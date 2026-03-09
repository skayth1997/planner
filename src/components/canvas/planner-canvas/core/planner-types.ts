import type { Line } from "fabric";

export type FurnitureType = "sofa" | "table" | "chair";
export type OpeningType = "door" | "window";
export type OpeningKind = "door" | "window";

export type RoomId = string;
export type WallId = string;

export type Pt = { x: number; y: number };

export type RoomSize = { width: number; height: number };

export type RoomSnapshot = {
  id: RoomId;
  name?: string;
  points: Pt[];
};

export type WallSeg = {
  id: string;
  a: Pt;
  b: Pt;
};

export type OpeningData = {
  kind?: "opening";
  type: OpeningKind;
  roomId?: RoomId;
  wallId?: WallId;
  segIndex?: number;
  t?: number;
  offset?: number;
  hinge?: "start" | "end";
  isOpen?: boolean;
};

export type SelectedInfo = {
  id: string;
  kind: "furniture" | "opening" | "room" | "unknown";
  type: FurnitureType | OpeningType | "room" | "unknown";
  roomId?: RoomId;
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  hinge?: "start" | "end";
  isOpen?: boolean;
  wallId?: string;
  t?: number;
};

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
  isDrawingRoom: () => boolean;
  startDrawRoom?: () => void;
  stopDrawRoom?: () => void;
  addRoom?: () => void;
  getActiveRoomId?: () => RoomId | null;
  setActiveRoom?: (roomId: RoomId) => void;
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
    roomId?: RoomId;
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
    roomId?: RoomId;
    wallId: string;
    t: number;
    offset: number;
    hinge?: "start" | "end";
    isOpen?: boolean;
    segIndex?: number;
  };
};

export type CanvasSnapshotItem = FurnitureSnapshot | OpeningSnapshot;

export type PlanSnapshotV5 = {
  version: 5;
  room: { points: Pt[] };
  items: CanvasSnapshotItem[];
};

export type PlanSnapshotV6 = {
  version: 6;
  rooms: RoomSnapshot[];
  items: CanvasSnapshotItem[];
  activeRoomId?: RoomId | null;
};

export type PlanSnapshot = PlanSnapshotV5 | PlanSnapshotV6;
