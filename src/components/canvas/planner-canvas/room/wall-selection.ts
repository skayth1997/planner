import type { Canvas } from "fabric";
import type { SelectedInfo } from "../core/planner-types";
import type { WallItem } from "./wall-manager";
import {
  createWallHandleVisuals,
  removeWallHandleVisuals,
} from "./wall-handles";
import type { WallHandleVisuals } from "./wall-handles";

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

  const showHandlesForSelectedWall = () => {
    clearHandles();

    const wall = getSelectedWall();
    if (!wall) return;
    if (wall.kind !== "segment") return;
    if (!selectionEnabled()) return;

    handleVisuals = createWallHandleVisuals({
      canvas,
      a: wall.a,
      b: wall.b,
    });

    renderNow();
  };

  const clearSelection = () => {
    selectedWallId = null;
    clearHandles();
    emitSelection();
    renderNow();
  };

  const selectWallById = (wallId: string) => {
    if (!selectionEnabled()) return;

    selectedWallId = wallId;
    showHandlesForSelectedWall();
    emitSelection();
    renderNow();
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
    rerenderHandles: showHandlesForSelectedWall,
  };
}
