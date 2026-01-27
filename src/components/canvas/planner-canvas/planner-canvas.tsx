"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Canvas, Rect, Line, Polygon, Circle } from "fabric";

import {
  GRID_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SENSITIVITY,
  ACTIVE_STROKE,
  ACTIVE_STROKE_WIDTH,
  HOVER_STROKE,
  HOVER_STROKE_WIDTH,
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

/** Grid (AABB) helper */
function drawGridLines(canvas: Canvas, room: any, gridSize: number) {
  const lines: Line[] = [];

  const roomRect = room.getBoundingRect();
  const stroke = room.strokeWidth ?? 0;
  const inset = stroke / 2;

  const left = roomRect.left + inset;
  const top = roomRect.top + inset;
  const right = roomRect.left + roomRect.width - inset;
  const bottom = roomRect.top + roomRect.height - inset;

  for (let x = left; x <= right; x += gridSize) {
    const l = new Line([x, top, x, bottom], {
      stroke: "#d1d5db",
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });
    canvas.add(l);
    lines.push(l);
  }

  for (let y = top; y <= bottom; y += gridSize) {
    const l = new Line([left, y, right, y], {
      stroke: "#d1d5db",
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });
    canvas.add(l);
    lines.push(l);
  }

  return lines;
}

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

  // grid
  const gridVisibleRef = useRef(true);
  const gridSizeRef = useRef<number>(GRID_SIZE);
  const gridLinesRef = useRef<Line[]>([]);

  // clipboard
  const clipboardRef = useRef<any[] | null>(null);

  // nudge batching
  const nudgeTimerRef = useRef<number | null>(null);
  const nudgeDirtyRef = useRef(false);

  const safeRender = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    if (scheduleRenderRef.current) scheduleRenderRef.current();
    else canvas.requestRenderAll();
  };

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

  const restyleAllFurniture = (canvas: Canvas) => {
    const active = canvas.getActiveObject() as any;

    canvas.getObjects().forEach((o: any) => {
      if (!isFurniture(o)) return;

      const baseStroke = o.data?.baseStroke ?? "#10b981";
      const baseStrokeWidth = o.data?.baseStrokeWidth ?? 2;

      if (active && o === active) {
        o.set({ stroke: ACTIVE_STROKE, strokeWidth: ACTIVE_STROKE_WIDTH });
      } else {
        o.set({ stroke: baseStroke, strokeWidth: baseStrokeWidth });
      }

      o.setCoords();
    });

    safeRender();
  };

  const pushHistoryNow = (canvas: Canvas) => {
    if (isApplyingHistoryRef.current) return;
    const snap = serializeState(canvas);
    pushHistory(historyRef, historyIndexRef, snap);
    scheduleAutosave();
  };

  const restackFixedBackground = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;

    canvas.sendObjectToBack(room);
    for (const l of gridLinesRef.current) canvas.sendObjectToBack(l);
    for (const h of roomHandlesRef.current) canvas.bringObjectToFront(h);
  };

  const rebuildGrid = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;

    for (const l of gridLinesRef.current) canvas.remove(l);
    gridLinesRef.current = [];

    if (gridVisibleRef.current) {
      gridLinesRef.current = drawGridLines(canvas, room, gridSizeRef.current);
    }

    restackFixedBackground();
    safeRender();
  };

  const setGridVisibleInternal = (visible: boolean) => {
    gridVisibleRef.current = visible;
    rebuildGrid();
  };

  const setGridSizeInternal = (size: number) => {
    const next = Number(size);
    if (!Number.isFinite(next) || next <= 5) return;
    gridSizeRef.current = next;
    rebuildGrid();
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

    restyleAllFurniture(canvas);
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

    restyleAllFurniture(canvas);
    clearGuides(canvas, guidesRef);
    scheduleAutosave();
    safeRender();
  };

  const snapToGrid = (v: number, grid: number) => Math.round(v / grid) * grid;

  const getSelectedFurnitureObjects = (canvas: Canvas): any[] => {
    const active: any = canvas.getActiveObject();
    if (!active) return [];

    const objs: any[] = Array.isArray(active?._objects)
      ? active._objects
      : [active];
    return objs.filter((o) => isFurniture(o));
  };

  const emitSelection = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const selected = getSelectedFurnitureObjects(canvas);

    if (selected.length === 0) {
      onSelectionChangeRef.current?.(null);
      return;
    }

    onSelectionChangeRef.current?.(getSelectedInfo(selected[0]));
  };

  const cloneSelectedToClipboard = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const selected = getSelectedFurnitureObjects(canvas);
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

    const grid = gridSizeRef.current ?? GRID_SIZE;
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
    restyleAllFurniture(canvas);
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

    const selected = getSelectedFurnitureObjects(canvas);
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
    restyleAllFurniture(canvas);
    clearGuides(canvas, guidesRef);
    safeRender();

    scheduleNudgeCommit();
  };

  const moveLayer = (dir: "up" | "down", toEdge: boolean) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const selected = getSelectedFurnitureObjects(canvas);
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

    restackFixedBackground();

    restyleAllFurniture(canvas);
    clearGuides(canvas, guidesRef);
    safeRender();

    pushHistoryNow(canvas);
  };

  const deleteSelectedInternal = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const selected = getSelectedFurnitureObjects(canvas);
    if (selected.length === 0) return;

    for (const o of selected) canvas.remove(o);

    canvas.discardActiveObject();
    onSelectionChangeRef.current?.(null);
    restyleAllFurniture(canvas);
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

    rebuildGrid();
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

    // room + handles
    const room = createRoomPolygon(canvas);
    roomRef.current = room;

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

          if (pts.length >= 3) setRoomPoints(room, pts);
        }
      } catch {}
    }

    const handles = createCornerHandles(canvas, room);
    roomHandlesRef.current = handles;

    attachWallEditing({
      canvas,
      room,
      handles,
      gridSize: gridSizeRef.current,
      onRoomChanging: () => {
        rebuildGrid();
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
        rebuildGrid();
        updateOpeningsForRoomChange(canvas, room as any);

        pushHistoryNow(canvas);

        try {
          const pts = getRoomPoints(room);
          localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify({ points: pts }));
        } catch {}
      },
    });

    rebuildGrid();

    const resizeCanvasToContainer = () => {
      const el = containerRef.current;
      if (!el) return;

      canvas.setDimensions({ width: el.clientWidth, height: el.clientHeight });
      canvas.calcOffset();
      fitRoomToView(canvas, room);
      rebuildGrid();
      scheduleRender();
    };

    resizeCanvasToContainer();
    window.addEventListener("resize", resizeCanvasToContainer);

    // zoom
    canvas.on("mouse:wheel", (opt) => {
      const event = opt.e as WheelEvent;

      let zoom = canvas.getZoom();
      zoom *= ZOOM_SENSITIVITY ** event.deltaY;
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

      canvas.zoomToPoint({ x: event.offsetX, y: event.offsetY }, zoom);

      event.preventDefault();
      event.stopPropagation();
      scheduleRender();
    });

    // pan
    let isPanning = false;
    let lastClientX = 0;
    let lastClientY = 0;

    canvas.on("mouse:down", (opt) => {
      if (!isSpacePressedRef.current) return;

      const e = opt.e as MouseEvent;
      isPanning = true;
      canvas.selection = false;
      canvas.defaultCursor = "grabbing";
      lastClientX = e.clientX;
      lastClientY = e.clientY;
    });

    canvas.on("mouse:move", (opt) => {
      if (!isPanning) return;

      const e = opt.e as MouseEvent;
      const vpt = canvas.viewportTransform!;
      vpt[4] += e.clientX - lastClientX;
      vpt[5] += e.clientY - lastClientY;

      lastClientX = e.clientX;
      lastClientY = e.clientY;

      scheduleRender();
    });

    canvas.on("mouse:up", () => {
      isPanning = false;
      canvas.selection = true;
      canvas.defaultCursor = "default";
      clearGuides(canvas, guidesRef);
      scheduleRender();
    });

    // selection events
    canvas.on("selection:created", () => {
      emitSelection();
      restyleAllFurniture(canvas);
      clearGuides(canvas, guidesRef);
      scheduleRender();
    });

    canvas.on("selection:updated", () => {
      emitSelection();
      restyleAllFurniture(canvas);
      clearGuides(canvas, guidesRef);
      scheduleRender();
    });

    canvas.on("selection:cleared", () => {
      onSelectionChangeRef.current?.(null);
      restyleAllFurniture(canvas);
      clearGuides(canvas, guidesRef);
      scheduleRender();
    });

    // hover
    canvas.on("mouse:over", (opt) => {
      const t = opt.target as any;
      if (!t || !isFurniture(t)) return;

      const active = canvas.getActiveObject() as any;
      if (active && (active === t || Array.isArray(active?._objects))) return;

      t.set({ stroke: HOVER_STROKE, strokeWidth: HOVER_STROKE_WIDTH });
      t.setCoords();
      scheduleRender();
    });

    canvas.on("mouse:out", (opt) => {
      const t = opt.target as any;
      if (!t || !isFurniture(t)) return;

      const active = canvas.getActiveObject() as any;
      if (active && (active === t || Array.isArray(active?._objects))) return;

      const baseStroke = t.data?.baseStroke ?? "#10b981";
      const baseStrokeWidth = t.data?.baseStrokeWidth ?? 2;
      t.set({ stroke: baseStroke, strokeWidth: baseStrokeWidth });
      t.setCoords();
      scheduleRender();
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

      const grid = gridSizeRef.current ?? GRID_SIZE;

      const rect = obj.getBoundingRect(false, true);
      const targetW = Math.max(grid, snapToGrid(rect.width, grid));
      const targetH = Math.max(grid, snapToGrid(rect.height, grid));

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

      const grid = gridSizeRef.current;

      snapFurnitureToRoomGrid(obj, room as any, grid);

      clampFurnitureInsideRoomPolygon(obj, room as any);
      clampFurnitureInsideRoom(obj, room as any);

      obj.setCoords();
      emitSelection();
      restyleAllFurniture(canvas);
      clearGuides(canvas, guidesRef);

      pushHistoryNow(canvas);
      scheduleRender();
    });

    // ✅ Keyboard controller (extracted)
    const detachKeyboard = attachKeyboardController({
      canvas,
      isSpacePressedRef,
      isShiftPressedRef,
      isAltPressedRef,
      getGridSize: () => gridSizeRef.current ?? GRID_SIZE,
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

    // autoload
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        isApplyingHistoryRef.current = true;
        restoreFromJson(canvas, room as any, saved, () =>
          onSelectionChangeRef.current?.(null)
        );
        isApplyingHistoryRef.current = false;

        restyleAllFurniture(canvas);
        historyRef.current = [saved];
        historyIndexRef.current = 0;
      } catch {
        isApplyingHistoryRef.current = false;
      }
    } else {
      restyleAllFurniture(canvas);
    }

    scheduleRender();

    return () => {
      window.removeEventListener("resize", resizeCanvasToContainer);

      detachKeyboard();

      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      if (nudgeTimerRef.current) {
        window.clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }

      clearGuides(canvas, guidesRef);

      for (const l of gridLinesRef.current) canvas.remove(l);
      gridLinesRef.current = [];

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
        restyleAllFurniture(canvas);
        pushHistoryNow(canvas);
      },

      deleteSelected() {
        deleteSelectedInternal();
      },

      duplicateSelected() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const selected = getSelectedFurnitureObjects(canvas);
        if (selected.length === 0) return;

        const grid = gridSizeRef.current ?? GRID_SIZE;
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
        restyleAllFurniture(canvas);
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
        snapFurnitureToRoomGrid(active, room as any, gridSizeRef.current);

        active.setCoords();
        restyleAllFurniture(canvas);
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

        rebuildGrid();
        updateOpeningsForRoomChange(canvas, room as any);
        restyleAllFurniture(canvas);

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

        rebuildGrid();
        updateOpeningsForRoomChange(canvas, room as any);
        restyleAllFurniture(canvas);

        const stored = localStorage.getItem(STORAGE_KEY) ?? null;
        historyRef.current = [stored ?? serializeState(canvas)];
        historyIndexRef.current = 0;

        pushHistoryNow(canvas);
        safeRender();
      },

      setGridVisible(visible: boolean) {
        setGridVisibleInternal(visible);
      },

      setGridSize(size: number) {
        setGridSizeInternal(size);
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
