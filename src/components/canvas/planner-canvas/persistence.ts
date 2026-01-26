import type { Canvas, Rect } from "fabric";
import { STORAGE_KEY } from "./planner-constants";
import { serializeState, restoreFromJson } from "./history";

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
  restoreFromJson(canvas, room, json, onClearSelection);
  localStorage.setItem(STORAGE_KEY, json);
}
