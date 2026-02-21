import type { Rect, Line } from "fabric";

export type FurnitureType = "sofa" | "table" | "chair";
export type OpeningType = "door" | "window";

export type SelectedInfo = {
  id: string;
  kind: "furniture" | "opening" | "unknown";
  type: FurnitureType | OpeningType | "unknown";
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  hinge?: "start" | "end";
  isOpen?: boolean;
};

export type RoomSize = { width: number; height: number };

export type PlannerCanvasHandle = {
  addFurniture: (type: FurnitureType) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  setSelectedProps: (
    patch: Partial<Pick<SelectedInfo, "width" | "height" | "angle" | "hinge">>
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
  addDoor: () => void;
  addWindow: () => void;
  toggleSelectedDoor(): void;
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
    hinge: "start" | "end";
    isOpen: boolean;
  };
};

export type CanvasSnapshotItem = FurnitureSnapshot | OpeningSnapshot;

export type PlanSnapshotV4 = {
  version: 4;
  room: { points: { x: number; y: number }[] };
  items: CanvasSnapshotItem[];
};
