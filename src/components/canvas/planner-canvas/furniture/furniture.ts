import type { Canvas, Polygon } from "fabric";
import { Rect } from "fabric";

import type { FurnitureType, RoomId } from "../core/planner-types";
import { GRID_SIZE } from "../core/planner-constants";
import { isFurniture, makeId } from "../core/utils";

import {
  pointInPolygon,
  nearestPointOnPolygon,
  polygonCentroid,
} from "../room/polygon-geometry";

import { getRoomPoints } from "../room/room-walls";

function getRoomId(room: any): RoomId | undefined {
  return room?.data?.id as RoomId | undefined;
}

function getRoomPolygonPoints(room: any) {
  return getRoomPoints(room);
}

function getRoomInnerAABB(room: any) {
  const r = room.getBoundingRect();
  const stroke = room.strokeWidth ?? 0;
  const inset = stroke / 2;

  const left = r.left + inset;
  const top = r.top + inset;
  const right = r.left + r.width - inset;
  const bottom = r.top + r.height - inset;

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function clampFurnitureInsideRoomPolygon(obj: any, room: Polygon) {
  if (!obj?.data || obj.data.kind !== "furniture") return;

  const roomId = getRoomId(room);
  const objRoomId = obj?.data?.roomId as RoomId | undefined;

  if (roomId && objRoomId && objRoomId !== roomId) return;

  const poly = getRoomPolygonPoints(room);
  if (poly.length < 3) return;

  const center = obj.getCenterPoint();
  const p = { x: center.x, y: center.y };

  if (pointInPolygon(p, poly)) return;

  const nearest = nearestPointOnPolygon(p, poly);

  const c = polygonCentroid(poly);
  let vx = c.x - nearest.x;
  let vy = c.y - nearest.y;
  const len = Math.hypot(vx, vy) || 1;
  vx /= len;
  vy /= len;

  const EPS = 2;
  const target = { x: nearest.x + vx * EPS, y: nearest.y + vy * EPS };

  const dx = target.x - p.x;
  const dy = target.y - p.y;

  obj.left = (obj.left ?? 0) + dx;
  obj.top = (obj.top ?? 0) + dy;
  obj.setCoords();
}

export function clampFurnitureInsideRoomPolygonByCorners(
  obj: any,
  room: Polygon
) {
  if (!isFurniture(obj)) return;

  const roomId = getRoomId(room);
  const objRoomId = obj?.data?.roomId as RoomId | undefined;

  if (roomId && objRoomId && objRoomId !== roomId) return;

  const poly = getRoomPolygonPoints(room);
  if (poly.length < 3) return;

  const corners = obj.getCoords?.() as { x: number; y: number }[] | undefined;
  if (!corners || corners.length < 4) return;

  if (corners.every((c) => pointInPolygon(c, poly))) return;

  let moveX = 0;
  let moveY = 0;
  let bestD2 = -1;

  for (const c of corners) {
    if (pointInPolygon(c, poly)) continue;

    const q = nearestPointOnPolygon(c, poly);
    const dx = q.x - c.x;
    const dy = q.y - c.y;
    const d2 = dx * dx + dy * dy;

    if (d2 > bestD2) {
      bestD2 = d2;
      moveX = dx;
      moveY = dy;
    }
  }

  obj.set({
    left: (obj.left ?? 0) + moveX,
    top: (obj.top ?? 0) + moveY,
  });

  obj.setCoords();
}

export function limitFurnitureSizeToRoomBBox(
  obj: any,
  room: any,
  gridSize: number
) {
  if (!isFurniture(obj)) return;

  const roomId = getRoomId(room);
  const objRoomId = obj?.data?.roomId as RoomId | undefined;

  if (roomId && objRoomId && objRoomId !== roomId) return;

  obj.setCoords();

  const box = getRoomInnerAABB(room);
  const r = obj.getBoundingRect(false, true);

  if (r.width <= box.width && r.height <= box.height) return;

  const kx = box.width / Math.max(1, r.width);
  const ky = box.height / Math.max(1, r.height);
  const k = Math.min(kx, ky);

  const center = obj.getCenterPoint();

  obj.scaleX = (obj.scaleX ?? 1) * k;
  obj.scaleY = (obj.scaleY ?? 1) * k;

  if (gridSize > 1) {
    const sw = obj.getScaledWidth();
    const sh = obj.getScaledHeight();
    const snappedW = Math.max(gridSize, Math.round(sw / gridSize) * gridSize);
    const snappedH = Math.max(gridSize, Math.round(sh / gridSize) * gridSize);

    const baseW = Math.max(1, obj.width ?? 1);
    const baseH = Math.max(1, obj.height ?? 1);

    obj.scaleX = snappedW / baseW;
    obj.scaleY = snappedH / baseH;
  }

  obj.setPositionByOrigin(center, "center", "center");
  obj.setCoords();
}

export function snapFurnitureToRoomGrid(obj: any, room: any, grid: number) {
  if (!isFurniture(obj)) return;

  const roomId = getRoomId(room);
  const objRoomId = obj?.data?.roomId as RoomId | undefined;

  if (roomId && objRoomId && objRoomId !== roomId) return;

  const box = getRoomInnerAABB(room);

  obj.set({
    left: box.left + Math.round(((obj.left ?? 0) - box.left) / grid) * grid,
    top: box.top + Math.round(((obj.top ?? 0) - box.top) / grid) * grid,
  });
}

export function clampFurnitureInsideRoom(obj: any, room: any) {
  if (!isFurniture(obj)) return;

  const roomId = getRoomId(room);
  const objRoomId = obj?.data?.roomId as RoomId | undefined;

  if (roomId && objRoomId && objRoomId !== roomId) return;

  obj.setCoords();
  const box = getRoomInnerAABB(room);

  const objRect = obj.getBoundingRect(false, true);

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
  const roomId = getRoomId(room);
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
    roomId,
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
