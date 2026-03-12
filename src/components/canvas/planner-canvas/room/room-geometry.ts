import { Point, type Polygon } from "fabric";
import type { Pt } from "../core/planner-types";

export function normalizeRoomPoints(points: Pt[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const localPoints = points.map((p) => ({
    x: p.x - minX,
    y: p.y - minY,
  }));

  return {
    left: minX,
    top: minY,
    width,
    height,
    localPoints,
  };
}

export function removeClosingPoint(points: Pt[]) {
  if (points.length < 2) return points;

  const first = points[0];
  const last = points[points.length - 1];

  if (first.x === last.x && first.y === last.y) {
    return points.slice(0, -1);
  }

  return points;
}

export function applyPolygonAbsolutePoints(
  polygon: Polygon,
  points: Pt[],
  extra?: Partial<Polygon>
) {
  const cleanPoints = removeClosingPoint(points);
  const { left, top, width, height, localPoints } =
    normalizeRoomPoints(cleanPoints);

  polygon.set({
    left,
    top,
    originX: "left",
    originY: "top",
    width,
    height,
    points: localPoints as any,
    pathOffset: new Point(width / 2, height / 2),
    ...extra,
  });

  polygon.setCoords();
}

export function getRoomAbsoluteBounds(room: Polygon) {
  const r = room.getBoundingRect();

  return {
    left: r.left,
    top: r.top,
    right: r.left + r.width,
    bottom: r.top + r.height,
    width: r.width,
    height: r.height,
  };
}
