import type React from "react";
import type { Canvas, Polygon } from "fabric";
import { Rect } from "fabric";

import type { GuideLine, CanvasSnapshotItem } from "../core/planner-types";

import { isFurniture, getSelectedInfo, makeId } from "../core/utils";
import {
  clampFurnitureInsideRoom,
  clampFurnitureInsideRoomPolygon,
  snapFurnitureToRoomGrid,
  addFurniture,
} from "../furniture/furniture";

import {
  isOpening,
  snapOpeningToNearestWall,
  addDoor,
  addWindow,
  applyDoorHinge,
  toggleDoorOpen,
} from "../openings/openings";

import { clearGuides } from "../selection/guides";
import { fitRoomToView } from "../room/fit";

type SelectionController = {
  getSelectedObjects: () => any[];
  emitSelection: () => void;
  restyleAllItems: () => void;
  restyleAllFurniture?: () => void;
  getSelectedFurnitureObjects?: () => any[];
};

type GridController = {
  getSize: () => number;
  rebuild: () => void;
  restack: () => void;
  setVisible: (v: boolean) => void;
  setSize: (n: number) => void;
};

type HistoryController = {
  pushNow: () => void;
  undo: () => void;
  redo: () => void;
  setHistoryFromSnapshot: (snap: any) => void;
};

type Deps = {
  getCanvas: () => Canvas | null;
  getRoom: () => Polygon | null;

  getGridSize: () => number;
  safeRender: () => void;

  selection: () => SelectionController | null;
  grid: () => GridController | null;
  history: () => HistoryController | null;

  onSelectionChange: (info: any | null) => void;

  guidesRef: React.MutableRefObject<GuideLine[]>;

  clipboardRef: React.MutableRefObject<CanvasSnapshotItem[] | null>;

  scheduleNudgeCommit: () => void;
};

function limitFurnitureSizeToRoom(obj: any, room: any, padding = 0) {
  if (!obj || !room) return;

  const roomRect = room.getBoundingRect(false, true);
  const maxW = Math.max(20, roomRect.width - padding * 2);
  const maxH = Math.max(20, roomRect.height - padding * 2);

  for (let i = 0; i < 3; i++) {
    const bbox = obj.getBoundingRect(false, true);
    if (!bbox?.width || !bbox?.height) break;

    if (bbox.width <= maxW && bbox.height <= maxH) break;

    const sx = maxW / bbox.width;
    const sy = maxH / bbox.height;

    obj.scaleX = Math.max(0.05, (obj.scaleX ?? 1) * Math.min(1, sx));
    obj.scaleY = Math.max(0.05, (obj.scaleY ?? 1) * Math.min(1, sy));

    obj.setCoords();
  }
}

