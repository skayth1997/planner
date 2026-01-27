import { Polygon, Circle, Canvas } from "fabric";

export type RoomPoint = { x: number; y: number };

export function createRoomPolygon(canvas: Canvas) {
  // initial rectangle (same position as old Rect)
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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function attachWallEditing(args: {
  canvas: Canvas;
  room: Polygon;
  handles: Circle[];
  onRoomChanging?: () => void;
  onRoomChanged?: () => void;
}) {
  const { canvas, room, handles, onRoomChanging, onRoomChanged } = args;

  const MIN_W = 200;
  const MIN_H = 200;

  const getAABB = () => {
    const r = room.getBoundingRect();
    return {
      left: r.left,
      top: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
    };
  };

  handles.forEach((h) => {
    h.on("moving", () => {
      const idx = (h as any).data?.index ?? 0;

      const pts = getRoomPoints(room);

      // new point from handle center
      const nx = h.left ?? 0;
      const ny = h.top ?? 0;

      // Update point
      pts[idx] = { x: nx, y: ny };

      // Keep room roughly valid in MVP: enforce min bbox size
      // We do it by clamping the moved handle inside a bbox based on other points.
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      // if too small, clamp moved point away from opposite side
      let x = pts[idx].x;
      let y = pts[idx].y;

      const width = maxX - minX;
      const height = maxY - minY;

      if (width < MIN_W) {
        const aabb = getAABB();
        x = clamp(x, aabb.left - 2000, aabb.right + 2000); // don't explode
      }
      if (height < MIN_H) {
        const aabb = getAABB();
        y = clamp(y, aabb.top - 2000, aabb.bottom + 2000);
      }

      pts[idx] = { x, y };

      setRoomPoints(room, pts);
      syncHandlesToRoom(handles, room);

      onRoomChanging?.();
    });

    h.on("modified", () => {
      onRoomChanged?.();
    });
  });
}
