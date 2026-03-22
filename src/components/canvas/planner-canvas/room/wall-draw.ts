import type { Canvas } from "fabric";
import type { Pt } from "../core/planner-types";
import {
  analyzeWallCandidate,
  distanceBetween,
  isLongEnough,
  MIN_WALL_LENGTH,
  projectPointToSegment,
  snapPointToWallEndpoint,
} from "./wall-geometry";
import {
  clearAllWallPreview,
  createWallPreviewState,
  renderDraggedWallPreview,
  renderWallCursor,
  renderWallGuides,
} from "./wall-preview";

type LinearWallRef = {
  id: string;
  a: Pt;
  b: Pt;
  thickness: number;
};

function getPointerPoint(canvas: Canvas, opt: any): Pt | null {
  const p = opt?.absolutePointer ?? opt?.pointer ?? opt?.scenePoint ?? null;

  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    return { x: p.x, y: p.y };
  }

  if (typeof (canvas as any).getPointer === "function") {
    const pp = (canvas as any).getPointer(opt?.e);
    if (pp && Number.isFinite(pp.x) && Number.isFinite(pp.y)) {
      return { x: pp.x, y: pp.y };
    }
  }

  return null;
}

export function createWallDrawController(args: {
  canvas: Canvas;
  getLinearWalls: () => LinearWallRef[];
  getDefaultThickness: () => number;
  splitSegmentWallAtPoint?: (args: { id: string; point: Pt }) => Pt | null;
  onCommitSegmentWall?: (a: Pt, b: Pt, thickness: number) => void;
  onCommitBlockWall?: (center: Pt, size: number, thickness: number) => void;
  scheduleRender?: () => void;
}) {
  const {
    canvas,
    getLinearWalls,
    getDefaultThickness,
    splitSegmentWallAtPoint,
    onCommitSegmentWall,
    onCommitBlockWall,
    scheduleRender,
  } = args;

  let toolActive = false;
  let isPointerDown = false;
  let dragStart: Pt | null = null;
  let currentMouse: Pt | null = null;

  const preview = createWallPreviewState();

  const renderNow = () => {
    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const findWallAtPoint = (
    point: Pt,
    options?: {
      ignoreWallIds?: string[];
      tolerance?: number;
    }
  ) => {
    const ignoreWallIds = new Set(options?.ignoreWallIds ?? []);
    const tolerance = options?.tolerance ?? 12;

    let best: { wall: LinearWallRef; distance: number } | null = null;

    for (const wall of getLinearWalls()) {
      if (ignoreWallIds.has(wall.id)) continue;

      const projection = projectPointToSegment(point, wall.a, wall.b);
      if (projection.distance > tolerance) continue;

      if (!best || projection.distance < best.distance) {
        best = {
          wall,
          distance: projection.distance,
        };
      }
    }

    return best?.wall ?? null;
  };

  const getSnappedEndPoint = (end: Pt, ignoreWallIds?: string[]) => {
    return snapPointToWallEndpoint({
      point: end,
      walls: getLinearWalls(),
      ignoreWallIds,
    });
  };

  const renderDrag = (start: Pt, rawEnd: Pt) => {
    const thickness = getDefaultThickness();
    const snappedEnd = getSnappedEndPoint(rawEnd);

    const analysis = analyzeWallCandidate({
      start,
      end: snappedEnd,
      walls: getLinearWalls(),
    });

    renderWallGuides({
      canvas,
      state: preview,
      start,
    });

    renderDraggedWallPreview({
      canvas,
      state: preview,
      start,
      validEnd: analysis.validEnd,
      thickness,
    });

    renderWallCursor({
      canvas,
      state: preview,
      point: rawEnd,
    });

    renderNow();
    return analysis;
  };

  const resolveStartPoint = (point: Pt, target: any): Pt | null => {
    const targetKind = target?.data?.kind;
    const targetId = target?.data?.id;

    if (targetKind === "wall-block") {
      return null;
    }

    if (targetKind === "wall-segment" && targetId && splitSegmentWallAtPoint) {
      return splitSegmentWallAtPoint({
        id: targetId,
        point,
      });
    }

    return point;
  };

  const resolveEndPoint = (point: Pt, startPoint: Pt): Pt => {
    const touchedWall = findWallAtPoint(point, {
      tolerance: 12,
    });

    if (!touchedWall || !splitSegmentWallAtPoint) {
      const snappedEnd = getSnappedEndPoint(point);

      const analysis = analyzeWallCandidate({
        start: startPoint,
        end: snappedEnd,
        walls: getLinearWalls(),
      });

      return analysis.validEnd ?? snappedEnd;
    }

    const splitPoint = splitSegmentWallAtPoint({
      id: touchedWall.id,
      point,
    });

    const candidateEnd = splitPoint ?? point;
    const snappedEnd = getSnappedEndPoint(candidateEnd, [touchedWall.id]);

    const analysis = analyzeWallCandidate({
      start: startPoint,
      end: snappedEnd,
      walls: getLinearWalls(),
      ignoreWallId: touchedWall.id,
    });

    return analysis.validEnd ?? snappedEnd;
  };

  const commitCurrentWall = (resolvedEnd: Pt) => {
    if (!dragStart) return;

    const thickness = getDefaultThickness();

    if (
      distanceBetween(dragStart, resolvedEnd) >= MIN_WALL_LENGTH &&
      isLongEnough(dragStart, resolvedEnd)
    ) {
      onCommitSegmentWall?.(dragStart, resolvedEnd, thickness);
    }
  };

  const onMouseMove = (opt: any) => {
    if (!toolActive) return;

    const point = getPointerPoint(canvas, opt);
    if (!point) return;

    currentMouse = point;

    if (isPointerDown && dragStart) {
      renderDrag(dragStart, point);
      return;
    }

    renderWallCursor({
      canvas,
      state: preview,
      point,
    });

    renderNow();
  };

  const onMouseDown = (opt: any) => {
    if (!toolActive) return;

    const target = opt?.target as any;
    const targetKind = target?.data?.kind;

    if (targetKind === "wall-handle") {
      return;
    }

    const point = getPointerPoint(canvas, opt);
    if (!point) return;

    const startPoint = resolveStartPoint(point, target);
    if (!startPoint) return;

    isPointerDown = true;
    dragStart = startPoint;
    currentMouse = point;

    renderWallGuides({
      canvas,
      state: preview,
      start: startPoint,
    });

    renderWallCursor({
      canvas,
      state: preview,
      point,
    });

    renderNow();
  };

  const onMouseUp = (opt: any) => {
    if (!toolActive || !isPointerDown || !dragStart) return;

    const point = getPointerPoint(canvas, opt) ?? currentMouse ?? dragStart;
    const resolvedEnd = resolveEndPoint(point, dragStart);

    commitCurrentWall(resolvedEnd);

    isPointerDown = false;
    dragStart = null;
    currentMouse = point;

    clearAllWallPreview(canvas, preview);

    renderWallCursor({
      canvas,
      state: preview,
      point,
    });

    renderNow();
  };

  const onMouseDblClick = (opt: any) => {
    if (!toolActive) return;

    const target = opt?.target as any;
    const targetKind = target?.data?.kind;

    if (
      targetKind === "wall-segment" ||
      targetKind === "wall-block" ||
      targetKind === "wall-handle"
    ) {
      return;
    }

    const point = getPointerPoint(canvas, opt);
    if (!point) return;

    const thickness = getDefaultThickness();
    onCommitBlockWall?.(point, thickness, thickness);

    clearAllWallPreview(canvas, preview);

    renderWallCursor({
      canvas,
      state: preview,
      point,
    });

    renderNow();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!toolActive) return;

    if (e.key === "Escape") {
      e.preventDefault();

      isPointerDown = false;
      dragStart = null;
      clearAllWallPreview(canvas, preview);

      if (currentMouse) {
        renderWallCursor({
          canvas,
          state: preview,
          point: currentMouse,
        });
      }

      renderNow();
    }
  };

  const start = () => {
    if (toolActive) return;

    toolActive = true;
    isPointerDown = false;
    dragStart = null;
    currentMouse = null;

    canvas.on("mouse:move", onMouseMove);
    canvas.on("mouse:down", onMouseDown);
    canvas.on("mouse:up", onMouseUp);
    canvas.on("mouse:dblclick", onMouseDblClick);

    window.addEventListener("keydown", onKeyDown);

    renderNow();
  };

  const stop = () => {
    if (!toolActive) return;

    toolActive = false;
    isPointerDown = false;
    dragStart = null;

    canvas.off("mouse:move", onMouseMove);
    canvas.off("mouse:down", onMouseDown);
    canvas.off("mouse:up", onMouseUp);
    canvas.off("mouse:dblclick", onMouseDblClick);

    window.removeEventListener("keydown", onKeyDown);

    clearAllWallPreview(canvas, preview);
    currentMouse = null;

    renderNow();
  };

  const isActive = () => toolActive;

  return {
    start,
    stop,
    isActive,
  };
}
