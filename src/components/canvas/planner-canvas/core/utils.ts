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

export function getSelectedInfo(obj: any): SelectedInfo | null {
  if (!obj) return null;

  const id = obj?.data?.id ?? "";

  const left = obj.left ?? 0;
  const top = obj.top ?? 0;

  const width = obj.getScaledWidth?.() ?? obj.width ?? 0;
  const height = obj.getScaledHeight?.() ?? obj.height ?? 0;

  const angle = obj.angle ?? 0;

  const kind = obj?.data?.kind;
  const dataType = obj?.data?.type;

  let type: SelectedInfo["type"] = "unknown";

  if (kind === "opening" && (dataType === "door" || dataType === "window")) {
    type = dataType;
  } else if (obj?.data?.type) {
    type = obj.data.type;
  }

  const hinge =
    kind === "opening" &&
    dataType === "door" &&
    (obj.data?.hinge === "start" || obj.data?.hinge === "end")
      ? obj.data.hinge
      : undefined;

  const isOpen =
    kind === "opening" && dataType === "door" ? !!obj.data?.isOpen : undefined;

  return {
    id,
    kind,
    type,
    left,
    top,
    width,
    height,
    angle,
    hinge,
    isOpen,
  };
}
