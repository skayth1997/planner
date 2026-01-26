"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Canvas, Line, Rect } from "fabric";

const GRID_SIZE = 50;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_SENSITIVITY = 0.999;

const STORAGE_KEY = "planner:v1";

type FurnitureType = "sofa" | "table" | "chair";

export type SelectedInfo = {
  id: string;
  type: FurnitureType | "unknown";
  left: number;
  top: number;
  width: number; // actual width (scaled)
  height: number; // actual height (scaled)
  angle: number;
};

export type PlannerCanvasHandle = {
  addFurniture: (type: FurnitureType) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  setSelectedProps: (
    patch: Partial<Pick<SelectedInfo, "width" | "height" | "angle">>
  ) => void;
  fitRoom: () => void;

  undo: () => void;
  redo: () => void;

  save: () => void;
  load: () => void;
  exportJson: () => void;
  importJsonString: (json: string) => void;
};

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

function isFurniture(obj: any): obj is Rect {
  return obj?.data?.kind === "furniture";
}

function getFurnitureType(obj: any): FurnitureType | "unknown" {
  return obj?.data?.type ?? "unknown";
}

function getSelectedInfo(obj: any): SelectedInfo {
  const rect = obj.getBoundingRect(false, true);
  return {
    id: obj.data?.id ?? makeId(),
    type: getFurnitureType(obj),
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: rect.width,
    height: rect.height,
    angle: obj.angle ?? 0,
  };
}

/** Snapshot for furniture only (serializable, stable). */
type FurnitureSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  rx?: number;
  ry?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  scaleX?: number;
  scaleY?: number;
  data: {
    kind: "furniture";
    type: FurnitureType | "unknown";
    id: string;
    baseStroke?: string;
    baseStrokeWidth?: number;
  };
};

type GuideLine = Line;

