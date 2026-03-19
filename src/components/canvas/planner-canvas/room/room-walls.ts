import {
  Polygon,
  Circle,
  Canvas,
  Point,
  Line,
  type Line as FabricLine,
} from "fabric";
import type { RoomId } from "../core/planner-types";
import { insetPolygonTowardsCentroid } from "./polygon-geometry";

export type RoomPoint = { x: number; y: number };

export type RoomRuntime = {
  id: RoomId;
  polygon: Polygon;
  innerPolygon: Polygon;
  hatchLines: FabricLine[];
  handles: Circle[];
};

const DEFAULT_WALL_THICKNESS = 10;
const DEFAULT_HATCH_SPACING = 12;

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

function applyPolygonAbsolutePoints(
  polygon: Polygon,
  points: RoomPoint[],
  extra?: Partial<Polygon>
) {
  const { left, top, width, height, localPoints } = normalizeRoomPoints(points);

  polygon.set({
    left,
    top,
    originX: "left",
    originY: "top",
    width,
    height,
    points: localPoints as any,
    pathOffset: new Point(width / 2, height / 2),
    ...extra,
  });

  polygon.setCoords();
}

function createAbsoluteClipPolygon(points: RoomPoint[]) {
  return new Polygon(points as any, {
    absolutePositioned: true,
    selectable: false,
    evented: false,
    objectCaching: false,
  });
}

function removeRoomHatchLines(canvas: Canvas, roomId?: RoomId) {
  if (!roomId) return;

  const objects = canvas.getObjects().slice();
  for (const obj of objects as any[]) {
    if (obj?.data?.kind === "room-hatch" && obj?.data?.roomId === roomId) {
      canvas.remove(obj);
    }
  }
}

function createWallHatchLines(
  canvas: Canvas,
  outerPoints: RoomPoint[],
  innerPolygon: Polygon,
  roomId?: RoomId,
  spacing = DEFAULT_HATCH_SPACING
): FabricLine[] {
  if (outerPoints.length < 3) return [];

  const xs = outerPoints.map((p) => p.x);
  const ys = outerPoints.map((p) => p.y);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const width = maxX - minX;
  const height = maxY - minY;
  const overscan = Math.max(width, height) + 300;

  const clipPath = createAbsoluteClipPolygon(outerPoints);
  const lines: FabricLine[] = [];

  for (let x = minX - overscan; x <= maxX + overscan; x += spacing) {
    const line = new Line([x, maxY + overscan, x + overscan, minY - overscan], {
      stroke: "rgba(17,24,39,0.42)",
      strokeWidth: 1,
      selectable: false,
      evented: false,
      objectCaching: false,
      excludeFromExport: true,
    }) as FabricLine;

    (line as any).clipPath = clipPath;
    (line as any).data = {
      kind: "room-hatch",
      roomId,
    };

    canvas.add(line as any);
    lines.push(line);
  }

  canvas.bringObjectToFront(innerPolygon);

  return lines;
}

function bringRoomVisualsToFront(
  canvas: Canvas,
  room: Polygon,
  innerPolygon: Polygon | null,
  handles: Circle[] = []
) {
  if (!canvas) return;

  canvas.bringObjectToFront(room);

  if (innerPolygon) {
    canvas.bringObjectToFront(innerPolygon);
  }

  for (const h of handles) {
    canvas.bringObjectToFront(h);
  }
}

