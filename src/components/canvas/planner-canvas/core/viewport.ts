import type { Canvas, Polygon } from "fabric";
import { getRoomAbsoluteBounds } from "../room/room-geometry";

export function fitObjectsToView(
  canvas: Canvas,
  objects: Polygon[],
  padding = 40
) {
  if (!objects.length) return;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const obj of objects) {
    const r = getRoomAbsoluteBounds(obj);

    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }

  const contentWidth = Math.max(1, right - left);
  const contentHeight = Math.max(1, bottom - top);

  const viewWidth = canvas.getWidth();
  const viewHeight = canvas.getHeight();

  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

  const scaleX = (viewWidth - padding * 2) / contentWidth;
  const scaleY = (viewHeight - padding * 2) / contentHeight;

  const zoom = Math.min(scaleX, scaleY, 1);

  canvas.setZoom(zoom);

  const vpt = canvas.viewportTransform!;

  const centerX = left + contentWidth / 2;
  const centerY = top + contentHeight / 2;

  vpt[4] = viewWidth / 2 - centerX * zoom;
  vpt[5] = viewHeight / 2 - centerY * zoom;

  canvas.setViewportTransform(vpt);
  canvas.requestRenderAll();
}
