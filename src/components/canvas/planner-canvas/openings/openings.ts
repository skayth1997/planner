import type { Canvas, Polygon } from "fabric";
import { Rect, Point, Path } from "fabric";
import { makeId } from "../core/utils";

type Pt = { x: number; y: number };

// Put this into constants later if you want (planner-constants.ts)
const DOOR_INSET = 12;

function segsFromRoom(room: Polygon) {
  const pts = (room.points ?? []) as any[];
  const poly: Pt[] = pts.map((p) => ({
    x: Number(p.x) || 0,
    y: Number(p.y) || 0,
  }));
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

  return { q, t: tt, d2 };
}

function segmentAngleDeg(a: Pt, b: Pt) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// raw perp normal for segment a->b (unknown in/out direction)
function segmentNormal(a: Pt, b: Pt) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy) || 1;
  const ux = vx / len;
  const uy = vy / len;
  return { nx: -uy, ny: ux };
}

function pointInPolygon(p: Pt, poly: Pt[]) {
  // Ray-casting algorithm
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;

    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 0.0) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

function inwardNormalForSegment(a: Pt, b: Pt, poly: Pt[]) {
  let { nx, ny } = segmentNormal(a, b);

  // probe near segment midpoint
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  const eps = 1;
  const test = { x: mx + nx * eps, y: my + ny * eps };

  // flip if test point goes outside polygon
  if (!pointInPolygon(test, poly)) {
    nx = -nx;
    ny = -ny;
  }

  return { nx, ny };
}

function degToRad(a: number) {
  return (a * Math.PI) / 180;
}

function doorLeafClosedAngle(baseWallAngle: number, hinge: "start" | "end") {
  // start hinge: leaf points along wall direction
  // end hinge:   leaf points opposite wall direction
  return hinge === "start" ? baseWallAngle : baseWallAngle + 180;
}

function doorLeafOpenAngle(leafClosedAngle: number, hinge: "start" | "end") {
  // start hinge swings +90, end hinge swings -90
  return hinge === "start" ? leafClosedAngle + 90 : leafClosedAngle - 90;
}

function getDoorArc(canvas: Canvas, doorId: string) {
  return canvas
    .getObjects()
    .find(
      (o: any) => o?.data?.kind === "doorArc" && o?.data?.doorId === doorId
    ) as any;
}

function removeDoorArc(canvas: Canvas, doorId: string) {
  const arc = getDoorArc(canvas, doorId);
  if (arc) canvas.remove(arc);
}

function upsertDoorArcPath(
  canvas: Canvas,
  doorId: string,
  hingePt: Pt,
  radius: number,
  startDeg: number,
  endDeg: number,
  sweepFlag: 0 | 1
) {
  const startRad = degToRad(startDeg);
  const endRad = degToRad(endDeg);

  const x1 = hingePt.x + Math.cos(startRad) * radius;
  const y1 = hingePt.y + Math.sin(startRad) * radius;

  const x2 = hingePt.x + Math.cos(endRad) * radius;
  const y2 = hingePt.y + Math.sin(endRad) * radius;

  // SVG arc: M x1 y1 A r r 0 0 sweep x2 y2
  const d = `M ${x1} ${y1} A ${radius} ${radius} 0 0 ${sweepFlag} ${x2} ${y2}`;

  const existing = getDoorArc(canvas, doorId);
  if (existing) canvas.remove(existing);

  const arc = new Path(d, {
    fill: "",
    stroke: "rgba(245,158,11,0.75)",
    strokeWidth: 2,
    selectable: false,
    evented: false,
    objectCaching: false,
    hoverCursor: "default",
    excludeFromExport: true,
  });

  (arc as any).data = { kind: "doorArc", doorId };

  canvas.add(arc);
  arc.setCoords();
}