function updateRoomVisuals(
  canvas: Canvas,
  room: Polygon,
  handles: Circle[] = []
): FabricLine[] {
  const roomId = (room as any)?.data?.id as RoomId | undefined;
  const wallThickness = Math.max(
    1,
    Number((room as any)?.data?.wallThickness ?? DEFAULT_WALL_THICKNESS)
  );

  const outerPoints = getRoomPoints(room);
  const innerPoints = insetPolygonTowardsCentroid(outerPoints, wallThickness);

  const innerPolygon = (room as any)?.data?.innerPolygon as Polygon | null;
  if (innerPolygon) {
    applyPolygonAbsolutePoints(innerPolygon, innerPoints, {
      fill: "#ffffff",
      stroke: "#111827",
      strokeWidth: 1.5,
    });
  }

  removeRoomHatchLines(canvas, roomId);

  const nextHatchLines = innerPolygon
    ? createWallHatchLines(canvas, outerPoints, innerPolygon, roomId)
    : [];

  (room as any).data = {
    ...(room as any).data,
    hatchLines: nextHatchLines,
  };

  bringRoomVisualsToFront(canvas, room, innerPolygon, handles);

  return nextHatchLines;
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

function createInnerRoomPolygon(
  canvas: Canvas,
  outerPoints: RoomPoint[],
  options: {
    id?: RoomId;
    wallThickness?: number;
  }
) {
  const wallThickness = Math.max(
    1,
    Number(options.wallThickness ?? DEFAULT_WALL_THICKNESS)
  );

  const innerPoints = insetPolygonTowardsCentroid(outerPoints, wallThickness);

  const inner = new Polygon([], {
    fill: "#ffffff",
    stroke: "#111827",
    strokeWidth: 1.5,
    selectable: false,
    evented: false,
    objectCaching: false,
    perPixelTargetFind: false,
  });

  (inner as any).data = {
    kind: "room-inner",
    roomId: options.id,
  };

  applyPolygonAbsolutePoints(inner, innerPoints);
  canvas.add(inner);

  return inner;
}

export function createRoomPolygon(
  canvas: Canvas,
  options?: {
    id?: RoomId;
    points?: RoomPoint[];
    fill?: string;
    stroke?: string;
    wallThickness?: number;
  }
) {
  const absolutePoints: RoomPoint[] = options?.points ?? [
    { x: 200, y: 150 },
    { x: 800, y: 150 },
    { x: 800, y: 550 },
    { x: 200, y: 550 },
  ];

  const room = new Polygon([], {
    fill: options?.fill ?? "#f8fafc",
    stroke: options?.stroke ?? "#111827",
    strokeWidth: 2,
    selectable: false,
    evented: false,
    objectCaching: false,
    perPixelTargetFind: false,
  });

  (room as any).data = {
    kind: "room",
    id: options?.id,
    wallThickness: options?.wallThickness ?? DEFAULT_WALL_THICKNESS,
    innerPolygon: null,
    hatchLines: [],
  };

  applyPolygonAbsolutePoints(room, absolutePoints);
  canvas.add(room);

  const innerPolygon = createInnerRoomPolygon(canvas, absolutePoints, {
    id: options?.id,
    wallThickness: options?.wallThickness,
  });

  (room as any).data.innerPolygon = innerPolygon;

  const hatchLines = createWallHatchLines(
    canvas,
    absolutePoints,
    innerPolygon,
    options?.id
  );

  (room as any).data.hatchLines = hatchLines;

  canvas.bringObjectToFront(room);
  canvas.bringObjectToFront(innerPolygon);

  return room;
}

export function createRoomRuntime(
  canvas: Canvas,
  options: {
    id: RoomId;
    points?: RoomPoint[];
    fill?: string;
    stroke?: string;
    wallThickness?: number;
  }
): RoomRuntime {
  const polygon = createRoomPolygon(canvas, {
    id: options.id,
    points: options.points,
    fill: options.fill,
    stroke: options.stroke,
    wallThickness: options.wallThickness,
  });

  const innerPolygon = (polygon as any).data?.innerPolygon as Polygon;
  const hatchLines =
    ((polygon as any).data?.hatchLines as FabricLine[] | undefined) ?? [];
  const handles = createCornerHandles(canvas, polygon, options.id);

  bringRoomVisualsToFront(canvas, polygon, innerPolygon, handles);

  return {
    id: options.id,
    polygon,
    innerPolygon,
    hatchLines,
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
  applyPolygonAbsolutePoints(room, points);
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

  if (canvas) {
    updateRoomVisuals(canvas, room, handles);
  }
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
