import { Line as FabricLine } from "fabric";
import type { Canvas, Line } from "fabric";

type Args = {
  canvas: Canvas;
  scheduleRender: () => void;
  initial: {
    visible: boolean;
    size: number;
  };
};

function toSceneX(canvas: Canvas, viewportX: number) {
  const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  return (viewportX - vpt[4]) / vpt[0];
}

function toSceneY(canvas: Canvas, viewportY: number) {
  const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  return (viewportY - vpt[5]) / vpt[3];
}

function getVisibleSceneBounds(canvas: Canvas) {
  const width = canvas.getWidth();
  const height = canvas.getHeight();

  const left = toSceneX(canvas, 0);
  const top = toSceneY(canvas, 0);
  const right = toSceneX(canvas, width);
  const bottom = toSceneY(canvas, height);

  return {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
  };
}

function makeLine(
  coords: [number, number, number, number],
  options: {
    stroke: string;
    strokeWidth: number;
    kind: "grid-line-minor" | "grid-line-major";
  }
) {
  const line = (new FabricLine(coords, {
    stroke: options.stroke,
    strokeWidth: options.strokeWidth,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
  }) as unknown) as Line;

  (line as any).data = { kind: options.kind };

  return line;
}

function drawGridLines(canvas: Canvas, gridSize: number) {
  const lines: Line[] = [];

  const bounds = getVisibleSceneBounds(canvas);

  const startX = Math.floor(bounds.left / gridSize) * gridSize;
  const endX = Math.ceil(bounds.right / gridSize) * gridSize;

  const startY = Math.floor(bounds.top / gridSize) * gridSize;
  const endY = Math.ceil(bounds.bottom / gridSize) * gridSize;

  const majorStep = gridSize * 5;

  for (let x = startX; x <= endX; x += gridSize) {
    const isMajor = Math.round(x) % majorStep === 0;

    const line = new FabricLine([x, startY, x, endY], {
      stroke: isMajor ? "#cfd4dc" : "#e5e7eb",
      strokeWidth: isMajor ? 1.2 : 1,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
    }) as unknown as Line;

    (line as any).data = {
      kind: isMajor ? "grid-line-major" : "grid-line",
    };

    canvas.add(line as any);
    lines.push(line);
  }

  for (let y = startY; y <= endY; y += gridSize) {
    const isMajor = Math.round(y) % majorStep === 0;

    const line = new FabricLine([startX, y, endX, y], {
      stroke: isMajor ? "#cfd4dc" : "#e5e7eb",
      strokeWidth: isMajor ? 1.2 : 1,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
    }) as unknown as Line;

    (line as any).data = {
      kind: isMajor ? "grid-line-major" : "grid-line",
    };

    canvas.add(line as any);
    lines.push(line);
  }

  return lines;
}

export function createGridController(args: Args) {
  const { canvas, scheduleRender, initial } = args;

  let visible = initial.visible;
  let size = initial.size;
  let lines: Line[] = [];

  const clearLines = () => {
    for (const line of lines) {
      canvas.remove(line as any);
    }
    lines = [];
  };

  const restack = () => {
    for (const line of lines) {
      canvas.sendObjectToBack(line as any);
    }
  };

  const rebuild = () => {
    clearLines();

    if (visible) {
      lines = drawGridLines(canvas, size);
      restack();
    }

    scheduleRender();
  };

  const setVisible = (next: boolean) => {
    visible = !!next;
    rebuild();
  };

  const setSize = (next: number) => {
    const n = Number(next);
    if (!Number.isFinite(n) || n <= 5) return;

    size = n;
    rebuild();
  };

  const getSize = () => size;
  const isVisible = () => visible;

  const dispose = () => {
    clearLines();
  };

  return {
    rebuild,
    setVisible,
    setSize,
    getSize,
    isVisible,
    restack,
    dispose,
  };
}
