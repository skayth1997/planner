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
