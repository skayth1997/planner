import { Rect, Line, Canvas } from "fabric";
import { GRID_SIZE } from "./planner-constants";

export function drawRoom(canvas: Canvas) {
  const strokeWidth = 3;
  const width = 600 - strokeWidth;
  const height = 400 - strokeWidth;

  const room = new Rect({
    left: 200,
    top: 150,
    width,
    height,
    fill: "rgba(59,130,246,0.15)",
    stroke: "#3b82f6",
    strokeWidth,
    selectable: false,
    evented: false,
  });

  canvas.add(room);
  return room;
}

export function drawGrid(canvas: Canvas, room: Rect, gridSize = GRID_SIZE) {
  const roomRect = room.getBoundingRect();
  const stroke = room.strokeWidth ?? 0;
  const inset = stroke / 2;

  const left = roomRect.left + inset;
  const top = roomRect.top + inset;
  const right = roomRect.left + roomRect.width - inset;
  const bottom = roomRect.top + roomRect.height - inset;

  for (let x = left; x <= right; x += gridSize) {
    canvas.add(
      new Line([x, top, x, bottom], {
        stroke: "#d1d5db",
        selectable: false,
        evented: false,
        excludeFromExport: true,
      })
    );
  }

  for (let y = top; y <= bottom; y += gridSize) {
    canvas.add(
      new Line([left, y, right, y], {
        stroke: "#d1d5db",
        selectable: false,
        evented: false,
        excludeFromExport: true,
      })
    );
  }
}
