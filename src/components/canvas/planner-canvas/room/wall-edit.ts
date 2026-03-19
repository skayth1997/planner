import type { Canvas } from "fabric";
import type { Pt } from "../core/planner-types";
import type { WallItem } from "./wall-manager";
import {
  analyzeWallCandidate,
  getWallsConnectedToNode,
  isLongEnough,
  snapPointToWallEndpoint,
} from "./wall-geometry";
import type { LinearWallLike } from "./wall-geometry";

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

function distance(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type DragRole = "start" | "middle" | "end";

export function createWallEditController(args: {
  canvas: Canvas;
  getSelectedWall: () => WallItem | null;
  getLinearWalls: () => LinearWallLike[];
  moveConnectedNode: (args: {
    rootId: string;
    nodeRole: "start" | "end";
    dx: number;
    dy: number;
  }) => void;
  offsetWallWithConnectedEnds: (args: {
    rootId: string;
    dx: number;
    dy: number;
  }) => void;
  rerenderHandles: () => void;
  scheduleRender?: () => void;
}) {
  const {
    canvas,
    getSelectedWall,
    getLinearWalls,
    moveConnectedNode,
    offsetWallWithConnectedEnds,
    rerenderHandles,
    scheduleRender,
  } = args;

  let dragRole: DragRole | null = null;
  let dragStartPointer: Pt | null = null;
  let dragInitialWall: {
    id: string;
    a: Pt;
    b: Pt;
  } | null = null;

  let prevSelection = false;
  let prevSkipTargetFind = false;
  let prevSelectionColor = "";
  let prevSelectionBorderColor = "";
  let prevSelectionLineWidth = 1;

  const HANDLE_HIT_RADIUS = 16;

  const renderNow = () => {
    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const getHandleRoleAtPoint = (point: Pt): DragRole | null => {
    const wall = getSelectedWall();
    if (!wall || wall.kind !== "segment") return null;

    const middle: Pt = {
      x: (wall.a.x + wall.b.x) / 2,
      y: (wall.a.y + wall.b.y) / 2,
    };

    if (distance(point, wall.a) <= HANDLE_HIT_RADIUS) return "start";
    if (distance(point, middle) <= HANDLE_HIT_RADIUS) return "middle";
    if (distance(point, wall.b) <= HANDLE_HIT_RADIUS) return "end";

    return null;
  };

  const beginFabricDragGuard = () => {
    prevSelection = !!canvas.selection;
    prevSkipTargetFind = !!(canvas as any).skipTargetFind;
    prevSelectionColor = (canvas as any).selectionColor ?? "";
    prevSelectionBorderColor = (canvas as any).selectionBorderColor ?? "";
    prevSelectionLineWidth = (canvas as any).selectionLineWidth ?? 1;

    canvas.selection = false;
    (canvas as any).skipTargetFind = true;
    (canvas as any).selectionColor = "transparent";
    (canvas as any).selectionBorderColor = "transparent";
    (canvas as any).selectionLineWidth = 0;

    canvas.discardActiveObject();
  };

  const endFabricDragGuard = () => {
    canvas.selection = prevSelection;
    (canvas as any).skipTargetFind = prevSkipTargetFind;
    (canvas as any).selectionColor = prevSelectionColor;
    (canvas as any).selectionBorderColor = prevSelectionBorderColor;
    (canvas as any).selectionLineWidth = prevSelectionLineWidth;

    canvas.discardActiveObject();
  };

  const onMouseDown = (opt: any) => {
    const point = getPointerPoint(canvas, opt);
    if (!point) return;

    const role = getHandleRoleAtPoint(point);
    if (!role) return;

    opt?.e?.preventDefault?.();
    opt?.e?.stopPropagation?.();

    const wall = getSelectedWall();
    if (!wall || wall.kind !== "segment") return;

    dragRole = role;
    dragStartPointer = point;
    dragInitialWall = {
      id: wall.id,
      a: { ...wall.a },
      b: { ...wall.b },
    };

    beginFabricDragGuard();
    renderNow();
  };

  const onMouseMove = (opt: any) => {
    if (!dragRole || !dragStartPointer || !dragInitialWall) return;

    opt?.e?.preventDefault?.();
    opt?.e?.stopPropagation?.();

    const point = getPointerPoint(canvas, opt);
    if (!point) return;

    const walls = getLinearWalls();

    if (dragRole === "start" || dragRole === "end") {
      const node = dragRole === "start" ? dragInitialWall.a : dragInitialWall.b;

      const connectedNodeWalls = getWallsConnectedToNode({
        node,
        walls,
      });

      const ignoreWallIds = connectedNodeWalls.map((wall) => wall.id);

      const snappedPoint = snapPointToWallEndpoint({
        point,
        walls,
        ignoreWallIds,
      });

      const fixedPoint =
        dragRole === "start" ? dragInitialWall.b : dragInitialWall.a;

      const analysis = analyzeWallCandidate({
        start: fixedPoint,
        end: snappedPoint,
        walls,
        ignoreWallIds,
      });

      if (analysis.validEnd && isLongEnough(fixedPoint, analysis.validEnd)) {
        const dx = analysis.validEnd.x - node.x;
        const dy = analysis.validEnd.y - node.y;

        moveConnectedNode({
          rootId: dragInitialWall.id,
          nodeRole: dragRole,
          dx,
          dy,
        });

        const wall = getSelectedWall();
        if (wall && wall.kind === "segment") {
          dragInitialWall = {
            id: wall.id,
            a: { ...wall.a },
            b: { ...wall.b },
          };
        }

        rerenderHandles();
        renderNow();
      }

      return;
    }

    if (dragRole === "middle") {
      const dx = point.x - dragStartPointer.x;
      const dy = point.y - dragStartPointer.y;

      offsetWallWithConnectedEnds({
        rootId: dragInitialWall.id,
        dx,
        dy,
      });

      const wall = getSelectedWall();
      if (wall && wall.kind === "segment") {
        dragInitialWall = {
          id: wall.id,
          a: { ...wall.a },
          b: { ...wall.b },
        };
        dragStartPointer = point;
      }

      rerenderHandles();
      renderNow();
    }
  };

  const stopDragging = () => {
    dragRole = null;
    dragStartPointer = null;
    dragInitialWall = null;

    endFabricDragGuard();
    renderNow();
  };

  const onMouseUp = (opt: any) => {
    if (!dragRole) return;

    opt?.e?.preventDefault?.();
    opt?.e?.stopPropagation?.();
    stopDragging();
  };

  const start = () => {
    canvas.on("mouse:down", onMouseDown);
    canvas.on("mouse:move", onMouseMove);
    canvas.on("mouse:up", onMouseUp);
  };

  const stop = () => {
    canvas.off("mouse:down", onMouseDown);
    canvas.off("mouse:move", onMouseMove);
    canvas.off("mouse:up", onMouseUp);

    if (dragRole) {
      stopDragging();
    }
  };

  return {
    start,
    stop,
    isDragging: () => !!dragRole,
  };
}
