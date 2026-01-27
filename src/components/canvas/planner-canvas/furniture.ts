import type { Canvas } from "fabric";
import { Rect } from "fabric";
import type { FurnitureType } from "./planner-types";
import { GRID_SIZE } from "./planner-constants";
import { isFurniture, makeId } from "./utils";

function getRoomInnerAABB(room: any) {
  const r = room.getBoundingRect();
  const stroke = room.strokeWidth ?? 0;
  const inset = stroke / 2;

  const left = r.left + inset;
  const top = r.top + inset;
  const right = r.left + r.width - inset;
  const bottom = r.top + r.height - inset;

  return { left, top, right, bottom };
}

export function snapFurnitureToRoomGrid(obj: any, room: any, grid: number) {
  if (!isFurniture(obj)) return;

  const box = getRoomInnerAABB(room);

  obj.set({
    left: box.left + Math.round(((obj.left ?? 0) - box.left) / grid) * grid,
    top: box.top + Math.round(((obj.top ?? 0) - box.top) / grid) * grid,
  });
}

export function clampFurnitureInsideRoom(obj: any, room: any) {
  if (!isFurniture(obj)) return;

  obj.setCoords();
  const box = getRoomInnerAABB(room);

  const objRect = obj.getBoundingRect();

  let nextLeft = obj.left ?? 0;
  let nextTop = obj.top ?? 0;

  if (objRect.left < box.left) nextLeft += box.left - objRect.left;
  if (objRect.top < box.top) nextTop += box.top - objRect.top;

  const objRight = objRect.left + objRect.width;
  const objBottom = objRect.top + objRect.height;

  if (objRight > box.right) nextLeft += box.right - objRight;
  if (objBottom > box.bottom) nextTop += box.bottom - objBottom;

  obj.set({ left: nextLeft, top: nextTop });
  obj.setCoords();
}

export function addFurniture(canvas: Canvas, room: any, type: FurnitureType) {
  const box = getRoomInnerAABB(room);

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

  const spawnLeft = box.left + (box.right - box.left) / 2;
  const spawnTop = box.top + (box.bottom - box.top) / 2;

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
