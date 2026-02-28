import type { Canvas, Polygon } from "fabric";
import { Rect, Point, Path } from "fabric";
import { makeId } from "../core/utils";
import { projectPointToSegment } from "./wall-math";
import { getRoomPoints } from "../room/room-walls";
import type { Pt, WallSeg } from "../core/planner-types";
const DOOR_INSET = 12;

function wallsFromRoom(room: Polygon) {
  const pts = (getRoomPoints(room) as Pt[]).map((p) => ({
    x: Number(p.x) || 0,
    y: Number(p.y) || 0,
  }));

  const poly: Pt[] = pts;

  const segs: WallSeg[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    segs.push({ id: `seg-${i}`, a, b });
  }

  return { poly, segs };
}

function clamp01(t: number) {
  return Math.max(0, Math.min(1, t));
}

function segmentAngleDeg(a: Pt, b: Pt) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function segmentNormal(a: Pt, b: Pt) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy) || 1;
  const ux = vx / len;
  const uy = vy / len;
  return { nx: -uy, ny: ux };
}

function pointInPolygon(p: Pt, poly: Pt[]) {
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

  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  const eps = 1;
  const test = { x: mx + nx * eps, y: my + ny * eps };

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
  return hinge === "start" ? baseWallAngle : baseWallAngle + 180;
}

function doorLeafOpenAngle(leafClosedAngle: number, hinge: "start" | "end") {
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

function ensureWallId(obj: any, segs: WallSeg[]) {
  const hasWallId = typeof obj?.data?.wallId === "string" && obj.data.wallId;
  if (hasWallId) return;

  const segIndex = Number(obj?.data?.segIndex);
  if (!Number.isFinite(segIndex)) return;

  const idx = Math.max(0, Math.min(segs.length - 1, segIndex));
  obj.data = {
    ...(obj.data ?? {}),
    wallId: segs[idx]?.id ?? `seg-${idx}`,
  };
}

function findWall(segs: WallSeg[], wallId: string) {
  return segs.find((s) => s.id === wallId) ?? null;
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

  const t = clamp01(Number(obj.data?.t));
  const hinge =
    obj.data?.hinge === "end" ? ("end" as const) : ("start" as const);

  const { segs, poly } = wallsFromRoom(room);
  ensureWallId(obj, segs);

  const wallId = String(obj.data?.wallId || "");
  const s = findWall(segs, wallId);
  if (!s) return;

  const baseAngle = segmentAngleDeg(s.a, s.b);

  const hx0 = s.a.x + (s.b.x - s.a.x) * t;
  const hy0 = s.a.y + (s.b.y - s.a.y) * t;

  const { nx, ny } = inwardNormalForSegment(s.a, s.b, poly);
  const hx = hx0 + nx * DOOR_INSET;
  const hy = hy0 + ny * DOOR_INSET;

  const radius = Math.max(4, Number(obj.getScaledWidth?.() ?? obj.width ?? 0));

  const leafClosed = doorLeafClosedAngle(baseAngle, hinge);
  const leafOpen = doorLeafOpenAngle(leafClosed, hinge);

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

export function snapOpeningToNearestWall(obj: any, room: Polygon) {
  if (!isOpening(obj)) return;

  const { segs, poly } = wallsFromRoom(room);
  if (segs.length < 3) return;

  ensureWallId(obj, segs);

  const prevOffset = typeof obj.data?.offset === "number" ? obj.data.offset : 0;

  const isDoor = obj.data?.type === "door";
  const hinge =
    obj.data?.hinge === "end" ? ("end" as const) : ("start" as const);
  const isOpen = !!obj.data?.isOpen;

  if (!isDoor) {
    const c = obj.getCenterPoint();
    const p = { x: c.x, y: c.y };

    let best = {
      wallId: segs[0].id,
      t: 0,
      d2: Number.POSITIVE_INFINITY,
      q: { x: 0, y: 0 },
      a: segs[0].a,
      b: segs[0].b,
    };

    for (const s of segs) {
      const proj = projectPointToSegment(p, s.a, s.b);
      if (proj.d2 < best.d2) {
        best = {
          wallId: s.id,
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
      wallId: best.wallId,
      t: best.t,
      offset: prevOffset,
      segIndex: undefined,
    };

    return;
  }

  const hingePt = obj.getPointByOrigin(
    hinge === "start" ? "left" : "right",
    "center"
  );
  const hp = { x: hingePt.x, y: hingePt.y };

  let bestDoor = {
    wallId: segs[0].id,
    t: 0,
    d2: Number.POSITIVE_INFINITY,
    q: { x: 0, y: 0 },
    a: segs[0].a,
    b: segs[0].b,
  };

  for (const s of segs) {
    const proj = projectPointToSegment(hp, s.a, s.b);
    if (proj.d2 < bestDoor.d2) {
      bestDoor = {
        wallId: s.id,
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

  obj.data = {
    ...(obj.data ?? {}),
    kind: "opening",
    wallId: bestDoor.wallId,
    t: bestDoor.t,
    offset: prevOffset,
    segIndex: undefined,
  };

  syncDoorArcForDoor(obj, room);
}

export function updateOpeningsForRoomChange(canvas: Canvas, room: Polygon) {
  const { segs, poly } = wallsFromRoom(room);
  if (segs.length < 3) return;

  canvas.getObjects().forEach((o: any) => {
    if (!isOpening(o)) return;

    ensureWallId(o, segs);

    const wallId = String(o.data?.wallId || "");
    const s = findWall(segs, wallId);
    if (!s) {
      snapOpeningToNearestWall(o, room);
      return;
    }

    const t = clamp01(Number(o.data?.t));
    const offset = Number(o.data?.offset) || 0;

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
    wallId: "seg-0",
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
    wallId: "seg-0",
    t: 0.5,
    offset: 0,
  };

  canvas.add(win);
  snapOpeningToNearestWall(win as any, room);
  canvas.setActiveObject(win);
  canvas.requestRenderAll();
}
