import { Line } from "fabric";
import type { Canvas, Rect } from "fabric";
import type { GuideLine } from "./planner-types";
import { isFurniture } from "./utils";
import { ALIGN_SNAP_TOLERANCE } from "./planner-constants";

type GuidePair = {
  v: GuideLine;
  h: GuideLine;
  initialized: boolean;
};

function ensureGuidePair(canvas: Canvas, guidesRef: { current: GuideLine[] }) {
  // We store 2 lines in guidesRef.current: [v, h]
  if (guidesRef.current.length === 2) {
    return {
      v: guidesRef.current[0],
      h: guidesRef.current[1],
      initialized: true,
    } as GuidePair;
  }

  // Create once
  const v = new Line([0, 0, 0, 0], {
    stroke: "#2563eb",
    strokeWidth: 2,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    opacity: 0.9,
    visible: false,
  });

  const h = new Line([0, 0, 0, 0], {
    stroke: "#2563eb",
    strokeWidth: 2,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    opacity: 0.9,
    visible: false,
  });

  canvas.add(v);
  canvas.add(h);

  // Keep them on top
  canvas.bringObjectToFront(v);
  canvas.bringObjectToFront(h);

  guidesRef.current = [v, h];

  return { v, h, initialized: true } as GuidePair;
}

export function clearGuides(
  canvas: Canvas,
  guidesRef: { current: GuideLine[] }
) {
  // Instead of removing objects, just hide them
  if (guidesRef.current.length !== 2) return;
  const [v, h] = guidesRef.current;
  v.set({ visible: false });
  h.set({ visible: false });
  canvas.requestRenderAll();
}

function updateV(line: GuideLine, x: number, y1: number, y2: number) {
  line.set({ x1: x, y1, x2: x, y2, visible: true });
}

function updateH(line: GuideLine, y: number, x1: number, x2: number) {
  line.set({ x1, y1: y, x2, y2: y, visible: true });
}

function hide(line: GuideLine) {
  line.set({ visible: false });
}

function computeObjectAABB(obj: any) {
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
  };
}

function snapValue(value: number, target: number, tolerance: number) {
  const d = target - value;
  if (Math.abs(d) <= tolerance) return { snapped: true, delta: d };
  return { snapped: false, delta: 0 };
}

export function alignAndGuide(
  canvas: Canvas,
  room: Rect,
  guidesRef: { current: GuideLine[] },
  moving: any
) {
  const { v, h } = ensureGuidePair(canvas, guidesRef);

  const all = canvas
    .getObjects()
    .filter((o: any) => isFurniture(o) && o !== moving);

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

  // Best guide candidates
  let bestV: null | { x: number; y1: number; y2: number } = null;
  let bestH: null | { y: number; x1: number; x2: number } = null;

  const candidatesX = [mv.left, mv.cx, mv.right];
  const candidatesY = [mv.top, mv.cy, mv.bottom];

  for (const o of all) {
    const ob = computeObjectAABB(o);

    const targetsX = [ob.left, ob.cx, ob.right];
    const targetsY = [ob.top, ob.cy, ob.bottom];

    for (const cX of candidatesX) {
      for (const tX of targetsX) {
        const s = snapValue(cX, tX, ALIGN_SNAP_TOLERANCE);
        if (s.snapped && Math.abs(s.delta) < bestDxAbs) {
          bestDxAbs = Math.abs(s.delta);
          bestDx = s.delta;

          const y1 = Math.max(roomTop, Math.min(mv.top, ob.top));
          const y2 = Math.min(roomBottom, Math.max(mv.bottom, ob.bottom));
          bestV = { x: tX, y1, y2 };
        }
      }
    }

    for (const cY of candidatesY) {
      for (const tY of targetsY) {
        const s = snapValue(cY, tY, ALIGN_SNAP_TOLERANCE);
        if (s.snapped && Math.abs(s.delta) < bestDyAbs) {
          bestDyAbs = Math.abs(s.delta);
          bestDy = s.delta;

          const x1 = Math.max(roomLeft, Math.min(mv.left, ob.left));
          const x2 = Math.min(roomRight, Math.max(mv.right, ob.right));
          bestH = { y: tY, x1, x2 };
        }
      }
    }
  }

  if (bestDxAbs !== Number.POSITIVE_INFINITY) {
    moving.set({ left: (moving.left ?? 0) + bestDx });
  }
  if (bestDyAbs !== Number.POSITIVE_INFINITY) {
    moving.set({ top: (moving.top ?? 0) + bestDy });
  }

  // Update persistent lines
  if (bestV) updateV(v, bestV.x, bestV.y1, bestV.y2);
  else hide(v);

  if (bestH) updateH(h, bestH.y, bestH.x1, bestH.x2);
  else hide(h);

  // Keep on top (in case new objects got added)
  canvas.bringObjectToFront(v);
  canvas.bringObjectToFront(h);
}
