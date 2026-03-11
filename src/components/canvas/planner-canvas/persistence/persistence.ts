import type { Canvas } from "fabric";
import { STORAGE_KEY } from "../core/planner-constants";
import { serializeState, restoreFromJson } from "../history/history";
import type { Pt } from "../core/planner-types";

type RoomSnapshot = {
  id: string;
  points: Pt[];
};

type PlanSnapshot = {
  version: 2;
  rooms: RoomSnapshot[];
  items: any[];
};

type RestoreHelpers = {
  clearCanvasState: () => void;
  createRoom: (room: RoomSnapshot) => any;
  getRoomById: (roomId: string) => any | null;
};

function safeParseJson<T = any>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isValidRoomPoints(points: any): points is Pt[] {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.every((p) => p && typeof p.x === "number" && typeof p.y === "number")
  );
}

function isPlanSnapshot(value: any): value is PlanSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray(value.rooms) &&
    Array.isArray(value.items)
  );
}

function normalizeImportedJson(json: string): string {
  const parsed = safeParseJson<any>(json);

  if (Array.isArray(parsed)) {
    return JSON.stringify({
      version: 2,
      rooms: [],
      items: parsed,
    } satisfies PlanSnapshot);
  }

  if (isPlanSnapshot(parsed)) {
    const rooms = parsed.rooms.filter(
      (room: any) =>
        room && typeof room.id === "string" && isValidRoomPoints(room.points)
    );

    return JSON.stringify({
      version: 2,
      rooms,
      items: parsed.items,
    } satisfies PlanSnapshot);
  }

  if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).items)) {
    const maybePoints = (parsed as any)?.room?.points;
    const legacyRooms = isValidRoomPoints(maybePoints)
      ? [{ id: "room-1", points: maybePoints }]
      : [];

    return JSON.stringify({
      version: 2,
      rooms: legacyRooms,
      items: (parsed as any).items,
    } satisfies PlanSnapshot);
  }

  return json;
}

export function saveNow(canvas: Canvas) {
  const planJson = serializeState(canvas);
  localStorage.setItem(STORAGE_KEY, planJson);
}

export function loadNow(
  canvas: Canvas,
  onClearSelection: () => void,
  helpers: RestoreHelpers
): { layoutJson: string | null } {
  const planJson = localStorage.getItem(STORAGE_KEY);
  if (!planJson) return { layoutJson: null };

  restoreFromJson({
    canvas,
    json: planJson,
    clearCanvasState: helpers.clearCanvasState,
    createRoom: helpers.createRoom,
    getRoomById: helpers.getRoomById,
    onClearSelection,
  });

  return { layoutJson: planJson };
}

export function exportJson(canvas: Canvas) {
  const planJson = serializeState(canvas);
  const parsed = safeParseJson<any>(planJson);

  const payload: PlanSnapshot = isPlanSnapshot(parsed)
    ? parsed
    : {
        version: 2,
        rooms: [],
        items: Array.isArray(parsed) ? parsed : [],
      };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
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
  json: string,
  onClearSelection: () => void,
  helpers: RestoreHelpers
) {
  const normalizedJson = normalizeImportedJson(json);

  restoreFromJson({
    canvas,
    json: normalizedJson,
    clearCanvasState: helpers.clearCanvasState,
    createRoom: helpers.createRoom,
    getRoomById: helpers.getRoomById,
    onClearSelection,
  });

  localStorage.setItem(STORAGE_KEY, normalizedJson);
}
