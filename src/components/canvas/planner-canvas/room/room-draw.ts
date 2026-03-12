import type { Canvas, Polygon, Path } from "fabric";
import {
  Polygon as FabricPolygon,
  Path as FabricPath,
  Pattern,
  Point,
  util,
} from "fabric";
import type { Pt } from "../core/planner-types";
import { insetPolygon } from "./polygon-geometry";
import {
  createWallStripVisual,
  addWallStripVisualToCanvas,
  removeWallStripVisual,
  type WallStripVisual,
} from "./room-visual";

const CLOSE_DISTANCE = 16;

const CURSOR_WALL_SIZE = 20;
const CURSOR_WALL_THICKNESS = 8;

let cachedCursorWallPatternSource: HTMLCanvasElement | null = null;

function normalizeRoomPoints(points: Pt[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const localPoints = points.map((p) => ({
    x: p.x - minX,
    y: p.y - minY,
  }));

  return {
    left: minX,
    top: minY,
    width,
    height,
    localPoints,
  };
}

function removeClosingPoint(points: Pt[]) {
  if (points.length < 2) return points;

  const first = points[0];
  const last = points[points.length - 1];

  if (first.x === last.x && first.y === last.y) {
    return points.slice(0, -1);
  }

  return points;
}

function applyPolygonAbsolutePoints(
  polygon: Polygon,
  points: Pt[],
  extra?: Partial<Polygon>
) {
  const cleanPoints = removeClosingPoint(points);
  const { left, top, width, height, localPoints } =
    normalizeRoomPoints(cleanPoints);

  polygon.set({
    left,
    top,
    originX: "left",
    originY: "top",
    width,
    height,
    points: localPoints as any,
    pathOffset: new Point(width / 2, height / 2),
    ...extra,
  });

  polygon.setCoords();
}

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

export function createRoomDrawController(args: {
  canvas: Canvas;
  getGridSize: () => number;
  onFinish?: (points: Pt[]) => void;
  onCancel?: () => void;
  onDrawingChange?: (points: Pt[]) => void;
  scheduleRender?: () => void;
}) {
  const {
    canvas,
    getGridSize,
    onFinish,
    onCancel,
    onDrawingChange,
    scheduleRender,
  } = args;

  let active = false;
  let pts: Pt[] = [];

  let previewWalls: WallStripVisual[] = [];

  let cursorOuter: Polygon | null = null;
  let cursorInner: Polygon | null = null;
  let cursorWallBand: Path | null = null;

  let lastMouse: Pt | null = null;
  let isShiftPressed = false;

  const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

  const getPointerPt = (opt: any): Pt | null => {
    const p = opt?.absolutePointer ?? opt?.pointer ?? opt?.scenePoint ?? null;

    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      const g = Math.max(1, getGridSize());
      return { x: snap(p.x, g), y: snap(p.y, g) };
    }

    const vp = opt?.viewportPoint;
    if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y)) {
      const vt = (canvas as any).viewportTransform;
      if (vt && util?.invertTransform && util?.transformPoint) {
        const inv = util.invertTransform(vt);
        const sp = util.transformPoint(vp, inv);
        const g = Math.max(1, getGridSize());
        return { x: snap(sp.x, g), y: snap(sp.y, g) };
      }
    }

    if (typeof (canvas as any).getPointer === "function") {
      const pp = (canvas as any).getPointer(opt?.e);
      if (pp && Number.isFinite(pp.x) && Number.isFinite(pp.y)) {
        const g = Math.max(1, getGridSize());
        return { x: snap(pp.x, g), y: snap(pp.y, g) };
      }
    }

    return null;
  };

  const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

  const applyAxisLock = (next: Pt): Pt => {
    if (!isShiftPressed || pts.length === 0) return next;

    const prev = pts[pts.length - 1];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: next.x, y: prev.y };
    }

    return { x: prev.x, y: next.y };
  };

  const getCloseTarget = (p: Pt): Pt | null => {
    if (pts.length < 3) return null;

    const first = pts[0];
    if (distance(first, p) <= CLOSE_DISTANCE) return first;

    return null;
  };

  const removeAllPreviewArtifacts = () => {
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
  };

  const clearCursorPreview = () => {
    if (cursorWallBand) {
      canvas.remove(cursorWallBand);
      cursorWallBand = null;
    }

    if (cursorOuter) {
      canvas.remove(cursorOuter);
      cursorOuter = null;
    }

    if (cursorInner) {
      canvas.remove(cursorInner);
      cursorInner = null;
    }
  };

  const clearPreview = () => {
    for (const wall of previewWalls) {
      removeWallStripVisual(canvas, wall);
    }
    previewWalls = [];

    clearCursorPreview();
    removeAllPreviewArtifacts();
  };

  const emitDrawingChange = () => {
    onDrawingChange?.([...pts]);
  };

  const renderCursorPreview = (mouse: Pt) => {
    clearCursorPreview();

    const { outer, inner } = buildCursorWallPoints(mouse);

    cursorWallBand = createCursorWallBandPath(outer, inner);
    (cursorWallBand as any).data = {
      kind: "room-preview-cursor-wall-band",
    };
    canvas.add(cursorWallBand);

    cursorOuter = new FabricPolygon([], {
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
    (cursorOuter as any).data = {
      kind: "room-preview-cursor-outer",
    };
    applyPolygonAbsolutePoints(cursorOuter, outer);
    canvas.add(cursorOuter);

    cursorInner = new FabricPolygon([], {
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
    (cursorInner as any).data = {
      kind: "room-preview-cursor-inner",
    };
    applyPolygonAbsolutePoints(cursorInner, inner);
    canvas.add(cursorInner);

    canvas.bringObjectToFront(cursorOuter);
    canvas.bringObjectToFront(cursorInner);
  };

  const renderPreview = (mouse?: Pt) => {
    for (const wall of previewWalls) {
      removeWallStripVisual(canvas, wall);
    }
    previewWalls = [];

    const closeTarget = mouse ? getCloseTarget(mouse) : null;
    const liveMouse = closeTarget ?? mouse ?? null;

    const chainPoints = liveMouse ? [...pts, liveMouse] : [...pts];

    for (let i = 1; i < chainPoints.length; i++) {
      const a = chainPoints[i - 1];
      const b = chainPoints[i];

      const wall = createWallStripVisual(a, b, {
        kind: "room-preview-wall-strip",
        excludeFromExport: true,
      });

      addWallStripVisualToCanvas(canvas, wall);
      previewWalls.push(wall);
    }

    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const finish = (forceClosed = false) => {
    if (pts.length < 3) return;

    const result = [...pts];

    if (forceClosed) {
      const first = result[0];
      const last = result[result.length - 1];

      if (first.x !== last.x || first.y !== last.y) {
        result.push({ ...first });
      }
    }

    clearPreview();
    removeAllPreviewArtifacts();

    pts = [];
    lastMouse = null;
    isShiftPressed = false;

    stop();
    onFinish?.(result);
    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const cancel = () => {
    clearPreview();
    removeAllPreviewArtifacts();

    pts = [];
    lastMouse = null;
    isShiftPressed = false;

    stop();
    onCancel?.();
    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const onMouseMove = (opt: any) => {
    if (!active) return;

    const raw = getPointerPt(opt);
    if (!raw) return;

    const next = applyAxisLock(raw);
    lastMouse = next;

    renderCursorPreview(next);
    renderPreview(next);
  };

  const onMouseDown = (opt: any) => {
    if (!active) return;

    const raw = getPointerPt(opt);
    if (!raw) return;

    const p = applyAxisLock(raw);
    const last = pts[pts.length - 1];

    const closeTarget = getCloseTarget(p);
    if (closeTarget) {
      finish(true);
      return;
    }

    if (last && last.x === p.x && last.y === p.y) return;

    pts.push(p);
    emitDrawingChange();
    renderPreview(lastMouse ?? p);
  };

  const onDblClick = () => {
    if (!active) return;
    finish(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!active) return;

    if (e.key === "Shift") {
      isShiftPressed = true;
      if (lastMouse) {
        const locked = applyAxisLock(lastMouse);
        lastMouse = locked;
        renderCursorPreview(locked);
        renderPreview(locked);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      finish(false);
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      pts.pop();
      emitDrawingChange();
      renderPreview(lastMouse ?? undefined);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!active) return;

    if (e.key === "Shift") {
      isShiftPressed = false;
      if (lastMouse) {
        renderCursorPreview(lastMouse);
        renderPreview(lastMouse);
      }
    }
  };

  const prevSelection = canvas.selection;
  const prevSkipTargetFind = (canvas as any).skipTargetFind;

  let previousInteractiveState = new Map<
    any,
    { selectable: boolean; evented: boolean }
    >();

  const start = () => {
    if (active) return;
    active = true;

    pts = [];
    lastMouse = null;
    isShiftPressed = false;
    previousInteractiveState = new Map();

    canvas.discardActiveObject();

    canvas.selection = false;
    (canvas as any).skipTargetFind = true;

    canvas.forEachObject((o: any) => {
      previousInteractiveState.set(o, {
        selectable: !!o.selectable,
        evented: !!o.evented,
      });

      o.selectable = false;
      o.evented = false;
    });

    canvas.on("mouse:down", onMouseDown);
    canvas.on("mouse:move", onMouseMove);
    canvas.on("mouse:dblclick", onDblClick);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    renderPreview();
  };

  const stop = () => {
    if (!active) return;
    active = false;

    canvas.off("mouse:down", onMouseDown);
    canvas.off("mouse:move", onMouseMove);
    canvas.off("mouse:dblclick", onDblClick);

    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);

    canvas.selection = prevSelection ?? true;
    (canvas as any).skipTargetFind = prevSkipTargetFind ?? false;

    canvas.forEachObject((o: any) => {
      const prev = previousInteractiveState.get(o);
      if (!prev) return;

      o.selectable = prev.selectable;
      o.evented = prev.evented;
    });

    previousInteractiveState.clear();

    clearPreview();
    removeAllPreviewArtifacts();
    lastMouse = null;
    isShiftPressed = false;

    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const isActive = () => active;

  return {
    start,
    stop,
    isActive,
    finish,
    cancel,
  };
}
