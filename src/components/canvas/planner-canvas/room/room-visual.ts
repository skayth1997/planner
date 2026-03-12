import { Path, Pattern, Polygon } from "fabric";
import type { Canvas } from "fabric";
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

export const WALL_THICKNESS = 20;

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

function createWallBandPath(outerPoints: Pt[], innerPoints: Pt[]) {
  const outerPath = pointsToPath(outerPoints);
  const innerPath = pointsToPath([...innerPoints].reverse());

  const patternSource = getWallPatternSource();

  return new Path(`${outerPath} ${innerPath}`, {
    fill: patternSource
      ? new Pattern({
          source: patternSource,
          repeat: "repeat",
        })
      : "#f4f2ec",
    strokeWidth: 0,
    selectable: false,
    evented: false,
    objectCaching: true,
  });
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
