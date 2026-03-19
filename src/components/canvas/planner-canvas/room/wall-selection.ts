import type { Canvas } from "fabric";
import type { Pt, SelectedInfo } from "../core/planner-types";
import type { WallItem } from "./wall-manager";
import {
  createWallHandleVisuals,
  removeWallHandleVisuals,
} from "./wall-handles";
import type { WallHandleVisuals } from "./wall-handles";
import {
  createWallAngleVisual,
  removeWallAngleVisual,
} from "./wall-angle-visual";
import type { WallAngleVisual } from "./wall-angle-visual";
import { sameNode } from "./wall-geometry";

export function createWallSelectionController(args: {
  canvas: Canvas;
  getWalls: () => WallItem[];
  isSelectionEnabled?: () => boolean;
  onSelectionChange?: (info: SelectedInfo | null) => void;
  scheduleRender?: () => void;
}) {
  const {
    canvas,
    getWalls,
    isSelectionEnabled,
    onSelectionChange,
    scheduleRender,
  } = args;

  let selectedWallId: string | null = null;
  let handleVisuals: WallHandleVisuals | null = null;
  let angleVisuals: WallAngleVisual[] = [];

  const renderNow = () => {
    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const selectionEnabled = () => {
    return isSelectionEnabled ? !!isSelectionEnabled() : true;
  };

  const getSelectedWall = () => {
    if (!selectedWallId) return null;
    return getWalls().find((wall) => wall.id === selectedWallId) ?? null;
  };

  const clearHandles = () => {
    removeWallHandleVisuals(canvas, handleVisuals);
    handleVisuals = null;
  };

  const clearAngleVisuals = () => {
    for (const visual of angleVisuals) {
      removeWallAngleVisual(canvas, visual);
    }
    angleVisuals = [];
  };

  const clearSelectionVisuals = () => {
    clearHandles();
    clearAngleVisuals();
  };

  const emitSelection = () => {
    const wall = getSelectedWall();

    if (!wall) {
      onSelectionChange?.(null);
      return;
    }

    if (wall.kind === "segment") {
      const dx = wall.b.x - wall.a.x;
      const dy = wall.b.y - wall.a.y;
      const length = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

      onSelectionChange?.({
        id: wall.id,
        kind: "wall",
        type: "wall",
        left: Math.min(wall.a.x, wall.b.x),
        top: Math.min(wall.a.y, wall.b.y),
        width: Math.round(length),
        height: Math.round(wall.thickness),
        angle,
      });

      return;
    }

    onSelectionChange?.({
      id: wall.id,
      kind: "wall",
      type: "wall",
      left: wall.center.x - wall.size / 2,
      top: wall.center.y - wall.size / 2,
      width: Math.round(wall.size),
      height: Math.round(wall.size),
      angle: 0,
    });
  };

  const getNeighborVectorAtNode = (
    selectedWall: Extract<WallItem, { kind: "segment" }>,
    node: Pt
  ) => {
    const walls = getWalls();

    const connectedSegmentWalls = walls.filter((wall): wall is Extract<
      WallItem,
      { kind: "segment" }
    > => {
      if (wall.kind !== "segment") return false;
      if (wall.id === selectedWall.id) return false;

      return sameNode(wall.a, node) || sameNode(wall.b, node);
    });

    if (connectedSegmentWalls.length !== 1) {
      return null;
    }

    const neighbor = connectedSegmentWalls[0];
    const neighborOther = sameNode(neighbor.a, node) ? neighbor.b : neighbor.a;

    return {
      x: neighborOther.x - node.x,
      y: neighborOther.y - node.y,
    };
  };

  const createAngleVisualsForSelectedWall = () => {
    clearAngleVisuals();

    const wall = getSelectedWall();
    if (!wall) return;
    if (wall.kind !== "segment") return;
    if (!selectionEnabled()) return;

    const startNeighborVec = getNeighborVectorAtNode(wall, wall.a);
    if (startNeighborVec) {
      const selectedVecFromStart = {
        x: wall.b.x - wall.a.x,
        y: wall.b.y - wall.a.y,
      };

      const visual = createWallAngleVisual({
        canvas,
        node: wall.a,
        selectedVec: selectedVecFromStart,
        neighborVec: startNeighborVec,
      });

      if (visual) angleVisuals.push(visual);
    }

    const endNeighborVec = getNeighborVectorAtNode(wall, wall.b);
    if (endNeighborVec) {
      const selectedVecFromEnd = {
        x: wall.a.x - wall.b.x,
        y: wall.a.y - wall.b.y,
      };

      const visual = createWallAngleVisual({
        canvas,
        node: wall.b,
        selectedVec: selectedVecFromEnd,
        neighborVec: endNeighborVec,
      });

      if (visual) angleVisuals.push(visual);
    }
  };

  const rerenderSelectionVisuals = () => {
    clearSelectionVisuals();

    const wall = getSelectedWall();
    if (!wall) {
      emitSelection();
      renderNow();
      return;
    }

    if (!selectionEnabled()) {
      emitSelection();
      renderNow();
      return;
    }

    if (wall.kind === "segment") {
      handleVisuals = createWallHandleVisuals({
        canvas,
        a: wall.a,
        b: wall.b,
      });
    }

    createAngleVisualsForSelectedWall();
    emitSelection();
    renderNow();
  };

  const clearSelection = () => {
    selectedWallId = null;
    clearSelectionVisuals();
    emitSelection();
    renderNow();
  };

  const selectWallById = (wallId: string) => {
    if (!selectionEnabled()) return;

    selectedWallId = wallId;
    rerenderSelectionVisuals();
  };

  const onMouseDown = (opt: any) => {
    if (!selectionEnabled()) return;

    const target = opt?.target as any;
    const kind = target?.data?.kind;
    const id = target?.data?.id;

    if (kind === "wall-segment" || kind === "wall-block") {
      if (id) {
        selectWallById(id);
        return;
      }
    }

    if (kind === "wall-handle") {
      return;
    }

    clearSelection();
  };

  const start = () => {
    canvas.on("mouse:down", onMouseDown);
  };

  const stop = () => {
    canvas.off("mouse:down", onMouseDown);
    clearSelection();
  };

  return {
    start,
    stop,
    clearSelection,
    selectWallById,
    getSelectedWall,
    getSelectedWallId: () => selectedWallId,
    rerenderSelectionVisuals,
  };
}
