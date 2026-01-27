import type { Canvas, Rect } from "fabric";
import { STORAGE_KEY } from "./planner-constants";
import { serializeState, restoreFromJson } from "./history";

function isValidLayoutJson(json: string): boolean {
  try {
    const data = JSON.parse(json);
    return Array.isArray(data);
  } catch {
    return false;
  }
}

export function saveNow(canvas: Canvas) {
  const json = serializeState(canvas);
  localStorage.setItem(STORAGE_KEY, json);
}

export function loadNow(
  canvas: Canvas,
  room: Rect,
  onClearSelection: () => void
) {
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) return null;

  // If storage somehow got corrupted, don't crash
  if (!isValidLayoutJson(json)) {
    console.warn("Invalid saved layout JSON in localStorage");
    return null;
  }

  restoreFromJson(canvas, room, json, onClearSelection);
  return json;
}

export function exportJson(canvas: Canvas) {
  const json = serializeState(canvas);

  const blob = new Blob([json], { type: "application/json" });
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
  const trimmed = json.trim();
  if (!trimmed) {
    alert("Paste JSON first.");
    return { ok: false as const, error: "empty" as const };
  }

  if (!isValidLayoutJson(trimmed)) {
    alert(
      "Invalid JSON. It must be an array of items exported from the planner."
    );
    return { ok: false as const, error: "invalid_json" as const };
  }

  restoreFromJson(canvas, room, trimmed, onClearSelection);
  localStorage.setItem(STORAGE_KEY, trimmed);

  return { ok: true as const };
}
