"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Canvas, Polygon, Point, Path, Pattern } from "fabric";

import {
  GRID_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SENSITIVITY,
} from "./core/planner-constants";

import type {
  PlannerCanvasHandle,
  SelectedInfo,
  FurnitureType,
  RoomSize,
  Pt,
} from "./core/planner-types";

import { createRoomDrawController } from "./room/room-draw";
import { createRenderScheduler } from "./core/render";
import { attachMouseController } from "./input/mouse-controller";
import { createGridController } from "./grid/grid-controller";
import { insetPolygon } from "./room/polygon-geometry";

type GridController = ReturnType<typeof createGridController>;

type RoomVisual = {
  id: string;
  outer: Polygon;
  inner: Polygon;
  wallBand: Path;
};

const WALL_THICKNESS = 20;

let cachedWallPatternSource: HTMLCanvasElement | null = null;

function normalizeRoomPoints(points: Pt[]) {
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

function removeClosingPoint(points: Pt[]) {
  if (points.length < 2) return points;

  const first = points[0];
  const last = points[points.length - 1];

  if (first.x === last.x && first.y === last.y) {
    return points.slice(0, -1);
  }

  return points;
}

function applyPolygonAbsolutePoints(
  polygon: Polygon,
  points: Pt[],
  extra?: Partial<Polygon>
) {
  const cleanPoints = removeClosingPoint(points);
  const { left, top, width, height, localPoints } = normalizeRoomPoints(
    cleanPoints
  );

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

function getRoomAbsoluteBounds(room: Polygon) {
  const r = room.getBoundingRect();

  return {
    left: r.left,
    top: r.top,
    right: r.left + r.width,
    bottom: r.top + r.height,
    width: r.width,
    height: r.height,
  };
}

function fitObjectsToView(canvas: Canvas, objects: Polygon[], padding = 40) {
  if (!objects.length) return;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const obj of objects) {
    const r = getRoomAbsoluteBounds(obj);
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }

  const contentWidth = Math.max(1, right - left);
  const contentHeight = Math.max(1, bottom - top);

  const viewWidth = canvas.getWidth();
  const viewHeight = canvas.getHeight();

  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

  const scaleX = (viewWidth - padding * 2) / contentWidth;
  const scaleY = (viewHeight - padding * 2) / contentHeight;
  const zoom = Math.min(scaleX, scaleY, 1);

  canvas.setZoom(zoom);

  const vpt = canvas.viewportTransform!;
  const centerX = left + contentWidth / 2;
  const centerY = top + contentHeight / 2;

  vpt[4] = viewWidth / 2 - centerX * zoom;
  vpt[5] = viewHeight / 2 - centerY * zoom;

  canvas.setViewportTransform(vpt);
  canvas.requestRenderAll();
}

function pointsToPath(points: Pt[]) {
  if (!points.length) return "";

  const [first, ...rest] = points;
  return (
    `M ${first.x} ${first.y} ` +
    rest.map((p) => `L ${p.x} ${p.y}`).join(" ") +
    " Z"
  );
}

function getWallPatternSource() {
  if (cachedWallPatternSource) return cachedWallPatternSource;

  const size = 10;

  const patternCanvas = document.createElement("canvas");
  patternCanvas.width = size;
  patternCanvas.height = size;

  const ctx = patternCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(17,24,39,0.7)";

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-size, size);
  ctx.lineTo(0, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(size, size);
  ctx.lineTo(size * 2, 0);
  ctx.stroke();

  cachedWallPatternSource = patternCanvas;
  return patternCanvas;
}

function createWallBandPath(outerPoints: Pt[], innerPoints: Pt[]) {
  const outerPath = pointsToPath(outerPoints);
  const innerPath = pointsToPath([...innerPoints].reverse());

  const patternSource = getWallPatternSource();

  return new Path(`${outerPath} ${innerPath}`, {
    fill: patternSource
      ? new Pattern({
          source: patternSource,
          repeat: "repeat",
        })
      : "#f4f2ec",
    strokeWidth: 0,
    selectable: false,
    evented: false,
    objectCaching: true,
  });
}

function createRoomVisual(points: Pt[], roomId: string): RoomVisual {
  const cleanPoints = removeClosingPoint(points);
  const innerPoints = insetPolygon(cleanPoints, WALL_THICKNESS);

  const wallBand = createWallBandPath(cleanPoints, innerPoints);

  const outer = new Polygon([], {
    fill: "transparent",
    stroke: "#111827",
    strokeWidth: 1.8,
    strokeLineJoin: "miter",
    selectable: false,
    evented: false,
    objectCaching: true,
    perPixelTargetFind: false,
    strokeUniform: true,
  });

  (outer as any).data = {
    kind: "room",
    id: roomId,
    role: "outer",
  };

  applyPolygonAbsolutePoints(outer, cleanPoints);

  const inner = new Polygon([], {
    fill: "#ffffff",
    stroke: "#111827",
    strokeWidth: 1.8,
    strokeLineJoin: "miter",
    selectable: false,
    evented: false,
    objectCaching: true,
    perPixelTargetFind: false,
    strokeUniform: true,
  });

  (inner as any).data = {
    kind: "room-inner",
    id: `${roomId}-inner`,
    roomId,
    role: "inner",
  };

  applyPolygonAbsolutePoints(inner, innerPoints);

  return {
    id: roomId,
    outer,
    inner,
    wallBand,
  };
}

function updateRoomVisual(room: RoomVisual, points: Pt[]) {
  const cleanPoints = removeClosingPoint(points);
  const innerPoints = insetPolygon(cleanPoints, WALL_THICKNESS);

  applyPolygonAbsolutePoints(room.outer, cleanPoints, {
    fill: "transparent",
    stroke: "#111827",
    strokeWidth: 1.8,
  });

  applyPolygonAbsolutePoints(room.inner, innerPoints, {
    fill: "#ffffff",
    stroke: "#111827",
    strokeWidth: 1.8,
  });

  room.wallBand = createWallBandPath(cleanPoints, innerPoints);
}

function removeRoomVisual(canvas: Canvas, room: RoomVisual) {
  canvas.remove(room.inner);
  canvas.remove(room.outer);
  canvas.remove(room.wallBand);
}

function addRoomVisualToCanvas(canvas: Canvas, room: RoomVisual) {
  canvas.add(room.wallBand);
  canvas.add(room.outer);
  canvas.add(room.inner);

  canvas.bringObjectToFront(room.outer);
  canvas.bringObjectToFront(room.inner);
}

export default forwardRef<
  PlannerCanvasHandle,
  { onSelectionChange?: (info: SelectedInfo | null) => void }
>(function PlannerCanvas({ onSelectionChange: _onSelectionChange }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const fabricCanvasRef = useRef<Canvas | null>(null);
  const roomsRef = useRef<RoomVisual[]>([]);

  const gridRef = useRef<GridController | null>(null);
  const drawRoomRef = useRef<ReturnType<
    typeof createRoomDrawController
  > | null>(null);

  const scheduleRenderRef = useRef<null | (() => void)>(null);
  const isSpacePressedRef = useRef(false);

  const safeRender = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    if (scheduleRenderRef.current) scheduleRenderRef.current();
    else canvas.requestRenderAll();
  };

  const getGridSize = () => gridRef.current?.getSize() ?? GRID_SIZE;

  const getLastRoom = () => {
    const rooms = roomsRef.current;
    return rooms.length ? rooms[rooms.length - 1] : null;
  };

  const getRoomSizeInternal = (): RoomSize => {
    const room = getLastRoom();
    if (!room) return { width: 0, height: 0 };

    const r = room.outer.getBoundingRect();
    return {
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };

  const setRoomSizeInternal = (size: RoomSize) => {
    const canvas = fabricCanvasRef.current;
    const room = getLastRoom();

    if (!canvas || !room) return;

    const min = 100;
    const targetW = Math.max(min, Math.round(Number(size.width)));
    const targetH = Math.max(min, Math.round(Number(size.height)));

    const r = room.outer.getBoundingRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    const left = cx - targetW / 2;
    const top = cy - targetH / 2;

    const points: Pt[] = [
      { x: left, y: top },
      { x: left + targetW, y: top },
      { x: left + targetW, y: top + targetH },
      { x: left, y: top + targetH },
    ];

    removeRoomVisual(canvas, room);
    updateRoomVisual(room, points);
    addRoomVisualToCanvas(canvas, room);

    gridRef.current?.rebuild();
    safeRender();
  };

  useEffect(() => {
    if (!htmlCanvasRef.current) return;

    const canvas = new Canvas(htmlCanvasRef.current, {
      backgroundColor: "#fafafa",
      selection: false,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;

    const scheduleRender = createRenderScheduler(canvas);
    scheduleRenderRef.current = scheduleRender;

    const grid = createGridController({
      canvas,
      scheduleRender,
      initial: {
        visible: true,
        size: GRID_SIZE,
      },
    });

    gridRef.current = grid;

    drawRoomRef.current = createRoomDrawController({
      canvas,
      getGridSize: () => getGridSize(),
      scheduleRender,
      onFinish: (points) => {
        if (points.length < 3) return;

        const roomId = `room-${roomsRef.current.length + 1}`;
        const room = createRoomVisual(points, roomId);

        roomsRef.current.push(room);
        addRoomVisualToCanvas(canvas, room);

        gridRef.current?.rebuild();
        safeRender();
      },
      onCancel: () => {
        safeRender();
      },
      onDrawingChange: () => {
        safeRender();
      },
    });

    const resizeCanvasToContainer = () => {
      const el = containerRef.current;
      if (!el) return;

      canvas.setDimensions({
        width: el.clientWidth,
        height: el.clientHeight,
      });

      canvas.calcOffset();
      gridRef.current?.rebuild();
      scheduleRender();
    };

    resizeCanvasToContainer();
    window.addEventListener("resize", resizeCanvasToContainer);

    const detachMouse = attachMouseController({
      canvas,
      isSpacePressedRef,
      zoom: {
        min: ZOOM_MIN,
        max: ZOOM_MAX,
        sensitivity: ZOOM_SENSITIVITY,
      },
      scheduleRender,
      onViewportChange: () => {
        gridRef.current?.rebuild();
      },
      canDragPan: () => {
        return !drawRoomRef.current?.isActive();
      },
    });

    grid.rebuild();
    scheduleRender();

    return () => {
      window.removeEventListener("resize", resizeCanvasToContainer);

      detachMouse();

      drawRoomRef.current?.stop();
      drawRoomRef.current = null;

      grid.dispose();
      gridRef.current = null;

      canvas.dispose();

      roomsRef.current = [];
      fabricCanvasRef.current = null;
      scheduleRenderRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      addFurniture(_: FurnitureType) {},

      deleteSelected() {},

      duplicateSelected() {},

      setSelectedProps() {},

      toggleSelectedDoor() {},

      fitRoom() {
        const canvas = fabricCanvasRef.current;
        if (!canvas || !roomsRef.current.length) return;

        fitObjectsToView(
          canvas,
          roomsRef.current.map((r) => r.outer)
        );
        safeRender();
      },

      undo() {},

      redo() {},

      save() {},

      load() {},

      exportJson() {},

      importJsonString() {},

      getRoomSize() {
        return getRoomSizeInternal();
      },

      setRoomSize(size: RoomSize) {
        setRoomSizeInternal(size);
      },

      setGridVisible(visible: boolean) {
        gridRef.current?.setVisible(visible);
      },

      setGridSize(size: number) {
        gridRef.current?.setSize(size);
      },

      addDoor() {},

      addWindow() {},

      isDrawingRoom() {
        return !!drawRoomRef.current?.isActive();
      },

      startDrawRoom() {
        drawRoomRef.current?.start();
      },

      stopDrawRoom() {
        const controller = drawRoomRef.current;
        if (!controller) return;

        if (controller.isActive()) {
          controller.finish();
        } else {
          controller.stop();
        }
      },

      addRoom() {},

      getActiveRoomId() {
        const room = getLastRoom();
        return room ? room.id : null;
      },

      setActiveRoom() {},
    }),
    []
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden border border-neutral-300 bg-white"
    >
      <canvas ref={htmlCanvasRef} />
    </div>
  );
});
