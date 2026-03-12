import type { Canvas, Path, Polygon } from "fabric";
import { Polygon as FabricPolygon, Path as FabricPath, Pattern } from "fabric";
import type { Pt } from "../core/planner-types";
import { insetPolygon } from "./polygon-geometry";
import { applyPolygonAbsolutePoints } from "./room-geometry";
import {
  createWallStripVisual,
  addWallStripVisualToCanvas,
  removeWallStripVisual,
} from "./room-visual";
import type { WallStripVisual } from "./room-visual";

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

export type RoomDrawPreview = {
  previewWalls: WallStripVisual[];
  cursorOuter: Polygon | null;
  cursorInner: Polygon | null;
  cursorWallBand: Path | null;
};

export function createRoomDrawPreviewState(): RoomDrawPreview {
  return {
    previewWalls: [],
    cursorOuter: null,
    cursorInner: null,
    cursorWallBand: null,
  };
}

export function removeAllPreviewArtifacts(canvas: Canvas) {
  const objects = canvas.getObjects().slice();

  for (const obj of objects as any[]) {
    const kind = obj?.data?.kind;

    if (
      kind === "room-preview-wall-strip" ||
      kind === "room-preview-cursor-wall-band" ||
      kind === "room-preview-cursor-outer" ||
      kind === "room-preview-cursor-inner"
    ) {
      canvas.remove(obj);
    }
  }
}

export function clearCursorPreview(canvas: Canvas, state: RoomDrawPreview) {
  if (state.cursorWallBand) {
    canvas.remove(state.cursorWallBand);
    state.cursorWallBand = null;
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

export function clearWallPreview(canvas: Canvas, state: RoomDrawPreview) {
  for (const wall of state.previewWalls) {
    removeWallStripVisual(canvas, wall);
  }

  state.previewWalls = [];
}

export function clearAllPreview(canvas: Canvas, state: RoomDrawPreview) {
  clearWallPreview(canvas, state);
  clearCursorPreview(canvas, state);
  removeAllPreviewArtifacts(canvas);
}

export function renderCursorPreview(args: {
  canvas: Canvas;
  state: RoomDrawPreview;
  mouse: Pt;
}) {
  const { canvas, state, mouse } = args;

  clearCursorPreview(canvas, state);

  const { outer, inner } = buildCursorWallPoints(mouse);

  state.cursorWallBand = createCursorWallBandPath(outer, inner);
  (state.cursorWallBand as any).data = {
    kind: "room-preview-cursor-wall-band",
  };
  canvas.add(state.cursorWallBand);

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
  (state.cursorOuter as any).data = {
    kind: "room-preview-cursor-outer",
  };
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
  (state.cursorInner as any).data = {
    kind: "room-preview-cursor-inner",
  };
  applyPolygonAbsolutePoints(state.cursorInner, inner);
  canvas.add(state.cursorInner);

  canvas.bringObjectToFront(state.cursorOuter);
  canvas.bringObjectToFront(state.cursorInner);
}

export function renderWallPreview(args: {
  canvas: Canvas;
  state: RoomDrawPreview;
  points: Pt[];
  mouse?: Pt;
  getCloseTarget: (point: Pt) => Pt | null;
}) {
  const { canvas, state, points, mouse, getCloseTarget } = args;

  clearWallPreview(canvas, state);

  const closeTarget = mouse ? getCloseTarget(mouse) : null;
  const liveMouse = closeTarget ?? mouse ?? null;
  const chainPoints = liveMouse ? [...points, liveMouse] : [...points];

  for (let i = 1; i < chainPoints.length; i++) {
    const a = chainPoints[i - 1];
    const b = chainPoints[i];

    const wall = createWallStripVisual(a, b, {
      kind: "room-preview-wall-strip",
      excludeFromExport: true,
    });

    addWallStripVisualToCanvas(canvas, wall);
    state.previewWalls.push(wall);
  }
}
