import type { Canvas } from "fabric";

export function createRenderScheduler(canvas: Canvas) {
  let raf: number | null = null;

  return function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      canvas.requestRenderAll();
    });
  };
}
