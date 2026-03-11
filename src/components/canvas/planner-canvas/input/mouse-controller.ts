import { Point } from "fabric";
import type { Canvas } from "fabric";

type Args = {
  canvas: Canvas;
  isSpacePressedRef: React.MutableRefObject<boolean>;
  zoom: { min: number; max: number; sensitivity: number };
  scheduleRender: () => void;
  onPanEnd?: () => void;
  onViewportChange?: () => void;
  canDragPan?: () => boolean;
};

export function attachMouseController(args: Args) {
  const {
    canvas,
    isSpacePressedRef,
    zoom,
    scheduleRender,
    onPanEnd,
    onViewportChange,
    canDragPan,
  } = args;

  let isPanning = false;
  let lastClientX = 0;
  let lastClientY = 0;

  const startPan = (e: MouseEvent) => {
    isPanning = true;
    lastClientX = e.clientX ?? 0;
    lastClientY = e.clientY ?? 0;

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
    const button = e.button ?? 0;
    const isMiddle = button === 1;
    const isLeft = button === 0;

    if (isMiddle || isSpacePressedRef.current) {
      e.preventDefault();
      startPan(e);
      return;
    }

    if (isLeft && (canDragPan?.() ?? true)) {
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
    onViewportChange?.();
    scheduleRender();
  };

  const onMouseUp = () => {
    endPan();
  };

  const onMouseOut = () => {
    endPan();
  };

  const onWheel = (opt: any) => {
    const e = opt.e as WheelEvent;
    if (isPanning) return;

    e.preventDefault();
    e.stopPropagation();

    const upperCanvas = canvas.upperCanvasEl;
    const rect = upperCanvas.getBoundingClientRect();

    const pointer = new Point(e.clientX - rect.left, e.clientY - rect.top);

    const currentZoom = canvas.getZoom();

    let nextZoom = currentZoom * Math.pow(zoom.sensitivity, e.deltaY);
    nextZoom = Math.max(zoom.min, Math.min(zoom.max, nextZoom));

    if (nextZoom === currentZoom) return;

    canvas.zoomToPoint(pointer, nextZoom);
    onViewportChange?.();
    scheduleRender();
  };

  canvas.on("mouse:down", onMouseDown);
  canvas.on("mouse:move", onMouseMove);
  canvas.on("mouse:up", onMouseUp);
  canvas.on("mouse:out", onMouseOut);
  canvas.on("mouse:wheel", onWheel);

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
