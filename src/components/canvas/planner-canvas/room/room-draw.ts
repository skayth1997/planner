import type { Canvas, Line } from "fabric";
import { Circle as FabricCircle, Line as FabricLine, util } from "fabric";
import type { Pt } from "../core/planner-types";

const CLOSE_DISTANCE = 16;

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

  let active = false;
  let pts: Pt[] = [];

  let previewDots: FabricCircle[] = [];
  let previewLines: FabricLine[] = [];
  let lastMouse: Pt | null = null;
  let isShiftPressed = false;

  const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

  const getPointerPt = (opt: any): Pt | null => {
    const p = opt?.absolutePointer ?? opt?.pointer ?? opt?.scenePoint ?? null;

    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      const g = Math.max(1, getGridSize());
      return { x: snap(p.x, g), y: snap(p.y, g) };
    }

    const vp = opt?.viewportPoint;
    if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y)) {
      const vt = (canvas as any).viewportTransform;
      if (vt && util?.invertTransform && util?.transformPoint) {
        const inv = util.invertTransform(vt);
        const sp = util.transformPoint(vp, inv);
        const g = Math.max(1, getGridSize());
        return { x: snap(sp.x, g), y: snap(sp.y, g) };
      }
    }

    if (typeof (canvas as any).getPointer === "function") {
      const pp = (canvas as any).getPointer(opt?.e);
      if (pp && Number.isFinite(pp.x) && Number.isFinite(pp.y)) {
        const g = Math.max(1, getGridSize());
        return { x: snap(pp.x, g), y: snap(pp.y, g) };
      }
    }

    return null;
  };

  const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

  const applyAxisLock = (next: Pt): Pt => {
    if (!isShiftPressed || pts.length === 0) return next;

    const prev = pts[pts.length - 1];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: next.x, y: prev.y };
    }

    return { x: prev.x, y: next.y };
  };

  const getCloseTarget = (p: Pt): Pt | null => {
    if (pts.length < 3) return null;

    const first = pts[0];
    if (distance(first, p) <= CLOSE_DISTANCE) return first;

    return null;
  };

  const removeAllPreviewArtifacts = () => {
    const objects = canvas.getObjects().slice();

    for (const obj of objects as any[]) {
      const kind = obj?.data?.kind;

      if (
        kind === "room-preview-dot" ||
        kind === "room-preview-edge" ||
        kind === "room-preview-live" ||
        kind === "room-preview-close-dot"
      ) {
        canvas.remove(obj);
      }
    }
  };

  const clearPreview = () => {
    for (const ln of previewLines) {
      canvas.remove(ln);
    }
    previewLines = [];

    for (const d of previewDots) {
      canvas.remove(d);
    }
    previewDots = [];

    removeAllPreviewArtifacts();
  };

  const emitDrawingChange = () => {
    onDrawingChange?.([...pts]);
  };

  const renderPreview = (mouse?: Pt) => {
    clearPreview();

    const closeTarget = mouse ? getCloseTarget(mouse) : null;
    const liveMouse = closeTarget ?? mouse ?? null;

    previewDots = pts.map((p, index) => {
      const isFirst = index === 0;
      const shouldHighlightAsClose =
        !!closeTarget && isFirst && pts.length >= 3;

      const c = new FabricCircle({
        left: p.x,
        top: p.y,
        radius: shouldHighlightAsClose ? 7 : 5,
        fill: shouldHighlightAsClose ? "#16a34a" : "#2563eb",
        stroke: "#ffffff",
        strokeWidth: 2,
        originX: "center",
        originY: "center",
        selectable: false,
        evented: false,
        objectCaching: false,
        excludeFromExport: true,
      });

      (c as any).data = {
        kind: shouldHighlightAsClose
          ? "room-preview-close-dot"
          : "room-preview-dot",
      };

      canvas.add(c);
      canvas.bringObjectToFront(c);
      return c;
    });

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];

      const ln = new FabricLine([a.x, a.y, b.x, b.y], {
        stroke: "rgba(37,99,235,0.95)",
        strokeWidth: 2,
        selectable: false,
        evented: false,
        objectCaching: false,
        excludeFromExport: true,
      });

      (ln as any).data = { kind: "room-preview-edge" };

      canvas.add(ln);
      canvas.bringObjectToFront(ln);
      previewLines.push(ln);
    }

    if (pts.length > 0 && liveMouse) {
      const last = pts[pts.length - 1];
      const ln = new FabricLine([last.x, last.y, liveMouse.x, liveMouse.y], {
        stroke: closeTarget ? "rgba(22,163,74,0.95)" : "rgba(37,99,235,0.95)",
        strokeWidth: 2,
        selectable: false,
        evented: false,
        objectCaching: false,
        excludeFromExport: true,
      });

      (ln as any).data = { kind: "room-preview-live" };

      canvas.add(ln);
      canvas.bringObjectToFront(ln);
      previewLines.push(ln);
    }

    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const finish = (forceClosed = false) => {
    if (pts.length < 3) return;

    const result = [...pts];

    if (forceClosed) {
      const first = result[0];
      const last = result[result.length - 1];

      if (first.x !== last.x || first.y !== last.y) {
        result.push({ ...first });
      }
    }

    clearPreview();
    removeAllPreviewArtifacts();

    pts = [];
    lastMouse = null;
    isShiftPressed = false;

    stop();
    onFinish?.(result);
    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const cancel = () => {
    clearPreview();
    removeAllPreviewArtifacts();

    pts = [];
    lastMouse = null;
    isShiftPressed = false;

    stop();
    onCancel?.();
    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const onMouseMove = (opt: any) => {
    if (!active) return;

    const raw = getPointerPt(opt);
    if (!raw) return;

    const next = applyAxisLock(raw);
    lastMouse = next;
    renderPreview(next);
  };

  const onMouseDown = (opt: any) => {
    if (!active) return;

    const raw = getPointerPt(opt);
    if (!raw) return;

    const p = applyAxisLock(raw);
    const last = pts[pts.length - 1];

    const closeTarget = getCloseTarget(p);
    if (closeTarget) {
      finish(true);
      return;
    }

    if (last && last.x === p.x && last.y === p.y) return;

    pts.push(p);
    emitDrawingChange();
    renderPreview(lastMouse ?? p);
  };

  const onDblClick = () => {
    if (!active) return;
    finish(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!active) return;

    if (e.key === "Shift") {
      isShiftPressed = true;
      if (lastMouse) {
        const locked = applyAxisLock(lastMouse);
        lastMouse = locked;
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
      pts.pop();
      emitDrawingChange();
      renderPreview(lastMouse ?? undefined);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!active) return;

    if (e.key === "Shift") {
      isShiftPressed = false;
      if (lastMouse) {
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
    if (active) return;
    active = true;

    pts = [];
    lastMouse = null;
    isShiftPressed = false;
    previousInteractiveState = new Map();

    canvas.discardActiveObject();

    canvas.selection = false;
    (canvas as any).skipTargetFind = true;

    canvas.forEachObject((o: any) => {
      previousInteractiveState.set(o, {
        selectable: !!o.selectable,
        evented: !!o.evented,
      });

      o.selectable = false;
      o.evented = false;
    });

    canvas.on("mouse:down", onMouseDown);
    canvas.on("mouse:move", onMouseMove);
    canvas.on("mouse:dblclick", onDblClick);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    renderPreview();
  };

  const stop = () => {
    if (!active) return;
    active = false;

    canvas.off("mouse:down", onMouseDown);
    canvas.off("mouse:move", onMouseMove);
    canvas.off("mouse:dblclick", onDblClick);

    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);

    canvas.selection = prevSelection ?? true;
    (canvas as any).skipTargetFind = prevSkipTargetFind ?? false;

    canvas.forEachObject((o: any) => {
      const prev = previousInteractiveState.get(o);
      if (!prev) return;

      o.selectable = prev.selectable;
      o.evented = prev.evented;
    });

    previousInteractiveState.clear();

    clearPreview();
    removeAllPreviewArtifacts();
    lastMouse = null;
    isShiftPressed = false;

    scheduleRender?.() ?? canvas.requestRenderAll();
  };

  const isActive = () => active;

  return {
    start,
    stop,
    isActive,
    finish,
    cancel,
  };
}
