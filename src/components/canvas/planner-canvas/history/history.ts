import type { Canvas, Rect, Polygon } from "fabric";
import { Rect as FabricRect } from "fabric";

import type {
  CanvasSnapshotItem,
  FurnitureSnapshot,
  OpeningSnapshot,
} from "../core/planner-types";

import { GRID_SIZE } from "../core/planner-constants";
import {
  clampFurnitureInsideRoom,
  snapFurnitureToRoomGrid,
} from "../furniture/furniture";
import { isFurniture, makeId } from "../core/utils";
import { isOpening, snapOpeningToNearestWall } from "../openings/openings";

export function serializeState(canvas: Canvas) {
  const items = canvas
    .getObjects()
    .filter(
      (o: any) => o?.data?.kind === "furniture" || o?.data?.kind === "opening"
    )
    .map(
      (o: any): CanvasSnapshotItem => {
        if (o?.data?.kind === "furniture") {
          const snap: FurnitureSnapshot = {
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
              baseStroke: o.data?.baseStroke ?? o.stroke ?? "#10b981",
              baseStrokeWidth: o.data?.baseStrokeWidth ?? o.strokeWidth ?? 2,
            },
          };

          return snap;
        }

        const open: OpeningSnapshot = {
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
            wallId:
              typeof o.data?.wallId === "string" ? o.data.wallId : "seg-0",
            t: typeof o.data?.t === "number" ? o.data.t : 0.5,
            offset: typeof o.data?.offset === "number" ? o.data.offset : 0,
            hinge: o.data?.hinge === "end" ? "end" : "start",
            isOpen: !!o.data?.isOpen,
          } as any,
        };

        return open;
      }
    );

  items.sort((a: any, b: any) => {
    const ida = a?.data?.id ?? "";
    const idb = b?.data?.id ?? "";
    return String(ida).localeCompare(String(idb));
  });

  return JSON.stringify(items);
}

function safeParseItems(json: string): CanvasSnapshotItem[] {
  try {
    const data = JSON.parse(json) as any;
    if (!Array.isArray(data)) return [];
    return data as CanvasSnapshotItem[];
  } catch {
    return [];
  }
}

export function restoreFromJson(
  canvas: Canvas,
  room: Rect | Polygon,
  json: string,
  onClearSelection: () => void
) {
  const prevRenderOnAddRemove = (canvas as any).renderOnAddRemove;
  (canvas as any).renderOnAddRemove = false;

  try {
    const objects = canvas.getObjects().slice();
    for (const o of objects as any[]) {
      if (isFurniture(o) || isOpening(o)) canvas.remove(o);
    }

    const data = safeParseItems(json);

    for (const s of data) {
      if ((s as any)?.data?.kind === "furniture") {
        const f = s as FurnitureSnapshot;

        const rect = new FabricRect({
          left: f.left,
          top: f.top,
          width: f.width,
          height: f.height,
          fill: f.fill ?? "rgba(16,185,129,0.25)",
          stroke: f.stroke ?? "#10b981",
          strokeWidth: f.strokeWidth ?? 2,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockScalingFlip: true,
          transparentCorners: false,
          angle: f.angle ?? 0,
          hoverCursor: "move",
        });

        if (typeof f.rx === "number" && typeof f.ry === "number") {
          rect.set({ rx: f.rx, ry: f.ry });
        }

        rect.scaleX = f.scaleX ?? 1;
        rect.scaleY = f.scaleY ?? 1;

        (rect as any).data = {
          ...f.data,
          kind: "furniture",
          id: f.data?.id ?? makeId(),
        };

        canvas.add(rect);

        clampFurnitureInsideRoom(rect as any, room as any);
        snapFurnitureToRoomGrid(rect as any, room as any, GRID_SIZE);
        rect.setCoords();

        continue;
      }

      if ((s as any)?.data?.kind === "opening") {
        const o = s as OpeningSnapshot;

        const type = (o as any)?.data?.type ?? "door";
        const isDoor = type === "door";

        const hinge =
          (o as any)?.data?.hinge === "end"
            ? ("end" as const)
            : ("start" as const);

        const rect = new FabricRect({
          left: o.left,
          top: o.top,
          width: o.width,
          height: o.height,
          fill:
            o.fill ??
            (type === "window"
              ? "rgba(59,130,246,0.18)"
              : "rgba(245,158,11,0.25)"),
          stroke: o.stroke ?? (type === "window" ? "#3b82f6" : "#f59e0b"),
          strokeWidth: o.strokeWidth ?? 2,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockScalingFlip: true,
          transparentCorners: false,
          angle: o.angle ?? 0,
          hoverCursor: "move",
          originX: isDoor ? (hinge === "start" ? "left" : "right") : "center",
          originY: "center",
        });

        rect.scaleX = o.scaleX ?? 1;
        rect.scaleY = o.scaleY ?? 1;

        const wallId =
          typeof (o as any)?.data?.wallId === "string"
            ? String((o as any).data.wallId)
            : undefined;

        const legacySegIndex = Number.isFinite(
          Number((o as any)?.data?.segIndex)
        )
          ? Number((o as any).data.segIndex)
          : undefined;

        (rect as any).data = {
          kind: "opening",
          type,
          id: (o as any)?.data?.id ?? makeId(),

          wallId:
            wallId ??
            (typeof legacySegIndex === "number"
              ? `seg-${legacySegIndex}`
              : "seg-0"),

          t: typeof (o as any)?.data?.t === "number" ? (o as any).data.t : 0.5,
          offset:
            typeof (o as any)?.data?.offset === "number"
              ? (o as any).data.offset
              : 0,

          hinge,
          isOpen: !!(o as any)?.data?.isOpen,
        };

        canvas.add(rect);

        if ((room as any)?.points) {
          snapOpeningToNearestWall(rect as any, room as any);
        }

        rect.setCoords();
      }
    }

    canvas.discardActiveObject();
    onClearSelection();
  } finally {
    (canvas as any).renderOnAddRemove = prevRenderOnAddRemove ?? true;
    canvas.requestRenderAll();
  }
}
