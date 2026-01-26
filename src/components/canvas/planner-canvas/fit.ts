import type { Canvas, Rect } from "fabric";

export function fitRoomToView(canvas: Canvas, room: Rect, padding = 40) {
  const roomRect = room.getBoundingRect();

  const viewWidth = canvas.getWidth();
  const viewHeight = canvas.getHeight();

  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

  const scaleX = (viewWidth - padding * 2) / roomRect.width;
  const scaleY = (viewHeight - padding * 2) / roomRect.height;

  const zoom = Math.min(scaleX, scaleY, 1);
  canvas.setZoom(zoom);

  const vpt = canvas.viewportTransform!;
  const roomCenterX = roomRect.left + roomRect.width / 2;
  const roomCenterY = roomRect.top + roomRect.height / 2;

  vpt[4] = viewWidth / 2 - roomCenterX * zoom;
  vpt[5] = viewHeight / 2 - roomCenterY * zoom;

  canvas.setViewportTransform(vpt);
  canvas.requestRenderAll();
}
