import type { Rect, Line } from "fabric";

export type FurnitureType = "sofa" | "table" | "chair";
export type OpeningType = "door" | "window";

export type SelectedInfo = {
  id: string;

  // ✅ NEW (so panel can show what is selected)
  kind: "furniture" | "opening" | "unknown";

  // furniture type OR opening type
  type: FurnitureType | OpeningType | "unknown";

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

  getRoomSize: () => RoomSize;
  setRoomSize: (size: RoomSize) => void;

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

    segIndex: number;
    t: number;
    offset: number;
  };
};

export type CanvasSnapshotItem = FurnitureSnapshot | OpeningSnapshot;

export type PlanSnapshotV4 = {
  version: 4;
  room: { points: { x: number; y: number }[] };
  items: CanvasSnapshotItem[];
};
