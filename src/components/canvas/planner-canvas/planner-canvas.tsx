"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Canvas, Rect } from "fabric";

import {
  GRID_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SENSITIVITY,
  ACTIVE_STROKE,
  ACTIVE_STROKE_WIDTH,
  HOVER_STROKE,
  HOVER_STROKE_WIDTH,
} from "./planner-constants";

import type {
  PlannerCanvasHandle,
  SelectedInfo,
  FurnitureType,
  GuideLine,
} from "./planner-types";

import { isFurniture, getSelectedInfo, makeId } from "./utils";
import { drawRoom, drawGrid } from "./room";
import {
  addFurniture,
  clampFurnitureInsideRoom,
  snapFurnitureToRoomGrid,
} from "./furniture";
import { fitRoomToView } from "./fit";
import { alignAndGuide, clearGuides } from "./guides";
import { serializeState, restoreFromJson, pushHistory } from "./history";
import {
  saveNow,
  loadNow,
  exportJson as exportJsonFile,
  importJsonString as importJson,
} from "./persistence";

export default forwardRef<
  PlannerCanvasHandle,
  { onSelectionChange?: (info: SelectedInfo | null) => void }
  >(function PlannerCanvas({ onSelectionChange }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const roomRef = useRef<Rect | null>(null);
  const isSpacePressedRef = useRef(false);

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const guidesRef = useRef<GuideLine[]>([]);
  const autosaveTimerRef = useRef<number | null>(null);
  const isApplyingHistoryRef = useRef(false);

  const scheduleAutosave = () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      try {
        const json = serializeState(canvas);
        localStorage.setItem("planner:v1", json);
      } catch {}
    }, 350);
  };

  const restyleAllFurniture = (canvas: Canvas) => {
    const active = canvas.getActiveObject() as any;

    canvas.getObjects().forEach((o: any) => {
      if (!isFurniture(o)) return;

      const baseStroke = o.data?.baseStroke ?? "#10b981";
      const baseStrokeWidth = o.data?.baseStrokeWidth ?? 2;

      if (active && o === active) {
        o.set({ stroke: ACTIVE_STROKE, strokeWidth: ACTIVE_STROKE_WIDTH });
      } else {
        o.set({ stroke: baseStroke, strokeWidth: baseStrokeWidth });
      }

      o.setCoords();
    });

    canvas.requestRenderAll();
  };

  const pushHistoryNow = (canvas: Canvas) => {
    if (isApplyingHistoryRef.current) return;
    const snap = serializeState(canvas);
    pushHistory(historyRef, historyIndexRef, snap);
    scheduleAutosave();
  };

  const undo = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;
    if (historyIndexRef.current <= 0) return;

    historyIndexRef.current -= 1;

    isApplyingHistoryRef.current = true;
    restoreFromJson(canvas, room, historyRef.current[historyIndexRef.current], () => {
      onSelectionChangeRef.current?.(null);
    });
    isApplyingHistoryRef.current = false;

    restyleAllFurniture(canvas);
    clearGuides(canvas, guidesRef);
    scheduleAutosave();
  };

  const redo = () => {
    const canvas = fabricCanvasRef.current;
    const room = roomRef.current;
    if (!canvas || !room) return;
    if (historyIndexRef.current >= historyRef.current.length - 1) return;

    historyIndexRef.current += 1;

    isApplyingHistoryRef.current = true;
    restoreFromJson(canvas, room, historyRef.current[historyIndexRef.current], () => {
      onSelectionChangeRef.current?.(null);
    });
    isApplyingHistoryRef.current = false;

    restyleAllFurniture(canvas);
    clearGuides(canvas, guidesRef);
    scheduleAutosave();
  };

  useEffect(() => {
    if (!htmlCanvasRef.current) return;

    const canvas = new Canvas(htmlCanvasRef.current, {
      backgroundColor: "#fafafa",
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;

    const room = drawRoom(canvas);
    roomRef.current = room;

    drawGrid(canvas, room, GRID_SIZE);

    const resizeCanvasToContainer = () => {
      const el = containerRef.current;
      if (!el) return;

      canvas.setDimensions({ width: el.clientWidth, height: el.clientHeight });
      canvas.calcOffset();
      fitRoomToView(canvas, room);
    };

    resizeCanvasToContainer();
    window.addEventListener("resize", resizeCanvasToContainer);

    // zoom
    canvas.on("mouse:wheel", (opt) => {
      const event = opt.e as WheelEvent;

      let zoom = canvas.getZoom();
      zoom *= ZOOM_SENSITIVITY ** event.deltaY;
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

      canvas.zoomToPoint({ x: event.offsetX, y: event.offsetY }, zoom);

      event.preventDefault();
      event.stopPropagation();
    });

    // pan
    let isPanning = false;
    let lastClientX = 0;
    let lastClientY = 0;

    canvas.on("mouse:down", (opt) => {
      if (!isSpacePressedRef.current) return;

      const e = opt.e as MouseEvent;
      isPanning = true;
      canvas.selection = false;
      canvas.defaultCursor = "grabbing";
      lastClientX = e.clientX;
      lastClientY = e.clientY;
    });

    canvas.on("mouse:move", (opt) => {
      if (!isPanning) return;

      const e = opt.e as MouseEvent;
      const vpt = canvas.viewportTransform!;
      vpt[4] += e.clientX - lastClientX;
      vpt[5] += e.clientY - lastClientY;
      canvas.requestRenderAll();

      lastClientX = e.clientX;
      lastClientY = e.clientY;
    });

    canvas.on("mouse:up", () => {
      isPanning = false;
      canvas.selection = true;
      canvas.defaultCursor = "default";
      clearGuides(canvas, guidesRef);
    });

    const emitSelection = () => {
      const active = canvas.getActiveObject();
      if (!active || !isFurniture(active)) {
        onSelectionChangeRef.current?.(null);
        return;
      }
      onSelectionChangeRef.current?.(getSelectedInfo(active));
    };

    canvas.on("selection:created", () => {
      emitSelection();
      restyleAllFurniture(canvas);
      clearGuides(canvas, guidesRef);
    });

    canvas.on("selection:updated", () => {
      emitSelection();
      restyleAllFurniture(canvas);
      clearGuides(canvas, guidesRef);
    });

    canvas.on("selection:cleared", () => {
      onSelectionChangeRef.current?.(null);
      restyleAllFurniture(canvas);
      clearGuides(canvas, guidesRef);
    });

    // hover
    canvas.on("mouse:over", (opt) => {
      const t = opt.target as any;
      if (!t || !isFurniture(t)) return;

      const active = canvas.getActiveObject() as any;
      if (active && active === t) return;

      t.set({ stroke: HOVER_STROKE, strokeWidth: HOVER_STROKE_WIDTH });
      t.setCoords();
      canvas.requestRenderAll();
    });

    canvas.on("mouse:out", (opt) => {
      const t = opt.target as any;
      if (!t || !isFurniture(t)) return;

      const active = canvas.getActiveObject() as any;
      if (active && active === t) return;

      const baseStroke = t.data?.baseStroke ?? "#10b981";
      const baseStrokeWidth = t.data?.baseStrokeWidth ?? 2;
      t.set({ stroke: baseStroke, strokeWidth: baseStrokeWidth });
      t.setCoords();
      canvas.requestRenderAll();
    });

    // keep panel updated during transforms
    canvas.on("object:scaling", emitSelection);
    canvas.on("object:rotating", emitSelection);

    canvas.on("object:moving", (opt) => {
      const obj = opt.target as any;
      if (!obj || !isFurniture(obj)) return;

      obj.setCoords();
      room.setCoords();

      clampFurnitureInsideRoom(obj, room);
      alignAndGuide(canvas, room, guidesRef, obj);

      emitSelection();
      canvas.requestRenderAll();
    });

    canvas.on("object:modified", (opt) => {
      const obj = opt.target as any;
      if (!obj || !isFurniture(obj)) return;

      snapFurnitureToRoomGrid(obj, room, GRID_SIZE);
      clampFurnitureInsideRoom(obj, room);

      obj.setCoords();
      emitSelection();
      restyleAllFurniture(canvas);
      clearGuides(canvas, guidesRef);
      canvas.requestRenderAll();

      pushHistoryNow(canvas);
    });

    // keyboard
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressedRef.current = true;
        canvas.defaultCursor = "grab";
      }

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;

        const active = canvas.getActiveObject() as any;
        if (!active || !isFurniture(active)) return;

        canvas.remove(active);
        canvas.discardActiveObject();
        onSelectionChangeRef.current?.(null);
        restyleAllFurniture(canvas);
        clearGuides(canvas, guidesRef);
        canvas.requestRenderAll();

        pushHistoryNow(canvas);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressedRef.current = false;
        canvas.defaultCursor = "default";
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // history init
    pushHistoryNow(canvas);

    // autoload
    const saved = localStorage.getItem("planner:v1");
    if (saved) {
      try {
        isApplyingHistoryRef.current = true;
        restoreFromJson(canvas, room, saved, () => onSelectionChangeRef.current?.(null));
        isApplyingHistoryRef.current = false;

        restyleAllFurniture(canvas);
        historyRef.current = [saved];
        historyIndexRef.current = 0;
      } catch {}
    } else {
      restyleAllFurniture(canvas);
    }

    canvas.requestRenderAll();

    return () => {
      window.removeEventListener("resize", resizeCanvasToContainer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);

      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      clearGuides(canvas, guidesRef);
      canvas.dispose();
      fabricCanvasRef.current = null;
      roomRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      addFurniture(type: FurnitureType) {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        addFurniture(canvas, room, type);
        restyleAllFurniture(canvas);
        pushHistoryNow(canvas);
      },

      deleteSelected() {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        const active = canvas.getActiveObject() as any;
        if (!active || !isFurniture(active)) return;

        canvas.remove(active);
        canvas.discardActiveObject();
        onSelectionChangeRef.current?.(null);
        restyleAllFurniture(canvas);
        clearGuides(canvas, guidesRef);
        canvas.requestRenderAll();

        pushHistoryNow(canvas);
      },

      duplicateSelected() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const active = canvas.getActiveObject() as any;
        if (!active || !isFurniture(active)) return;

        const rect = new Rect({
          left: (active.left ?? 0) + GRID_SIZE,
          top: (active.top ?? 0) + GRID_SIZE,
          width: active.width,
          height: active.height,
          fill: active.fill,
          stroke: active.stroke,
          strokeWidth: active.strokeWidth,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockScalingFlip: true,
          transparentCorners: false,
          angle: active.angle ?? 0,
          hoverCursor: "move",
        });

        if (active.rx && active.ry) rect.set({ rx: active.rx, ry: active.ry });

        rect.scaleX = active.scaleX ?? 1;
        rect.scaleY = active.scaleY ?? 1;

        (rect as any).data = {
          kind: "furniture",
          type: active.data?.type ?? "unknown",
          id: makeId(),
          baseStroke: active.data?.baseStroke ?? "#10b981",
          baseStrokeWidth: active.data?.baseStrokeWidth ?? 2,
        };

        canvas.add(rect);

        clampFurnitureInsideRoom(rect as any, room);
        snapFurnitureToRoomGrid(rect as any, room, GRID_SIZE);

        rect.setCoords();
        canvas.setActiveObject(rect);

        onSelectionChangeRef.current?.(getSelectedInfo(rect as any));
        restyleAllFurniture(canvas);
        clearGuides(canvas, guidesRef);

        canvas.requestRenderAll();
        pushHistoryNow(canvas);
      },

      setSelectedProps(patch) {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const active = canvas.getActiveObject() as any;
        if (!active || !isFurniture(active)) return;

        if (typeof patch.width === "number" && patch.width > 1) {
          const current = active.getBoundingRect(false, true).width;
          const factor = patch.width / Math.max(1, current);
          active.scaleX = (active.scaleX ?? 1) * factor;
        }

        if (typeof patch.height === "number" && patch.height > 1) {
          const current = active.getBoundingRect(false, true).height;
          const factor = patch.height / Math.max(1, current);
          active.scaleY = (active.scaleY ?? 1) * factor;
        }

        if (typeof patch.angle === "number") active.angle = patch.angle;

        active.setCoords();
        room.setCoords();

        clampFurnitureInsideRoom(active, room);
        snapFurnitureToRoomGrid(active, room, GRID_SIZE);

        active.setCoords();
        restyleAllFurniture(canvas);
        clearGuides(canvas, guidesRef);
        canvas.requestRenderAll();

        onSelectionChangeRef.current?.(getSelectedInfo(active));
        pushHistoryNow(canvas);
      },

      fitRoom() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        fitRoomToView(canvas, room);
        restyleAllFurniture(canvas);
        clearGuides(canvas, guidesRef);
      },

      undo() {
        undo();
      },

      redo() {
        redo();
      },

      save() {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        saveNow(canvas);
      },

      load() {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        const json = loadNow(canvas, room, () => onSelectionChangeRef.current?.(null));
        if (json) {
          restyleAllFurniture(canvas);
          historyRef.current = [json];
          historyIndexRef.current = 0;
          scheduleAutosave();
        }
      },

      exportJson() {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        exportJsonFile(canvas);
      },

      importJsonString(json: string) {
        const canvas = fabricCanvasRef.current;
        const room = roomRef.current;
        if (!canvas || !room) return;

        importJson(canvas, room, json, () => onSelectionChangeRef.current?.(null));
        restyleAllFurniture(canvas);

        historyRef.current = [json];
        historyIndexRef.current = 0;
      },
    }),
    []
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-white border border-neutral-300 overflow-hidden"
    >
      <canvas ref={htmlCanvasRef} />
    </div>
  );
});