export default forwardRef<
  PlannerCanvasHandle,
  { onSelectionChange?: (info: SelectedInfo | null) => void }
  >(function PlannerCanvas({ onSelectionChange }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const roomRef = useRef<Rect | null>(null);

  const isSpacePressedRef = useRef(false);

  // stable callback ref
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // History
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const isApplyingHistoryRef = useRef(false);

  // Autosave debounce
  const autosaveTimerRef = useRef<number | null>(null);

  // Guide lines (temporary)
  const guidesRef = useRef<GuideLine[]>([]);

  // ---- Visual Styles (hover / active) ----
  const ACTIVE_STROKE = "#0f172a";
  const ACTIVE_STROKE_WIDTH = 3;

  const HOVER_STROKE = "#2563eb";
  const HOVER_STROKE_WIDTH = 3;

  // Alignment snapping settings
  const ALIGN_SNAP_TOLERANCE = 8; // pixels

  const serializeState = (canvas: Canvas) => {
    const items = canvas
      .getObjects()
      .filter((o: any) => o?.data?.kind === "furniture")
      .map((o: any): FurnitureSnapshot => ({
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
          baseStroke: o.data?.baseStroke ?? o.stroke ?? "#10b981",
          baseStrokeWidth: o.data?.baseStrokeWidth ?? o.strokeWidth ?? 2,
        },
      }));

    items.sort((a, b) => a.data.id.localeCompare(b.data.id));
    return JSON.stringify(items);
  };

  const scheduleAutosave = () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      try {
        const json = serializeState(canvas);
        localStorage.setItem(STORAGE_KEY, json);
      } catch {
        // ignore
      }
    }, 350);
  };

  const pushHistory = (canvas: Canvas) => {
    if (isApplyingHistoryRef.current) return;

    const snapshot = serializeState(canvas);
    const current = historyRef.current[historyIndexRef.current];
    if (current === snapshot) return;

    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);

    historyRef.current.push(snapshot);
    historyIndexRef.current = historyRef.current.length - 1;

    const LIMIT = 80;
    if (historyRef.current.length > LIMIT) {
      historyRef.current.shift();
      historyIndexRef.current--;
    }

    scheduleAutosave();
  };

  const clearGuides = (canvas: Canvas) => {
    if (!guidesRef.current.length) return;
    for (const g of guidesRef.current) canvas.remove(g);
    guidesRef.current = [];
    canvas.requestRenderAll();
  };

  const addGuide = (canvas: Canvas, line: GuideLine) => {
    canvas.add(line);
    canvas.bringObjectToFront(line);
    guidesRef.current.push(line);
  };


  const drawGuides = (
    canvas: Canvas,
    room: Rect,
    guides: Array<
      | { kind: "v"; x: number; y1: number; y2: number }
      | { kind: "h"; y: number; x1: number; x2: number }
      >
  ) => {
    clearGuides(canvas);

    if (guides.length === 0) return;

    for (const g of guides) {
      if (g.kind === "v") {
        addGuide(
          canvas,
          new Line([g.x, g.y1, g.x, g.y2], {
            stroke: "#2563eb",
            strokeWidth: 2,
            selectable: false,
            evented: false,
            excludeFromExport: true,
            opacity: 0.9,
          })
        );
      } else {
        addGuide(
          canvas,
          new Line([g.x1, g.y, g.x2, g.y], {
            stroke: "#2563eb",
            strokeWidth: 2,
            selectable: false,
            evented: false,
            excludeFromExport: true,
            opacity: 0.9,
          })
        );
      }
    }

    // Keep guides on top of everything
    canvas.getObjects().forEach((o: any) => {
      if (!isFurniture(o)) return;
      // keep furniture above grid but below guides
      // (guides already brought to front)
    });
  };

  const restoreFromJson = (canvas: Canvas, room: Rect, json: string) => {
    isApplyingHistoryRef.current = true;

    // remove furniture only
    canvas.getObjects().forEach((o: any) => {
      if (o?.data?.kind === "furniture") canvas.remove(o);
    });

    const data: FurnitureSnapshot[] = JSON.parse(json);

    for (const s of data) {
      const rect = new Rect({
        left: s.left,
        top: s.top,
        width: s.width,
        height: s.height,
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

      (rect as any).data = s.data;

      canvas.add(rect);

      clampFurnitureInsideRoom(rect as any, room);
      snapFurnitureToRoomGrid(rect as any, room, GRID_SIZE);
      rect.setCoords();
    }

    canvas.discardActiveObject();
    onSelectionChangeRef.current?.(null);
    clearGuides(canvas);
    canvas.requestRenderAll();

    isApplyingHistoryRef.current = false;
  };

  const undo = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;

    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    restoreFromJson(canvas, room, historyRef.current[historyIndexRef.current]);
    scheduleAutosave();
  };

  const redo = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;

    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    restoreFromJson(canvas, room, historyRef.current[historyIndexRef.current]);
    scheduleAutosave();
  };

  // ---- Styling helpers (no history) ----
  const resetToBaseStyle = (obj: any) => {
    if (!isFurniture(obj)) return;

    const baseStroke = obj.data?.baseStroke ?? "#10b981";
    const baseStrokeWidth = obj.data?.baseStrokeWidth ?? 2;

    obj.set({
      stroke: baseStroke,
      strokeWidth: baseStrokeWidth,
    });
  };

  const applyHoverStyle = (obj: any) => {
    if (!isFurniture(obj)) return;
    obj.set({ stroke: HOVER_STROKE, strokeWidth: HOVER_STROKE_WIDTH });
  };

  const applyActiveStyle = (obj: any) => {
    if (!isFurniture(obj)) return;
    obj.set({ stroke: ACTIVE_STROKE, strokeWidth: ACTIVE_STROKE_WIDTH });
  };

  const restyleAllFurniture = (canvas: Canvas) => {
    const active = canvas.getActiveObject() as any;

    canvas.getObjects().forEach((o: any) => {
      if (!isFurniture(o)) return;

      if (active && o === active) applyActiveStyle(o);
      else resetToBaseStyle(o);

      o.setCoords();
    });

    canvas.requestRenderAll();
  };

  // Persistence (buttons)
  const saveNow = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const json = serializeState(canvas);
    localStorage.setItem(STORAGE_KEY, json);
  };

  const loadNow = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;

    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return;

    restoreFromJson(canvas, room, json);
    restyleAllFurniture(canvas);

    historyRef.current = [json];
    historyIndexRef.current = 0;

    scheduleAutosave();
  };

  const exportJson = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const json = serializeState(canvas);

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "planner-layout.json";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  };

  const importJsonString = (json: string) => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;

    restoreFromJson(canvas, room, json);
    restyleAllFurniture(canvas);

    historyRef.current = [json];
    historyIndexRef.current = 0;

    localStorage.setItem(STORAGE_KEY, json);
  };

  // --- Alignment Guides + Snapping while moving ---
  const computeObjectAABB = (obj: any) => {
    // AABB in canvas coords (includes rotation)
    const r = obj.getBoundingRect(false, true);
    const left = r.left;
    const top = r.top;
    const right = r.left + r.width;
    const bottom = r.top + r.height;
    return {
      left,
      top,
      right,
      bottom,
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
      w: r.width,
      h: r.height,
    };
  };

  const snapValue = (value: number, target: number, tolerance: number) => {
    const d = target - value;
    if (Math.abs(d) <= tolerance) return { snapped: true, delta: d };
    return { snapped: false, delta: 0 };
  };

  const alignAndGuide = (canvas: Canvas, room: Rect, moving: any) => {
    const all = canvas.getObjects().filter((o: any) => isFurniture(o) && o !== moving);

    const mv = computeObjectAABB(moving);

    const roomRect = room.getBoundingRect();
    const roomLeft = roomRect.left;
    const roomTop = roomRect.top;
    const roomRight = roomRect.left + roomRect.width;
    const roomBottom = roomRect.top + roomRect.height;

    let bestDx = 0;
    let bestDy = 0;
    let bestDxAbs = Number.POSITIVE_INFINITY;
    let bestDyAbs = Number.POSITIVE_INFINITY;

    const guides: Array<
      | { kind: "v"; x: number; y1: number; y2: number }
      | { kind: "h"; y: number; x1: number; x2: number }
      > = [];

    const candidatesX = [mv.left, mv.cx, mv.right];
    const candidatesY = [mv.top, mv.cy, mv.bottom];

    for (const o of all) {
      const ob = computeObjectAABB(o);

      const targetsX = [ob.left, ob.cx, ob.right];
      const targetsY = [ob.top, ob.cy, ob.bottom];

      // X alignment
      for (const cX of candidatesX) {
        for (const tX of targetsX) {
          const s = snapValue(cX, tX, ALIGN_SNAP_TOLERANCE);
          if (s.snapped && Math.abs(s.delta) < bestDxAbs) {
            bestDxAbs = Math.abs(s.delta);
            bestDx = s.delta;

            // guide vertical line at tX spanning between objects (clamped to room bounds)
            const y1 = Math.max(roomTop, Math.min(mv.top, ob.top));
            const y2 = Math.min(roomBottom, Math.max(mv.bottom, ob.bottom));
            guides.push({ kind: "v", x: tX, y1, y2 });
          }
        }
      }

      // Y alignment
      for (const cY of candidatesY) {
        for (const tY of targetsY) {
          const s = snapValue(cY, tY, ALIGN_SNAP_TOLERANCE);
          if (s.snapped && Math.abs(s.delta) < bestDyAbs) {
            bestDyAbs = Math.abs(s.delta);
            bestDy = s.delta;

            // guide horizontal line at tY spanning between objects (clamped to room bounds)
            const x1 = Math.max(roomLeft, Math.min(mv.left, ob.left));
            const x2 = Math.min(roomRight, Math.max(mv.right, ob.right));
            guides.push({ kind: "h", y: tY, x1, x2 });
          }
        }
      }
    }

    // apply the best snap deltas (smallest alignment difference)
    if (bestDxAbs !== Number.POSITIVE_INFINITY) {
      moving.set({ left: (moving.left ?? 0) + bestDx });
    }
    if (bestDyAbs !== Number.POSITIVE_INFINITY) {
      moving.set({ top: (moving.top ?? 0) + bestDy });
    }

    // draw guides based on the best snaps only
    // Keep only one vertical and one horizontal guide (the last best) for clarity
    const bestGuides: typeof guides = [];
    // last v/h in list corresponds to best currently found
    for (let i = guides.length - 1; i >= 0; i--) {
      const g = guides[i];
      if (g.kind === "v" && !bestGuides.some((x) => x.kind === "v")) bestGuides.push(g);
      if (g.kind === "h" && !bestGuides.some((x) => x.kind === "h")) bestGuides.push(g);
      if (bestGuides.length === 2) break;
    }

    drawGuides(canvas, room, bestGuides);
  };

  useEffect(() => {
    if (!htmlCanvasRef.current) return;

    const canvas = new Canvas(htmlCanvasRef.current, {
      backgroundColor: "#fafafa",
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;

    const room = drawRoom(canvas);
    roomRef.current = room;

    drawGrid(canvas, room, GRID_SIZE);

    const resizeCanvasToContainer = () => {
      const el = containerRef.current;
      if (!el) return;

      canvas.setDimensions({ width: el.clientWidth, height: el.clientHeight });
      canvas.calcOffset();
      fitRoomToView(canvas, room);
    };

    resizeCanvasToContainer();
    window.addEventListener("resize", resizeCanvasToContainer);

    // Zoom
    canvas.on("mouse:wheel", (opt) => {
      const event = opt.e as WheelEvent;

      let zoom = canvas.getZoom();
      zoom *= ZOOM_SENSITIVITY ** event.deltaY;
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

      canvas.zoomToPoint({ x: event.offsetX, y: event.offsetY }, zoom);

      event.preventDefault();
      event.stopPropagation();
    });

    // Pan (Space + drag)
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
      canvas.requestRenderAll();

      lastClientX = e.clientX;
      lastClientY = e.clientY;
    });

    canvas.on("mouse:up", () => {
      isPanning = false;
      canvas.selection = true;
      canvas.defaultCursor = "default";
      clearGuides(canvas);
    });

    // Selection -> React
    const emitSelection = () => {
      const active = canvas.getActiveObject();

      if (!active || !isFurniture(active)) {
        onSelectionChangeRef.current?.(null);
        return;
      }

      onSelectionChangeRef.current?.(getSelectedInfo(active));
    };

    canvas.on("selection:created", () => {
      emitSelection();
      restyleAllFurniture(canvas);
      clearGuides(canvas);
    });

    canvas.on("selection:updated", () => {
      emitSelection();
      restyleAllFurniture(canvas);
      clearGuides(canvas);
    });

    canvas.on("selection:cleared", () => {
      onSelectionChangeRef.current?.(null);
      restyleAllFurniture(canvas);
      clearGuides(canvas);
    });

    // Hover
    canvas.on("mouse:over", (opt) => {
      const t = opt.target as any;
      if (!t || !isFurniture(t)) return;

      const active = canvas.getActiveObject() as any;
      if (active && active === t) return;

      applyHoverStyle(t);
      t.setCoords();
      canvas.requestRenderAll();
    });

    canvas.on("mouse:out", (opt) => {
      const t = opt.target as any;
      if (!t || !isFurniture(t)) return;

      const active = canvas.getActiveObject() as any;
      if (active && active === t) return;

      resetToBaseStyle(t);
      t.setCoords();
      canvas.requestRenderAll();
    });

    // keep panel updated during transforms
    canvas.on("object:scaling", emitSelection);
    canvas.on("object:rotating", emitSelection);

    canvas.on("object:moving", (opt) => {
      const obj = opt.target as any;
      if (!obj || !isFurniture(obj)) return;

      obj.setCoords();
      room.setCoords();

      // clamp to room
      clampFurnitureInsideRoom(obj, room);

      // align to other objects + draw guides
      alignAndGuide(canvas, room, obj);

      emitSelection();
      canvas.requestRenderAll();
    });

    canvas.on("object:modified", (opt) => {
      const obj = opt.target as any;
      if (!obj || !isFurniture(obj)) return;

      snapFurnitureToRoomGrid(obj, room, GRID_SIZE);
      clampFurnitureInsideRoom(obj, room);

      obj.setCoords();
      emitSelection();
      restyleAllFurniture(canvas);
      clearGuides(canvas);

      canvas.requestRenderAll();

      pushHistory(canvas);
    });

    // Keyboard
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressedRef.current = true;
        canvas.defaultCursor = "grab";
      }

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        restyleAllFurniture(canvas);
        clearGuides(canvas);
        return;
      }

      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        restyleAllFurniture(canvas);
        clearGuides(canvas);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;

        const active = canvas.getActiveObject() as any;
        if (!active || !isFurniture(active)) return;

        canvas.remove(active);
        canvas.discardActiveObject();
        onSelectionChangeRef.current?.(null);
        restyleAllFurniture(canvas);
        clearGuides(canvas);
        canvas.requestRenderAll();

        pushHistory(canvas);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressedRef.current = false;
        canvas.defaultCursor = "default";
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Initial history snapshot
    pushHistory(canvas);

    // Autoload
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        restoreFromJson(canvas, room, saved);
        restyleAllFurniture(canvas);
        historyRef.current = [saved];
        historyIndexRef.current = 0;
      } catch {
        // ignore broken data
      }
    } else {
      restyleAllFurniture(canvas);
    }

    canvas.requestRenderAll();

    return () => {
      window.removeEventListener("resize", resizeCanvasToContainer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);

      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      clearGuides(canvas);
      canvas.dispose();
      fabricCanvasRef.current = null;
      roomRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    (): PlannerCanvasHandle => {
      const getCanvas = () => {
        const c = fabricCanvasRef.current;
        if (!c) throw new Error("Canvas not initialized yet");
        return c;
      };

      const getRoom = () => {
        const r = roomRef.current;
        if (!r) throw new Error("Room not initialized yet");
        return r;
      };

      const getActiveFurniture = () => {
        const canvas = getCanvas();
        const active = canvas.getActiveObject() as any;
        if (!active || !isFurniture(active)) return null;
        return active;
      };

      return {
        addFurniture(type) {
          const canvas = getCanvas();
          const room = getRoom();

          addFurniture(canvas, room, type);
          restyleAllFurniture(canvas);
          pushHistory(canvas);
        },

        deleteSelected() {
          const canvas = getCanvas();
          const active = getActiveFurniture();
          if (!active) return;

          canvas.remove(active);
          canvas.discardActiveObject();
          onSelectionChangeRef.current?.(null);
          restyleAllFurniture(canvas);
          clearGuides(canvas);
          canvas.requestRenderAll();

          pushHistory(canvas);
        },

        duplicateSelected() {
          const canvas = getCanvas();
          const room = getRoom();
          const active = getActiveFurniture();
          if (!active) return;

          const rect = new Rect({
            left: (active.left ?? 0) + GRID_SIZE,
            top: (active.top ?? 0) + GRID_SIZE,
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

          clampFurnitureInsideRoom(rect as any, room);
          snapFurnitureToRoomGrid(rect as any, room, GRID_SIZE);

          rect.setCoords();
          canvas.setActiveObject(rect);

          onSelectionChangeRef.current?.(getSelectedInfo(rect as any));
          restyleAllFurniture(canvas);
          clearGuides(canvas);

          canvas.requestRenderAll();
          pushHistory(canvas);
        },

        setSelectedProps(patch) {
          const canvas = getCanvas();
          const room = getRoom();
          const active = getActiveFurniture();
          if (!active) return;

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

          if (typeof patch.angle === "number") {
            active.angle = patch.angle;
          }

          active.setCoords();
          room.setCoords();

          clampFurnitureInsideRoom(active, room);
          snapFurnitureToRoomGrid(active, room, GRID_SIZE);

          active.setCoords();
          restyleAllFurniture(canvas);
          clearGuides(canvas);
          canvas.requestRenderAll();

          onSelectionChangeRef.current?.(getSelectedInfo(active));

          pushHistory(canvas);
        },

        fitRoom() {
          const canvas = getCanvas();
          const room = getRoom();
          fitRoomToView(canvas, room);
          restyleAllFurniture(canvas);
          clearGuides(canvas);
        },

        undo() {
          undo();
          const canvas = fabricCanvasRef.current;
          if (canvas) restyleAllFurniture(canvas);
        },

        redo() {
          redo();
          const canvas = fabricCanvasRef.current;
          if (canvas) restyleAllFurniture(canvas);
        },

        save() {
          saveNow();
        },

        load() {
          loadNow();
        },

        exportJson() {
          exportJson();
        },

        importJsonString(json: string) {
          importJsonString(json);
        },
      };
    },
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

/* =========================
   Room + Grid
========================= */
function drawRoom(canvas: Canvas) {
  const strokeWidth = 3;
  const width = 600 - strokeWidth;
  const height = 400 - strokeWidth;

  const room = new Rect({
    left: 200,
    top: 150,
    width,
    height,
    fill: "rgba(59,130,246,0.15)",
    stroke: "#3b82f6",
    strokeWidth,
    selectable: false,
    evented: false,
  });

  canvas.add(room);
  return room;
}

function drawGrid(canvas: Canvas, room: Rect, gridSize = GRID_SIZE) {
  const roomRect = room.getBoundingRect();
  const stroke = room.strokeWidth ?? 0;
  const inset = stroke / 2;

  const left = roomRect.left + inset;
  const top = roomRect.top + inset;
  const right = roomRect.left + roomRect.width - inset;
  const bottom = roomRect.top + roomRect.height - inset;

  for (let x = left; x <= right; x += gridSize) {
    canvas.add(
      new Line([x, top, x, bottom], {
        stroke: "#d1d5db",
        selectable: false,
        evented: false,
        excludeFromExport: true,
      })
    );
  }

  for (let y = top; y <= bottom; y += gridSize) {
    canvas.add(
      new Line([left, y, right, y], {
        stroke: "#d1d5db",
        selectable: false,
        evented: false,
        excludeFromExport: true,
      })
    );
  }
}

/* =========================
   Furniture helpers
========================= */
function snapFurnitureToRoomGrid(obj: any, room: Rect, grid: number) {
  if (!isFurniture(obj)) return;

  const roomRect = room.getBoundingRect();
  const stroke = room.strokeWidth ?? 0;

  const originX = roomRect.left + stroke / 2;
  const originY = roomRect.top + stroke / 2;

  obj.set({
    left: originX + Math.round(((obj.left ?? 0) - originX) / grid) * grid,
    top: originY + Math.round(((obj.top ?? 0) - originY) / grid) * grid,
  });
}

function clampFurnitureInsideRoom(obj: any, room: Rect) {
  if (!isFurniture(obj)) return;

  room.setCoords();
  obj.setCoords();

  const roomRect = room.getBoundingRect();
  const stroke = room.strokeWidth ?? 0;
  const inset = stroke / 2;

  const innerLeft = roomRect.left + inset;
  const innerTop = roomRect.top + inset;
  const innerRight = roomRect.left + roomRect.width - inset;
  const innerBottom = roomRect.top + roomRect.height - inset;

  const objRect = obj.getBoundingRect();

  let nextLeft = obj.left ?? 0;
  let nextTop = obj.top ?? 0;

  if (objRect.left < innerLeft) nextLeft += innerLeft - objRect.left;
  if (objRect.top < innerTop) nextTop += innerTop - objRect.top;

  const objRight = objRect.left + objRect.width;
  const objBottom = objRect.top + objRect.height;

  if (objRight > innerRight) nextLeft += innerRight - objRight;
  if (objBottom > innerBottom) nextTop += innerBottom - objBottom;

  obj.set({ left: nextLeft, top: nextTop });
  obj.setCoords();
}

function addFurniture(canvas: Canvas, room: Rect, type: FurnitureType) {
  const roomRect = room.getBoundingRect();
  const stroke = room.strokeWidth ?? 0;
  const inset = stroke / 2;

  const innerLeft = roomRect.left + inset;
  const innerTop = roomRect.top + inset;
  const innerRight = roomRect.left + roomRect.width - inset;
  const innerBottom = roomRect.top + inset + (roomRect.height - inset * 2);

  let width: number;
  let height: number;
  let rounded = false;

  if (type === "sofa") {
    width = 180;
    height = 80;
    rounded = true;
  } else if (type === "table") {
    width = 120;
    height = 120;
  } else {
    width = 60;
    height = 60;
  }

  const spawnLeft = innerLeft + (innerRight - innerLeft) / 2;
  const spawnTop = innerTop + (innerBottom - innerTop) / 2;

  const baseStroke = "#10b981";
  const baseStrokeWidth = 2;

  const obj = new Rect({
    left: spawnLeft,
    top: spawnTop,
    width,
    height,
    fill: "rgba(16,185,129,0.25)",
    stroke: baseStroke,
    strokeWidth: baseStrokeWidth,
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    lockScalingFlip: true,
    transparentCorners: false,
    hoverCursor: "move",
  });

  if (rounded) obj.set({ rx: 10, ry: 10 });

  (obj as any).data = {
    kind: "furniture",
    type,
    id: makeId(),
    baseStroke,
    baseStrokeWidth,
  };

  canvas.add(obj);

  clampFurnitureInsideRoom(obj as any, room);
  snapFurnitureToRoomGrid(obj as any, room, GRID_SIZE);

  obj.setCoords();
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();
}

/* =========================
   Fit room to view
========================= */
function fitRoomToView(canvas: Canvas, room: Rect, padding = 40) {
  const roomRect = room.getBoundingRect();

  const viewWidth = canvas.getWidth();
  const viewHeight = canvas.getHeight();

  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

  const scaleX = (viewWidth - padding * 2) / roomRect.width;
  const scaleY = (viewHeight - padding * 2) / roomRect.height;

  const zoom = Math.min(scaleX, scaleY, 1);
  canvas.setZoom(zoom);

  const vpt = canvas.viewportTransform!;
  const roomCenterX = roomRect.left + roomRect.width / 2;
  const roomCenterY = roomRect.top + roomRect.height / 2;

  vpt[4] = viewWidth / 2 - roomCenterX * zoom;
  vpt[5] = viewHeight / 2 - roomCenterY * zoom;

  canvas.setViewportTransform(vpt);
  canvas.requestRenderAll();
}
