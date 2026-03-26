import type { Canvas, Circle, Line } from "fabric";
import {
  Circle as FabricCircle,
  Line as FabricLine,
} from "fabric";
import type { Pt } from "../core/planner-types";
import {
  addWallStripVisualToCanvas,
  createWallStripVisual,
  removeWallStripVisual,
  type WallStripVisual,
} from "./room-visual";

let cachedCursorWallPatternSource: HTMLCanvasElement | null = null;

export type WallPreviewState = {
  validWall: WallStripVisual | null;
  guideLines: Line[];
  guideCircle: Circle | null;
  guideCenter: Circle | null;
  cursorWall: WallStripVisual | null;
};

export function createWallPreviewState(): WallPreviewState {
  return {
    validWall: null,
    guideLines: [],
    guideCircle: null,
    guideCenter: null,
    cursorWall: null,
  };
}

function getCursorWallLength(thickness: number) {
  return Math.max(thickness, 10);
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
  if (state.cursorWall) {
    removeWallStripVisual(canvas, state.cursorWall);
    state.cursorWall = null;
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
    new FabricLine(
      [start.x - big, start.y, start.x + big, start.y],
      guideStyle
    ),
    new FabricLine(
      [start.x, start.y - big, start.x, start.y + big],
      guideStyle
    ),
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
  thickness: number;
}) {
  const { canvas, state, point, thickness } = args;

  clearCursor(canvas, state);

  const length = getCursorWallLength(thickness);
  const half = length / 2;

  const a: Pt = {
    x: point.x - half,
    y: point.y,
  };

  const b: Pt = {
    x: point.x + half,
    y: point.y,
  };

  state.cursorWall = createWallStripVisual(a, b, thickness, {
    kind: "wall-preview-cursor",
    excludeFromExport: true,
    selectable: false,
    evented: false,
    showStartCap: true,
    showEndCap: true,
  });

  addWallStripVisualToCanvas(canvas, state.cursorWall);
}
