// src/components/canvas/planner-canvas/core/planner-types.ts
import type { Rect, Line } from "fabric";

export type FurnitureType = "sofa" | "table" | "chair";

export type SelectedInfo = {
  id: string;
  type: FurnitureType | "unknown";
  left: number;
  top: number;
  width: number; // actual width (scaled)
  height: number; // actual height (scaled)
  angle: number;
};

export type RoomSize = { width: number; height: number };

export type PlannerCanvasHandle = {
  addFurniture: (type: FurnitureType) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  setSelectedProps: (
    patch: Partial<Pick<SelectedInfo, "width" | "height" | "angle">>
  ) => void;

  fitRoom: () => void;

  undo: () => void;
  redo: () => void;

  save: () => void;
  load: () => void;
  exportJson: () => void;
  importJsonString: (json: string) => void;

  // NEW
  getRoomSize: () => RoomSize;
  setRoomSize: (size: RoomSize) => void;

  // optional (you already have these implemented in canvas)
  setGridVisible?: (visible: boolean) => void;
  setGridSize?: (size: number) => void;
};

export type FurnitureSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  rx?: number;
  ry?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  scaleX?: number;
  scaleY?: number;
  data: {
    kind: "furniture";
    type: FurnitureType | "unknown";
    id: string;
    baseStroke?: string;
    baseStrokeWidth?: number;
  };
};

export type GuideLine = Line;

export type IsFurnitureFn = (obj: any) => obj is Rect;

export type OpeningType = "door" | "window";

export type OpeningSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  scaleX?: number;
  scaleY?: number;
  data: {
    kind: "opening";
    type: OpeningType;
    id: string;

    // wall attachment
    segIndex: number; // which wall segment
    t: number; // 0..1 along the segment
    offset: number; // signed distance along normal (px)
  };
};

// ✅ NEW: union snapshot items (v4 can contain both)
export type CanvasSnapshotItem = FurnitureSnapshot | OpeningSnapshot;

// ✅ NEW: export/import container format v4
export type PlanSnapshotV4 = {
  version: 4;
  room: { points: { x: number; y: number }[] };
  items: CanvasSnapshotItem[];
};
