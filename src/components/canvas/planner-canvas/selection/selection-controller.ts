import type { Canvas } from "fabric";
import type { SelectedInfo } from "../core/planner-types";
import { isFurniture, getSelectedInfo } from "../core/utils";
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

function getSelectedFurnitureObjects(canvas: Canvas): any[] {
  const active: any = canvas.getActiveObject();
  if (!active) return [];

  const objs: any[] = Array.isArray(active?._objects) ? active._objects : [active];
  return objs.filter((o) => isFurniture(o));
}

export function createSelectionController(args: Args) {
  const { canvas, onSelectionChange, scheduleRender, clearGuides } = args;

  const emitSelection = () => {
    const selected = getSelectedFurnitureObjects(canvas);

    if (selected.length === 0) {
      onSelectionChange?.(null);
      return;
    }

    onSelectionChange?.(getSelectedInfo(selected[0]));
  };

  const restyleAllFurniture = () => {
    const active = canvas.getActiveObject() as any;

    canvas.getObjects().forEach((o: any) => {
      if (!isFurniture(o)) return;

      const baseStroke = o.data?.baseStroke ?? "#10b981";
      const baseStrokeWidth = o.data?.baseStrokeWidth ?? 2;

      // If ActiveSelection, do not try to “single-active” highlight
      if (active && o === active) {
        o.set({ stroke: ACTIVE_STROKE, strokeWidth: ACTIVE_STROKE_WIDTH });
      } else {
        o.set({ stroke: baseStroke, strokeWidth: baseStrokeWidth });
      }

      o.setCoords();
    });

    scheduleRender();
  };

  // ===== selection events =====
  const onSelectionCreated = () => {
    emitSelection();
    restyleAllFurniture();
    clearGuides?.();
    scheduleRender();
  };

  const onSelectionUpdated = () => {
    emitSelection();
    restyleAllFurniture();
    clearGuides?.();
    scheduleRender();
  };

  const onSelectionCleared = () => {
    onSelectionChange?.(null);
    restyleAllFurniture();
    clearGuides?.();
    scheduleRender();
  };

  // ===== hover events =====
  const onMouseOver = (opt: any) => {
    const t = opt.target as any;
    if (!t || !isFurniture(t)) return;

    const active = canvas.getActiveObject() as any;
    if (active && (active === t || Array.isArray(active?._objects))) return;

    t.set({ stroke: HOVER_STROKE, strokeWidth: HOVER_STROKE_WIDTH });
    t.setCoords();
    scheduleRender();
  };

  const onMouseOut = (opt: any) => {
    const t = opt.target as any;
    if (!t || !isFurniture(t)) return;

    const active = canvas.getActiveObject() as any;
    if (active && (active === t || Array.isArray(active?._objects))) return;

    const baseStroke = t.data?.baseStroke ?? "#10b981";
    const baseStrokeWidth = t.data?.baseStrokeWidth ?? 2;
    t.set({ stroke: baseStroke, strokeWidth: baseStrokeWidth });
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

    // expose for planner-canvas.tsx usage
    emitSelection,
    restyleAllFurniture,
    getSelectedFurnitureObjects: () => getSelectedFurnitureObjects(canvas),
  };
}
