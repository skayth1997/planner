import { Polygon, Circle, Canvas } from "fabric";

export type RoomPoint = { x: number; y: number };

function snap(v: number, grid: number) {
  return Math.round(v / grid) * grid;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function createRoomPolygon(canvas: Canvas) {
  const pts: RoomPoint[] = [
    { x: 200, y: 150 },
    { x: 800, y: 150 },
    { x: 800, y: 550 },
    { x: 200, y: 550 },
  ];

  const room = new Polygon(pts as any, {
    fill: "rgba(59,130,246,0.15)",
    stroke: "#3b82f6",
    strokeWidth: 3,
    selectable: false,
    evented: false,
    objectCaching: false,
    perPixelTargetFind: false,
  });

  (room as any).data = { kind: "room" };

  canvas.add(room);
  return room;
}

export function getRoomPoints(room: Polygon): RoomPoint[] {
  const pts = (room.points ?? []) as any[];
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

export function setRoomPoints(room: Polygon, points: RoomPoint[]) {
  room.set({ points: points as any });
  room.setCoords();
}

export function createCornerHandles(canvas: Canvas, room: Polygon) {
  const pts = getRoomPoints(room);

  const handles: Circle[] = pts.map((p, idx) => {
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

    (c as any).data = { kind: "room-handle", index: idx };

    canvas.add(c);
    canvas.bringObjectToFront(c);
    return c;
  });

  return handles;
}

export function syncHandlesToRoom(handles: Circle[], room: Polygon) {
  const pts = getRoomPoints(room);
  handles.forEach((h, i) => {
    const p = pts[i];
    if (!p) return;
    h.set({ left: p.x, top: p.y });
    h.setCoords();
  });
}

type AttachArgs = {
  canvas: Canvas;
  room: Polygon;
  handles: Circle[];
  gridSize: number;
  minSize?: number; // bbox min w/h
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

  const getAABB = () => {
    const r = room.getBoundingRect();
    return {
      left: r.left,
      top: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
      width: r.width,
      height: r.height,
    };
  };

  handles.forEach((h) => {
    h.on("moving", () => {
      const idx = (h as any).data?.index ?? 0;

      const pts = getRoomPoints(room);

      // snap handle to grid (center-based)
      let nx = h.left ?? 0;
      let ny = h.top ?? 0;

      nx = snap(nx, gridSize);
      ny = snap(ny, gridSize);

      // Apply snapped coords to handle immediately (visual consistency)
      h.set({ left: nx, top: ny });
      h.setCoords();

      // Update room point
      pts[idx] = { x: nx, y: ny };

      // Keep bbox not collapsing below minSize (simple MVP constraint)
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      const width = maxX - minX;
      const height = maxY - minY;

      if (width < minSize || height < minSize) {
        // revert this move a bit using previous aabb center idea
        // simplest: clamp the moved point inside a huge safe range but try not to collapse
        const aabb = getAABB();
        const cx = (aabb.left + aabb.right) / 2;
        const cy = (aabb.top + aabb.bottom) / 2;

        // push point away from center if too small
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
      syncHandlesToRoom(handles, room);

      onRoomChanging?.();
    });

    h.on("modified", () => {
      onRoomChanged?.();
    });
  });
}
