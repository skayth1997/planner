import { Polygon } from "fabric";
import type { Canvas } from "fabric";
import type { Pt } from "../core/planner-types";
import type { DetectedRoom } from "./room-detection";
import { applyPolygonAbsolutePoints } from "./room-geometry";
import { insetPolygon } from "./polygon-geometry";

export type RoomFillVisual = {
  id: string;
  polygon: Polygon;
};

const DEFAULT_WALL_THICKNESS = 10;

function createRoomFillPolygon(
  points: Pt[],
  wallThickness = DEFAULT_WALL_THICKNESS
) {
  const innerOverlap = 4;
  const innerPoints = insetPolygon(
    points,
    Math.max(0, wallThickness - innerOverlap)
  );

  const polygon = new Polygon([], {
    fill: "#ffffff",
    stroke: "transparent",
    strokeWidth: 0,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: true,
    perPixelTargetFind: false,
    strokeUniform: true,
  });

  (polygon as any).data = {
    kind: "room-fill",
  };

  applyPolygonAbsolutePoints(polygon, innerPoints);

  return polygon;
}

function isGridObject(obj: any) {
  const kind = obj?.data?.kind;
  return kind === "grid-line" || kind === "grid-line-major";
}

export function createRoomFillVisual(
  room: DetectedRoom,
  wallThickness = DEFAULT_WALL_THICKNESS
): RoomFillVisual {
  return {
    id: room.id,
    polygon: createRoomFillPolygon(room.points, wallThickness),
  };
}

export function addRoomFillToCanvas(canvas: Canvas, fill: RoomFillVisual) {
  canvas.add(fill.polygon);

  const objects = canvas.getObjects() as any[];
  const lastGridIndex = objects.reduce((best, obj, index) => {
    return isGridObject(obj) ? index : best;
  }, -1);

  const targetIndex = Math.max(0, lastGridIndex + 1);

  if (typeof (canvas as any).moveObjectTo === "function") {
    (canvas as any).moveObjectTo(fill.polygon, targetIndex);
  }
}

export function removeRoomFillFromCanvas(canvas: Canvas, fill: RoomFillVisual) {
  canvas.remove(fill.polygon);
}

export function clearRoomFills(canvas: Canvas, fills: RoomFillVisual[]) {
  for (const fill of fills) {
    canvas.remove(fill.polygon);
  }
}

export function rebuildRoomFills(args: {
  canvas: Canvas;
  rooms: DetectedRoom[];
  current: RoomFillVisual[];
  wallThickness?: number;
}) {
  const {
    canvas,
    rooms,
    current,
    wallThickness = DEFAULT_WALL_THICKNESS,
  } = args;

  clearRoomFills(canvas, current);

  const next = rooms.map((room) => createRoomFillVisual(room, wallThickness));

  for (const fill of next) {
    addRoomFillToCanvas(canvas, fill);
  }

  return next;
}