function syncDoorArcForDoor(obj: any, room: Polygon) {
  if (!isOpening(obj)) return;
  if (obj.data?.type !== "door") return;

  const canvas = obj.canvas as Canvas | undefined;
  if (!canvas) return;

  const doorId = String(obj.data?.id || "");
  if (!doorId) return;

  const isOpen = !!obj.data?.isOpen;
  if (!isOpen) {
    removeDoorArc(canvas, doorId);
    return;
  }

  const segIndex = Number(obj.data?.segIndex);
  const t = clamp01(Number(obj.data?.t));
  const hinge =
    obj.data?.hinge === "end" ? ("end" as const) : ("start" as const);

  const { segs, poly } = segsFromRoom(room);
  if (!Number.isFinite(segIndex) || segIndex < 0 || segIndex >= segs.length)
    return;

  const s = segs[segIndex];
  const baseAngle = segmentAngleDeg(s.a, s.b);

  // hinge world point on wall, inset inward
  const hx0 = s.a.x + (s.b.x - s.a.x) * t;
  const hy0 = s.a.y + (s.b.y - s.a.y) * t;

  const { nx, ny } = inwardNormalForSegment(s.a, s.b, poly);
  const hx = hx0 + nx * DOOR_INSET;
  const hy = hy0 + ny * DOOR_INSET;

  // radius = door leaf length (use current scaled width)
  const radius = Math.max(4, Number(obj.getScaledWidth?.() ?? obj.width ?? 0));

  const leafClosed = doorLeafClosedAngle(baseAngle, hinge);
  const leafOpen = doorLeafOpenAngle(leafClosed, hinge);

  // start hinge swings +90 => sweep 1, end hinge swings -90 => sweep 0
  const sweep: 0 | 1 = hinge === "start" ? 1 : 0;

  upsertDoorArcPath(
    canvas,
    doorId,
    { x: hx, y: hy },
    radius,
    leafClosed,
    leafOpen,
    sweep
  );
}

export function isOpening(obj: any) {
  return obj?.data?.kind === "opening";
}

/**
 * Snap opening to nearest wall.
 * - windows: use center projection (with offset)
 * - doors: use hinge-point projection, and inset inside room (DOOR_INSET)
 */
export function snapOpeningToNearestWall(obj: any, room: Polygon) {
  if (!isOpening(obj)) return;

  const { segs, poly } = segsFromRoom(room);
  if (segs.length < 3) return;

  const prevOffset = typeof obj.data?.offset === "number" ? obj.data.offset : 0;

  const isDoor = obj.data?.type === "door";
  const hinge =
    obj.data?.hinge === "end" ? ("end" as const) : ("start" as const);
  const isOpen = !!obj.data?.isOpen;

  // === WINDOW / non-door: center projection ===
  if (!isDoor) {
    const c = obj.getCenterPoint();
    const p = { x: c.x, y: c.y };

    let best = {
      segIndex: 0,
      t: 0,
      d2: Number.POSITIVE_INFINITY,
      q: { x: 0, y: 0 },
      a: segs[0].a,
      b: segs[0].b,
    };

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const proj = projectPointToSegment(p, s.a, s.b);
      if (proj.d2 < best.d2) {
        best = {
          segIndex: i,
          t: proj.t,
          d2: proj.d2,
          q: proj.q,
          a: s.a,
          b: s.b,
        };
      }
    }

    const { nx, ny } = inwardNormalForSegment(best.a, best.b, poly);
    const baseAngle = segmentAngleDeg(best.a, best.b);

    obj.set({
      left: best.q.x + nx * prevOffset,
      top: best.q.y + ny * prevOffset,
      originX: "center",
      originY: "center",
      angle: baseAngle,
    });

    obj.setCoords();

    obj.data = {
      ...(obj.data ?? {}),
      kind: "opening",
      segIndex: best.segIndex,
      t: best.t,
      offset: prevOffset,
    };

    return;
  }

  // === DOOR: hinge projection ===
  const hingePt = obj.getPointByOrigin(
    hinge === "start" ? "left" : "right",
    "center"
  );
  const hp = { x: hingePt.x, y: hingePt.y };

  let bestDoor = {
    segIndex: 0,
    t: 0,
    d2: Number.POSITIVE_INFINITY,
    q: { x: 0, y: 0 },
    a: segs[0].a,
    b: segs[0].b,
  };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const proj = projectPointToSegment(hp, s.a, s.b);
    if (proj.d2 < bestDoor.d2) {
      bestDoor = {
        segIndex: i,
        t: proj.t,
        d2: proj.d2,
        q: proj.q,
        a: s.a,
        b: s.b,
      };
    }
  }

  const baseAngle = segmentAngleDeg(bestDoor.a, bestDoor.b);
  const openAngle = hinge === "start" ? baseAngle + 90 : baseAngle - 90;

  // always inset INSIDE polygon
  const { nx, ny } = inwardNormalForSegment(bestDoor.a, bestDoor.b, poly);

  const insetX = bestDoor.q.x + nx * (DOOR_INSET + prevOffset);
  const insetY = bestDoor.q.y + ny * (DOOR_INSET + prevOffset);

  obj.set({
    originX: hinge === "start" ? "left" : "right",
    originY: "center",
    angle: isOpen ? openAngle : baseAngle,
  });

  obj.setPositionByOrigin(
    new Point(insetX, insetY),
    hinge === "start" ? "left" : "right",
    "center"
  );

  obj.setCoords();

  // store attachment (segment + t)
  obj.data = {
    ...(obj.data ?? {}),
    kind: "opening",
    segIndex: bestDoor.segIndex,
    t: bestDoor.t,
    offset: prevOffset,
  };

  syncDoorArcForDoor(obj, room);
}

