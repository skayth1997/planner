import type { Canvas, Rect } from "fabric";
import { Rect as FabricRect } from "fabric";
import type { FurnitureSnapshot } from "./planner-types";
import { GRID_SIZE } from "./planner-constants";
import { clampFurnitureInsideRoom, snapFurnitureToRoomGrid } from "./furniture";
import { isFurniture, makeId } from "./utils";

export function serializeState(canvas: Canvas) {
  const items = canvas
    .getObjects()
    .filter((o: any) => o?.data?.kind === "furniture")
    .map((o: any): FurnitureSnapshot => ({
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
    }));

  items.sort((a, b) => a.data.id.localeCompare(b.data.id));
  return JSON.stringify(items);
}

export function restoreFromJson(
  canvas: Canvas,
  room: Rect,
  json: string,
  onClearSelection: () => void
) {
  canvas.getObjects().forEach((o: any) => {
    if (isFurniture(o)) canvas.remove(o);
  });

  const data: FurnitureSnapshot[] = JSON.parse(json);

  for (const s of data) {
    const rect = new FabricRect({
      left: s.left,
      top: s.top,
      width: s.width,
      height: s.height,
      fill: s.fill ?? "rgba(16,185,129,0.25)",
      stroke: s.stroke ?? "#10b981",
      strokeWidth: s.strokeWidth ?? 2,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      lockScalingFlip: true,
      transparentCorners: false,
      angle: s.angle ?? 0,
      hoverCursor: "move",
    });

    if (typeof s.rx === "number" && typeof s.ry === "number") {
      rect.set({ rx: s.rx, ry: s.ry });
    }

    rect.scaleX = s.scaleX ?? 1;
    rect.scaleY = s.scaleY ?? 1;

    (rect as any).data = s.data;

    canvas.add(rect);

    clampFurnitureInsideRoom(rect as any, room);
    snapFurnitureToRoomGrid(rect as any, room, GRID_SIZE);
    rect.setCoords();
  }

  canvas.discardActiveObject();
  onClearSelection();
  canvas.requestRenderAll();
}

export function pushHistory(
  historyRef: { current: string[] },
  historyIndexRef: { current: number },
  snapshot: string
) {
  const current = historyRef.current[historyIndexRef.current];
  if (current === snapshot) return;

  historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
  historyRef.current.push(snapshot);
  historyIndexRef.current = historyRef.current.length - 1;

  const LIMIT = 80;
  if (historyRef.current.length > LIMIT) {
    historyRef.current.shift();
    historyIndexRef.current--;
  }
}
