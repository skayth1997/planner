import { Polygon, Circle, Canvas, Point } from "fabric";
import type { RoomId } from "../core/planner-types";

export type RoomPoint = { x: number; y: number };

export type RoomRuntime = {
  id: RoomId;
  polygon: Polygon;
  handles: Circle[];
};

function snap(v: number, grid: number) {
  return Math.round(v / grid) * grid;
}

function normalizeRoomPoints(points: RoomPoint[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const localPoints = points.map((p) => ({
    x: p.x - minX,
    y: p.y - minY,
  }));

  return {
    left: minX,
    top: minY,
    width,
    height,
    localPoints,
  };
}

function createOneCornerHandle(
  canvas: Canvas,
  p: RoomPoint,
  idx: number,
  roomId?: RoomId
) {
  const c = new Circle({
    left: p.x,
    top: p.y,
    radius: 7,
    fill: "#2563eb",
    stroke: "#ffffff",
    strokeWidth: 2,
    originX: "center",
    originY: "center",
    selectable: true,
    evented: true,
    hasControls: false,
    hasBorders: false,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    transparentCorners: false,
    objectCaching: false,
    hoverCursor: "pointer",
  });

  (c as any).data = {
    kind: "room-handle",
    index: idx,
    roomId,
  };

  canvas.add(c);
  canvas.bringObjectToFront(c);

  return c;
}

export function createRoomPolygon(
  canvas: Canvas,
  options?: {
    id?: RoomId;
    points?: RoomPoint[];
    fill?: string;
    stroke?: string;
  }
) {
  const absolutePoints: RoomPoint[] = options?.points ?? [
    { x: 200, y: 150 },
    { x: 800, y: 150 },
    { x: 800, y: 550 },
    { x: 200, y: 550 },
  ];

  const { left, top, width, height, localPoints } = normalizeRoomPoints(
    absolutePoints
  );

  const room = new Polygon(localPoints as any, {
    left,
    top,
    originX: "left",
    originY: "top",
    width,
    height,
    pathOffset: new Point(width / 2, height / 2),

    fill: options?.fill ?? "rgba(59,130,246,0.15)",
    stroke: options?.stroke ?? "#3b82f6",
    strokeWidth: 3,
    selectable: false,
    evented: false,
    objectCaching: false,
    perPixelTargetFind: false,
  });

  (room as any).data = {
    kind: "room",
    id: options?.id,
  };

  canvas.add(room);
  return room;
}

export function createRoomRuntime(
  canvas: Canvas,
  options: {
    id: RoomId;
    points?: RoomPoint[];
    fill?: string;
    stroke?: string;
  }
): RoomRuntime {
  const polygon = createRoomPolygon(canvas, {
    id: options.id,
    points: options.points,
    fill: options.fill,
    stroke: options.stroke,
  });

  const handles = createCornerHandles(canvas, polygon, options.id);

  return {
    id: options.id,
    polygon,
    handles,
  };
}

export function getRoomPoints(room: Polygon): RoomPoint[] {
  const pts = (room.points ?? []) as any[];
  const left = Number(room.left) || 0;
  const top = Number(room.top) || 0;

  return pts.map((p) => ({
    x: left + (Number(p.x) || 0),
    y: top + (Number(p.y) || 0),
  }));
}

export function setRoomPoints(room: Polygon, points: RoomPoint[]) {
  if (!points.length) return;

  const { left, top, width, height, localPoints } = normalizeRoomPoints(points);

  room.set({
    left,
    top,
    originX: "left",
    originY: "top",
    width,
    height,
    points: localPoints as any,
    pathOffset: new Point(width / 2, height / 2),
  });

  room.setCoords();
}

export function createCornerHandles(
  canvas: Canvas,
  room: Polygon,
  roomId?: RoomId
) {
  const pts = getRoomPoints(room);
  return pts.map((p, idx) => createOneCornerHandle(canvas, p, idx, roomId));
}

export function syncHandlesToRoom(
  handles: Circle[],
  room: Polygon,
  canvas?: Canvas
) {
  const pts = getRoomPoints(room);
  const roomId = (room as any)?.data?.id as RoomId | undefined;

  if (canvas && handles.length < pts.length) {
    for (let i = handles.length; i < pts.length; i++) {
      handles.push(createOneCornerHandle(canvas, pts[i], i, roomId));
    }
  }

  while (handles.length > pts.length) {
    const h = handles.pop();
    if (h && canvas) canvas.remove(h);
  }

  handles.forEach((h, i) => {
    const p = pts[i];
    if (!p) return;

    h.set({
      left: p.x,
      top: p.y,
    });

    (h as any).data = {
      ...(h as any).data,
      kind: "room-handle",
      index: i,
      roomId,
    };

    h.setCoords();
  });
}

type AttachArgs = {
  canvas: Canvas;
  room: Polygon;
  handles: Circle[];
  gridSize: number;
  minSize?: number;
  onRoomChanging?: () => void;
  onRoomChanged?: () => void;
};

export function attachWallEditing(args: AttachArgs) {
  const {
    canvas,
    room,
    handles,
    gridSize,
    minSize = 200,
    onRoomChanging,
    onRoomChanged,
  } = args;

  const roomId = (room as any)?.data?.id as RoomId | undefined;

  const bindHandle = (h: Circle) => {
    h.on("moving", () => {
      const handleRoomId = (h as any).data?.roomId;
      if (roomId && handleRoomId && handleRoomId !== roomId) return;

      const idx = (h as any).data?.index ?? 0;

      const pts = getRoomPoints(room);

      let nx = h.left ?? 0;
      let ny = h.top ?? 0;

      nx = snap(nx, gridSize);
      ny = snap(ny, gridSize);

      h.set({ left: nx, top: ny });
      h.setCoords();

      pts[idx] = { x: nx, y: ny };

      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      const width = maxX - minX;
      const height = maxY - minY;

      if (width < minSize || height < minSize) {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        if (width < minSize) {
          nx = nx < cx ? cx - minSize / 2 : cx + minSize / 2;
          nx = snap(nx, gridSize);
        }

        if (height < minSize) {
          ny = ny < cy ? cy - minSize / 2 : cy + minSize / 2;
          ny = snap(ny, gridSize);
        }

        h.set({ left: nx, top: ny });
        h.setCoords();
        pts[idx] = { x: nx, y: ny };
      }

      setRoomPoints(room, pts);
      syncHandlesToRoom(handles, room, canvas);

      onRoomChanging?.();
    });

    h.on("modified", () => {
      onRoomChanged?.();
    });
  };

  handles.forEach(bindHandle);

  const rebindNewHandles = () => {
    handles.forEach((h: any) => {
      if (h.__roomBound) return;
      h.__roomBound = true;
      bindHandle(h);
    });
  };

  rebindNewHandles();

  return { rebindNewHandles };
}
