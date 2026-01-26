import type { Rect } from "fabric";
import type { FurnitureType, SelectedInfo } from "./planner-types";

export function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

export function isFurniture(obj: any): obj is Rect {
  return obj?.data?.kind === "furniture";
}

export function getFurnitureType(obj: any): FurnitureType | "unknown" {
  return obj?.data?.type ?? "unknown";
}

export function getSelectedInfo(obj: any): SelectedInfo {
  const rect = obj.getBoundingRect(false, true);
  return {
    id: obj.data?.id ?? makeId(),
    type: getFurnitureType(obj),
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: rect.width,
    height: rect.height,
    angle: obj.angle ?? 0,
  };
}
