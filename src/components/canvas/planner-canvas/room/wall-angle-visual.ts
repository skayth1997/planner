import {
  Circle as FabricCircle,
  Line as FabricLine,
  Path,
  Text as FabricText,
} from "fabric";
import type { Canvas, Circle, Line, Text } from "fabric";
import type { Pt } from "../core/planner-types";

export type WallAngleVisual = {
  rayA: Line;
  rayB: Line;
  arc: Path;
  dotA: Circle;
  dotB: Circle;
  text: Text;
};

function normalize(v: Pt): Pt | null {
  const len = Math.hypot(v.x, v.y);
  if (len < 0.0001) return null;

  return {
    x: v.x / len,
    y: v.y / len,
  };
}

function angleOf(v: Pt) {
  return Math.atan2(v.y, v.x);
}

function normalizeDeltaRad(v: number) {
  let a = v;

  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;

  return a;
}

function pointFrom(node: Pt, angle: number, radius: number): Pt {
  return {
    x: node.x + Math.cos(angle) * radius,
    y: node.y + Math.sin(angle) * radius,
  };
}

function createLine(a: Pt, b: Pt): Line {
  return new FabricLine([a.x, a.y, b.x, b.y], {
    stroke: "#e11d48",
    strokeWidth: 1.5,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
    strokeLineCap: "round",
  }) as Line;
}

function createDot(center: Pt): Circle {
  return new FabricCircle({
    left: center.x,
    top: center.y,
    originX: "center",
    originY: "center",
    radius: 3.5,
    fill: "#e11d48",
    strokeWidth: 0,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
  }) as Circle;
}

function createText(text: string, center: Pt): Text {
  return new FabricText(text, {
    left: center.x,
    top: center.y,
    originX: "center",
    originY: "center",
    fontSize: 14,
    fontWeight: "700",
    fill: "#e11d48",
    angle: 0,
    backgroundColor: "rgba(255,255,255,0.92)",
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
  }) as Text;
}

function createArcPath(args: {
  node: Pt;
  startAngle: number;
  endAngle: number;
  radius: number;
}): Path {
  const { node, startAngle, endAngle, radius } = args;

  const start = pointFrom(node, startAngle, radius);
  const end = pointFrom(node, endAngle, radius);

  const delta = normalizeDeltaRad(endAngle - startAngle);
  const sweepFlag = delta >= 0 ? 1 : 0;

  const path = `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweepFlag} ${end.x} ${end.y}`;

  return new Path(path, {
    fill: "",
    stroke: "#e11d48",
    strokeWidth: 1.5,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
  });
}

export function createWallAngleVisual(args: {
  canvas: Canvas;
  node: Pt;
  selectedVec: Pt;
  neighborVec: Pt;
  radius?: number;
  rayLength?: number;
  textOffset?: number;
}): WallAngleVisual | null {
  const {
    canvas,
    node,
    selectedVec,
    neighborVec,
    radius = 28,
    rayLength = 40,
    textOffset = 18,
  } = args;

  const aVec = normalize(selectedVec);
  const bVec = normalize(neighborVec);

  if (!aVec || !bVec) return null;

  const angleA = angleOf(aVec);
  const angleB = angleOf(bVec);

  let delta = normalizeDeltaRad(angleB - angleA);

  if (Math.abs(delta) < 0.001) return null;

  if (Math.abs(delta) > Math.PI) {
    delta = delta > 0 ? delta - Math.PI * 2 : delta + Math.PI * 2;
  }

  const visibleAngleDeg = Math.abs(delta) * (180 / Math.PI);
  const bisectorAngle = angleA + delta / 2;

  const rayEndA = pointFrom(node, angleA, rayLength);
  const rayEndB = pointFrom(node, angleB, rayLength);

  const textPoint = pointFrom(node, bisectorAngle, radius + textOffset);

  const rayA = createLine(node, rayEndA);
  const rayB = createLine(node, rayEndB);
  const arc = createArcPath({
    node,
    startAngle: angleA,
    endAngle: angleB,
    radius,
  });

  const dotA = createDot(rayEndA);
  const dotB = createDot(rayEndB);
  const text = createText(`${visibleAngleDeg.toFixed(1)}°`, textPoint);

  const objects = [rayA, rayB, arc, dotA, dotB, text];
  for (const obj of objects) {
    canvas.add(obj as any);
  }

  return {
    rayA,
    rayB,
    arc,
    dotA,
    dotB,
    text,
  };
}

export function removeWallAngleVisual(
  canvas: Canvas,
  visual: WallAngleVisual | null | undefined
) {
  if (!visual) return;

  canvas.remove(visual.rayA);
  canvas.remove(visual.rayB);
  canvas.remove(visual.arc);
  canvas.remove(visual.dotA);
  canvas.remove(visual.dotB);
  canvas.remove(visual.text);
}
