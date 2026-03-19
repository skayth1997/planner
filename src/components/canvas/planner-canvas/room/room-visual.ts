import { Line as FabricLine, Path, Pattern, Polygon } from "fabric";
import type { Canvas, Line } from "fabric";
import type { Pt } from "../core/planner-types";

import { insetPolygon } from "./polygon-geometry";
import {
  applyPolygonAbsolutePoints,
  removeClosingPoint,
} from "./room-geometry";

export type RoomVisual = {
  id: string;
  outer: Polygon;
  inner: Polygon;
  wallBand: Path;
};

export type WallStripVisual = {
  band: Polygon;
  sideA: Line;
  sideB: Line;
  startCap: Line | null;
  endCap: Line | null;
};

export const WALL_THICKNESS = 10;

let cachedWallPatternSource: HTMLCanvasElement | null = null;

function pointsToPath(points: Pt[]) {
  if (!points.length) return "";

  const [first, ...rest] = points;

  return (
    `M ${first.x} ${first.y} ` +
    rest.map((p) => `L ${p.x} ${p.y}`).join(" ") +
    " Z"
  );
}

function getWallPatternSource() {
  if (cachedWallPatternSource) return cachedWallPatternSource;

  const size = 10;

  const patternCanvas = document.createElement("canvas");
  patternCanvas.width = size;
  patternCanvas.height = size;

  const ctx = patternCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(17,24,39,0.7)";
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-size, size);
  ctx.lineTo(0, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(size, size);
  ctx.lineTo(size * 2, 0);
  ctx.stroke();

  cachedWallPatternSource = patternCanvas;

  return patternCanvas;
}

function createWallPatternFill() {
  const patternSource = getWallPatternSource();

  return patternSource
    ? new Pattern({
        source: patternSource,
        repeat: "repeat",
      })
    : "#f4f2ec";
}

function createWallBandPath(outerPoints: Pt[], innerPoints: Pt[]) {
  const outerPath = pointsToPath(outerPoints);
  const innerPath = pointsToPath([...innerPoints].reverse());

  return new Path(`${outerPath} ${innerPath}`, {
    fill: createWallPatternFill(),
    strokeWidth: 0,
    selectable: false,
    evented: false,
    objectCaching: true,
  });
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(v: Pt, s: number): Pt {
  return { x: v.x * s, y: v.y * s };
}

function cross(a: Pt, b: Pt) {
  return a.x * b.y - a.y * b.x;
}

function length(v: Pt) {
  return Math.hypot(v.x, v.y);
}

function normalize(v: Pt): Pt | null {
  const len = length(v);
  if (len < 0.0001) return null;
  return { x: v.x / len, y: v.y / len };
}

function leftNormal(v: Pt): Pt {
  return { x: -v.y, y: v.x };
}

function lineIntersection(p: Pt, r: Pt, q: Pt, s: Pt): Pt | null {
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 0.0001) return null;

  const qp = sub(q, p);
  const t = cross(qp, s) / rxs;

  return add(p, mul(r, t));
}

function isReasonableJoin(node: Pt, pt: Pt, thickness: number) {
  return length(sub(pt, node)) <= thickness * 6;
}

function getEndpointLocalJoin(args: {
  node: Pt;
  otherSelf: Pt;
  neighborOther?: Pt | null;
  thickness: number;
}) {
  const { node, otherSelf, neighborOther, thickness } = args;

  const dirSelf = normalize(sub(otherSelf, node));
  if (!dirSelf) {
    const half = thickness / 2;
    return {
      localPlus: { x: node.x, y: node.y + half },
      localMinus: { x: node.x, y: node.y - half },
    };
  }

  const nSelf = leftNormal(dirSelf);
  const half = thickness / 2;

  const selfPlusBase = add(node, mul(nSelf, half));
  const selfMinusBase = add(node, mul(nSelf, -half));

  if (!neighborOther) {
    return {
      localPlus: selfPlusBase,
      localMinus: selfMinusBase,
    };
  }

  const dirNeighbor = normalize(sub(neighborOther, node));
  if (!dirNeighbor) {
    return {
      localPlus: selfPlusBase,
      localMinus: selfMinusBase,
    };
  }

  if (Math.abs(cross(dirSelf, dirNeighbor)) < 0.0001) {
    return {
      localPlus: selfPlusBase,
      localMinus: selfMinusBase,
    };
  }

  const nNeighbor = leftNormal(dirNeighbor);

  const neighborPlusBase = add(node, mul(nNeighbor, half));
  const neighborMinusBase = add(node, mul(nNeighbor, -half));

  const joinedPlus =
    lineIntersection(selfPlusBase, dirSelf, neighborMinusBase, dirNeighbor) ??
    selfPlusBase;

  const joinedMinus =
    lineIntersection(selfMinusBase, dirSelf, neighborPlusBase, dirNeighbor) ??
    selfMinusBase;

  return {
    localPlus: isReasonableJoin(node, joinedPlus, thickness)
      ? joinedPlus
      : selfPlusBase,
    localMinus: isReasonableJoin(node, joinedMinus, thickness)
      ? joinedMinus
      : selfMinusBase,
  };
}

