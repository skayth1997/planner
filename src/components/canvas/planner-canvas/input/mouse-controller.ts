// src/components/canvas/planner-canvas/mouse-controller.ts
import type { Canvas } from "fabric";

type BoolRef = { current: boolean };

type AttachMouseArgs = {
  canvas: Canvas;

  // key state (Space => pan)
  isSpacePressedRef: BoolRef;

  // zoom config
  zoom: {
    min: number;
    max: number;
    sensitivity: number;
  };

  // rendering
  scheduleRender: () => void;

  // optional hooks
  onPanStart?: () => void;
  onPanEnd?: () => void;
};

export function attachMouseController(args: AttachMouseArgs) {
  const { canvas, isSpacePressedRef, zoom, scheduleRender, onPanStart, onPanEnd } =
    args;

  // ===== Zoom (wheel) =====
  const onWheel = (opt: any) => {
    const event = opt.e as WheelEvent;

    let z = canvas.getZoom();
    z *= zoom.sensitivity ** event.deltaY;
    z = Math.min(zoom.max, Math.max(zoom.min, z));

    canvas.zoomToPoint({ x: event.offsetX, y: event.offsetY }, z);

    event.preventDefault();
    event.stopPropagation();
    scheduleRender();
  };

  canvas.on("mouse:wheel", onWheel);

  // ===== Pan (hold Space) =====
  let isPanning = false;
  let lastClientX = 0;
  let lastClientY = 0;

  const onMouseDown = (opt: any) => {
    if (!isSpacePressedRef.current) return;

    const e = opt.e as MouseEvent;
    isPanning = true;

    // while panning we disable selection to avoid accidental marquee selection
    canvas.selection = false;
    canvas.defaultCursor = "grabbing";

    lastClientX = e.clientX;
    lastClientY = e.clientY;

    onPanStart?.();
  };

  const onMouseMove = (opt: any) => {
    if (!isPanning) return;

    const e = opt.e as MouseEvent;
    const vpt = canvas.viewportTransform!;
    vpt[4] += e.clientX - lastClientX;
    vpt[5] += e.clientY - lastClientY;

    lastClientX = e.clientX;
    lastClientY = e.clientY;

    scheduleRender();
  };

  const onMouseUp = () => {
    if (!isPanning) return;

    isPanning = false;
    canvas.selection = true;
    canvas.defaultCursor = "default";

    onPanEnd?.();
    scheduleRender();
  };

  canvas.on("mouse:down", onMouseDown);
  canvas.on("mouse:move", onMouseMove);
  canvas.on("mouse:up", onMouseUp);

  // cleanup
  return () => {
    canvas.off("mouse:wheel", onWheel);
    canvas.off("mouse:down", onMouseDown);
    canvas.off("mouse:move", onMouseMove);
    canvas.off("mouse:up", onMouseUp);
  };
}
