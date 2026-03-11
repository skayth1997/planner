import type { Canvas } from "fabric";
import { Rect as FabricRect } from "fabric";

import type {
  CanvasSnapshotItem,
  FurnitureSnapshot,
  OpeningSnapshot,
  Pt,
} from "../core/planner-types";

import { GRID_SIZE } from "../core/planner-constants";
import {
  clampFurnitureInsideRoom,
  clampFurnitureInsideRoomPolygon,
  snapFurnitureToRoomGrid,
} from "../furniture/furniture";
import { isFurniture, makeId } from "../core/utils";
import { isOpening, snapOpeningToNearestWall } from "../openings/openings";

export type RoomSnapshot = {
  id: string;
  points: Pt[];
};

export type PlanSnapshotV2 = {
  version: 2;
  rooms: RoomSnapshot[];
  items: CanvasSnapshotItem[];
};

type RestoreArgs = {
  canvas: Canvas;
  json: string;
  clearCanvasState: () => void;
  createRoom: (room: RoomSnapshot) => any;
  getRoomById: (roomId: string) => any | null;
  onClearSelection: () => void;
};

function isRoom(obj: any) {
  return obj?.data?.kind === "room";
}

function getRoomPoints(room: any): Pt[] {
  const pts = Array.isArray(room?.points) ? room.points : [];
  const left = Number(room?.left) || 0;
  const top = Number(room?.top) || 0;

  return pts.map((p: any) => ({
    x: left + (Number(p?.x) || 0),
    y: top + (Number(p?.y) || 0),
  }));
}

function serializeRooms(canvas: Canvas): RoomSnapshot[] {
  const rooms = canvas
    .getObjects()
    .filter((o: any) => isRoom(o))
    .map(
      (room: any): RoomSnapshot => {
        return {
          id: String(room?.data?.id ?? makeId()),
          points: getRoomPoints(room),
        };
      }
    );

  rooms.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return rooms;
}

function serializeItems(canvas: Canvas): CanvasSnapshotItem[] {
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
              roomId: o.data?.roomId,
              baseStroke: o.data?.baseStroke ?? o.stroke ?? "#10b981",
              baseStrokeWidth: o.data?.baseStrokeWidth ?? o.strokeWidth ?? 2,
            } as any,
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
            roomId: o.data?.roomId,
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

  return items;
}

export function serializeState(canvas: Canvas) {
  const snapshot: PlanSnapshotV2 = {
    version: 2,
    rooms: serializeRooms(canvas),
    items: serializeItems(canvas),
  };

  return JSON.stringify(snapshot);
}

function safeParsePlan(json: string): PlanSnapshotV2 {
  try {
    const data = JSON.parse(json) as any;

    if (Array.isArray(data)) {
      return {
        version: 2,
        rooms: [],
        items: data as CanvasSnapshotItem[],
      };
    }

    return {
      version: 2,
      rooms: Array.isArray(data?.rooms) ? data.rooms : [],
      items: Array.isArray(data?.items) ? data.items : [],
    };
  } catch {
    return {
      version: 2,
      rooms: [],
      items: [],
    };
  }
}

export function restoreFromJson(args: RestoreArgs) {
  const {
    canvas,
    json,
    clearCanvasState,
    createRoom,
    getRoomById,
    onClearSelection,
  } = args;

  const prevRenderOnAddRemove = (canvas as any).renderOnAddRemove;
  (canvas as any).renderOnAddRemove = false;

  try {
    clearCanvasState();

    const plan = safeParsePlan(json);

    for (const room of plan.rooms) {
      if (!room?.id || !Array.isArray(room?.points) || room.points.length < 3) {
        continue;
      }

      createRoom({
        id: room.id,
        points: room.points,
      });
    }

    for (const s of plan.items) {
      const roomId = (s as any)?.data?.roomId as string | undefined;
      const ownerRoom =
        (roomId && getRoomById(roomId)) ||
        getRoomById(plan.rooms[0]?.id ?? "") ||
        null;

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
          roomId,
        };

        canvas.add(rect);

        if (ownerRoom) {
          clampFurnitureInsideRoomPolygon(rect as any, ownerRoom as any);
          clampFurnitureInsideRoom(rect as any, ownerRoom as any);
          snapFurnitureToRoomGrid(rect as any, ownerRoom as any, GRID_SIZE);
        }

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
          roomId,
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

        if (ownerRoom) {
          snapOpeningToNearestWall(rect as any, ownerRoom as any);
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
