// src/components/canvas/planner-canvas/planner-canvas.tsx
"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Canvas, Rect, Polygon, Circle } from "fabric";

import {
  GRID_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SENSITIVITY,
  STORAGE_KEY,
  STORAGE_ROOM_KEY,
} from "./planner-constants";

import type {
  PlannerCanvasHandle,
  SelectedInfo,
  FurnitureType,
  GuideLine,
  RoomSize,
} from "./planner-types";

import { isFurniture, getSelectedInfo, makeId } from "./utils";
import {
  addFurniture,
  clampFurnitureInsideRoom,
  clampFurnitureInsideRoomPolygon,
  snapFurnitureToRoomGrid,
} from "./furniture";
import { fitRoomToView } from "./fit";
import { alignAndGuide, clearGuides } from "./guides";
import { serializeState, restoreFromJson, pushHistory } from "./history";
import {
  saveNow,
  loadNow,
  exportJson as exportJsonFile,
  importJsonString as importJson,
} from "./persistence";

import {
  createRoomPolygon,
  createCornerHandles,
  attachWallEditing,
  getRoomPoints,
  setRoomPoints,
  syncHandlesToRoom,
} from "./room-walls";

import { createRenderScheduler } from "./render";

import {
  isOpening,
  snapOpeningToNearestWall,
  updateOpeningsForRoomChange,
} from "./openings";

import { attachKeyboardController } from "./keyboard-controller";
import { attachMouseController } from "./mouse-controller";
import { createSelectionController } from "./selection-controller";
import { createGridController } from "./grid-controller";

type SelectionController = ReturnType<typeof createSelectionController>;
type GridController = ReturnType<typeof createGridController>;