export function buildWallStripPoints(
  a: Pt,
  b: Pt,
  thickness = WALL_THICKNESS,
  options?: {
    startJoinOther?: Pt | null;
    endJoinOther?: Pt | null;
  }
): Pt[] {
  const dir = normalize(sub(b, a));

  if (!dir) {
    const half = thickness / 2;
    return [
      { x: a.x - half, y: a.y - half },
      { x: a.x + half, y: a.y - half },
      { x: a.x + half, y: a.y + half },
      { x: a.x - half, y: a.y + half },
    ];
  }

  const startJoin = getEndpointLocalJoin({
    node: a,
    otherSelf: b,
    neighborOther: options?.startJoinOther ?? null,
    thickness,
  });

  const endJoin = getEndpointLocalJoin({
    node: b,
    otherSelf: a,
    neighborOther: options?.endJoinOther ?? null,
    thickness,
  });

  const startGlobalPlus = startJoin.localPlus;
  const startGlobalMinus = startJoin.localMinus;

  const endGlobalPlus = endJoin.localMinus;
  const endGlobalMinus = endJoin.localPlus;

  return [startGlobalPlus, endGlobalPlus, endGlobalMinus, startGlobalMinus];
}

export function getWallFaceLengths(
  a: Pt,
  b: Pt,
  thickness = WALL_THICKNESS,
  options?: {
    startJoinOther?: Pt | null;
    endJoinOther?: Pt | null;
  }
) {
  const points = buildWallStripPoints(a, b, thickness, options);

  const topLength = Math.hypot(
    points[1].x - points[0].x,
    points[1].y - points[0].y
  );
  const bottomLength = Math.hypot(
    points[2].x - points[3].x,
    points[2].y - points[3].y
  );

  return {
    topLength,
    bottomLength,
    points,
  };
}

function createBorderLine(a: Pt, b: Pt) {
  return new FabricLine([a.x, a.y, b.x, b.y], {
    stroke: "#111827",
    strokeWidth: 1.8,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
    strokeLineCap: "square",
  }) as Line;
}

function updateBorderLine(line: Line, a: Pt, b: Pt) {
  line.set({
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
  });
  line.setCoords();
}

export function createWallStripVisual(
  a: Pt,
  b: Pt,
  thickness = WALL_THICKNESS,
  options?: {
    kind?: string;
    excludeFromExport?: boolean;
    fill?: string | Pattern;
    selectable?: boolean;
    evented?: boolean;
    startJoinOther?: Pt | null;
    endJoinOther?: Pt | null;
    showStartCap?: boolean;
    showEndCap?: boolean;
  }
): WallStripVisual {
  const points = buildWallStripPoints(a, b, thickness, {
    startJoinOther: options?.startJoinOther,
    endJoinOther: options?.endJoinOther,
  });

  const band = new Polygon([], {
    fill: options?.fill ?? createWallPatternFill(),
    stroke: "transparent",
    strokeWidth: 0,
    selectable: options?.selectable ?? false,
    evented: options?.evented ?? false,
    objectCaching: true,
    perPixelTargetFind: false,
    strokeUniform: true,
    excludeFromExport: options?.excludeFromExport ?? false,
  });

  (band as any).data = {
    kind: options?.kind ?? "wall-strip",
  };

  applyPolygonAbsolutePoints(band, points);

  const sideA = createBorderLine(points[0], points[1]);
  const sideB = createBorderLine(points[3], points[2]);

  const startCap =
    options?.showStartCap === false
      ? null
      : createBorderLine(points[0], points[3]);

  const endCap =
    options?.showEndCap === false
      ? null
      : createBorderLine(points[1], points[2]);

  return {
    band,
    sideA,
    sideB,
    startCap,
    endCap,
  };
}