/**
 * When room shape changes, keep openings attached:
 * - windows: center on wall + offset
 * - doors: hinge on wall + inset
 */
export function updateOpeningsForRoomChange(canvas: Canvas, room: Polygon) {
  const { segs, poly } = segsFromRoom(room);
  if (segs.length < 3) return;

  canvas.getObjects().forEach((o: any) => {
    if (!isOpening(o)) return;

    const segIndex = Number(o.data?.segIndex);
    const t = clamp01(Number(o.data?.t));
    const offset = Number(o.data?.offset) || 0;

    const idx = Number.isFinite(segIndex) ? segIndex : -1;
    if (idx < 0 || idx >= segs.length) {
      snapOpeningToNearestWall(o, room);
      return;
    }

    const s = segs[idx];

    const wallX = s.a.x + (s.b.x - s.a.x) * t;
    const wallY = s.a.y + (s.b.y - s.a.y) * t;

    const baseAngle = segmentAngleDeg(s.a, s.b);

    const isDoor = o.data?.type === "door";
    const hinge =
      o.data?.hinge === "end" ? ("end" as const) : ("start" as const);
    const isOpen = !!o.data?.isOpen;
    const openAngle = hinge === "start" ? baseAngle + 90 : baseAngle - 90;

    const { nx, ny } = inwardNormalForSegment(s.a, s.b, poly);

    if (!isDoor) {
      o.set({
        originX: "center",
        originY: "center",
        left: wallX + nx * offset,
        top: wallY + ny * offset,
        angle: baseAngle,
      });
      o.setCoords();
      return;
    }

    // door hinge point = wall point inset inward (+offset if any)
    const px = wallX + nx * (DOOR_INSET + offset);
    const py = wallY + ny * (DOOR_INSET + offset);

    o.set({
      originX: hinge === "start" ? "left" : "right",
      originY: "center",
      angle: isOpen ? openAngle : baseAngle,
    });

    o.setPositionByOrigin(
      new Point(px, py),
      hinge === "start" ? "left" : "right",
      "center"
    );

    o.setCoords();
    syncDoorArcForDoor(o, room);
  });
}

export function toggleDoorOpen(obj: any, room: Polygon) {
  if (!isOpening(obj)) return;
  if (obj.data?.type !== "door") return;

  obj.data = { ...(obj.data ?? {}), isOpen: !obj.data?.isOpen };
  snapOpeningToNearestWall(obj, room);
}

export function applyDoorHinge(
  obj: any,
  room: Polygon,
  hinge: "start" | "end"
) {
  if (!isOpening(obj)) return;
  if (obj.data?.type !== "door") return;

  obj.data = { ...(obj.data ?? {}), hinge };
  snapOpeningToNearestWall(obj, room);
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
    isOpen: false,
    hinge: "start" as "start" | "end",
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
