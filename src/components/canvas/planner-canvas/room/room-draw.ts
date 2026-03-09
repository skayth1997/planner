import type { Canvas, Polygon, Circle, Line } from "fabric";
import { Circle as FabricCircle, Line as FabricLine, util } from "fabric";
import type { Pt } from "../core/planner-types";
import { setRoomPoints, syncHandlesToRoom } from "./room-walls";

export function createRoomDrawController(args: {
  canvas: Canvas;
  room: Polygon;
  handlesRef: React.MutableRefObject<Circle[]>;
  getGridSize: () => number;
  onRoomChanging?: () => void;
  onRoomChanged?: () => void;
  scheduleRender?: () => void;
}) {
  const {
    canvas,
    room,
    handlesRef,
    getGridSize,
    onRoomChanging,
    onRoomChanged,
    scheduleRender,
  } = args;

  let active = false;
  let pts: Pt[] = [];

  let previewLine: Line | null = null;
  let previewDots: FabricCircle[] = [];

  const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

  const getPointerPt = (opt: any): Pt | null => {
    const p =
      opt?.absolutePointer ??
      opt?.pointer ??
      opt?.scenePoint ??
      null;

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

  let previewLines: FabricLine[] = [];
  let lastMouse: Pt | null = null;

  const clearPreview = () => {
    for (const ln of previewLines) canvas.remove(ln);
    previewLines = [];

    for (const d of previewDots) canvas.remove(d);
    previewDots = [];
  };

  const renderPreview = (mouse?: Pt) => {
    clearPreview();

    previewDots = pts.map((p) => {
      const c = new FabricCircle({
        left: p.x,
        top: p.y,
        radius: 5,
        fill: "#2563eb",
        stroke: "#ffffff",
        strokeWidth: 2,
        originX: "center",
        originY: "center",
        selectable: false,
        evented: false,
        objectCaching: false,
        excludeFromExport: true,
      });
      (c as any).data = { kind: "room-preview-dot" };
      canvas.add(c);
      canvas.bringObjectToFront(c);
      return c;
    });

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];

      const ln = new FabricLine([a.x, a.y, b.x, b.y], {
        stroke: "rgba(37,99,235,0.9)",
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

    if (pts.length > 0 && mouse) {
      const last = pts[pts.length - 1];
      const ln = new FabricLine([last.x, last.y, mouse.x, mouse.y], {
        stroke: "rgba(37,99,235,0.9)",
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

  const finish = () => {
    if (pts.length < 3) return;

    setRoomPoints(room, pts);
    room.setCoords();

    syncHandlesToRoom(handlesRef.current as any, room);

    clearPreview();
    pts = [];

    onRoomChanged?.();
    scheduleRender?.() ?? canvas.requestRenderAll();
    stop();
  };

  const cancel = () => {
    clearPreview();
    pts = [];
    scheduleRender?.() ?? canvas.requestRenderAll();
    stop();
  };


  const onMouseMove = (opt: any) => {
    if (!active) return;
    const p = getPointerPt(opt);
    if (!p) return;
    lastMouse = p;
    renderPreview(p);
  };

  const onMouseDown = (opt: any) => {
    if (!active) return;
    const p = getPointerPt(opt);
    if (!p) return;

    const last = pts[pts.length - 1];
    if (last && last.x === p.x && last.y === p.y) return;

    pts.push(p);

    onRoomChanging?.();
    renderPreview(lastMouse ?? p); // <-- key
  };

  const onDblClick = () => {
    if (!active) return;
    finish();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!active) return;

    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }

    if (e.key === "Enter") {
      e.preventDefault();
      finish();
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      pts.pop();
      onRoomChanging?.();
      renderPreview();
    }
  };

  const prevSelection = canvas.selection;
  const prevSkipTargetFind = (canvas as any).skipTargetFind;

  let prevRoomSelectable = room.selectable;
  let prevRoomEvented = (room as any).evented;

  const start = () => {
    if (active) return;
    active = true;

    canvas.discardActiveObject();

    canvas.selection = false;
    (canvas as any).skipTargetFind = true; // 🔥 key for drawing

    // also disable room itself, otherwise Fabric still tries to target it
    room.selectable = false;
    (room as any).evented = false;

    // disable everything else
    canvas.forEachObject((o: any) => {
      if (o === room) return;
      o.selectable = false;
      o.evented = false;
    });

    canvas.on("mouse:down", onMouseDown);
    canvas.on("mouse:move", onMouseMove);
    canvas.on("mouse:dblclick", onDblClick);

    window.addEventListener("keydown", onKeyDown);

    renderPreview();
  };

  const stop = () => {
    if (!active) return;
    active = false;

    canvas.off("mouse:down", onMouseDown);
    canvas.off("mouse:move", onMouseMove);
    canvas.off("mouse:dblclick", onDblClick);

    window.removeEventListener("keydown", onKeyDown);

    canvas.selection = prevSelection ?? true;
    (canvas as any).skipTargetFind = prevSkipTargetFind ?? false;

    room.selectable = prevRoomSelectable ?? true;
    (room as any).evented = prevRoomEvented ?? true;

    canvas.forEachObject((o: any) => {
      if (o === room) return;

      o.selectable = true;
      o.evented = true;
    });

    clearPreview();
    scheduleRender?.() ?? canvas.requestRenderAll();
  };
  const isActive = () => active;

  return { start, stop, isActive };
}