export default forwardRef<
  PlannerCanvasHandle,
  { onSelectionChange?: (info: SelectedInfo | null) => void }
  >(function PlannerCanvas({ onSelectionChange }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const fabricCanvasRef = useRef<Canvas | null>(null);

  // ROOM polygon
  const roomRef = useRef<Polygon | null>(null);
  const roomHandlesRef = useRef<Circle[]>([]);

  // keyboard state
  const isSpacePressedRef = useRef(false);
  const isShiftPressedRef = useRef(false);
  const isAltPressedRef = useRef(false);

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const guidesRef = useRef<GuideLine[]>([]);
  const autosaveTimerRef = useRef<number | null>(null);
  const isApplyingHistoryRef = useRef(false);

  // render
  const scheduleRenderRef = useRef<null | (() => void)>(null);

  // clipboard
  const clipboardRef = useRef<any[] | null>(null);

  // nudge batching
  const nudgeTimerRef = useRef<number | null>(null);
  const nudgeDirtyRef = useRef(false);

  // controllers
  const selectionRef = useRef<SelectionController | null>(null);
  const gridRef = useRef<GridController | null>(null);

  const safeRender = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    if (scheduleRenderRef.current) scheduleRenderRef.current();
    else canvas.requestRenderAll();
  };

  const getGridSize = () => gridRef.current?.getSize() ?? GRID_SIZE;

  const scheduleAutosave = () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      const canvas = fabricCanvasRef.current;
      const room = roomRef.current;
      if (!canvas || !room) return;

      try {
        const json = serializeState(canvas);
        localStorage.setItem(STORAGE_KEY, json);

        const pts = getRoomPoints(room);
        localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify({ points: pts }));
      } catch {}
    }, 350);
  };

  const pushHistoryNow = (canvas: Canvas) => {
    if (isApplyingHistoryRef.current) return;
    const snap = serializeState(canvas);
    pushHistory(historyRef, historyIndexRef, snap);
    scheduleAutosave();
  };

  const undoInternal = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;
    if (historyIndexRef.current <= 0) return;

    historyIndexRef.current -= 1;

    isApplyingHistoryRef.current = true;
    restoreFromJson(
      canvas,
      room as any,
      historyRef.current[historyIndexRef.current],
      () => onSelectionChangeRef.current?.(null)
    );
    isApplyingHistoryRef.current = false;

    selectionRef.current?.restyleAllFurniture();
    clearGuides(canvas, guidesRef);
    scheduleAutosave();
    safeRender();
  };

  const redoInternal = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;
    if (historyIndexRef.current >= historyRef.current.length - 1) return;

    historyIndexRef.current += 1;

    isApplyingHistoryRef.current = true;
    restoreFromJson(
      canvas,
      room as any,
      historyRef.current[historyIndexRef.current],
      () => onSelectionChangeRef.current?.(null)
    );
    isApplyingHistoryRef.current = false;

    selectionRef.current?.restyleAllFurniture();
    clearGuides(canvas, guidesRef);
    scheduleAutosave();
    safeRender();
  };

  const snapToGrid = (v: number, grid: number) => Math.round(v / grid) * grid;

  const getSelectedFurnitureObjects = (): any[] => {
    return selectionRef.current?.getSelectedFurnitureObjects() ?? [];
  };

  const emitSelection = () => {
    selectionRef.current?.emitSelection();
  };

  const cloneSelectedToClipboard = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const selected = getSelectedFurnitureObjects();
    if (selected.length === 0) return;

    clipboardRef.current = selected.map((active: any) => ({
      left: active.left ?? 0,
      top: active.top ?? 0,
      width: active.width ?? 0,
      height: active.height ?? 0,
      angle: active.angle ?? 0,
      rx: active.rx,
      ry: active.ry,
      fill: active.fill,
      stroke: active.stroke,
      strokeWidth: active.strokeWidth ?? 2,
      scaleX: active.scaleX ?? 1,
      scaleY: active.scaleY ?? 1,
      data: {
        kind: "furniture",
        type: active.data?.type ?? "unknown",
        baseStroke: active.data?.baseStroke ?? "#10b981",
        baseStrokeWidth: active.data?.baseStrokeWidth ?? 2,
      },
    }));
  };

  const pasteFromClipboard = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;

    const snaps = clipboardRef.current;
    if (!snaps || snaps.length === 0) return;

    const grid = getGridSize();
    const clones: Rect[] = [];

    for (const snap of snaps) {
      const rect = new Rect({
        left: (snap.left ?? 0) + grid,
        top: (snap.top ?? 0) + grid,
        width: snap.width ?? 60,
        height: snap.height ?? 60,
        fill: snap.fill ?? "rgba(16,185,129,0.25)",
        stroke: snap.stroke ?? "#10b981",
        strokeWidth: snap.strokeWidth ?? 2,
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
        lockScalingFlip: true,
        transparentCorners: false,
        angle: snap.angle ?? 0,
        hoverCursor: "move",
      });

      if (typeof snap.rx === "number" && typeof snap.ry === "number") {
        rect.set({ rx: snap.rx, ry: snap.ry });
      }

      rect.scaleX = snap.scaleX ?? 1;
      rect.scaleY = snap.scaleY ?? 1;

      (rect as any).data = {
        kind: "furniture",
        type: snap.data?.type ?? "unknown",
        id: makeId(),
        baseStroke: snap.data?.baseStroke ?? "#10b981",
        baseStrokeWidth: snap.data?.baseStrokeWidth ?? 2,
      };

      canvas.add(rect);

      clampFurnitureInsideRoomPolygon(rect as any, room as any);
      clampFurnitureInsideRoom(rect as any, room as any);
      snapFurnitureToRoomGrid(rect as any, room as any, grid);

      rect.setCoords();
      clones.push(rect);
    }

    canvas.discardActiveObject();
    if (clones.length === 1) {
      canvas.setActiveObject(clones[0]);
    } else {
      const anyCanvas: any = canvas as any;
      const ActiveSelectionCtor =
        anyCanvas?.ActiveSelection || (window as any)?.fabric?.ActiveSelection;
      if (ActiveSelectionCtor) {
        const sel = new ActiveSelectionCtor(clones, { canvas });
        canvas.setActiveObject(sel);
      } else {
        canvas.setActiveObject(clones[0]);
      }
    }

    emitSelection();
    selectionRef.current?.restyleAllFurniture();
    clearGuides(canvas, guidesRef);

    pushHistoryNow(canvas);
    safeRender();
  };

  const scheduleNudgeCommit = () => {
    nudgeDirtyRef.current = true;

    if (nudgeTimerRef.current) window.clearTimeout(nudgeTimerRef.current);

    nudgeTimerRef.current = window.setTimeout(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      if (!nudgeDirtyRef.current) return;

      nudgeDirtyRef.current = false;
      pushHistoryNow(canvas);
    }, 220);
  };

  const nudgeSelected = (dx: number, dy: number, skipClamp = false) => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;

    const selected = getSelectedFurnitureObjects();
    if (selected.length === 0) return;

    for (const o of selected) {
      o.set({
        left: (o.left ?? 0) + dx,
        top: (o.top ?? 0) + dy,
      });
      o.setCoords();
      if (!skipClamp) {
        clampFurnitureInsideRoomPolygon(o, room as any);
        clampFurnitureInsideRoom(o, room as any);
      }
      o.setCoords();
    }

    const active: any = canvas.getActiveObject();
    if (active && Array.isArray(active?._objects)) {
      active.setCoords?.();
    }

    emitSelection();
    selectionRef.current?.restyleAllFurniture();
    clearGuides(canvas, guidesRef);
    safeRender();

    scheduleNudgeCommit();
  };

  const moveLayer = (dir: "up" | "down", toEdge: boolean) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const selected = getSelectedFurnitureObjects();
    if (selected.length === 0) return;

    const objs = dir === "up" ? [...selected] : [...selected].reverse();

    for (const o of objs) {
      if (toEdge) {
        if (dir === "up") canvas.bringObjectToFront(o);
        else canvas.sendObjectToBack(o);
      } else {
        if (dir === "up") canvas.bringObjectForward(o);
        else canvas.sendObjectBackwards(o);
      }
    }

    // ensure room/grid/handles correct
    gridRef.current?.restack();

    selectionRef.current?.restyleAllFurniture();
    clearGuides(canvas, guidesRef);
    safeRender();

    pushHistoryNow(canvas);
  };

  const deleteSelectedInternal = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const selected = getSelectedFurnitureObjects();
    if (selected.length === 0) return;

    for (const o of selected) canvas.remove(o);

    canvas.discardActiveObject();
    onSelectionChangeRef.current?.(null);

    selectionRef.current?.restyleAllFurniture();
    clearGuides(canvas, guidesRef);

    pushHistoryNow(canvas);
    safeRender();
  };

  // ===== Room API (bbox) =====
  const getRoomSizeInternal = (): RoomSize => {
    const room = roomRef.current;
    if (!room) return { width: 0, height: 0 };

    const r = room.getBoundingRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  };

  const setRoomSizeInternal = (size: RoomSize) => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;

    const min = 200;

    const targetW = Math.max(min, Math.round(Number(size.width)));
    const targetH = Math.max(min, Math.round(Number(size.height)));

    const r = room.getBoundingRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    const left = cx - targetW / 2;
    const top = cy - targetH / 2;

    const pts = [
      { x: left, y: top },
      { x: left + targetW, y: top },
      { x: left + targetW, y: top + targetH },
      { x: left, y: top + targetH },
    ];

    setRoomPoints(room, pts);
    syncHandlesToRoom(roomHandlesRef.current, room);

    gridRef.current?.rebuild();
    updateOpeningsForRoomChange(canvas, room as any);

    canvas.getObjects().forEach((o: any) => {
      if (!isFurniture(o)) return;
      clampFurnitureInsideRoomPolygon(o, room as any);
      clampFurnitureInsideRoom(o, room as any);
      o.setCoords();
    });

    fitRoomToView(canvas, room);
    clearGuides(canvas, guidesRef);
    safeRender();

    localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify({ points: pts }));
    pushHistoryNow(canvas);
  };

  useEffect(() => {
    if (!htmlCanvasRef.current) return;

    const canvas = new Canvas(htmlCanvasRef.current, {
      backgroundColor: "#fafafa",
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;

    const scheduleRender = createRenderScheduler(canvas);
    scheduleRenderRef.current = scheduleRender;

    // === Create room polygon + handles ===
    const room = createRoomPolygon(canvas);
    roomRef.current = room;

    // Load saved room points (if any)
    const savedRoom = localStorage.getItem(STORAGE_ROOM_KEY);
    if (savedRoom) {
      try {
        const parsed = JSON.parse(savedRoom);
        if (parsed?.points && Array.isArray(parsed.points)) {
          const pts = parsed.points
            .filter(
              (p: any) => p && typeof p.x === "number" && typeof p.y === "number"
            )
            .map((p: any) => ({ x: p.x, y: p.y }));

          if (pts.length >= 3) {
            setRoomPoints(room, pts);
          }
        }
      } catch {}
    }

    const handles = createCornerHandles(canvas, room);
    roomHandlesRef.current = handles;

    // ✅ Grid controller (extracted)
    const grid = createGridController({
      canvas,
      roomRef,
      roomHandlesRef,
      scheduleRender,
      initial: { visible: true, size: GRID_SIZE },
    });
    gridRef.current = grid;

    // ✅ Selection + hover controller (extracted)
    const selection = createSelectionController({
      canvas,
      onSelectionChange: (info) => onSelectionChangeRef.current?.(info),
      scheduleRender,
      clearGuides: () => clearGuides(canvas, guidesRef),
    });
    selection.attach();
    selectionRef.current = selection;

    attachWallEditing({
      canvas,
      room,
      handles,
      gridSize: getGridSize(),
      onRoomChanging: () => {
        grid.rebuild();
        updateOpeningsForRoomChange(canvas, room as any);

        canvas.getObjects().forEach((o: any) => {
          if (!isFurniture(o)) return;
          clampFurnitureInsideRoomPolygon(o, room as any);
          clampFurnitureInsideRoom(o, room as any);
          o.setCoords();
        });

        clearGuides(canvas, guidesRef);
        safeRender();
      },
      onRoomChanged: () => {
        fitRoomToView(canvas, room);
        grid.rebuild();
        updateOpeningsForRoomChange(canvas, room as any);

        pushHistoryNow(canvas);

        try {
          const pts = getRoomPoints(room);
          localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify({ points: pts }));
        } catch {}
      },
    });

    grid.rebuild();

    const resizeCanvasToContainer = () => {
      const el = containerRef.current;
      if (!el) return;

      canvas.setDimensions({ width: el.clientWidth, height: el.clientHeight });
      canvas.calcOffset();
      fitRoomToView(canvas, room);
      grid.rebuild();
      scheduleRender();
    };

    resizeCanvasToContainer();
    window.addEventListener("resize", resizeCanvasToContainer);

    // ✅ Mouse controller
    const detachMouse = attachMouseController({
      canvas,
      isSpacePressedRef,
      zoom: { min: ZOOM_MIN, max: ZOOM_MAX, sensitivity: ZOOM_SENSITIVITY },
      scheduleRender,
      onPanEnd: () => clearGuides(canvas, guidesRef),
    });

    // transforms
    canvas.on("object:scaling", (opt) => {
      const obj = opt.target as any;
      if (!obj || !isFurniture(obj)) {
        emitSelection();
        return;
      }

      if (isAltPressedRef.current) {
        emitSelection();
        safeRender();
        return;
      }

      const gridSize = getGridSize();

      const rect = obj.getBoundingRect(false, true);
      const targetW = Math.max(gridSize, snapToGrid(rect.width, gridSize));
      const targetH = Math.max(gridSize, snapToGrid(rect.height, gridSize));

      const baseW = Math.max(1, obj.width ?? 1);
      const baseH = Math.max(1, obj.height ?? 1);

      const nextScaleX = targetW / baseW;
      const nextScaleY = targetH / baseH;

      if (Number.isFinite(nextScaleX)) obj.scaleX = nextScaleX;
      if (Number.isFinite(nextScaleY)) obj.scaleY = nextScaleY;

      obj.setCoords();

      emitSelection();
      safeRender();
    });

    canvas.on("object:rotating", (opt) => {
      const obj = opt.target as any;
      if (obj && isFurniture(obj) && isShiftPressedRef.current) {
        const step = 15;
        const a = obj.angle ?? 0;
        obj.angle = Math.round(a / step) * step;
        obj.setCoords();
      }
      emitSelection();
      scheduleRender();
    });

    canvas.on("object:moving", (opt) => {
      const obj = opt.target as any;
      if (!obj) return;

      // openings snap to wall
      if (isOpening(obj)) {
        snapOpeningToNearestWall(obj, room as any);
        obj.setCoords();
        emitSelection();
        scheduleRender();
        return;
      }

      if (!isFurniture(obj)) return;

      obj.setCoords();

      clampFurnitureInsideRoomPolygon(obj, room as any);
      clampFurnitureInsideRoom(obj, room as any);

      if (!isShiftPressedRef.current) {
        alignAndGuide(canvas, room as any, guidesRef, obj);
      } else {
        clearGuides(canvas, guidesRef);
      }

      emitSelection();
      scheduleRender();
    });

    canvas.on("object:modified", (opt) => {
      const obj = opt.target as any;
      if (!obj) return;

      if (isOpening(obj)) {
        snapOpeningToNearestWall(obj, room as any);
        obj.setCoords();
        emitSelection();
        pushHistoryNow(canvas);
        scheduleRender();
        return;
      }

      if (!isFurniture(obj)) return;

      const gridSize = getGridSize();

      snapFurnitureToRoomGrid(obj, room as any, gridSize);

      clampFurnitureInsideRoomPolygon(obj, room as any);
      clampFurnitureInsideRoom(obj, room as any);

      obj.setCoords();
      emitSelection();
      selectionRef.current?.restyleAllFurniture();
      clearGuides(canvas, guidesRef);

      pushHistoryNow(canvas);
      scheduleRender();
    });

    // ✅ Keyboard controller
    const detachKeyboard = attachKeyboardController({
      canvas,
      isSpacePressedRef,
      isShiftPressedRef,
      isAltPressedRef,
      getGridSize: () => getGridSize(),
      actions: {
        moveLayer,
        nudgeSelected,
        copySelected: cloneSelectedToClipboard,
        paste: pasteFromClipboard,
        undo: undoInternal,
        redo: redoInternal,
        deleteSelected: deleteSelectedInternal,
      },
    });

    // history init
    pushHistoryNow(canvas);

    // autoload items
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        isApplyingHistoryRef.current = true;
        restoreFromJson(canvas, room as any, saved, () =>
          onSelectionChangeRef.current?.(null)
        );
        isApplyingHistoryRef.current = false;

        selectionRef.current?.restyleAllFurniture();
        historyRef.current = [saved];
        historyIndexRef.current = 0;
      } catch {
        isApplyingHistoryRef.current = false;
      }
    } else {
      selectionRef.current?.restyleAllFurniture();
    }

    scheduleRender();

    return () => {
      window.removeEventListener("resize", resizeCanvasToContainer);

      detachMouse();
      detachKeyboard();

      selection.detach();
      selectionRef.current = null;

      grid.dispose();
      gridRef.current = null;

      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      if (nudgeTimerRef.current) {
        window.clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }

      clearGuides(canvas, guidesRef);

      for (const h of roomHandlesRef.current) canvas.remove(h);
      roomHandlesRef.current = [];

      canvas.dispose();

      fabricCanvasRef.current = null;
      roomRef.current = null;
      scheduleRenderRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      addFurniture(type: FurnitureType) {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        addFurniture(canvas, room as any, type);

        selectionRef.current?.restyleAllFurniture();
        pushHistoryNow(canvas);
      },

      deleteSelected() {
        deleteSelectedInternal();
      },

      duplicateSelected() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const selected = getSelectedFurnitureObjects();
        if (selected.length === 0) return;

        const grid = getGridSize();
        const clones: Rect[] = [];

        for (const active of selected) {
          const rect = new Rect({
            left: (active.left ?? 0) + grid,
            top: (active.top ?? 0) + grid,
            width: active.width,
            height: active.height,
            fill: active.fill,
            stroke: active.stroke,
            strokeWidth: active.strokeWidth,
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true,
            lockScalingFlip: true,
            transparentCorners: false,
            angle: active.angle ?? 0,
            hoverCursor: "move",
          });

          if (active.rx && active.ry) rect.set({ rx: active.rx, ry: active.ry });

          rect.scaleX = active.scaleX ?? 1;
          rect.scaleY = active.scaleY ?? 1;

          (rect as any).data = {
            kind: "furniture",
            type: active.data?.type ?? "unknown",
            id: makeId(),
            baseStroke: active.data?.baseStroke ?? "#10b981",
            baseStrokeWidth: active.data?.baseStrokeWidth ?? 2,
          };

          canvas.add(rect);

          clampFurnitureInsideRoomPolygon(rect as any, room as any);
          clampFurnitureInsideRoom(rect as any, room as any);
          snapFurnitureToRoomGrid(rect as any, room as any, grid);

          rect.setCoords();
          clones.push(rect);
        }

        canvas.discardActiveObject();
        if (clones.length === 1) {
          canvas.setActiveObject(clones[0]);
        } else {
          const anyCanvas: any = canvas as any;
          const ActiveSelectionCtor =
            anyCanvas?.ActiveSelection || (window as any)?.fabric?.ActiveSelection;
          if (ActiveSelectionCtor) {
            const sel = new ActiveSelectionCtor(clones, { canvas });
            canvas.setActiveObject(sel);
          } else {
            canvas.setActiveObject(clones[0]);
          }
        }

        emitSelection();
        selectionRef.current?.restyleAllFurniture();
        clearGuides(canvas, guidesRef);

        pushHistoryNow(canvas);
        safeRender();
      },

      setSelectedProps(patch) {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const active = canvas.getActiveObject() as any;
        if (!active || !isFurniture(active) || Array.isArray(active?._objects))
          return;

        if (typeof patch.width === "number" && patch.width > 1) {
          const current = active.getBoundingRect(false, true).width;
          const factor = patch.width / Math.max(1, current);
          active.scaleX = (active.scaleX ?? 1) * factor;
        }

        if (typeof patch.height === "number" && patch.height > 1) {
          const current = active.getBoundingRect(false, true).height;
          const factor = patch.height / Math.max(1, current);
          active.scaleY = (active.scaleY ?? 1) * factor;
        }

        if (typeof patch.angle === "number") active.angle = patch.angle;

        active.setCoords();

        clampFurnitureInsideRoomPolygon(active, room as any);
        clampFurnitureInsideRoom(active, room as any);
        snapFurnitureToRoomGrid(active, room as any, getGridSize());

        active.setCoords();
        selectionRef.current?.restyleAllFurniture();
        clearGuides(canvas, guidesRef);

        onSelectionChangeRef.current?.(getSelectedInfo(active));
        pushHistoryNow(canvas);
        safeRender();
      },

      fitRoom() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        fitRoomToView(canvas, room);
        clearGuides(canvas, guidesRef);
        safeRender();
      },

      undo() {
        undoInternal();
      },

      redo() {
        redoInternal();
      },

      save() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;
        saveNow(canvas, room);
      },

      load() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const { layoutJson } = loadNow(canvas, room, () =>
          onSelectionChangeRef.current?.(null)
        );

        syncHandlesToRoom(roomHandlesRef.current, room);

        gridRef.current?.rebuild();
        updateOpeningsForRoomChange(canvas, room as any);
        selectionRef.current?.restyleAllFurniture();

        if (layoutJson) {
          historyRef.current = [layoutJson];
          historyIndexRef.current = 0;
          scheduleAutosave();
        }

        safeRender();
      },

      exportJson() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;
        exportJsonFile(canvas, room);
      },

      importJsonString(json: string) {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        importJson(canvas, room, json, () =>
          onSelectionChangeRef.current?.(null)
        );

        syncHandlesToRoom(roomHandlesRef.current, room);

        gridRef.current?.rebuild();
        updateOpeningsForRoomChange(canvas, room as any);
        selectionRef.current?.restyleAllFurniture();

        const stored = localStorage.getItem(STORAGE_KEY) ?? null;
        historyRef.current = [stored ?? serializeState(canvas)];
        historyIndexRef.current = 0;

        pushHistoryNow(canvas);
        safeRender();
      },

      setGridVisible(visible: boolean) {
        gridRef.current?.setVisible(visible);
      },

      setGridSize(size: number) {
        gridRef.current?.setSize(size);
      },

      getRoomSize() {
        return getRoomSizeInternal();
      },

      setRoomSize(size: RoomSize) {
        setRoomSizeInternal(size);
      },
    }),
    []
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-white border border-neutral-300 overflow-hidden"
    >
      <canvas ref={htmlCanvasRef} />
    </div>
  );
});
