"use client";

import { useEffect, useRef } from "react";
import { Canvas, Line, Rect } from "fabric";

export default function PlannerCanvas() {
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);

  useEffect(() => {
    if (!htmlCanvasRef.current) return;

    const canvas = new Canvas(htmlCanvasRef.current, {
      backgroundColor: "#fafafa",
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;

    drawGrid(canvas);
    drawRoom(canvas);
    canvas.renderAll();

    canvas.on("mouse:wheel", (opt) => {
      const event = opt.e as WheelEvent;

      let zoom = canvas.getZoom();
      zoom *= 0.999 ** event.deltaY;
      zoom = Math.min(3, Math.max(0.4, zoom));

      canvas.zoomToPoint({ x: event.offsetX, y: event.offsetY }, zoom);

      event.preventDefault();
      event.stopPropagation();
    });

    let isPanning = false;
    let isSpacePressed = false;
    let lastX = 0;
    let lastY = 0;

    canvas.on("mouse:down", (opt) => {
      if (!isSpacePressed) return;

      const e = opt.e as MouseEvent;
      isPanning = true;
      canvas.selection = false;
      canvas.defaultCursor = "grabbing";
      lastX = e.clientX;
      lastY = e.clientY;
    });

    canvas.on("mouse:move", (opt) => {
      if (!isPanning) return;

      const e = opt.e as MouseEvent;
      const vpt = canvas.viewportTransform!;
      vpt[4] += e.clientX - lastX;
      vpt[5] += e.clientY - lastY;

      canvas.requestRenderAll();

      lastX = e.clientX;
      lastY = e.clientY;
    });

    canvas.on("mouse:up", () => {
      isPanning = false;
      canvas.selection = true;
      canvas.defaultCursor = "default";
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressed = true;
        canvas.defaultCursor = "grab";
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressed = false;
        canvas.defaultCursor = "default";
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    const handleDelete = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key !== "Delete" && e.key !== "Backspace") return;

      const active = canvas.getActiveObject();
      if (!active) return;

      canvas.remove(active);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    };

    window.addEventListener("keydown", handleDelete);

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.id) return;

      if (target.id === "add-sofa") addFurniture(canvas, "sofa");
      if (target.id === "add-table") addFurniture(canvas, "table");
      if (target.id === "add-chair") addFurniture(canvas, "chair");
    };

    window.addEventListener("click", onClick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("keydown", handleDelete);
      window.removeEventListener("click", onClick);

      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, []);

  return (
    <div
      className="relative bg-white border border-neutral-300"
      style={{ width: 1200, height: 800 }}
    >
      <canvas ref={htmlCanvasRef} width={1200} height={800} />
    </div>
  );
}

function drawGrid(canvas: Canvas, gridSize = 50) {
  const width = canvas.getWidth();
  const height = canvas.getHeight();

  for (let x = 0; x <= width; x += gridSize) {
    canvas.add(
      new Line([x, 0, x, height], {
        stroke: "#d1d5db",
        selectable: false,
        evented: false,
        excludeFromExport: true,
      })
    );
  }

  for (let y = 0; y <= height; y += gridSize) {
    canvas.add(
      new Line([0, y, width, y], {
        stroke: "#d1d5db",
        selectable: false,
        evented: false,
        excludeFromExport: true,
      })
    );
  }
}

function drawRoom(canvas: Canvas) {
  const room = new Rect({
    left: 200,
    top: 150,
    width: 600,
    height: 400,
    fill: "rgba(59,130,246,0.15)",
    stroke: "#3b82f6",
    strokeWidth: 3,
    selectable: false,
    evented: false,
  });

  canvas.add(room);
}

function addFurniture(canvas: Canvas, type: "sofa" | "table" | "chair") {
  const base = {
    left: 450,
    top: 300,
    fill: "rgba(16,185,129,0.25)",
    stroke: "#10b981",
    strokeWidth: 2,
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    lockScalingFlip: true,
    transparentCorners: false,
  };

  let obj: Rect;

  if (type === "sofa") {
    obj = new Rect({ ...base, width: 180, height: 80 });
    obj.set({ rx: 10, ry: 10 });
  } else if (type === "table") {
    obj = new Rect({ ...base, width: 120, height: 120 });
  } else {
    obj = new Rect({ ...base, width: 60, height: 60 });
  }

  canvas.add(obj);
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();
}
