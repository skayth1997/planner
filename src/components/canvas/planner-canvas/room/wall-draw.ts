import type { Canvas } from "fabric";
import type { Pt } from "../core/planner-types";
import {
  analyzeWallCandidate,
  distanceBetween,
  isLongEnough,
  MIN_WALL_LENGTH,
  snapPointToWallEndpoint,
} from "./wall-geometry";
import {
  clearAllWallPreview,
  createWallPreviewState,
  renderDraggedWallPreview,
  renderWallCursor,
  renderWallGuides,
} from "./wall-preview";

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
  getLinearWalls: () => Array<{ id: string; a: Pt; b: Pt; thickness: number }>;
  getDefaultThickness: () => number;
  onCommitSegmentWall?: (a: Pt, b: Pt, thickness: number) => void;
  onCommitBlockWall?: (center: Pt, size: number, thickness: number) => void;
  scheduleRender?: () => void;
}) {
  const {
    canvas,
    getLinearWalls,
    getDefaultThickness,
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

  const getSnappedEndPoint = (end: Pt) => {
    return snapPointToWallEndpoint({
      point: end,
      walls: getLinearWalls(),
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

  const commitCurrentWall = (rawEnd: Pt) => {
    if (!dragStart) return;

    const thickness = getDefaultThickness();
    const snappedEnd = getSnappedEndPoint(rawEnd);

    const analysis = analyzeWallCandidate({
      start: dragStart,
      end: snappedEnd,
      walls: getLinearWalls(),
    });

    if (
      analysis.validEnd &&
      distanceBetween(dragStart, analysis.validEnd) >= MIN_WALL_LENGTH &&
      isLongEnough(dragStart, analysis.validEnd)
    ) {
      onCommitSegmentWall?.(dragStart, analysis.validEnd, thickness);
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

    if (
      targetKind === "wall-segment" ||
      targetKind === "wall-block" ||
      targetKind === "wall-handle"
    ) {
      return;
    }

    const point = getPointerPoint(canvas, opt);
    if (!point) return;

    isPointerDown = true;
    dragStart = point;
    currentMouse = point;

    renderWallGuides({
      canvas,
      state: preview,
      start: point,
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

    commitCurrentWall(point);

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