export function createCanvasActions(deps: Deps) {
  const emitSelection = () => deps.selection()?.emitSelection();

  const restyleAll = () => {
    const sel = deps.selection();
    if (sel?.restyleAllItems) {
      sel.restyleAllItems();
    } else {
      sel?.restyleAllFurniture?.();
    }
  };

  const pushHistoryNow = () => deps.history()?.pushNow();

  const getSelectedObjects = () => {
    const sel = deps.selection();
    return (
      sel?.getSelectedObjects?.() ?? sel?.getSelectedFurnitureObjects?.() ?? []
    );
  };

  const deleteSelected = () => {
    const canvas = deps.getCanvas();
    if (!canvas) return;

    const selected = getSelectedObjects();
    if (selected.length === 0) return;

    for (const o of selected) canvas.remove(o);

    canvas.discardActiveObject();
    deps.onSelectionChange(null);

    restyleAll();
    clearGuides(canvas, deps.guidesRef);
    pushHistoryNow();
    deps.safeRender();
  };

  const moveLayer = (dir: "up" | "down", toEdge: boolean) => {
    const canvas = deps.getCanvas();
    if (!canvas) return;

    const selected = getSelectedObjects();
    if (selected.length === 0) return;

    const objs = dir === "up" ? [...selected] : [...selected].reverse();

    for (const o of objs) {
      if (toEdge) {
        if (dir === "up") canvas.bringObjectToFront(o);
        else canvas.sendObjectToBack(o);
      } else {
        if (dir === "up") canvas.bringObjectForward(o);
        else canvas.sendObjectBackwards(o);
      }
    }

    deps.grid()?.restack();

    restyleAll();
    clearGuides(canvas, deps.guidesRef);
    deps.safeRender();
    pushHistoryNow();
  };

  const cloneSelectedToClipboard = () => {
    const canvas = deps.getCanvas();
    if (!canvas) return;

    const selected = getSelectedObjects();
    if (selected.length === 0) return;

    deps.clipboardRef.current = selected
      .filter((o) => isFurniture(o) || isOpening(o))
      .map(
        (o: any): CanvasSnapshotItem => {
          if (isFurniture(o)) {
            return {
              left: o.left ?? 0,
              top: o.top ?? 0,
              width: o.width ?? 0,
              height: o.height ?? 0,
              angle: o.angle ?? 0,
              rx: o.rx,
              ry: o.ry,
              fill: o.fill,
              stroke: o.stroke,
              strokeWidth: o.strokeWidth ?? 2,
              scaleX: o.scaleX ?? 1,
              scaleY: o.scaleY ?? 1,
              data: {
                kind: "furniture",
                type: o.data?.type ?? "unknown",
                id: o.data?.id ?? makeId(),
                baseStroke: o.data?.baseStroke ?? "#10b981",
                baseStrokeWidth: o.data?.baseStrokeWidth ?? 2,
              },
            } as any;
          }

          return {
            left: o.left ?? 0,
            top: o.top ?? 0,
            width: o.width ?? 0,
            height: o.height ?? 0,
            angle: o.angle ?? 0,
            fill: o.fill,
            stroke: o.stroke,
            strokeWidth: o.strokeWidth ?? 2,
            scaleX: o.scaleX ?? 1,
            scaleY: o.scaleY ?? 1,
            data: {
              kind: "opening",
              type: o.data?.type ?? "door",
              id: o.data?.id ?? makeId(),
              segIndex: Number(o.data?.segIndex) || 0,
              t: typeof o.data?.t === "number" ? o.data.t : 0.5,
              offset: typeof o.data?.offset === "number" ? o.data.offset : 0,
            },
          } as any;
        }
      );
  };

  const pasteFromClipboard = () => {
    const canvas = deps.getCanvas();
    const room = deps.getRoom();
    if (!canvas || !room) return;

    const snaps = deps.clipboardRef.current;
    if (!snaps || snaps.length === 0) return;

    const grid = deps.getGridSize();
    const clones: Rect[] = [];

    for (const snap of snaps) {
      if ((snap as any).data?.kind === "furniture") {
        const s: any = snap;

        const rect = new Rect({
          left: (s.left ?? 0) + grid,
          top: (s.top ?? 0) + grid,
          width: s.width ?? 60,
          height: s.height ?? 60,
          fill: s.fill ?? "rgba(16,185,129,0.25)",
          stroke: s.stroke ?? "#10b981",
          strokeWidth: s.strokeWidth ?? 2,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockScalingFlip: true,
          transparentCorners: false,
          angle: s.angle ?? 0,
          hoverCursor: "move",
        });

        if (typeof s.rx === "number" && typeof s.ry === "number") {
          rect.set({ rx: s.rx, ry: s.ry });
        }

        rect.scaleX = s.scaleX ?? 1;
        rect.scaleY = s.scaleY ?? 1;

        (rect as any).data = {
          kind: "furniture",
          type: s.data?.type ?? "unknown",
          id: makeId(),
          baseStroke: s.data?.baseStroke ?? "#10b981",
          baseStrokeWidth: s.data?.baseStrokeWidth ?? 2,
        };

        canvas.add(rect);

        clampFurnitureInsideRoomPolygon(rect as any, room as any);
        clampFurnitureInsideRoom(rect as any, room as any);
        snapFurnitureToRoomGrid(rect as any, room as any, grid);

        rect.setCoords();
        clones.push(rect);
        continue;
      }

      if ((snap as any).data?.kind === "opening") {
        const s: any = snap;

        const rect = new Rect({
          left: (s.left ?? 0) + grid,
          top: (s.top ?? 0) + grid,
          width: s.width ?? 80,
          height: s.height ?? 10,
          fill:
            s.fill ??
            (s.data?.type === "window"
              ? "rgba(59,130,246,0.18)"
              : "rgba(245,158,11,0.25)"),
          stroke:
            s.stroke ?? (s.data?.type === "window" ? "#3b82f6" : "#f59e0b"),
          strokeWidth: s.strokeWidth ?? 2,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockScalingFlip: true,
          transparentCorners: false,
          angle: s.angle ?? 0,
          hoverCursor: "move",
          originX: "center",
          originY: "center",
        });

        rect.scaleX = s.scaleX ?? 1;
        rect.scaleY = s.scaleY ?? 1;

        (rect as any).data = {
          kind: "opening",
          type: s.data?.type ?? "door",
          id: makeId(),
          segIndex: Number(s.data?.segIndex) || 0,
          t: typeof s.data?.t === "number" ? s.data.t : 0.5,
          offset: typeof s.data?.offset === "number" ? s.data.offset : 0,
          baseStroke:
            s.data?.baseStroke ??
            (s.data?.type === "window" ? "#3b82f6" : "#f59e0b"),
          baseStrokeWidth: s.data?.baseStrokeWidth ?? 2,
        };

        canvas.add(rect);
        snapOpeningToNearestWall(rect as any, room as any);

        rect.setCoords();
        clones.push(rect);
        continue;
      }
    }

    canvas.discardActiveObject();
    if (clones.length === 1) {
      canvas.setActiveObject(clones[0]);
    } else if (clones.length > 1) {
      const anyCanvas: any = canvas as any;
      const ActiveSelectionCtor =
        anyCanvas?.ActiveSelection || (window as any)?.fabric?.ActiveSelection;

      if (ActiveSelectionCtor) {
        const sel = new ActiveSelectionCtor(clones, { canvas });
        canvas.setActiveObject(sel);
      } else {
        canvas.setActiveObject(clones[0]);
      }
    }

    emitSelection();
    restyleAll();
    clearGuides(canvas, deps.guidesRef);

    pushHistoryNow();
    deps.safeRender();
  };

  const nudgeSelected = (dx: number, dy: number, skipClamp = false) => {
    const canvas = deps.getCanvas();
    const room = deps.getRoom();
    if (!canvas || !room) return;

    const selected = getSelectedObjects();
    if (selected.length === 0) return;

    for (const o of selected) {
      o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy });
      o.setCoords();

      if (!skipClamp && isFurniture(o)) {
        clampFurnitureInsideRoomPolygon(o, room as any);
        clampFurnitureInsideRoom(o, room as any);
      }

      if (!skipClamp && isOpening(o)) {
        snapOpeningToNearestWall(o, room as any);
      }

      o.setCoords();
    }

    const active: any = canvas.getActiveObject();
    if (active && Array.isArray(active?._objects)) {
      active.setCoords?.();
    }

    emitSelection();
    restyleAll();
    clearGuides(canvas, deps.guidesRef);
    deps.safeRender();

    deps.scheduleNudgeCommit();
  };

  const duplicateSelected = () => {
    cloneSelectedToClipboard();
    pasteFromClipboard();
  };

  const setSelectedProps = (patch: {
    width?: number;
    height?: number;
    angle?: number;
    hinge?: "start" | "end";
  }) => {
    const canvas = deps.getCanvas();
    const room = deps.getRoom();
    if (!canvas || !room) return;

    const active = canvas.getActiveObject() as any;
    if (!active) return;

    if (Array.isArray(active?._objects)) return;

    const isF = isFurniture(active);
    const isO = isOpening(active);
    if (!isF && !isO) return;

    if (patch.hinge && isO && active.data?.type === "door") {
      applyDoorHinge(active, room as any, patch.hinge);
    }

    if (typeof patch.width === "number" && patch.width > 1) {
      const current = active.getBoundingRect(false, true).width;
      const factor = patch.width / Math.max(1, current);
      active.scaleX = (active.scaleX ?? 1) * factor;
    }

    if (typeof patch.height === "number" && patch.height > 1) {
      const current = active.getBoundingRect(false, true).height;
      const factor = patch.height / Math.max(1, current);
      active.scaleY = (active.scaleY ?? 1) * factor;
    }

    if (typeof patch.angle === "number") active.angle = patch.angle;

    active.setCoords();

    if (isF) {
      limitFurnitureSizeToRoom(active, room as any, 0);
      clampFurnitureInsideRoomPolygon(active, room as any);
      clampFurnitureInsideRoom(active, room as any);
      snapFurnitureToRoomGrid(active, room as any, deps.getGridSize());
    }

    if (isO) {
      snapOpeningToNearestWall(active, room as any);
    }

    active.setCoords();

    restyleAll();
    clearGuides(canvas, deps.guidesRef);

    deps.onSelectionChange(getSelectedInfo(active));
    pushHistoryNow();
    deps.safeRender();
  };

  const fitRoom = () => {
    const canvas = deps.getCanvas();
    const room = deps.getRoom();
    if (!canvas || !room) return;

    fitRoomToView(canvas, room);
    clearGuides(canvas, deps.guidesRef);
    deps.safeRender();
  };

  const addFurnitureAction = (type: any) => {
    const canvas = deps.getCanvas();
    const room = deps.getRoom();
    if (!canvas || !room) return;

    addFurniture(canvas, room as any, type);
    restyleAll();
    pushHistoryNow();
  };

  const addDoorAction = () => {
    const canvas = deps.getCanvas();
    const room = deps.getRoom();
    if (!canvas || !room) return;

    addDoor(canvas, room as any);
    deps.grid()?.restack();
    pushHistoryNow();
    deps.safeRender();
  };

  const addWindowAction = () => {
    const canvas = deps.getCanvas();
    const room = deps.getRoom();
    if (!canvas || !room) return;

    addWindow(canvas, room as any);
    deps.grid()?.restack();
    pushHistoryNow();
    deps.safeRender();
  };

  const undo = () => deps.history()?.undo();
  const redo = () => deps.history()?.redo();

  const toggleSelectedDoor = () => {
    const canvas = deps.getCanvas();
    const room = deps.getRoom();
    if (!canvas || !room) return;

    const active = canvas.getActiveObject() as any;
    if (!active) return;

    if (isOpening(active) && active.data?.type === "door") {
      toggleDoorOpen(active, room as any);

      active.setCoords();
      deps.onSelectionChange(getSelectedInfo(active));
      pushHistoryNow();
      deps.safeRender();
    }
  };

  return {
    deleteSelected,
    duplicateSelected,
    copySelected: cloneSelectedToClipboard,
    paste: pasteFromClipboard,
    nudgeSelected,
    moveLayer,
    setSelectedProps,
    fitRoom,
    addFurniture: addFurnitureAction,
    addDoor: addDoorAction,
    addWindow: addWindowAction,
    toggleSelectedDoor,
    undo,
    redo,
  };
}
