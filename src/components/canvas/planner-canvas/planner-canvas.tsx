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
} from "./core/planner-constants";

import type {
  PlannerCanvasHandle,
  SelectedInfo,
  FurnitureType,
  GuideLine,
  RoomSize,
  CanvasSnapshotItem,
} from "./core/planner-types";

import { isFurniture, getSelectedInfo, makeId } from "./core/utils";
import {
  addFurniture,
  clampFurnitureInsideRoom,
  clampFurnitureInsideRoomPolygon,
  snapFurnitureToRoomGrid,
} from "./furniture/furniture";
import { fitRoomToView } from "./room/fit";
import { alignAndGuide, clearGuides } from "./selection/guides";
import { serializeState, restoreFromJson } from "./history/history";
import {
  saveNow,
  loadNow,
  exportJson as exportJsonFile,
  importJsonString as importJson,
} from "./persistence/persistence";

import {
  createRoomPolygon,
  createCornerHandles,
  attachWallEditing,
  getRoomPoints,
  setRoomPoints,
  syncHandlesToRoom,
} from "./room/room-walls";

import { createRenderScheduler } from "./core/render";

import {
  isOpening,
  snapOpeningToNearestWall,
  updateOpeningsForRoomChange,
} from "./openings/openings";

import { attachKeyboardController } from "./input/keyboard-controller";
import { attachMouseController } from "./input/mouse-controller";
import { createSelectionController } from "./selection/selection-controller";
import { createGridController } from "./grid/grid-controller";
import { createHistoryController } from "./history/history-controller";

