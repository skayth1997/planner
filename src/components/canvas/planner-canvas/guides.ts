import { Line } from "fabric";
import type { Canvas, Rect } from "fabric";
import type { GuideLine } from "./planner-types";
import { isFurniture } from "./utils";
import { ALIGN_SNAP_TOLERANCE } from "./planner-constants";

export function clearGuides(canvas: Canvas, guidesRef: { current: GuideLine[] }) {
  if (!guidesRef.current.length) return;
  for (const g of guidesRef.current) canvas.remove(g);
  guidesRef.current = [];
  canvas.requestRenderAll();
}

export function addGuide(
  canvas: Canvas,
  guidesRef: { current: GuideLine[] },
  line: GuideLine
) {
  canvas.add(line);
  canvas.bringObjectToFront(line);
  guidesRef.current.push(line);
}

export function drawGuides(
  canvas: Canvas,
  room: Rect,
  guidesRef: { current: GuideLine[] },
  guides: Array<
    | { kind: "v"; x: number; y1: number; y2: number }
    | { kind: "h"; y: number; x1: number; x2: number }
    >
) {
  clearGuides(canvas, guidesRef);
  if (guides.length === 0) return;

  for (const g of guides) {
    if (g.kind === "v") {
      addGuide(
        canvas,
        guidesRef,
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
        guidesRef,
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

  // keep guides on top; furniture order not changed
  canvas.getObjects().forEach((o: any) => {
    if (!isFurniture(o)) return;
  });
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
    w: r.width,
    h: r.height,
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

    for (const cX of candidatesX) {
      for (const tX of targetsX) {
        const s = snapValue(cX, tX, ALIGN_SNAP_TOLERANCE);
        if (s.snapped && Math.abs(s.delta) < bestDxAbs) {
          bestDxAbs = Math.abs(s.delta);
          bestDx = s.delta;

          const y1 = Math.max(roomTop, Math.min(mv.top, ob.top));
          const y2 = Math.min(roomBottom, Math.max(mv.bottom, ob.bottom));
          guides.push({ kind: "v", x: tX, y1, y2 });
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
          guides.push({ kind: "h", y: tY, x1, x2 });
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

  // keep only one v + one h
  const bestGuides: typeof guides = [];
  for (let i = guides.length - 1; i >= 0; i--) {
    const g = guides[i];
    if (g.kind === "v" && !bestGuides.some((x) => x.kind === "v"))
      bestGuides.push(g);
    if (g.kind === "h" && !bestGuides.some((x) => x.kind === "h"))
      bestGuides.push(g);
    if (bestGuides.length === 2) break;
  }

  drawGuides(canvas, room, guidesRef, bestGuides);
}
