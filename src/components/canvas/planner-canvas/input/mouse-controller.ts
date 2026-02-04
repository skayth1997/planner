import { Point } from "fabric";
import type { Canvas } from "fabric";

type Args = {
  canvas: Canvas;
  isSpacePressedRef: React.MutableRefObject<boolean>;
  zoom: { min: number; max: number; sensitivity: number };
  scheduleRender: () => void;
  onPanEnd?: () => void;
};

export function attachMouseController(args: Args) {
  const { canvas, isSpacePressedRef, zoom, scheduleRender, onPanEnd } = args;

  let isPanning = false;
  let lastClientX = 0;
  let lastClientY = 0;

  const startPan = (e: any) => {
    isPanning = true;
    lastClientX = e.clientX ?? 0;
    lastClientY = e.clientY ?? 0;

    // during pan, disable group selection box
    canvas.selection = false;
    canvas.defaultCursor = "grab";
    canvas.hoverCursor = "grab";
  };

  const endPan = () => {
    if (!isPanning) return;
    isPanning = false;

    canvas.selection = true;
    canvas.defaultCursor = "default";
    canvas.hoverCursor = "move";

    onPanEnd?.();
    scheduleRender();
  };

  const onMouseDown = (opt: any) => {
    const e = opt.e as MouseEvent;

    // Middle mouse can pan too (nice UX)
    const isMiddle = (e.button ?? 0) === 1;

    if (isSpacePressedRef.current || isMiddle) {
      e.preventDefault();
      startPan(e);
    }
  };

  const onMouseMove = (opt: any) => {
    if (!isPanning) return;

    const e = opt.e as MouseEvent;
    e.preventDefault();

    const cx = e.clientX ?? 0;
    const cy = e.clientY ?? 0;

    const dx = cx - lastClientX;
    const dy = cy - lastClientY;

    lastClientX = cx;
    lastClientY = cy;

    canvas.relativePan(new Point(dx, dy));
    scheduleRender();
  };

  const onMouseUp = () => {
    endPan();
  };

  const onMouseOut = () => {
    // safety: end panning when pointer leaves canvas
    endPan();
  };

  const onWheel = (opt: any) => {
    const e = opt.e as WheelEvent;

    // don’t zoom while actively panning
    if (isPanning) return;

    e.preventDefault();

    const delta = e.deltaY;

    let nextZoom = canvas.getZoom();
    // sensitivity ~ 0.999, use exp-like curve
    nextZoom *= Math.pow(zoom.sensitivity, delta);

    nextZoom = Math.max(zoom.min, Math.min(zoom.max, nextZoom));

    // zoom towards cursor
    const pointer = canvas.getScenePoint(e as any);
    canvas.zoomToPoint(new Point(pointer.x, pointer.y), nextZoom);

    scheduleRender();
  };

  canvas.on("mouse:down", onMouseDown);
  canvas.on("mouse:move", onMouseMove);
  canvas.on("mouse:up", onMouseUp);
  canvas.on("mouse:out", onMouseOut);
  canvas.on("mouse:wheel", onWheel);

  // global safety (mouseup outside canvas)
  const onWindowMouseUp = () => endPan();
  window.addEventListener("mouseup", onWindowMouseUp);

  return () => {
    window.removeEventListener("mouseup", onWindowMouseUp);

    canvas.off("mouse:down", onMouseDown);
    canvas.off("mouse:move", onMouseMove);
    canvas.off("mouse:up", onMouseUp);
    canvas.off("mouse:out", onMouseOut);
    canvas.off("mouse:wheel", onWheel);

    endPan();
  };
}
