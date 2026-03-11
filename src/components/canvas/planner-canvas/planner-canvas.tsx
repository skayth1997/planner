"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Canvas, Polygon, Point } from "fabric";

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

type GridController = ReturnType<typeof createGridController>;

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

function createRoomPolygonFromPoints(points: Pt[], roomId: string) {
  const cleanPoints = removeClosingPoint(points);
  const { left, top, width, height, localPoints } = normalizeRoomPoints(
    cleanPoints
  );

  const room = new Polygon(localPoints as any, {
    left,
    top,
    originX: "left",
    originY: "top",
    width,
    height,
    pathOffset: new Point(width / 2, height / 2),

    fill: "rgba(59,130,246,0.15)",
    stroke: "#3b82f6",
    strokeWidth: 3,
    selectable: false,
    evented: false,
    objectCaching: false,
    perPixelTargetFind: false,
  });

  (room as any).data = {
    kind: "room",
    id: roomId,
  };

  return room;
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

export default forwardRef<
  PlannerCanvasHandle,
  { onSelectionChange?: (info: SelectedInfo | null) => void }
>(function PlannerCanvas({ onSelectionChange: _onSelectionChange }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const fabricCanvasRef = useRef<Canvas | null>(null);
  const roomsRef = useRef<Polygon[]>([]);

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

  const getRooms = () => {
    return roomsRef.current;
  };

  const getLastRoom = () => {
    const rooms = roomsRef.current;
    return rooms.length ? rooms[rooms.length - 1] : null;
  };

  const getRoomSizeInternal = (): RoomSize => {
    const room = getLastRoom();
    if (!room) return { width: 0, height: 0 };

    const r = room.getBoundingRect();
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

    const r = room.getBoundingRect();
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

    const cleanPoints = removeClosingPoint(points);
    const {
      left: nextLeft,
      top: nextTop,
      width,
      height,
      localPoints,
    } = normalizeRoomPoints(cleanPoints);

    room.set({
      left: nextLeft,
      top: nextTop,
      originX: "left",
      originY: "top",
      width,
      height,
      points: localPoints as any,
      pathOffset: new Point(width / 2, height / 2),
    });

    room.setCoords();

    gridRef.current?.rebuild();
    fitObjectsToView(canvas, roomsRef.current);
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
        const room = createRoomPolygonFromPoints(points, roomId);

        roomsRef.current.push(room);
        canvas.add(room);

        gridRef.current?.rebuild();
        fitObjectsToView(canvas, roomsRef.current);
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

      if (roomsRef.current.length) {
        fitObjectsToView(canvas, roomsRef.current);
      }

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

        fitObjectsToView(canvas, roomsRef.current);
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
        drawRoomRef.current?.stop();
      },

      addRoom() {},

      getActiveRoomId() {
        const room = getLastRoom();
        return room ? (room as any).data?.id ?? null : null;
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
