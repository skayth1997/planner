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
  onRoomActivated?: (roomId: string, roomObj: any) => void;
  scheduleRender: () => void;
  clearGuides?: () => void;
};

function isRoom(obj: any) {
  return obj?.data?.kind === "room";
}

function isSelectableItem(obj: any) {
  return isFurniture(obj) || isOpening(obj);
}

function getSelectedObjectsFromCanvas(canvas: Canvas): any[] {
  const active: any = canvas.getActiveObject();
  if (!active) return [];

  const objs: any[] = Array.isArray(active?._objects)
    ? active._objects
    : [active];

  return objs.filter((o) => isSelectableItem(o));
}

function getBaseStyle(o: any) {
  if (isFurniture(o)) {
    return {
      stroke: o.data?.baseStroke ?? o.stroke ?? "#10b981",
      strokeWidth: o.data?.baseStrokeWidth ?? o.strokeWidth ?? 2,
    };
  }

  const t = o.data?.type;
  const fallbackStroke = t === "window" ? "#3b82f6" : "#f59e0b";
  const fallbackWidth = 2;

  return {
    stroke: o.data?.baseStroke ?? fallbackStroke,
    strokeWidth: o.data?.baseStrokeWidth ?? fallbackWidth,
  };
}

function setHoverEffect(o: any, on: boolean) {
  o.set({
    shadow: on
      ? { color: "rgba(0,0,0,0.25)", blur: 12, offsetX: 0, offsetY: 0 }
      : null,
    objectCaching: false,
  });
}

function isActiveSelectionContains(active: any, obj: any) {
  return Array.isArray(active?._objects) && active._objects.includes(obj);
}

function getRoomSelectedInfo(room: any): SelectedInfo | null {
  if (!isRoom(room)) return null;

  const rect = room.getBoundingRect();

  return {
    id: String(room?.data?.id ?? "room"),
    kind: "room",
    type: "room",
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    angle: Number(room?.angle ?? 0),
  };
}

export function createSelectionController(args: Args) {
  const {
    canvas,
    onSelectionChange,
    onRoomActivated,
    scheduleRender,
    clearGuides,
  } = args;

  const emitSelection = () => {
    const selected = getSelectedObjectsFromCanvas(canvas);
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

      if (active && (o === active || isActiveSelectionContains(active, o))) {
        o.set({ stroke: ACTIVE_STROKE, strokeWidth: ACTIVE_STROKE_WIDTH });
      } else {
        o.set({ stroke: base.stroke, strokeWidth: base.strokeWidth });
      }

      o.setCoords();
    });

    scheduleRender();
  };

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

  const onMouseOver = (opt: any) => {
    const t = opt.target as any;
    if (!t) return;

    if (isRoom(t)) {
      t.set({
        shadow: {
          color: "rgba(37,99,235,0.18)",
          blur: 10,
          offsetX: 0,
          offsetY: 0,
        },
        objectCaching: false,
      });
      t.setCoords();
      scheduleRender();
      return;
    }

    if (!isSelectableItem(t)) return;

    const active = canvas.getActiveObject() as any;
    if (active && (active === t || isActiveSelectionContains(active, t))) {
      return;
    }

    setHoverEffect(t, true);
    t.set({ stroke: HOVER_STROKE, strokeWidth: HOVER_STROKE_WIDTH });
    t.setCoords();
    scheduleRender();
  };

  const onMouseOut = (opt: any) => {
    const t = opt.target as any;
    if (!t) return;

    if (isRoom(t)) {
      t.set({
        shadow: null,
        objectCaching: false,
      });
      t.setCoords();
      scheduleRender();
      return;
    }

    if (!isSelectableItem(t)) return;

    const active = canvas.getActiveObject() as any;
    if (active && (active === t || isActiveSelectionContains(active, t))) {
      return;
    }

    setHoverEffect(t, false);

    const base = getBaseStyle(t);
    t.set({ stroke: base.stroke, strokeWidth: base.strokeWidth });
    t.setCoords();
    scheduleRender();
  };

  const onMouseDown = (opt: any) => {
    const t = opt.target as any;
    if (!t) return;

    if (!isRoom(t)) return;

    const roomId = String(t?.data?.id ?? "");
    if (!roomId) return;

    canvas.discardActiveObject();
    clearGuides?.();

    onRoomActivated?.(roomId, t);
    onSelectionChange?.(getRoomSelectedInfo(t));

    scheduleRender();
  };

  const attach = () => {
    canvas.on("selection:created", onSelectionCreated);
    canvas.on("selection:updated", onSelectionUpdated);
    canvas.on("selection:cleared", onSelectionCleared);

    canvas.on("mouse:over", onMouseOver);
    canvas.on("mouse:out", onMouseOut);
    canvas.on("mouse:down", onMouseDown);
  };

  const detach = () => {
    canvas.off("selection:created", onSelectionCreated);
    canvas.off("selection:updated", onSelectionUpdated);
    canvas.off("selection:cleared", onSelectionCleared);

    canvas.off("mouse:over", onMouseOver);
    canvas.off("mouse:out", onMouseOut);
    canvas.off("mouse:down", onMouseDown);
  };

  return {
    attach,
    detach,
    emitSelection,
    restyleAllItems,
    getSelectedObjects: () => getSelectedObjectsFromCanvas(canvas),
  };
}
