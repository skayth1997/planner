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
} from "./core/planner-types";

import { createRenderScheduler } from "./core/render";
import { attachMouseController } from "./input/mouse-controller";
import { createGridController } from "./grid/grid-controller";
import { fitObjectsToView } from "./core/viewport";
import { createWallManager } from "./room/wall-manager";
import { createWallDrawController } from "./room/wall-draw";
import { createWallSelectionController } from "./room/wall-selection";
import { createWallEditController } from "./room/wall-edit";
import { detectRoomsFromWalls } from "./room/room-detection";
import { rebuildRoomFills } from "./room/room-fill";
import type { RoomFillVisual } from "./room/room-fill";

type GridController = ReturnType<typeof createGridController>;
type WallManager = ReturnType<typeof createWallManager>;

export default forwardRef<
  PlannerCanvasHandle,
  { onSelectionChange?: (info: SelectedInfo | null) => void }
>(function PlannerCanvas({ onSelectionChange }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const fabricCanvasRef = useRef<Canvas | null>(null);
  const wallManagerRef = useRef<WallManager | null>(null);

  const gridRef = useRef<GridController | null>(null);
  const wallDrawRef = useRef<ReturnType<
    typeof createWallDrawController
  > | null>(null);
  const wallSelectionRef = useRef<ReturnType<
    typeof createWallSelectionController
  > | null>(null);
  const wallEditRef = useRef<ReturnType<
    typeof createWallEditController
  > | null>(null);

  const scheduleRenderRef = useRef<null | (() => void)>(null);
  const isSpacePressedRef = useRef(false);
  const roomFillsRef = useRef<RoomFillVisual[]>([]);

  const safeRender = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    if (scheduleRenderRef.current) scheduleRenderRef.current();
    else canvas.requestRenderAll();
  };

  const rebuildDetectedRoomFills = () => {
    const canvas = fabricCanvasRef.current;
    const wallManager = wallManagerRef.current;
    if (!canvas || !wallManager) return;

    const rooms = detectRoomsFromWalls(wallManager.getLinearWalls());

    roomFillsRef.current = rebuildRoomFills({
      canvas,
      rooms,
      current: roomFillsRef.current,
      wallThickness: wallManager.getDefaultThickness(),
    });
  };

  const deleteWallByIdInternal = (wallId: string) => {
    const wallSelection = wallSelectionRef.current;
    const wallManager = wallManagerRef.current;

    if (!wallSelection || !wallManager) return;
    if (!wallId) return;

    wallSelection.removeSelectedWallId(wallId);
    wallManager.removeWall(wallId);
    safeRender();
  };

  useEffect(() => {
    if (!htmlCanvasRef.current) return;

    const canvas = new Canvas(htmlCanvasRef.current, {
      backgroundColor: "#fafafa",
      selection: false,
      selectionColor: "transparent",
      selectionBorderColor: "transparent",
      selectionLineWidth: 0,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;

    const lowerCanvasEl = canvas.lowerCanvasEl as HTMLCanvasElement | undefined;
    const upperCanvasEl = canvas.upperCanvasEl as HTMLCanvasElement | undefined;
    const containerEl = containerRef.current;

    const preventDomDefault = (e: Event) => {
      e.preventDefault();
    };

    const preventMouseDefault = (e: MouseEvent) => {
      e.preventDefault();
    };

    const applyDomGuards = (el: HTMLElement | null | undefined) => {
      if (!el) return;

      el.setAttribute("draggable", "false");
      el.style.userSelect = "none";
      el.style.webkitUserSelect = "none";
      (el.style as any).msUserSelect = "none";
      (el.style as any).webkitUserDrag = "none";
      (el.style as any).webkitTapHighlightColor = "transparent";
      (el.style as any).touchAction = "none";

      el.addEventListener("dragstart", preventDomDefault);
      el.addEventListener("selectstart", preventDomDefault);
      el.addEventListener("mousedown", preventMouseDefault);
    };

    const removeDomGuards = (el: HTMLElement | null | undefined) => {
      if (!el) return;

      el.removeEventListener("dragstart", preventDomDefault);
      el.removeEventListener("selectstart", preventDomDefault);
      el.removeEventListener("mousedown", preventMouseDefault);
    };

    applyDomGuards(lowerCanvasEl);
    applyDomGuards(upperCanvasEl);
    applyDomGuards(containerEl);

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

    const wallManager = createWallManager({
      canvas,
      onChange: () => {
        rebuildDetectedRoomFills();
        gridRef.current?.rebuild();
        wallSelectionRef.current?.rerenderSelectionVisuals();
        safeRender();
      },
    });

    wallManagerRef.current = wallManager;

    const wallSelection = createWallSelectionController({
      canvas,
      getWalls: () => wallManager.getWalls(),
      isSelectionEnabled: () => !wallDrawRef.current?.isActive(),
      onSelectionChange,
      scheduleRender,
    });

    wallSelectionRef.current = wallSelection;
    wallSelection.start();

    const wallEdit = createWallEditController({
      canvas,
      getSelectedWall: () => wallSelection.getSelectedWall(),
      getLinearWalls: () => wallManager.getLinearWalls(),
      moveConnectedNode: ({ rootId, nodeRole, dx, dy }) => {
        wallManager.moveConnectedNode({ rootId, nodeRole, dx, dy });
      },
      offsetWallWithConnectedEnds: ({ rootId, dx, dy }) => {
        wallManager.offsetWallWithConnectedEnds({ rootId, dx, dy });
      },
      rerenderSelectionVisuals: () => wallSelection.rerenderSelectionVisuals(),
      scheduleRender,
    });

    wallEditRef.current = wallEdit;
    wallEdit.start();

    const wallDraw = createWallDrawController({
      canvas,
      getLinearWalls: () => wallManager.getLinearWalls(),
      getDefaultThickness: () => wallManager.getDefaultThickness(),
      splitSegmentWallAtPoint: ({ id, point }) => {
        return wallManager.splitSegmentWallAtPoint({ id, point });
      },
      onCommitSegmentWall: (a, b, thickness) => {
        wallManager.addSegmentWall({ a, b, thickness });
        gridRef.current?.rebuild();
        wallSelection.rerenderSelectionVisuals();
        safeRender();
      },
      onCommitBlockWall: (center, size, thickness) => {
        wallManager.addBlockWall({ center, size, thickness });
        gridRef.current?.rebuild();
        wallSelection.rerenderSelectionVisuals();
        safeRender();
      },
      scheduleRender,
    });

    wallDrawRef.current = wallDraw;
    rebuildDetectedRoomFills();

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
        const isDrawing = !!wallDrawRef.current?.isActive();
        const isEditing = !!wallEditRef.current?.isDragging();
        return !isDrawing && !isEditing;
      },
    });

    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      const isTyping =
        activeTag === "INPUT" ||
        activeTag === "TEXTAREA" ||
        activeTag === "SELECT";

      if (isTyping) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const selectedWall = wallSelectionRef.current?.getSelectedWall();
        if (!selectedWall) return;

        e.preventDefault();
        deleteWallByIdInternal(selectedWall.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    grid.rebuild();
    scheduleRender();

    return () => {
      window.removeEventListener("resize", resizeCanvasToContainer);
      window.removeEventListener("keydown", onKeyDown);

      removeDomGuards(lowerCanvasEl);
      removeDomGuards(upperCanvasEl);
      removeDomGuards(containerEl);

      detachMouse();

      wallEditRef.current?.stop();
      wallEditRef.current = null;

      wallSelectionRef.current?.stop();
      wallSelectionRef.current = null;

      wallDrawRef.current?.stop();
      wallDrawRef.current = null;

      wallManager.dispose();
      wallManagerRef.current = null;

      grid.dispose();
      gridRef.current = null;

      roomFillsRef.current = [];
      canvas.dispose();

      fabricCanvasRef.current = null;
      scheduleRenderRef.current = null;
    };
  }, [onSelectionChange]);

  useImperativeHandle(ref, () => ({
    addFurniture(_: FurnitureType) {},

    deleteSelected() {
      const selectedWall = wallSelectionRef.current?.getSelectedWall();
      if (!selectedWall) return;

      deleteWallByIdInternal(selectedWall.id);
    },

    deleteWallById(wallId: string) {
      deleteWallByIdInternal(wallId);
    },

    duplicateSelected() {},

    setSelectedProps() {},

    toggleSelectedDoor() {},

    fitRoom() {
      const canvas = fabricCanvasRef.current;
      const wallManager = wallManagerRef.current;
      if (!canvas || !wallManager) return;

      const objects = wallManager.getFitObjects();
      if (!objects.length) return;

      fitObjectsToView(canvas, objects);
      safeRender();
    },

    undo() {},

    redo() {},

    save() {},

    load() {},

    exportJson() {},

    importJsonString() {},

    getRoomSize() {
      return { width: 0, height: 0 };
    },

    setRoomSize(_: RoomSize) {},

    setGridVisible(visible: boolean) {
      gridRef.current?.setVisible(visible);
    },

    setGridSize(size: number) {
      gridRef.current?.setSize(size);
    },

    addDoor() {},

    addWindow() {},

    isDrawingRoom() {
      return !!wallDrawRef.current?.isActive();
    },

    startDrawRoom() {
      wallSelectionRef.current?.clearSelection();
      wallDrawRef.current?.start();
    },

    stopDrawRoom() {
      wallDrawRef.current?.stop();
    },

    addRoom() {},

    getActiveRoomId() {
      return null;
    },

    setActiveRoom() {},
  }));

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden border border-neutral-300 bg-white select-none"
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
    >
      <canvas ref={htmlCanvasRef} />
    </div>
  );
});
