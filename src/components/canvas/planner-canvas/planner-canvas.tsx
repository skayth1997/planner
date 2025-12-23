'use client';

import { useEffect, useRef } from 'react';
import { Canvas, Line, Rect } from 'fabric';

export default function PlannerCanvas() {
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);

  useEffect(() => {
    if (!htmlCanvasRef.current) return;

    const canvas = new Canvas(htmlCanvasRef.current, {
      backgroundColor: '#fafafa',
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;

    drawGrid(canvas);
    drawRoom(canvas);

    canvas.renderAll();

    return () => {
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, []);

  return (
    <div className="w-full h-full overflow-hidden">
      <canvas
        ref={htmlCanvasRef}
        width={1200}
        height={800}
        className="border border-neutral-300"
      />
    </div>
  );
}

function drawGrid(canvas: Canvas, gridSize = 50) {
  const width = canvas.getWidth();
  const height = canvas.getHeight();

  for (let x = 0; x <= width; x += gridSize) {
    canvas.add(
      new Line([x, 0, x, height], {
        stroke: '#d1d5db',
        selectable: false,
        evented: false,
        excludeFromExport: true,
      })
    );
  }

  for (let y = 0; y <= height; y += gridSize) {
    canvas.add(
      new Line([0, y, width, y], {
        stroke: '#d1d5db',
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
    fill: 'rgba(59,130,246,0.15)',
    strokeWidth: 3,
    stroke: '#3b82f6',
    selectable: false,
    evented: false,
  });

  canvas.add(room);
}
