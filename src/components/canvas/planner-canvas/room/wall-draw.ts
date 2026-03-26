import type { Canvas } from "fabric";
import type { Pt } from "../core/planner-types";
import {
  analyzeWallCandidateWithTerminalTarget,
  distanceBetween,
  findFirstWallCrossing,
  findNearestWallConnectionTarget,
  isLongEnough,
  MIN_WALL_LENGTH,
  snapPointToWallEndpoint,
} from "./wall-geometry";
import type { WallConnectionTarget, WallCrossingTarget } from "./wall-geometry";
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

  const getSnappedEndPoint = (end: Pt, ignoreWallIds?: string[]) => {
    return snapPointToWallEndpoint({
      point: end,
      walls: getLinearWalls(),
      ignoreWallIds,
    });
  };

  const pickTerminalTarget = (
    start: Pt,
    rawEnd: Pt
  ): WallConnectionTarget | WallCrossingTarget | null => {
    const endpointSnap = getSnappedEndPoint(rawEnd);

    const endpointTarget = findNearestWallConnectionTarget({
      point: endpointSnap,
      walls: getLinearWalls(),
    });

    if (endpointTarget) {
      return endpointTarget;
    }

    const firstCrossing = findFirstWallCrossing({
      start,
      end: rawEnd,
      walls: getLinearWalls(),
    });

    if (!firstCrossing) return null;

    const overshootDistance = distanceBetween(firstCrossing.point, rawEnd);

    if (overshootDistance >= 10) {
      return firstCrossing;
    }

    return null;
  };

  const renderDrag = (start: Pt, rawEnd: Pt) => {
    const thickness = getDefaultThickness();
    const terminalTarget = pickTerminalTarget(start, rawEnd);

    const analysis = analyzeWallCandidateWithTerminalTarget({
      start,
      rawEnd,
      walls: getLinearWalls(),
      terminalTarget,
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
      thickness,
    });

    renderNow();
    return { analysis, terminalTarget };
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
    const terminalTarget = pickTerminalTarget(startPoint, point);

    const analysis = analyzeWallCandidateWithTerminalTarget({
      start: startPoint,
      rawEnd: point,
      walls: getLinearWalls(),
      terminalTarget,
    });

    let finalEnd = analysis.validEnd ?? point;

    if (terminalTarget && analysis.targetWallId && splitSegmentWallAtPoint) {
      const splitPoint = splitSegmentWallAtPoint({
        id: terminalTarget.wall.id,
        point: terminalTarget.point,
      });

      if (splitPoint) {
        finalEnd = splitPoint;
      } else {
        finalEnd = terminalTarget.point;
      }
    }

    return finalEnd;
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
      thickness: getDefaultThickness(),
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
      thickness: getDefaultThickness(),
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
      thickness: getDefaultThickness(),
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
      thickness,
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
          thickness: getDefaultThickness(),
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
