import type { Canvas, Rect } from "fabric";
import { STORAGE_KEY, STORAGE_ROOM_KEY } from "./planner-constants";
import { serializeState, restoreFromJson } from "./history";

type RoomSize = { width: number; height: number };

function readRoomSizeFromRoom(room: Rect): RoomSize {
  // room.width/height are "base" (not scaled)
  const stroke = room.strokeWidth ?? 0;
  return {
    width: Math.round((room.width ?? 0) + stroke),
    height: Math.round((room.height ?? 0) + stroke),
  };
}

function applyRoomSizeToRoom(room: Rect, size: RoomSize) {
  const stroke = room.strokeWidth ?? 0;
  const min = 150;

  const nextW = Math.max(min, Math.round(size.width));
  const nextH = Math.max(min, Math.round(size.height));

  // Keep visual size consistent with current convention: width/height exclude full stroke
  room.set({
    width: Math.max(1, nextW - stroke),
    height: Math.max(1, nextH - stroke),
  });
  room.setCoords();
}

export function saveNow(canvas: Canvas, room: Rect) {
  const json = serializeState(canvas);
  localStorage.setItem(STORAGE_KEY, json);

  const roomSize = readRoomSizeFromRoom(room);
  localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify(roomSize));
}

export function loadNow(
  canvas: Canvas,
  room: Rect,
  onClearSelection: () => void
): { layoutJson: string | null; roomSize: RoomSize | null } {
  const json = localStorage.getItem(STORAGE_KEY);
  const roomJson = localStorage.getItem(STORAGE_ROOM_KEY);

  let roomSize: RoomSize | null = null;
  if (roomJson) {
    try {
      const parsed = JSON.parse(roomJson);
      if (
        parsed &&
        typeof parsed.width === "number" &&
        typeof parsed.height === "number"
      ) {
        roomSize = { width: parsed.width, height: parsed.height };
        applyRoomSizeToRoom(room, roomSize);
      }
    } catch {}
  }

  if (!json) return { layoutJson: null, roomSize };

  restoreFromJson(canvas, room, json, onClearSelection);
  return { layoutJson: json, roomSize };
}

export function exportJson(canvas: Canvas, room: Rect) {
  const itemsJson = serializeState(canvas);
  const roomSize = readRoomSizeFromRoom(room);

  const payload = JSON.stringify({
    version: 2,
    room: roomSize,
    items: JSON.parse(itemsJson),
  });

  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "planner-layout.json";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export function importJsonString(
  canvas: Canvas,
  room: Rect,
  json: string,
  onClearSelection: () => void
) {
  // Supports:
  // - v1: [FurnitureSnapshot,...]
  // - v2: {version:2, room:{width,height}, items:[...]}
  try {
    const parsed = JSON.parse(json);

    if (Array.isArray(parsed)) {
      restoreFromJson(canvas, room, json, onClearSelection);
      localStorage.setItem(STORAGE_KEY, json);
      return;
    }

    if (parsed && Array.isArray(parsed.items)) {
      if (
        parsed.room &&
        typeof parsed.room.width === "number" &&
        typeof parsed.room.height === "number"
      ) {
        localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify(parsed.room));
        applyRoomSizeToRoom(room, parsed.room);
      }

      const itemsOnly = JSON.stringify(parsed.items);
      restoreFromJson(canvas, room, itemsOnly, onClearSelection);
      localStorage.setItem(STORAGE_KEY, itemsOnly);
      return;
    }
  } catch {
    // fall through
  }

  // If invalid JSON, we still try original behavior (will throw inside restoreFromJson)
  restoreFromJson(canvas, room, json, onClearSelection);
  localStorage.setItem(STORAGE_KEY, json);
}
