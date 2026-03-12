import type { Canvas } from "fabric";
import type { Pt } from "../core/planner-types";
import {
  applyAxisLock,
  getCloseTarget,
  getPointerPoint,
} from "./room-draw-geometry";
import {
  clearAllPreview,
  createRoomDrawPreviewState,
  renderCursorPreview,
  renderWallPreview,
} from "./room-draw-preview";

export function createRoomDrawController(args: {
  canvas: Canvas;
  getGridSize: () => number;
  onFinish?: (points: Pt[]) => void;
  onCancel?: () => void;
  onDrawingChange?: (points: Pt[]) => void;
  scheduleRender?: () => void;
}) {
  const {
    canvas,
    getGridSize,
    onFinish,
    onCancel,
    onDrawingChange,
    scheduleRender,
  } = args;

  let isDrawing = false;
  let drawPoints: Pt[] = [];
  let lastMouse: Pt | null = null;
  let isShiftPressed = false;

  const preview = createRoomDrawPreviewState();

  const emitDrawingChange = () => {
    onDrawingChange?.([...drawPoints]);
  };

  const renderPreview = (mouse?: Pt) => {
    renderWallPreview({
      canvas,
      state: preview,
      points: drawPoints,
      mouse,
      getCloseTarget: (point) => getCloseTarget(drawPoints, point),
    });

    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const finish = (forceClosed = false) => {
    if (drawPoints.length < 3) return;

    const result = [...drawPoints];

    if (forceClosed) {
      const first = result[0];
      const last = result[result.length - 1];

      if (first.x !== last.x || first.y !== last.y) {
        result.push({ ...first });
      }
    }

    clearAllPreview(canvas, preview);

    drawPoints = [];
    lastMouse = null;
    isShiftPressed = false;

    stop();
    onFinish?.(result);
    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const cancel = () => {
    clearAllPreview(canvas, preview);

    drawPoints = [];
    lastMouse = null;
    isShiftPressed = false;

    stop();
    onCancel?.();
    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const onMouseMove = (opt: any) => {
    if (!isDrawing) return;

    const raw = getPointerPoint(canvas, opt, getGridSize);
    if (!raw) return;

    const next = applyAxisLock({
      point: raw,
      points: drawPoints,
      isShiftPressed,
    });

    lastMouse = next;

    renderCursorPreview({
      canvas,
      state: preview,
      mouse: next,
    });

    renderPreview(next);
  };

  const onMouseDown = (opt: any) => {
    if (!isDrawing) return;

    const raw = getPointerPoint(canvas, opt, getGridSize);
    if (!raw) return;

    const point = applyAxisLock({
      point: raw,
      points: drawPoints,
      isShiftPressed,
    });

    const last = drawPoints[drawPoints.length - 1];
    const closeTarget = getCloseTarget(drawPoints, point);

    if (closeTarget) {
      finish(true);
      return;
    }

    if (last && last.x === point.x && last.y === point.y) {
      return;
    }

    drawPoints.push(point);
    emitDrawingChange();
    renderPreview(lastMouse ?? point);
  };

  const onDblClick = () => {
    if (!isDrawing) return;
    finish(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isDrawing) return;

    if (e.key === "Shift") {
      isShiftPressed = true;

      if (lastMouse) {
        const locked = applyAxisLock({
          point: lastMouse,
          points: drawPoints,
          isShiftPressed: true,
        });

        lastMouse = locked;

        renderCursorPreview({
          canvas,
          state: preview,
          mouse: locked,
        });

        renderPreview(locked);
      }

      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      finish(false);
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      drawPoints.pop();
      emitDrawingChange();
      renderPreview(lastMouse ?? undefined);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!isDrawing) return;

    if (e.key === "Shift") {
      isShiftPressed = false;

      if (lastMouse) {
        renderCursorPreview({
          canvas,
          state: preview,
          mouse: lastMouse,
        });

        renderPreview(lastMouse);
      }
    }
  };

  const prevSelection = canvas.selection;
  const prevSkipTargetFind = (canvas as any).skipTargetFind;

  let previousInteractiveState = new Map<
    any,
    { selectable: boolean; evented: boolean }
  >();

  const start = () => {
    if (isDrawing) return;

    isDrawing = true;
    drawPoints = [];
    lastMouse = null;
    isShiftPressed = false;
    previousInteractiveState = new Map();

    canvas.discardActiveObject();
    canvas.selection = false;
    (canvas as any).skipTargetFind = true;

    canvas.forEachObject((obj: any) => {
      previousInteractiveState.set(obj, {
        selectable: !!obj.selectable,
        evented: !!obj.evented,
      });

      obj.selectable = false;
      obj.evented = false;
    });

    canvas.on("mouse:down", onMouseDown);
    canvas.on("mouse:move", onMouseMove);
    canvas.on("mouse:dblclick", onDblClick);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    renderPreview();
  };

  const stop = () => {
    if (!isDrawing) return;

    isDrawing = false;

    canvas.off("mouse:down", onMouseDown);
    canvas.off("mouse:move", onMouseMove);
    canvas.off("mouse:dblclick", onDblClick);

    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);

    canvas.selection = prevSelection ?? true;
    (canvas as any).skipTargetFind = prevSkipTargetFind ?? false;

    canvas.forEachObject((obj: any) => {
      const prev = previousInteractiveState.get(obj);
      if (!prev) return;

      obj.selectable = prev.selectable;
      obj.evented = prev.evented;
    });

    previousInteractiveState.clear();

    clearAllPreview(canvas, preview);
    lastMouse = null;
    isShiftPressed = false;

    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const isActive = () => isDrawing;

  return {
    start,
    stop,
    isActive,
    finish,
    cancel,
  };
}
