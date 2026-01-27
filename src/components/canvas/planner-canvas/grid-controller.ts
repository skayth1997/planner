import type { Canvas, Line, Polygon, Circle } from "fabric";

type RoomRef = { current: Polygon | null };
type HandlesRef = { current: Circle[] };

type Args = {
  canvas: Canvas;
  roomRef: RoomRef;
  roomHandlesRef: HandlesRef;
  scheduleRender: () => void;
  initial: {
    visible: boolean;
    size: number;
  };
};

function drawGridLines(canvas: Canvas, room: Polygon, gridSize: number) {
  const lines: Line[] = [];

  const roomRect = room.getBoundingRect();
  const stroke = (room as any).strokeWidth ?? 0;
  const inset = stroke / 2;

  const left = roomRect.left + inset;
  const top = roomRect.top + inset;
  const right = roomRect.left + roomRect.width - inset;
  const bottom = roomRect.top + roomRect.height - inset;

  for (let x = left; x <= right; x += gridSize) {
    const l: any = new (window as any).fabric.Line([x, top, x, bottom], {
      stroke: "#d1d5db",
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });
    canvas.add(l);
    lines.push(l);
  }

  for (let y = top; y <= bottom; y += gridSize) {
    const l: any = new (window as any).fabric.Line([left, y, right, y], {
      stroke: "#d1d5db",
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });
    canvas.add(l);
    lines.push(l);
  }

  return lines;
}

/**
 * Grid controller:
 * - owns grid lines
 * - rebuilds grid based on current room bbox
 * - manages stacking (room below furniture, grid below room, handles on top)
 */
export function createGridController(args: Args) {
  const { canvas, roomRef, roomHandlesRef, scheduleRender, initial } = args;

  let visible = initial.visible;
  let size = initial.size;
  let lines: Line[] = [];

  const restack = () => {
    const room = roomRef.current;
    if (!room) return;

    // room below furniture
    canvas.sendObjectToBack(room as any);

    // grid below room
    for (const l of lines) canvas.sendObjectToBack(l as any);

    // handles above everything
    for (const h of roomHandlesRef.current) canvas.bringObjectToFront(h as any);
  };

  const clearLines = () => {
    for (const l of lines) canvas.remove(l as any);
    lines = [];
  };

  const rebuild = () => {
    const room = roomRef.current;
    if (!room) return;

    clearLines();

    if (visible) {
      // NOTE: fabric Line class is available, but in some setups you may only have it on window.fabric
      // This draw uses window.fabric.Line to be robust in Next client env.
      lines = drawGridLines(canvas, room, size);
    }

    restack();
    scheduleRender();
  };

  const setVisible = (v: boolean) => {
    visible = !!v;
    rebuild();
  };

  const setSize = (next: number) => {
    const n = Number(next);
    if (!Number.isFinite(n) || n <= 5) return;
    size = n;
    rebuild();
  };

  const getSize = () => size;
  const isVisible = () => visible;

  const dispose = () => {
    clearLines();
  };

  return {
    rebuild,
    setVisible,
    setSize,
    getSize,
    isVisible,
    restack,
    dispose,
  };
}
