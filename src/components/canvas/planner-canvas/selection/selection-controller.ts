// src/components/canvas/planner-canvas/selection/selection-controller.ts
import type { Canvas } from "fabric";
import type { SelectedInfo } from "../core/planner-types";
import { getSelectedInfo, isFurniture, isOpening } from "../core/utils";
import {
  ACTIVE_STROKE,
  ACTIVE_STROKE_WIDTH,
  HOVER_STROKE,
  HOVER_STROKE_WIDTH,
} from "../core/planner-constants";

type Args = {
  canvas: Canvas;
  onSelectionChange?: (info: SelectedInfo | null) => void;
  scheduleRender: () => void;
  clearGuides?: () => void;
};

function isSelectableItem(obj: any) {
  return isFurniture(obj) || isOpening(obj);
}

function getSelectedCanvasObjects(canvas: Canvas): any[] {
  const active: any = canvas.getActiveObject();
  if (!active) return [];

  const objs: any[] = Array.isArray(active?._objects)
    ? active._objects
    : [active];
  return objs.filter((o) => isSelectableItem(o));
}

// Style helpers
function getBaseStyle(o: any) {
  // furniture keeps its baseStroke/baseStrokeWidth
  if (isFurniture(o)) {
    return {
      stroke: o.data?.baseStroke ?? o.stroke ?? "#10b981",
      strokeWidth: o.data?.baseStrokeWidth ?? o.strokeWidth ?? 2,
    };
  }

  // openings: default based on type
  const t = o.data?.type;
  if (t === "window")
    return { stroke: o.stroke ?? "#3b82f6", strokeWidth: o.strokeWidth ?? 2 };
  return { stroke: o.stroke ?? "#f59e0b", strokeWidth: o.strokeWidth ?? 2 }; // door default
}

export function createSelectionController(args: Args) {
  const { canvas, onSelectionChange, scheduleRender, clearGuides } = args;

  const emitSelection = () => {
    const selected = getSelectedCanvasObjects(canvas);
    if (selected.length === 0) {
      onSelectionChange?.(null);
      return;
    }
    onSelectionChange?.(getSelectedInfo(selected[0]));
  };

  const restyleAllItems = () => {
    const active = canvas.getActiveObject() as any;

    canvas.getObjects().forEach((o: any) => {
      if (!isSelectableItem(o)) return;

      const base = getBaseStyle(o);

      // Note: active can be ActiveSelection. In that case, we don't try to mark each object as active.
      if (active && o === active) {
        o.set({ stroke: ACTIVE_STROKE, strokeWidth: ACTIVE_STROKE_WIDTH });
      } else {
        o.set({ stroke: base.stroke, strokeWidth: base.strokeWidth });
      }

      o.setCoords();
    });

    scheduleRender();
  };

  // ===== selection events =====
  const onSelectionCreated = () => {
    emitSelection();
    restyleAllItems();
    clearGuides?.();
    scheduleRender();
  };

  const onSelectionUpdated = () => {
    emitSelection();
    restyleAllItems();
    clearGuides?.();
    scheduleRender();
  };

  const onSelectionCleared = () => {
    onSelectionChange?.(null);
    restyleAllItems();
    clearGuides?.();
    scheduleRender();
  };

  // ===== hover events =====
  const onMouseOver = (opt: any) => {
    const t = opt.target as any;
    if (!t || !isSelectableItem(t)) return;

    const active = canvas.getActiveObject() as any;
    if (active && (active === t || Array.isArray(active?._objects))) return;

    t.set({ stroke: HOVER_STROKE, strokeWidth: HOVER_STROKE_WIDTH });
    t.setCoords();
    scheduleRender();
  };

  const onMouseOut = (opt: any) => {
    const t = opt.target as any;
    if (!t || !isSelectableItem(t)) return;

    const active = canvas.getActiveObject() as any;
    if (active && (active === t || Array.isArray(active?._objects))) return;

    const base = getBaseStyle(t);
    t.set({ stroke: base.stroke, strokeWidth: base.strokeWidth });
    t.setCoords();
    scheduleRender();
  };

  const attach = () => {
    canvas.on("selection:created", onSelectionCreated);
    canvas.on("selection:updated", onSelectionUpdated);
    canvas.on("selection:cleared", onSelectionCleared);

    canvas.on("mouse:over", onMouseOver);
    canvas.on("mouse:out", onMouseOut);
  };

  const detach = () => {
    canvas.off("selection:created", onSelectionCreated);
    canvas.off("selection:updated", onSelectionUpdated);
    canvas.off("selection:cleared", onSelectionCleared);

    canvas.off("mouse:over", onMouseOver);
    canvas.off("mouse:out", onMouseOut);
  };

  return {
    attach,
    detach,
    emitSelection,
    restyleAllFurniture: restyleAllItems, // keep old name so planner-canvas.tsx doesn’t change
    getSelectedFurnitureObjects: () => getSelectedCanvasObjects(canvas), // keep old name too
  };
}
