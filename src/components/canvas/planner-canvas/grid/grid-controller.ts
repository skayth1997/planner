import {
  Line as FabricLine,
  Polygon as FabricPolygon,
  Point,
  util,
} from "fabric";
import type { Canvas, Line, Polygon, Circle } from "fabric";
import { getRoomPoints } from "@/components/canvas/planner-canvas/room/room-walls";

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

function getRoomAbsolutePoints(room: Polygon) {
  const pts = (room.points ?? []) as Array<{ x: number; y: number }>;
  const pathOffset = room.pathOffset ?? new Point(0, 0);
  const matrix = room.calcTransformMatrix();

  return pts.map((p) => {
    const local = new Point(
      (Number(p.x) || 0) - pathOffset.x,
      (Number(p.y) || 0) - pathOffset.y
    );

    const absolute = util.transformPoint(local, matrix);

    return {
      x: absolute.x,
      y: absolute.y,
    };
  });
}

function createRoomClipPath(room: Polygon) {
  return new FabricPolygon(getRoomPoints(room) as any, {
    absolutePositioned: true,
    selectable: false,
    evented: false,
    objectCaching: false,
  });
}

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
    const l = (new FabricLine([x, top, x, bottom], {
      stroke: "#d1d5db",
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
    }) as unknown) as Line;

    (l as any).clipPath = createRoomClipPath(room);
    (l as any).data = { kind: "grid-line" };

    canvas.add(l as any);
    lines.push(l);
  }

  for (let y = top; y <= bottom; y += gridSize) {
    const l = (new FabricLine([left, y, right, y], {
      stroke: "#d1d5db",
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
    }) as unknown) as Line;

    (l as any).clipPath = createRoomClipPath(room);
    (l as any).data = { kind: "grid-line" };

    canvas.add(l as any);
    lines.push(l);
  }

  return lines;
}

export function createGridController(args: Args) {
  const { canvas, roomRef, roomHandlesRef, scheduleRender, initial } = args;

  let visible = initial.visible;
  let size = initial.size;
  let lines: Line[] = [];

  const restack = () => {
    const room = roomRef.current;
    if (!room) return;

    for (const l of lines) {
      canvas.sendObjectToBack(l as any);
    }

    canvas.bringObjectToFront(room as any);

    canvas.getObjects().forEach((o: any) => {
      if (o?.data?.kind === "opening") canvas.bringObjectToFront(o);
    });

    canvas.getObjects().forEach((o: any) => {
      if (o?.data?.kind === "furniture") canvas.bringObjectToFront(o);
    });

    for (const h of roomHandlesRef.current) {
      canvas.bringObjectToFront(h as any);
    }
  };

  const clearLines = () => {
    for (const l of lines) {
      canvas.remove(l as any);
    }
    lines = [];
  };

  const rebuild = () => {
    const room = roomRef.current;
    if (!room) return;

    clearLines();

    if (visible) {
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
