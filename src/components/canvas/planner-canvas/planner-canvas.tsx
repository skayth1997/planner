"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Canvas } from "fabric";

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

import {
  createRoomVisual,
  updateRoomVisual,
  removeRoomVisual,
  addRoomVisualToCanvas,
} from "./room/room-visual";
import type { RoomVisual } from "./room/room-visual";

import { fitObjectsToView } from "./core/viewport";

type GridController = ReturnType<typeof createGridController>;

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
