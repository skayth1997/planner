import type { Canvas, Polygon } from "fabric";
import { STORAGE_KEY, STORAGE_ROOM_KEY } from "../core/planner-constants";
import { serializeState, restoreFromJson } from "../history/history";

type RoomPoint = { x: number; y: number };
type RoomState = { points: RoomPoint[] };

type PlanSnapshot = {
  room: RoomState;
  items: any[];
};

function safeParseJson<T = any>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function getRoomPoints(room: Polygon): RoomPoint[] {
  const pts = (room.points ?? []) as any[];
  return pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
}

function setRoomPoints(room: Polygon, points: RoomPoint[]) {
  room.set({ points: points as any });
  room.setCoords();
}

function isValidRoomPoints(points: any): points is RoomPoint[] {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.every((p) => p && typeof p.x === "number" && typeof p.y === "number")
  );
}

export function saveNow(canvas: Canvas, room: Polygon) {
  const itemsJson = serializeState(canvas);
  localStorage.setItem(STORAGE_KEY, itemsJson);

  const roomState: RoomState = { points: getRoomPoints(room) };
  localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify(roomState));
}

export function loadNow(
  canvas: Canvas,
  room: Polygon,
  onClearSelection: () => void
): { layoutJson: string | null; roomState: RoomState | null } {
  const itemsJson = localStorage.getItem(STORAGE_KEY);
  const roomJson = localStorage.getItem(STORAGE_ROOM_KEY);

  let roomState: RoomState | null = null;

  if (roomJson) {
    const parsed = safeParseJson<any>(roomJson);
    if (parsed && isValidRoomPoints(parsed.points)) {
      roomState = { points: parsed.points };
      setRoomPoints(room, roomState.points);
    }
  }

  if (!itemsJson) return { layoutJson: null, roomState };

  restoreFromJson(canvas as any, room as any, itemsJson, onClearSelection);
  return { layoutJson: itemsJson, roomState };
}

export function exportJson(canvas: Canvas, room: Polygon) {
  const itemsJson = serializeState(canvas);
  const roomState: RoomState = { points: getRoomPoints(room) };

  const payload: PlanSnapshot = {
    room: roomState,
    items: safeParseJson(itemsJson) ?? [],
  };

  const blob = new Blob([JSON.stringify(payload)], {
    type: "application/json",
  });
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
  room: Polygon,
  json: string,
  onClearSelection: () => void
) {
  const parsed = safeParseJson<any>(json);

  if (Array.isArray(parsed)) {
    const itemsOnly = JSON.stringify(parsed);
    restoreFromJson(canvas as any, room as any, itemsOnly, onClearSelection);
    localStorage.setItem(STORAGE_KEY, itemsOnly);
    return;
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as any).items)
  ) {
    const maybePoints = (parsed as any)?.room?.points;

    if (isValidRoomPoints(maybePoints)) {
      const roomState: RoomState = { points: maybePoints };
      setRoomPoints(room, roomState.points);
      localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify(roomState));
    }

    const itemsOnly = JSON.stringify((parsed as any).items);
    restoreFromJson(canvas as any, room as any, itemsOnly, onClearSelection);
    localStorage.setItem(STORAGE_KEY, itemsOnly);
    return;
  }

  restoreFromJson(canvas as any, room as any, json, onClearSelection);
  localStorage.setItem(STORAGE_KEY, json);
}
