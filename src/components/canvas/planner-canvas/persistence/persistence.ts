// src/components/canvas/planner-canvas/persistence/persistence.ts
import type { Canvas, Polygon } from "fabric";
import { STORAGE_KEY, STORAGE_ROOM_KEY } from "../core/planner-constants";
import { serializeState, restoreFromJson } from "../history/history";

type RoomPoint = { x: number; y: number };
type RoomStateV3 = { points: RoomPoint[] };

// v4 payload (room points + items that include furniture + openings)
type PlanSnapshotV4 = {
  version: 4;
  room: RoomStateV3;
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

/** Save items + room points to localStorage */
export function saveNow(canvas: Canvas, room: Polygon) {
  const itemsJson = serializeState(canvas);
  localStorage.setItem(STORAGE_KEY, itemsJson);

  const roomState: RoomStateV3 = { points: getRoomPoints(room) };
  localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify(roomState));
}

/** Load items + room points from localStorage */
export function loadNow(
  canvas: Canvas,
  room: Polygon,
  onClearSelection: () => void
): { layoutJson: string | null; roomState: RoomStateV3 | null } {
  const itemsJson = localStorage.getItem(STORAGE_KEY);
  const roomJson = localStorage.getItem(STORAGE_ROOM_KEY);

  let roomState: RoomStateV3 | null = null;

  if (roomJson) {
    const parsed = safeParseJson(roomJson);
    if (
      parsed &&
      Array.isArray((parsed as any).points) &&
      (parsed as any).points.every(
        (p: any) => p && typeof p.x === "number" && typeof p.y === "number"
      ) &&
      (parsed as any).points.length >= 3
    ) {
      roomState = { points: (parsed as any).points };
      setRoomPoints(room, roomState.points);
    }
  }

  if (!itemsJson) return { layoutJson: null, roomState };

  restoreFromJson(canvas as any, room as any, itemsJson, onClearSelection);
  return { layoutJson: itemsJson, roomState };
}

/** Export to file (v4) */
export function exportJson(canvas: Canvas, room: Polygon) {
  const itemsJson = serializeState(canvas);
  const roomState: RoomStateV3 = { points: getRoomPoints(room) };

  const payload: PlanSnapshotV4 = {
    version: 4,
    room: roomState,
    items: safeParseJson(itemsJson) ?? [],
  };

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "planner-layout.json";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

/**
 * Import supports:
 * - v1: [FurnitureSnapshot,...]  (legacy array, furniture only)
 * - v2: {version:2, room:{width,height}, items:[...]}   (legacy, room ignored now)
 * - v3: {version:3, room:{points:[{x,y}...]}, items:[...]} (room points + items; often furniture only)
 * - v4: {version:4, room:{points:[{x,y}...]}, items:[...]} (room points + items includes openings)
 */
export function importJsonString(
  canvas: Canvas,
  room: Polygon,
  json: string,
  onClearSelection: () => void
) {
  const parsed = safeParseJson(json);

  // v1: items array only
  if (Array.isArray(parsed)) {
    const itemsOnly = JSON.stringify(parsed);
    restoreFromJson(canvas as any, room as any, itemsOnly, onClearSelection);
    localStorage.setItem(STORAGE_KEY, itemsOnly);
    return;
  }

  // v2/v3/v4 object
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).items)) {
    const version = Number((parsed as any).version);

    // v3/v4: room points
    if ((version === 3 || version === 4) && (parsed as any).room?.points) {
      const pts = (parsed as any).room.points;
      if (
        Array.isArray(pts) &&
        pts.length >= 3 &&
        pts.every((p: any) => p && typeof p.x === "number" && typeof p.y === "number")
      ) {
        const roomState: RoomStateV3 = { points: pts };
        setRoomPoints(room, roomState.points);
        localStorage.setItem(STORAGE_ROOM_KEY, JSON.stringify(roomState));
      }
    }

    // v2: room width/height (legacy) -> ignored (room is polygon now)

    // items-only JSON (history/history.ts can restore furniture + openings)
    const itemsOnly = JSON.stringify((parsed as any).items);
    restoreFromJson(canvas as any, room as any, itemsOnly, onClearSelection);
    localStorage.setItem(STORAGE_KEY, itemsOnly);
    return;
  }

  // fallback: try restore as raw items array json
  restoreFromJson(canvas as any, room as any, json, onClearSelection);
  localStorage.setItem(STORAGE_KEY, json);
}
