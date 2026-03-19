import type { Canvas, Circle, Line, Path, Polygon } from "fabric";
import {
  Circle as FabricCircle,
  Line as FabricLine,
  Path as FabricPath,
  Pattern,
  Polygon as FabricPolygon,
} from "fabric";
import type { Pt } from "../core/planner-types";
import { insetPolygon } from "./polygon-geometry";
import { applyPolygonAbsolutePoints } from "./room-geometry";
import {
  addWallStripVisualToCanvas,
  createWallStripVisual,
  removeWallStripVisual,
  type WallStripVisual,
} from "./room-visual";

const CURSOR_WALL_SIZE = 20;
const CURSOR_WALL_THICKNESS = 8;

let cachedCursorWallPatternSource: HTMLCanvasElement | null = null;

function pointsToPath(points: Pt[]) {
  if (!points.length) return "";

  const [first, ...rest] = points;

  return (
    `M ${first.x} ${first.y} ` +
    rest.map((p) => `L ${p.x} ${p.y}`).join(" ") +
    " Z"
  );
}

function getCursorWallPatternSource() {
  if (cachedCursorWallPatternSource) return cachedCursorWallPatternSource;

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

  cachedCursorWallPatternSource = patternCanvas;
  return patternCanvas;
}

function createCursorWallBandPath(outerPoints: Pt[], innerPoints: Pt[]) {
  const outerPath = pointsToPath(outerPoints);
  const innerPath = pointsToPath([...innerPoints].reverse());

  const patternSource = getCursorWallPatternSource();

  return new FabricPath(`${outerPath} ${innerPath}`, {
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
    excludeFromExport: true,
  });
}

function buildCursorWallPoints(anchor: Pt) {
  const size = CURSOR_WALL_SIZE;
  const half = size / 2;

  const left = anchor.x - half;
  const top = anchor.y - half;

  const outer: Pt[] = [
    { x: left, y: top },
    { x: left + size, y: top },
    { x: left + size, y: top + size },
    { x: left, y: top + size },
  ];

  const inner = insetPolygon(outer, CURSOR_WALL_THICKNESS);

  return { outer, inner };
}

export type WallPreviewState = {
  validWall: WallStripVisual | null;
  guideLines: Line[];
  guideCircle: Circle | null;
  guideCenter: Circle | null;
  cursorOuter: Polygon | null;
  cursorInner: Polygon | null;
  cursorBand: Path | null;
};

export function createWallPreviewState(): WallPreviewState {
  return {
    validWall: null,
    guideLines: [],
    guideCircle: null,
    guideCenter: null,
    cursorOuter: null,
    cursorInner: null,
    cursorBand: null,
  };
}

export function clearDragPreview(canvas: Canvas, state: WallPreviewState) {
  if (state.validWall) {
    removeWallStripVisual(canvas, state.validWall);
    state.validWall = null;
  }
}

export function clearGuides(canvas: Canvas, state: WallPreviewState) {
  for (const line of state.guideLines) {
    canvas.remove(line);
  }
  state.guideLines = [];

  if (state.guideCircle) {
    canvas.remove(state.guideCircle);
    state.guideCircle = null;
  }

  if (state.guideCenter) {
    canvas.remove(state.guideCenter);
    state.guideCenter = null;
  }
}

export function clearCursor(canvas: Canvas, state: WallPreviewState) {
  if (state.cursorBand) {
    canvas.remove(state.cursorBand);
    state.cursorBand = null;
  }

  if (state.cursorOuter) {
    canvas.remove(state.cursorOuter);
    state.cursorOuter = null;
  }

  if (state.cursorInner) {
    canvas.remove(state.cursorInner);
    state.cursorInner = null;
  }
}

export function clearAllWallPreview(canvas: Canvas, state: WallPreviewState) {
  clearDragPreview(canvas, state);
  clearGuides(canvas, state);
  clearCursor(canvas, state);
}

export function renderDraggedWallPreview(args: {
  canvas: Canvas;
  state: WallPreviewState;
  start: Pt;
  validEnd: Pt | null;
  thickness: number;
}) {
  const { canvas, state, start, validEnd, thickness } = args;

  clearDragPreview(canvas, state);

  if (!validEnd) return;

  state.validWall = createWallStripVisual(start, validEnd, thickness, {
    kind: "wall-preview-valid",
    excludeFromExport: true,
    selectable: false,
    evented: false,
    showStartCap: true,
    showEndCap: true,
  });

  addWallStripVisualToCanvas(canvas, state.validWall);
}

export function renderWallGuides(args: {
  canvas: Canvas;
  state: WallPreviewState;
  start: Pt;
}) {
  const { canvas, state, start } = args;

  clearGuides(canvas, state);

  const width = canvas.getWidth();
  const height = canvas.getHeight();
  const big = Math.max(width, height) * 2;

  const guideStyle = {
    stroke: "rgba(34, 139, 34, 0.65)",
    strokeWidth: 1,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
    strokeDashArray: [10, 8] as number[],
  };

  const lines = [
    new FabricLine([start.x - big, start.y, start.x + big, start.y], guideStyle),
    new FabricLine([start.x, start.y - big, start.x, start.y + big], guideStyle),
    new FabricLine(
      [start.x - big, start.y - big, start.x + big, start.y + big],
      guideStyle
    ),
    new FabricLine(
      [start.x - big, start.y + big, start.x + big, start.y - big],
      guideStyle
    ),
  ];

  for (const line of lines) {
    canvas.add(line);
    state.guideLines.push(line);
  }

  state.guideCircle = new FabricCircle({
    left: start.x,
    top: start.y,
    radius: 95,
    originX: "center",
    originY: "center",
    fill: "rgba(34, 139, 34, 0.08)",
    strokeWidth: 0,
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });

  state.guideCenter = new FabricCircle({
    left: start.x,
    top: start.y,
    radius: 4,
    originX: "center",
    originY: "center",
    fill: "transparent",
    stroke: "rgba(34, 139, 34, 0.9)",
    strokeWidth: 1,
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });

  canvas.add(state.guideCircle);
  canvas.add(state.guideCenter);
}

export function renderWallCursor(args: {
  canvas: Canvas;
  state: WallPreviewState;
  point: Pt;
}) {
  const { canvas, state, point } = args;

  clearCursor(canvas, state);

  const { outer, inner } = buildCursorWallPoints(point);

  state.cursorBand = createCursorWallBandPath(outer, inner);
  canvas.add(state.cursorBand);

  state.cursorOuter = new FabricPolygon([], {
    fill: "transparent",
    stroke: "#111827",
    strokeWidth: 1.8,
    strokeLineJoin: "miter",
    selectable: false,
    evented: false,
    objectCaching: true,
    perPixelTargetFind: false,
    strokeUniform: true,
    excludeFromExport: true,
  });
  applyPolygonAbsolutePoints(state.cursorOuter, outer);
  canvas.add(state.cursorOuter);

  state.cursorInner = new FabricPolygon([], {
    fill: "#ffffff",
    stroke: "#111827",
    strokeWidth: 1.8,
    strokeLineJoin: "miter",
    selectable: false,
    evented: false,
    objectCaching: true,
    perPixelTargetFind: false,
    strokeUniform: true,
    excludeFromExport: true,
  });
  applyPolygonAbsolutePoints(state.cursorInner, inner);
  canvas.add(state.cursorInner);

  canvas.bringObjectToFront(state.cursorOuter);
  canvas.bringObjectToFront(state.cursorInner);
}
