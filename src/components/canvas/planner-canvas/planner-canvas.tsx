"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Canvas, Polygon, Circle } from "fabric";

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

import { isFurniture } from "./core/utils";

import {
  addFurniture as addFurnitureImpl,
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

import { createCanvasActions } from "./actions/canvas-actions";

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

  // clipboard (supports furniture + openings)
  const clipboardRef = useRef<CanvasSnapshotItem[] | null>(null);

  // actions controller
  const actionsRef = useRef<ReturnType<typeof createCanvasActions> | null>(
    null
  );

  const safeRender = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    if (scheduleRenderRef.current) scheduleRenderRef.current();
    else canvas.requestRenderAll();
  };

  const getGridSize = () => gridRef.current?.getSize() ?? GRID_SIZE;

  const snapToGrid = (v: number, grid: number) => Math.round(v / grid) * grid;

  // tiny helpers still used by Fabric event handlers
  const emitSelection = () => {
    selectionRef.current?.emitSelection();
  };

  const pushHistoryNow = () => {
    historyRef.current?.pushNow();
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
              (p: any) =>
                p && typeof p.x === "number" && typeof p.y === "number"
            )
            .map((p: any) => ({ x: p.x, y: p.y }));

          if (pts.length >= 3) setRoomPoints(room, pts);
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
        gridRef.current?.restack();
        selectionRef.current?.restyleAllFurniture();
        clearGuides(canvas, guidesRef);
        updateOpeningsForRoomChange(canvas, room as any);
      },
      autosaveExtra: () => {
        try {
          const pts = getRoomPoints(room);
          localStorage.setItem(
            STORAGE_ROOM_KEY,
            JSON.stringify({ points: pts })
          );
        } catch {}
      },
    });
    historyRef.current = history;

    // ✅ Actions controller (all imperative object actions)
    actionsRef.current = createCanvasActions({
      getCanvas: () => fabricCanvasRef.current,
      getRoom: () => roomRef.current,

      getGridSize: () => getGridSize(),
      safeRender,

      selection: () => selectionRef.current as any,
      grid: () => gridRef.current as any,
      history: () => historyRef.current as any,

      onSelectionChange: (info) => onSelectionChangeRef.current?.(info),

      guidesRef,
      clipboardRef,

      scheduleNudgeCommit,
    });

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
          localStorage.setItem(
            STORAGE_ROOM_KEY,
            JSON.stringify({ points: pts })
          );
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
      if (
        obj &&
        (isFurniture(obj) || isOpening(obj)) &&
        isShiftPressedRef.current
      ) {
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

      if (obj.type === "activeSelection" || Array.isArray(obj?._objects)) {
        clearGuides(canvas, guidesRef);
        return;
      }

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

      const shiftDown = isShiftPressedRef.current;
      if (!shiftDown) {
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

    // ✅ Keyboard controller (wired to actions controller)
    const actions = actionsRef.current;
    if (!actions) {
      // should never happen, but avoid crashing
      return () => {
        window.removeEventListener("resize", resizeCanvasToContainer);
        detachMouse();
        selection.detach();
        grid.dispose();
        history.dispose();
        canvas.dispose();
      };
    }

    const detachKeyboard = attachKeyboardController({
      canvas,
      isSpacePressedRef,
      isShiftPressedRef,
      isAltPressedRef,
      getGridSize: () => getGridSize(),
      actions: {
        moveLayer: actions.moveLayer,
        nudgeSelected: actions.nudgeSelected,
        copySelected: actions.copySelected,
        paste: actions.paste,
        undo: actions.undo,
        redo: actions.redo,
        deleteSelected: actions.deleteSelected,
      },
    });

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
      actionsRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      addFurniture(type: FurnitureType) {
        // keep this local for now or delegate — either is fine
        // delegate to actions to keep all actions centralized
        actionsRef.current?.addFurniture(type);
      },

      deleteSelected() {
        actionsRef.current?.deleteSelected();
      },

      duplicateSelected() {
        actionsRef.current?.duplicateSelected();
      },

      setSelectedProps(patch) {
        actionsRef.current?.setSelectedProps(patch);
      },

      fitRoom() {
        actionsRef.current?.fitRoom();
      },

      undo() {
        actionsRef.current?.undo();
      },

      redo() {
        actionsRef.current?.redo();
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
        actionsRef.current?.addDoor();
      },

      addWindow() {
        actionsRef.current?.addWindow();
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
