import type { Canvas, Polygon } from "fabric";
import { Rect } from "fabric";
import { makeId } from "../core/utils";

type Pt = { x: number; y: number };

function segsFromRoom(room: Polygon) {
  const pts = (room.points ?? []) as any[];
  const poly: Pt[] = pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
  const segs: Array<{ a: Pt; b: Pt }> = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    segs.push({ a, b });
  }
  return { poly, segs };
}

function clamp01(t: number) {
  return Math.max(0, Math.min(1, t));
}

function projectPointToSegment(p: Pt, a: Pt, b: Pt) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;

  const ab2 = abx * abx + aby * aby;
  const t = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
  const tt = clamp01(t);

  const q = { x: a.x + abx * tt, y: a.y + aby * tt };
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  const d2 = dx * dx + dy * dy;

  return { q, t: tt, d2, abx, aby };
}

function segmentAngleDeg(a: Pt, b: Pt) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// unit normal (perp) for segment a->b
function segmentNormal(a: Pt, b: Pt) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy) || 1;
  const ux = vx / len;
  const uy = vy / len;
  // rotate 90deg
  return { nx: -uy, ny: ux, ux, uy };
}

export function isOpening(obj: any) {
  return obj?.data?.kind === "opening";
}

/**
 * Attach opening to nearest wall.
 * Stores segIndex + t, and places the opening centered on the wall (plus offset).
 */
export function snapOpeningToNearestWall(obj: any, room: Polygon) {
  if (!isOpening(obj)) return;

  const { segs } = segsFromRoom(room);
  if (segs.length < 3) return;

  const c = obj.getCenterPoint();
  const p = { x: c.x, y: c.y };

  let best = { segIndex: 0, t: 0, d2: Number.POSITIVE_INFINITY, q: { x: 0, y: 0 }, a: segs[0].a, b: segs[0].b };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const proj = projectPointToSegment(p, s.a, s.b);
    if (proj.d2 < best.d2) {
      best = { segIndex: i, t: proj.t, d2: proj.d2, q: proj.q, a: s.a, b: s.b };
    }
  }

  const { nx, ny } = segmentNormal(best.a, best.b);

  // preserve existing offset if any, else set to 0 for MVP
  const prevOffset = typeof obj.data?.offset === "number" ? obj.data.offset : 0;

  // place center at projection + normal*offset
  const targetCx = best.q.x + nx * prevOffset;
  const targetCy = best.q.y + ny * prevOffset;

  const angle = segmentAngleDeg(best.a, best.b);

  obj.set({
    left: targetCx,
    top: targetCy,
    originX: "center",
    originY: "center",
    angle,
  });

  obj.setCoords();

  obj.data = {
    ...(obj.data ?? {}),
    kind: "opening",
    segIndex: best.segIndex,
    t: best.t,
    offset: prevOffset,
  };
}

/**
 * When the room changes (corners moved), update attached openings positions.
 * Keeps segIndex + t stable, recomputes center from new segment endpoints.
 */
export function updateOpeningsForRoomChange(canvas: Canvas, room: Polygon) {
  const { segs } = segsFromRoom(room);
  if (segs.length < 3) return;

  canvas.getObjects().forEach((o: any) => {
    if (!isOpening(o)) return;

    const segIndex = Number(o.data?.segIndex);
    const t = clamp01(Number(o.data?.t));
    const offset = Number(o.data?.offset) || 0;

    const idx = Number.isFinite(segIndex) ? segIndex : -1;
    if (idx < 0 || idx >= segs.length) {
      // fallback: re-snap
      snapOpeningToNearestWall(o, room);
      return;
    }

    const s = segs[idx];
    const cx = s.a.x + (s.b.x - s.a.x) * t;
    const cy = s.a.y + (s.b.y - s.a.y) * t;

    const { nx, ny } = segmentNormal(s.a, s.b);
    const angle = segmentAngleDeg(s.a, s.b);

    o.set({
      originX: "center",
      originY: "center",
      left: cx + nx * offset,
      top: cy + ny * offset,
      angle,
    });
    o.setCoords();
  });
}

export function addDoor(canvas: Canvas, room: Polygon) {
  const door = new Rect({
    width: 90,
    height: 14,
    fill: "rgba(245,158,11,0.25)",
    stroke: "#f59e0b",
    strokeWidth: 2,
    originX: "center",
    originY: "center",
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    lockScalingFlip: true,
    transparentCorners: false,
    hoverCursor: "move",
  });

  (door as any).data = {
    kind: "opening",
    type: "door",
    id: makeId(),
    segIndex: 0,
    t: 0.5,
    offset: 0,
  };

  canvas.add(door);
  snapOpeningToNearestWall(door as any, room);
  canvas.setActiveObject(door);
  canvas.requestRenderAll();
}

export function addWindow(canvas: Canvas, room: Polygon) {
  const win = new Rect({
    width: 80,
    height: 10,
    fill: "rgba(59,130,246,0.18)",
    stroke: "#3b82f6",
    strokeWidth: 2,
    originX: "center",
    originY: "center",
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    lockScalingFlip: true,
    transparentCorners: false,
    hoverCursor: "move",
  });

  (win as any).data = {
    kind: "opening",
    type: "window",
    id: makeId(),
    segIndex: 0,
    t: 0.5,
    offset: 0,
  };

  canvas.add(win);
  snapOpeningToNearestWall(win as any, room);
  canvas.setActiveObject(win);
  canvas.requestRenderAll();
}
