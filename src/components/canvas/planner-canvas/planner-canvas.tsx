"use client";

import { useEffect, useRef } from "react";
import { Canvas, Line, Rect } from "fabric";

const GRID_SIZE = 50;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_SENSITIVITY = 0.999;

type FurnitureType = "sofa" | "table" | "chair";

export default function PlannerCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);

  useEffect(() => {
    if (!htmlCanvasRef.current) {
      return;
    }

    const canvas = new Canvas(htmlCanvasRef.current, {
      backgroundColor: "#fafafa",
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;

    const room = drawRoom(canvas);
    drawGrid(canvas, room, GRID_SIZE);

    const resizeCanvasToContainer = () => {
      const el = containerRef.current;
      if (!el) {
        return;
      }

      canvas.setDimensions({ width: el.clientWidth, height: el.clientHeight });
      canvas.calcOffset();

      fitRoomToView(canvas, room);
    };

    resizeCanvasToContainer();
    window.addEventListener("resize", resizeCanvasToContainer);

    canvas.renderAll();

    canvas.on("mouse:wheel", (opt) => {
      const event = opt.e as WheelEvent;

      let zoom = canvas.getZoom();
      zoom *= ZOOM_SENSITIVITY ** event.deltaY;
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

      canvas.zoomToPoint({ x: event.offsetX, y: event.offsetY }, zoom);

      event.preventDefault();
      event.stopPropagation();
    });

    let isPanning = false;
    let isSpacePressed = false;
    let lastClientX = 0;
    let lastClientY = 0;

    canvas.on("mouse:down", (opt) => {
      if (!isSpacePressed) return;

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
      const viewportTransform = canvas.viewportTransform!;
      viewportTransform[4] += e.clientX - lastClientX;
      viewportTransform[5] += e.clientY - lastClientY;

      canvas.requestRenderAll();

      lastClientX = e.clientX;
      lastClientY = e.clientY;
    });

    canvas.on("mouse:up", () => {
      isPanning = false;
      canvas.selection = true;
      canvas.defaultCursor = "default";
    });

    canvas.on("object:modified", (opt) => {
      const obj = opt.target;
      if (!obj) return;

      snapFurnitureToRoomGrid(obj, room, GRID_SIZE);
      clampFurnitureInsideRoom(obj, room);
    });

    canvas.on("object:moving", (opt) => {
      const obj = opt.target;
      if (!obj) return;

      const kind = (obj as any).data?.kind;
      if (kind !== "furniture") return;

      obj.setCoords();
      room.setCoords();

      clampFurnitureInsideRoom(obj, room);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressed = true;
        canvas.defaultCursor = "grab";
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressed = false;
        canvas.defaultCursor = "default";
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    const handleDelete = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key !== "Delete" && e.key !== "Backspace") return;

      const active = canvas.getActiveObject();
      if (!active) return;

      canvas.remove(active);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    };

    window.addEventListener("keydown", handleDelete);

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.id) return;

      if (target.id === "add-sofa") {
        addFurniture(canvas, room, "sofa");
      }
      if (target.id === "add-table") {
        addFurniture(canvas, room, "table");
      }
      if (target.id === "add-chair") {
        addFurniture(canvas, room, "chair");
      }
    };

    window.addEventListener("click", onClick);

    return () => {
      window.removeEventListener("resize", resizeCanvasToContainer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("keydown", handleDelete);
      window.removeEventListener("click", onClick);

      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, []);

  return (
    <div
      className="relative w-full h-full bg-white border border-neutral-300 overflow-hidden"
      ref={containerRef}
    >
      <canvas ref={htmlCanvasRef} />
    </div>
  );
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

function drawRoom(canvas: Canvas) {
  const strokeWidth = 3;
  const width = 600 - strokeWidth;
  const height = 400 - strokeWidth;
  const left = width / 2 + strokeWidth / 2;
  const top = height / 2 + strokeWidth / 2;

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

function snapFurnitureToRoomGrid(obj: any, room: Rect, grid: number) {
  const roomRect = room.getBoundingRect();
  const stroke = room.strokeWidth ?? 0;

  const originX = roomRect.left + stroke / 2;
  const originY = roomRect.top + stroke / 2;

  obj.set({
    left: originX + Math.round(((obj.left ?? 0) - originX) / grid) * grid,
    top: originY + Math.round(((obj.top ?? 0) - originY) / grid) * grid,
  });
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

  const base = {
    fill: "rgba(16,185,129,0.25)",
    stroke: "#10b981",
    strokeWidth: 2,
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    lockScalingFlip: true,
    transparentCorners: false,
  };

  const obj = new Rect({
    ...base,
    left: spawnLeft,
    top: spawnTop,
    width,
    height,
  });

  if (rounded) {
    obj.set({ rx: 10, ry: 10 });
  }

  (obj as any).data = { kind: "furniture", type };
  (obj as any).__borderPad = computeObjectBorderPadding(obj);

  canvas.add(obj);

  clampFurnitureInsideRoom(obj, room);
  snapFurnitureToRoomGrid(obj, room, GRID_SIZE);

  obj.setCoords();
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();
}

function computeObjectBorderPadding(obj: any) {
  const scaledW = obj.getScaledWidth();
  const scaledH = obj.getScaledHeight();
  const rect = obj.getBoundingRect(false, true);

  const padX = Math.max(0, (rect.width - scaledW) / 2);
  const padY = Math.max(0, (rect.height - scaledH) / 2);

  return { padX, padY };
}

function clampFurnitureInsideRoom(obj: any, room: Rect) {
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

  if (objRect.left < innerLeft) {
    nextLeft += innerLeft - objRect.left;
  }
  if (objRect.top < innerTop) {
    nextTop += innerTop - objRect.top;
  }

  const objRight = objRect.left + objRect.width;
  const objBottom = objRect.top + objRect.height;

  if (objRight > innerRight) {
    nextLeft += innerRight - objRight;
  }
  if (objBottom > innerBottom) {
    nextTop += innerBottom - objBottom;
  }

  obj.set({ left: nextLeft, top: nextTop });
  obj.setCoords();
}

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
