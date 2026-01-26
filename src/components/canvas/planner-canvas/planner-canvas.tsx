"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Canvas, Line, Rect } from "fabric";

const GRID_SIZE = 50;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_SENSITIVITY = 0.999;

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

export default forwardRef<
  PlannerCanvasHandle,
  { onSelectionChange?: (info: SelectedInfo | null) => void }
  >(function PlannerCanvas({ onSelectionChange }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);

  const roomRef = useRef<Rect | null>(null);

  // local flag for space panning
  const isSpacePressedRef = useRef(false);

  // ✅ stable callback ref (don’t trigger re-init)
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

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

    /* =========================
       Zoom
    ========================= */
    canvas.on("mouse:wheel", (opt) => {
      const event = opt.e as WheelEvent;

      let zoom = canvas.getZoom();
      zoom *= ZOOM_SENSITIVITY ** event.deltaY;
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

      canvas.zoomToPoint({ x: event.offsetX, y: event.offsetY }, zoom);

      event.preventDefault();
      event.stopPropagation();
    });

    /* =========================
       Pan (Space + drag)
    ========================= */
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
    });

    /* =========================
       Selection -> React
    ========================= */
    const emitSelection = () => {
      const active = canvas.getActiveObject();

      if (!active || !isFurniture(active)) {
        onSelectionChangeRef.current?.(null);
        return;
      }

      onSelectionChangeRef.current?.(getSelectedInfo(active));
    };

    canvas.on("selection:created", emitSelection);
    canvas.on("selection:updated", emitSelection);
    canvas.on("selection:cleared", () => {
      onSelectionChangeRef.current?.(null);
    });

    // keep panel updated while transforming
    canvas.on("object:scaling", emitSelection);
    canvas.on("object:rotating", emitSelection);

    canvas.on("object:moving", (opt) => {
      const obj = opt.target as any;
      if (!obj || !isFurniture(obj)) return;

      // clamp while moving
      obj.setCoords();
      room.setCoords();
      clampFurnitureInsideRoom(obj, room);

      emitSelection();
    });

    canvas.on("object:modified", (opt) => {
      const obj = opt.target as any;
      if (!obj || !isFurniture(obj)) return;

      snapFurnitureToRoomGrid(obj, room, GRID_SIZE);
      clampFurnitureInsideRoom(obj, room);

      obj.setCoords();
      emitSelection();
      canvas.requestRenderAll();
    });

    /* =========================
       Keyboard
    ========================= */
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressedRef.current = true;
        canvas.defaultCursor = "grab";
      }

      // Delete selected furniture
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;

        const active = canvas.getActiveObject() as any;
        if (!active || !isFurniture(active)) return;

        canvas.remove(active);
        canvas.discardActiveObject();
        onSelectionChangeRef.current?.(null);
        canvas.requestRenderAll();
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

    canvas.requestRenderAll();

    return () => {
      window.removeEventListener("resize", resizeCanvasToContainer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);

      canvas.dispose();
      fabricCanvasRef.current = null;
      roomRef.current = null;
    };
  }, []);

  /* =========================
     Exposed Canvas API
  ========================= */
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
        },

        deleteSelected() {
          const canvas = getCanvas();
          const active = getActiveFurniture();
          if (!active) return;

          canvas.remove(active);
          canvas.discardActiveObject();
          onSelectionChangeRef.current?.(null);
          canvas.requestRenderAll();
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
          });

          if (active.rx && active.ry) rect.set({ rx: active.rx, ry: active.ry });

          (rect as any).data = {
            kind: "furniture",
            type: active.data?.type ?? "unknown",
            id: makeId(),
          };

          canvas.add(rect);

          clampFurnitureInsideRoom(rect as any, room);
          snapFurnitureToRoomGrid(rect as any, room, GRID_SIZE);

          rect.setCoords();
          canvas.setActiveObject(rect);
          canvas.requestRenderAll();

          onSelectionChangeRef.current?.(getSelectedInfo(rect as any));
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
          canvas.requestRenderAll();

          onSelectionChangeRef.current?.(getSelectedInfo(active));
        },

        fitRoom() {
          const canvas = getCanvas();
          const room = getRoom();
          fitRoomToView(canvas, room);
        },
      };
    },
    [] // ✅ important: don’t recreate handle on every render
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

  const left = 200;
  const top = 150;

  const room = new Rect({
    left,
    top,
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
  const innerBottom = roomRect.top + roomRect.height - inset;

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

  const obj = new Rect({
    left: spawnLeft,
    top: spawnTop,
    width,
    height,
    fill: "rgba(16,185,129,0.25)",
    stroke: "#10b981",
    strokeWidth: 2,
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    lockScalingFlip: true,
    transparentCorners: false,
  });

  if (rounded) obj.set({ rx: 10, ry: 10 });

  (obj as any).data = { kind: "furniture", type, id: makeId() };

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