export function updateWallStripVisual(
  wall: WallStripVisual,
  a: Pt,
  b: Pt,
  thickness = WALL_THICKNESS,
  options?: {
    excludeFromExport?: boolean;
    fill?: string | Pattern;
    selectable?: boolean;
    evented?: boolean;
    startJoinOther?: Pt | null;
    endJoinOther?: Pt | null;
    showStartCap?: boolean;
    showEndCap?: boolean;
  }
) {
  const points = buildWallStripPoints(a, b, thickness, {
    startJoinOther: options?.startJoinOther,
    endJoinOther: options?.endJoinOther,
  });

  applyPolygonAbsolutePoints(wall.band, points, {
    fill: options?.fill ?? createWallPatternFill(),
    stroke: "transparent",
    strokeWidth: 0,
    excludeFromExport: options?.excludeFromExport ?? false,
    selectable: options?.selectable ?? false,
    evented: options?.evented ?? false,
  });

  updateBorderLine(wall.sideA, points[0], points[1]);
  updateBorderLine(wall.sideB, points[3], points[2]);

  if (options?.showStartCap === false) {
    if (wall.startCap) {
      wall.band.canvas?.remove(wall.startCap);
      wall.startCap = null;
    }
  } else {
    if (!wall.startCap) {
      wall.startCap = createBorderLine(points[0], points[3]);
      wall.band.canvas?.add(wall.startCap);
    } else {
      updateBorderLine(wall.startCap, points[0], points[3]);
    }
  }

  if (options?.showEndCap === false) {
    if (wall.endCap) {
      wall.band.canvas?.remove(wall.endCap);
      wall.endCap = null;
    }
  } else {
    if (!wall.endCap) {
      wall.endCap = createBorderLine(points[1], points[2]);
      wall.band.canvas?.add(wall.endCap);
    } else {
      updateBorderLine(wall.endCap, points[1], points[2]);
    }
  }
}

export function addWallStripVisualToCanvas(
  canvas: Canvas,
  wall: WallStripVisual
) {
  canvas.add(wall.band);
  canvas.add(wall.sideA);
  canvas.add(wall.sideB);

  if (wall.startCap) canvas.add(wall.startCap);
  if (wall.endCap) canvas.add(wall.endCap);
}

export function removeWallStripVisual(canvas: Canvas, wall: WallStripVisual) {
  canvas.remove(wall.band);
  canvas.remove(wall.sideA);
  canvas.remove(wall.sideB);

  if (wall.startCap) canvas.remove(wall.startCap);
  if (wall.endCap) canvas.remove(wall.endCap);
}

export function createRoomVisual(points: Pt[], roomId: string): RoomVisual {
  const cleanPoints = removeClosingPoint(points);
  const innerPoints = insetPolygon(cleanPoints, WALL_THICKNESS);

  const wallBand = createWallBandPath(cleanPoints, innerPoints);

  const outer = new Polygon([], {
    fill: "transparent",
    stroke: "#111827",
    strokeWidth: 1.8,
    strokeLineJoin: "miter",
    selectable: false,
    evented: false,
    objectCaching: true,
    perPixelTargetFind: false,
    strokeUniform: true,
  });

  (outer as any).data = {
    kind: "room",
    id: roomId,
    role: "outer",
  };

  applyPolygonAbsolutePoints(outer, cleanPoints);

  const inner = new Polygon([], {
    fill: "#ffffff",
    stroke: "#111827",
    strokeWidth: 1.8,
    strokeLineJoin: "miter",
    selectable: false,
    evented: false,
    objectCaching: true,
    perPixelTargetFind: false,
    strokeUniform: true,
  });

  (inner as any).data = {
    kind: "room-inner",
    id: `${roomId}-inner`,
    roomId,
    role: "inner",
  };

  applyPolygonAbsolutePoints(inner, innerPoints);

  return {
    id: roomId,
    outer,
    inner,
    wallBand,
  };
}

export function updateRoomVisual(room: RoomVisual, points: Pt[]) {
  const cleanPoints = removeClosingPoint(points);
  const innerPoints = insetPolygon(cleanPoints, WALL_THICKNESS);

  applyPolygonAbsolutePoints(room.outer, cleanPoints, {
    fill: "transparent",
    stroke: "#111827",
    strokeWidth: 1.8,
  });

  applyPolygonAbsolutePoints(room.inner, innerPoints, {
    fill: "#ffffff",
    stroke: "#111827",
    strokeWidth: 1.8,
  });

  room.wallBand = createWallBandPath(cleanPoints, innerPoints);
}

export function removeRoomVisual(canvas: Canvas, room: RoomVisual) {
  canvas.remove(room.inner);
  canvas.remove(room.outer);
  canvas.remove(room.wallBand);
}

export function addRoomVisualToCanvas(canvas: Canvas, room: RoomVisual) {
  canvas.add(room.wallBand);
  canvas.add(room.outer);
  canvas.add(room.inner);

  canvas.bringObjectToFront(room.outer);
  canvas.bringObjectToFront(room.inner);
}
