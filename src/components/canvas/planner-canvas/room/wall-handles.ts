import type { Canvas, Circle } from "fabric";
import { Circle as FabricCircle } from "fabric";
import type { Pt } from "../core/planner-types";

export type WallHandleVisuals = {
  start: Circle;
  middle: Circle;
  end: Circle;
};

function createHandleCircle(args: {
  point: Pt;
  role: "start" | "middle" | "end";
}) {
  const { point, role } = args;

  const circle = new FabricCircle({
    left: point.x,
    top: point.y,
    radius: 9,
    originX: "center",
    originY: "center",
    fill: "#f8fafc",
    stroke: "#e11d48",
    strokeWidth: 3,

    selectable: false,
    evented: false,

    hasControls: false,
    hasBorders: false,

    borderColor: "transparent",
    cornerColor: "transparent",
    cornerStrokeColor: "transparent",
    transparentCorners: true,

    hoverCursor: "default",
    moveCursor: "default",

    excludeFromExport: true,
    objectCaching: false,
    perPixelTargetFind: false,
  });

  (circle as any).data = {
    kind: "wall-handle",
    role,
  };

  return circle as Circle;
}

export function createWallHandleVisuals(args: {
  canvas: Canvas;
  a: Pt;
  b: Pt;
}) {
  const { canvas, a, b } = args;

  const middle: Pt = {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };

  const visuals: WallHandleVisuals = {
    start: createHandleCircle({ point: a, role: "start" }),
    middle: createHandleCircle({ point: middle, role: "middle" }),
    end: createHandleCircle({ point: b, role: "end" }),
  };

  canvas.add(visuals.start);
  canvas.add(visuals.middle);
  canvas.add(visuals.end);

  canvas.bringObjectToFront(visuals.start);
  canvas.bringObjectToFront(visuals.middle);
  canvas.bringObjectToFront(visuals.end);

  return visuals;
}

export function removeWallHandleVisuals(
  canvas: Canvas,
  visuals: WallHandleVisuals | null
) {
  if (!visuals) return;

  canvas.remove(visuals.start);
  canvas.remove(visuals.middle);
  canvas.remove(visuals.end);
}
