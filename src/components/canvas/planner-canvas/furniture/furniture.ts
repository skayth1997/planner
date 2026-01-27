import type { Canvas } from "fabric";
import { Rect } from "fabric";
import type { FurnitureType } from "../core/planner-types";
import { GRID_SIZE } from "../core/planner-constants";
import { isFurniture, makeId } from "../core/utils";
import type { Polygon } from "fabric";
import {
  pointInPolygon,
  nearestPointOnPolygon,
  polygonCentroid,
} from "../room/polygon-geometry";

function getRoomPolygonPoints(room: any) {
  // Works because we store polygon points in absolute canvas coords
  const pts = (room.points ?? []) as any[];
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

export function clampFurnitureInsideRoomPolygon(obj: any, room: Polygon) {
  if (!obj?.data || obj.data.kind !== "furniture") return;

  const poly = getRoomPolygonPoints(room);
  if (poly.length < 3) return;

  // Use object center (stable & fast)
  const center = obj.getCenterPoint();
  const p = { x: center.x, y: center.y };

  if (pointInPolygon(p, poly)) return;

  const nearest = nearestPointOnPolygon(p, poly);

  // Nudge slightly inside (towards polygon centroid)
  const c = polygonCentroid(poly);
  let vx = c.x - nearest.x;
  let vy = c.y - nearest.y;
  const len = Math.hypot(vx, vy) || 1;
  vx /= len;
  vy /= len;

  const EPS = 2; // px inward
  const target = { x: nearest.x + vx * EPS, y: nearest.y + vy * EPS };

  const dx = target.x - p.x;
  const dy = target.y - p.y;

  obj.left = (obj.left ?? 0) + dx;
  obj.top = (obj.top ?? 0) + dy;
  obj.setCoords();
}

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
