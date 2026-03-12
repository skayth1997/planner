import { util } from "fabric";
import type { Canvas } from "fabric";
import type { Pt } from "../core/planner-types";

export const CLOSE_DISTANCE = 16;

export function snapToGrid(value: number, grid: number) {
  return Math.round(value / grid) * grid;
}

export function getPointerPoint(
  canvas: Canvas,
  opt: any,
  getGridSize: () => number
): Pt | null {
  const p = opt?.absolutePointer ?? opt?.pointer ?? opt?.scenePoint ?? null;

  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    const g = Math.max(1, getGridSize());
    return {
      x: snapToGrid(p.x, g),
      y: snapToGrid(p.y, g),
    };
  }

  const vp = opt?.viewportPoint;
  if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y)) {
    const vt = (canvas as any).viewportTransform;

    if (vt && util?.invertTransform && util?.transformPoint) {
      const inv = util.invertTransform(vt);
      const sp = util.transformPoint(vp, inv);
      const g = Math.max(1, getGridSize());

      return {
        x: snapToGrid(sp.x, g),
        y: snapToGrid(sp.y, g),
      };
    }
  }

  if (typeof (canvas as any).getPointer === "function") {
    const pp = (canvas as any).getPointer(opt?.e);

    if (pp && Number.isFinite(pp.x) && Number.isFinite(pp.y)) {
      const g = Math.max(1, getGridSize());

      return {
        x: snapToGrid(pp.x, g),
        y: snapToGrid(pp.y, g),
      };
    }
  }

  return null;
}

export function distanceBetween(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function applyAxisLock(args: {
  point: Pt;
  points: Pt[];
  isShiftPressed: boolean;
}): Pt {
  const { point, points, isShiftPressed } = args;

  if (!isShiftPressed || points.length === 0) {
    return point;
  }

  const prev = points[points.length - 1];
  const dx = point.x - prev.x;
  const dy = point.y - prev.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: point.x, y: prev.y };
  }

  return { x: prev.x, y: point.y };
}

export function getCloseTarget(points: Pt[], point: Pt): Pt | null {
  if (points.length < 3) return null;

  const first = points[0];
  if (distanceBetween(first, point) <= CLOSE_DISTANCE) {
    return first;
  }

  return null;
}