type SelectionController = ReturnType<typeof createSelectionController>;
type GridController = ReturnType<typeof createGridController>;
type HistoryController = ReturnType<typeof createHistoryController>;

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

  const guidesRef = useRef<GuideLine[]>([]);

  // nudge batching
  const nudgeTimerRef = useRef<number | null>(null);
  const nudgeDirtyRef = useRef(false);

  // controllers
  const selectionRef = useRef<SelectionController | null>(null);
  const gridRef = useRef<GridController | null>(null);
  const historyRef = useRef<HistoryController | null>(null);

  // render
  const scheduleRenderRef = useRef<null | (() => void)>(null);

  // clipboard (now supports furniture + openings)
  const clipboardRef = useRef<CanvasSnapshotItem[] | null>(null);

  const safeRender = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    if (scheduleRenderRef.current) scheduleRenderRef.current();
    else canvas.requestRenderAll();
  };

  const getGridSize = () => gridRef.current?.getSize() ?? GRID_SIZE;

  const snapToGrid = (v: number, grid: number) => Math.round(v / grid) * grid;

  const getSelectedFurnitureObjects = (): any[] => {
    // name kept for compatibility; selection controller now returns furniture + openings
    return selectionRef.current?.getSelectedFurnitureObjects() ?? [];
  };

  const emitSelection = () => {
    selectionRef.current?.emitSelection();
  };

  const pushHistoryNow = () => {
    historyRef.current?.pushNow();
  };

  const undoInternal = () => {
    historyRef.current?.undo();
  };

  const redoInternal = () => {
    historyRef.current?.redo();
  };

  const cloneSelectedToClipboard = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const selected = getSelectedFurnitureObjects();
    if (selected.length === 0) return;

    clipboardRef.current = selected
      .filter((o) => isFurniture(o) || isOpening(o))
      .map((o: any): CanvasSnapshotItem => {
        // furniture
        if (isFurniture(o)) {
          return {
            left: o.left ?? 0,
            top: o.top ?? 0,
            width: o.width ?? 0,
            height: o.height ?? 0,
            angle: o.angle ?? 0,
            rx: o.rx,
            ry: o.ry,
            fill: o.fill,
            stroke: o.stroke,
            strokeWidth: o.strokeWidth ?? 2,
            scaleX: o.scaleX ?? 1,
            scaleY: o.scaleY ?? 1,
            data: {
              kind: "furniture",
              type: o.data?.type ?? "unknown",
              id: o.data?.id ?? makeId(),
              baseStroke: o.data?.baseStroke ?? "#10b981",
              baseStrokeWidth: o.data?.baseStrokeWidth ?? 2,
            },
          };
        }

        // opening
        return {
          left: o.left ?? 0,
          top: o.top ?? 0,
          width: o.width ?? 0,
          height: o.height ?? 0,
          angle: o.angle ?? 0,
          fill: o.fill,
          stroke: o.stroke,
          strokeWidth: o.strokeWidth ?? 2,
          scaleX: o.scaleX ?? 1,
          scaleY: o.scaleY ?? 1,
          data: {
            kind: "opening",
            type: o.data?.type ?? "door",
            id: o.data?.id ?? makeId(),
            segIndex: Number(o.data?.segIndex) || 0,
            t: typeof o.data?.t === "number" ? o.data.t : 0.5,
            offset: typeof o.data?.offset === "number" ? o.data.offset : 0,
          },
        };
      });
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
      // furniture
      if ((snap as any).data?.kind === "furniture") {
        const s: any = snap;

        const rect = new Rect({
          left: (s.left ?? 0) + grid,
          top: (s.top ?? 0) + grid,
          width: s.width ?? 60,
          height: s.height ?? 60,
          fill: s.fill ?? "rgba(16,185,129,0.25)",
          stroke: s.stroke ?? "#10b981",
          strokeWidth: s.strokeWidth ?? 2,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockScalingFlip: true,
          transparentCorners: false,
          angle: s.angle ?? 0,
          hoverCursor: "move",
        });

        if (typeof s.rx === "number" && typeof s.ry === "number") {
          rect.set({ rx: s.rx, ry: s.ry });
        }

        rect.scaleX = s.scaleX ?? 1;
        rect.scaleY = s.scaleY ?? 1;

        (rect as any).data = {
          kind: "furniture",
          type: s.data?.type ?? "unknown",
          id: makeId(),
          baseStroke: s.data?.baseStroke ?? "#10b981",
          baseStrokeWidth: s.data?.baseStrokeWidth ?? 2,
        };

        canvas.add(rect);

        clampFurnitureInsideRoomPolygon(rect as any, room as any);
        clampFurnitureInsideRoom(rect as any, room as any);
        snapFurnitureToRoomGrid(rect as any, room as any, grid);

        rect.setCoords();
        clones.push(rect);
        continue;
      }

      // opening
      if ((snap as any).data?.kind === "opening") {
        const s: any = snap;

        const rect = new Rect({
          left: (s.left ?? 0) + grid,
          top: (s.top ?? 0) + grid,
          width: s.width ?? 80,
          height: s.height ?? 10,
          fill:
            s.fill ??
            (s.data?.type === "window"
              ? "rgba(59,130,246,0.18)"
              : "rgba(245,158,11,0.25)"),
          stroke:
            s.stroke ?? (s.data?.type === "window" ? "#3b82f6" : "#f59e0b"),
          strokeWidth: s.strokeWidth ?? 2,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockScalingFlip: true,
          transparentCorners: false,
          angle: s.angle ?? 0,
          hoverCursor: "move",
          originX: "center",
          originY: "center",
        });

        rect.scaleX = s.scaleX ?? 1;
        rect.scaleY = s.scaleY ?? 1;

        (rect as any).data = {
          kind: "opening",
          type: s.data?.type ?? "door",
          id: makeId(),
          segIndex: Number(s.data?.segIndex) || 0,
          t: typeof s.data?.t === "number" ? s.data.t : 0.5,
          offset: typeof s.data?.offset === "number" ? s.data.offset : 0,
        };

        canvas.add(rect);

        // IMPORTANT: resnap to wall so it attaches to correct segment after paste
        snapOpeningToNearestWall(rect as any, room as any);

        rect.setCoords();
        clones.push(rect);
        continue;
      }
    }

    // set active selection
    canvas.discardActiveObject();
    if (clones.length === 1) {
      canvas.setActiveObject(clones[0]);
    } else if (clones.length > 1) {
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

    pushHistoryNow();
    safeRender();
  };

  const scheduleNudgeCommit = () => {
    nudgeDirtyRef.current = true;

    if (nudgeTimerRef.current) window.clearTimeout(nudgeTimerRef.current);

    nudgeTimerRef.current = window.setTimeout(() => {
      if (!nudgeDirtyRef.current) return;

      nudgeDirtyRef.current = false;
      pushHistoryNow();
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
      if (!skipClamp && isFurniture(o)) {
        clampFurnitureInsideRoomPolygon(o, room as any);
        clampFurnitureInsideRoom(o, room as any);
      }
      if (!skipClamp && isOpening(o)) {
        snapOpeningToNearestWall(o, room as any);
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

    pushHistoryNow();
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

    pushHistoryNow();
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
    pushHistoryNow();
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

    // ✅ Grid controller
    const grid = createGridController({
      canvas,
      roomRef,
      roomHandlesRef,
      scheduleRender,
      initial: { visible: true, size: GRID_SIZE },
    });
    gridRef.current = grid;

    // ✅ Selection + hover controller
    const selection = createSelectionController({
      canvas,
      onSelectionChange: (info) => onSelectionChangeRef.current?.(info),
      scheduleRender,
      clearGuides: () => clearGuides(canvas, guidesRef),
    });
    selection.attach();
    selectionRef.current = selection;

    // ✅ History controller
    const history = createHistoryController({
      canvas,
      storageKey: STORAGE_KEY,
      scheduleRender,
      serialize: () => serializeState(canvas),
      restore: (json) =>
        restoreFromJson(canvas, room as any, json, () =>
          onSelectionChangeRef.current?.(null)
        ),
      onAfterRestore: () => {
        // keep stack order + UI consistent after restore
        gridRef.current?.restack();
        selectionRef.current?.restyleAllFurniture();
        clearGuides(canvas, guidesRef);
        updateOpeningsForRoomChange(canvas, room as any);
      },
      autosaveExtra: () => {
        // keep room points saved together with item autosave
        try {
          const pts = getRoomPoints(room);
          localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify({ points: pts }));
        } catch {}
      },
    });
    historyRef.current = history;

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

        pushHistoryNow();

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

      // openings scaling is allowed (Fabric will handle) — we just keep selection updated
      if (!obj || (!isFurniture(obj) && !isOpening(obj))) {
        emitSelection();
        return;
      }

      // if Alt: free scale (no snapping)
      if (isAltPressedRef.current) {
        emitSelection();
        safeRender();
        return;
      }

      // only snap furniture scaling to grid
      if (!isFurniture(obj)) {
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
      if (obj && (isFurniture(obj) || isOpening(obj)) && isShiftPressedRef.current) {
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
        obj.setCoords();
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
        pushHistoryNow();
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

      pushHistoryNow();
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

    // ✅ history init (autoload if exists)
    history.initFromStorage();

    scheduleRender();

    return () => {
      window.removeEventListener("resize", resizeCanvasToContainer);

      detachMouse();
      detachKeyboard();

      selection.detach();
      selectionRef.current = null;

      grid.dispose();
      gridRef.current = null;

      history.dispose();
      historyRef.current = null;

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
        pushHistoryNow();
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

        for (const active of selected as any[]) {
          // ===== furniture =====
          if (isFurniture(active)) {
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
            continue;
          }

          // ===== opening =====
          if (isOpening(active)) {
            const rect = new Rect({
              left: (active.left ?? 0) + grid,
              top: (active.top ?? 0) + grid,
              width: active.width ?? 80,
              height: active.height ?? 10,
              fill: active.fill,
              stroke: active.stroke,
              strokeWidth: active.strokeWidth ?? 2,
              selectable: true,
              evented: true,
              hasControls: true,
              hasBorders: true,
              lockScalingFlip: true,
              transparentCorners: false,
              angle: active.angle ?? 0,
              hoverCursor: "move",
              originX: "center",
              originY: "center",
            });

            rect.scaleX = active.scaleX ?? 1;
            rect.scaleY = active.scaleY ?? 1;

            (rect as any).data = {
              kind: "opening",
              type: active.data?.type ?? "door",
              id: makeId(),
              segIndex: Number(active.data?.segIndex) || 0,
              t: typeof active.data?.t === "number" ? active.data.t : 0.5,
              offset: typeof active.data?.offset === "number" ? active.data.offset : 0,
            };

            canvas.add(rect);

            snapOpeningToNearestWall(rect as any, room as any);

            rect.setCoords();
            clones.push(rect);
          }
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

        pushHistoryNow();
        safeRender();
      },

      setSelectedProps(patch) {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const active = canvas.getActiveObject() as any;
        if (!active) return;

        // Do not support editing ActiveSelection from side panel (MVP)
        if (Array.isArray(active?._objects)) return;

        const isF = isFurniture(active);
        const isO = isOpening(active);

        if (!isF && !isO) return;

        // Apply width/height by scaling to match bounding rect size
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

        // Constraints
        if (isF) {
          clampFurnitureInsideRoomPolygon(active, room as any);
          clampFurnitureInsideRoom(active, room as any);

          snapFurnitureToRoomGrid(active, room as any, getGridSize());
        }

        if (isO) {
          snapOpeningToNearestWall(active, room as any);
        }

        active.setCoords();

        selectionRef.current?.restyleAllFurniture();
        clearGuides(canvas, guidesRef);

        onSelectionChangeRef.current?.(getSelectedInfo(active));
        pushHistoryNow();
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

        // reset undo stack to loaded snapshot
        const snap = layoutJson ?? serializeState(canvas);
        historyRef.current?.setHistoryFromSnapshot(snap);

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

        // reset undo stack to imported snapshot
        const snap = serializeState(canvas);
        historyRef.current?.setHistoryFromSnapshot(snap);

        pushHistoryNow();
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

      addDoor() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const { addDoor } = require("./openings/openings");
        addDoor(canvas, room as any);

        gridRef.current?.restack();
        pushHistoryNow();
        safeRender();
      },

      addWindow() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const { addWindow } = require("./openings/openings");
        addWindow(canvas, room as any);

        gridRef.current?.restack();
        pushHistoryNow();
        safeRender();
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
