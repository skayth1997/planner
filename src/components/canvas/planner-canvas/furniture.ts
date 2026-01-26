import { Rect, Canvas } from "fabric";
import type { FurnitureType } from "./planner-types";
import { GRID_SIZE } from "./planner-constants";
import { isFurniture, makeId } from "./utils";

export function snapFurnitureToRoomGrid(obj: any, room: Rect, grid: number) {
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

export function clampFurnitureInsideRoom(obj: any, room: Rect) {
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

export function addFurniture(canvas: Canvas, room: Rect, type: FurnitureType) {
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
