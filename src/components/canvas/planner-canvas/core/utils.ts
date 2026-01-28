import type { Rect } from "fabric";
import type { FurnitureType, OpeningType, SelectedInfo } from "./planner-types";

export function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

export function isFurniture(obj: any): obj is Rect {
  return obj?.data?.kind === "furniture";
}

export function isAlignable(obj: any) {
  return obj?.data?.kind === "furniture" || obj?.data?.kind === "opening";
}

export function isOpening(obj: any): obj is Rect {
  return obj?.data?.kind === "opening";
}

export function getObjectKind(obj: any): "furniture" | "opening" | "unknown" {
  return obj?.data?.kind ?? "unknown";
}

export function getFurnitureType(obj: any): FurnitureType | "unknown" {
  return obj?.data?.type ?? "unknown";
}

export function getOpeningType(obj: any): OpeningType | "unknown" {
  return obj?.data?.type ?? "unknown";
}

export function getSelectedInfo(obj: any): SelectedInfo {
  const rect = obj.getBoundingRect(false, true);

  const kind = getObjectKind(obj);
  const type =
    kind === "furniture"
      ? getFurnitureType(obj)
      : kind === "opening"
      ? getOpeningType(obj)
      : "unknown";

  return {
    id: obj.data?.id ?? makeId(),
    kind,
    type,
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: rect.width,
    height: rect.height,
    angle: obj.angle ?? 0,
  };
}
