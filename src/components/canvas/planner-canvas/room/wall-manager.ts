import type { Canvas } from "fabric";
import type { Pt } from "../core/planner-types";
import type { WallDimensionVisual } from "./wall-dimensions";
import { createWallDimensions, removeWallDimensions } from "./wall-dimensions";
import {
  addWallStripVisualToCanvas,
  createWallStripVisual,
  removeWallStripVisual,
  updateWallStripVisual,
} from "./room-visual";
import type { WallStripVisual } from "./room-visual";
import {
  clampMovedNodeConnectedWallsAgainstWalls,
  distanceBetween,
  getWallsConnectedToNode,
  isLongEnough,
  projectPointToSegment,
  sameNode,
} from "./wall-geometry";

export type WallKind = "segment" | "block";

export type WallItem =
  | {
      id: string;
      kind: "segment";
      a: Pt;
      b: Pt;
      thickness: number;
      visual: WallStripVisual;
      dimensions: WallDimensionVisual;
    }
  | {
      id: string;
      kind: "block";
      center: Pt;
      size: number;
      thickness: number;
      visual: WallStripVisual;
      dimensions: null;
    };

export type WallSegmentLike = {
  id: string;
  a: Pt;
  b: Pt;
  thickness: number;
};

export function createWallManager(args: {
  canvas: Canvas;
  onChange?: () => void;
}) {
  const { canvas, onChange } = args;

  const walls: WallItem[] = [];
  let wallCounter = 1;
  let defaultThickness = 10;

  const getWalls = () => walls;

  const getWallById = (id: string) =>
    walls.find((wall) => wall.id === id) ?? null;

  const getDefaultThickness = () => defaultThickness;

  const setDefaultThickness = (next: number) => {
    const n = Number(next);
    if (!Number.isFinite(n) || n <= 0) return;
    defaultThickness = n;
  };

  const getLinearWalls = (): WallSegmentLike[] => {
    return walls
      .filter((wall): wall is Extract<WallItem, { kind: "segment" }> => {
        return wall.kind === "segment";
      })
      .map((wall) => ({
        id: wall.id,
        a: wall.a,
        b: wall.b,
        thickness: wall.thickness,
      }));
  };

  const getFitObjects = () => walls.map((wall) => wall.visual.band);

  const getConnectedEndpointVisibility = (
    wall: Extract<WallItem, { kind: "segment" }>
  ) => {
    const linearWalls = getLinearWalls().filter((item) => item.id !== wall.id);

    const startConnected = linearWalls.some(
      (item) => sameNode(item.a, wall.a) || sameNode(item.b, wall.a)
    );

    const endConnected = linearWalls.some(
      (item) => sameNode(item.a, wall.b) || sameNode(item.b, wall.b)
    );

    return {
      showStartThickness: !startConnected,
      showEndThickness: !endConnected,
    };
  };

  const getSingleJoinNeighborOtherPoint = (
    wall: Extract<WallItem, { kind: "segment" }>,
    node: Pt
  ): Pt | null => {
    const linearWalls = getLinearWalls().filter((item) => item.id !== wall.id);

    const connected = linearWalls.filter(
      (item) => sameNode(item.a, node) || sameNode(item.b, node)
    );

    if (connected.length !== 1) return null;

    const neighbor = connected[0];
    return sameNode(neighbor.a, node) ? neighbor.b : neighbor.a;
  };

  const getJoinData = (wall: Extract<WallItem, { kind: "segment" }>) => {
    const startJoinOther = getSingleJoinNeighborOtherPoint(wall, wall.a);
    const endJoinOther = getSingleJoinNeighborOtherPoint(wall, wall.b);

    return {
      startJoinOther,
      endJoinOther,
    };
  };

  const refreshSegmentWallGraphics = (
    wall: Extract<WallItem, { kind: "segment" }>
  ) => {
    const visibility = getConnectedEndpointVisibility(wall);
    const joinData = getJoinData(wall);

    updateWallStripVisual(wall.visual, wall.a, wall.b, wall.thickness, {
      selectable: false,
      evented: true,
      startJoinOther: joinData.startJoinOther,
      endJoinOther: joinData.endJoinOther,
      showStartCap: visibility.showStartThickness,
      showEndCap: visibility.showEndThickness,
    });

    removeWallDimensions(canvas, wall.dimensions);

    wall.dimensions = createWallDimensions(
      canvas,
      wall.a,
      wall.b,
      wall.thickness,
      {
        ...visibility,
        startJoinOther: joinData.startJoinOther,
        endJoinOther: joinData.endJoinOther,
      }
    );
  };

  const refreshAllSegmentWalls = () => {
    const updated: WallItem[] = [];

    for (const wall of walls) {
      if (wall.kind !== "segment") continue;

      refreshSegmentWallGraphics(wall);
      updated.push(wall);
    }

    return updated;
  };

  const createSegmentWallItem = (args: {
    a: Pt;
    b: Pt;
    thickness: number;
  }): Extract<WallItem, { kind: "segment" }> => {
    const id = `wall-${wallCounter++}`;

    const visual = createWallStripVisual(args.a, args.b, args.thickness, {
      kind: "wall-segment",
      selectable: false,
      evented: true,
      startJoinOther: null,
      endJoinOther: null,
      showStartCap: true,
      showEndCap: true,
    });

    (visual.band as any).data = {
      kind: "wall-segment",
      id,
    };

    addWallStripVisualToCanvas(canvas, visual);

    const dimensions = createWallDimensions(
      canvas,
      args.a,
      args.b,
      args.thickness,
      {
        showStartThickness: true,
        showEndThickness: true,
        startJoinOther: null,
        endJoinOther: null,
      }
    );

    return {
      id,
      kind: "segment",
      a: args.a,
      b: args.b,
      thickness: args.thickness,
      visual,
      dimensions,
    };
  };

  const addSegmentWall = (args: { a: Pt; b: Pt; thickness?: number }) => {
    console.log("[addSegmentWall]", {
      a: args.a,
      b: args.b,
      thickness: args.thickness ?? defaultThickness,
    });

    const thickness = args.thickness ?? defaultThickness;

    const wall = createSegmentWallItem({
      a: args.a,
      b: args.b,
      thickness,
    });

    walls.push(wall);
    refreshAllSegmentWalls();
    onChange?.();

    return wall;
  };

  const addBlockWall = (args: {
    center: Pt;
    size?: number;
    thickness?: number;
  }) => {
    const thickness = args.thickness ?? defaultThickness;
    const size = args.size ?? thickness;
    const half = size / 2;

    const a: Pt = {
      x: args.center.x - half,
      y: args.center.y,
    };

    const b: Pt = {
      x: args.center.x + half,
      y: args.center.y,
    };

    const id = `wall-${wallCounter++}`;

    const visual = createWallStripVisual(a, b, thickness, {
      kind: "wall-block",
      selectable: false,
      evented: true,
      showStartCap: true,
      showEndCap: true,
    });

    visual.band.set({
      scaleY: thickness > 0 ? size / thickness : 1,
    });
    visual.band.setCoords();

    (visual.band as any).data = {
      kind: "wall-block",
      id,
    };

    addWallStripVisualToCanvas(canvas, visual);

    const wall: WallItem = {
      id,
      kind: "block",
      center: args.center,
      size,
      thickness,
      visual,
      dimensions: null,
    };

    walls.push(wall);
    onChange?.();

    return wall;
  };

  const updateSegmentWall = (args: { id: string; a: Pt; b: Pt }) => {
    const wall = getWallById(args.id);
    if (!wall || wall.kind !== "segment") return null;

    wall.a = args.a;
    wall.b = args.b;

    refreshAllSegmentWalls();
    onChange?.();

    return wall;
  };

  const moveSegmentWall = (args: { id: string; dx: number; dy: number }) => {
    const wall = getWallById(args.id);
    if (!wall || wall.kind !== "segment") return null;

    wall.a = {
      x: wall.a.x + args.dx,
      y: wall.a.y + args.dy,
    };

    wall.b = {
      x: wall.b.x + args.dx,
      y: wall.b.y + args.dy,
    };

    refreshAllSegmentWalls();
    onChange?.();

    return wall;
  };

  const moveConnectedNode = (args: {
    rootId: string;
    nodeRole: "start" | "end";
    dx: number;
    dy: number;
  }) => {
    const rootWall = getWallById(args.rootId);
    if (!rootWall || rootWall.kind !== "segment") return [];

    const node = args.nodeRole === "start" ? rootWall.a : rootWall.b;

    const linearWalls = getLinearWalls();
    const connectedWalls = getWallsConnectedToNode({
      node,
      walls: linearWalls,
    });

    if (!connectedWalls.length) return [];

    const connectedIds = new Set(connectedWalls.map((wall) => wall.id));
    const outsideWalls = linearWalls.filter(
      (wall) => !connectedIds.has(wall.id)
    );

    const clamped = clampMovedNodeConnectedWallsAgainstWalls({
      node,
      connectedWalls,
      outsideWalls,
      dx: args.dx,
      dy: args.dy,
    });

    for (const connectedWall of connectedWalls) {
      const wall = getWallById(connectedWall.id);
      if (!wall || wall.kind !== "segment") continue;

      if (sameNode(wall.a, node)) {
        wall.a = {
          x: wall.a.x + clamped.dx,
          y: wall.a.y + clamped.dy,
        };
      }

      if (sameNode(wall.b, node)) {
        wall.b = {
          x: wall.b.x + clamped.dx,
          y: wall.b.y + clamped.dy,
        };
      }
    }

    const updated = refreshAllSegmentWalls();
    onChange?.();
    return updated;
  };

  const offsetWallWithConnectedEnds = (args: {
    rootId: string;
    dx: number;
    dy: number;
  }) => {
    const rootWall = getWallById(args.rootId);
    if (!rootWall || rootWall.kind !== "segment") return [];

    const originalStart: Pt = { ...rootWall.a };
    const originalEnd: Pt = { ...rootWall.b };

    const linearWalls = getLinearWalls();

    const startConnectedWalls = getWallsConnectedToNode({
      node: originalStart,
      walls: linearWalls,
      ignoreWallId: rootWall.id,
    });

    const endConnectedWalls = getWallsConnectedToNode({
      node: originalEnd,
      walls: linearWalls,
      ignoreWallId: rootWall.id,
    });

    const affectedIds = new Set<string>([
      rootWall.id,
      ...startConnectedWalls.map((wall) => wall.id),
      ...endConnectedWalls.map((wall) => wall.id),
    ]);

    const outsideWalls = linearWalls.filter(
      (wall) => !affectedIds.has(wall.id)
    );

    const startClamp = clampMovedNodeConnectedWallsAgainstWalls({
      node: originalStart,
      connectedWalls: [
        {
          id: rootWall.id,
          a: originalStart,
          b: originalEnd,
          thickness: rootWall.thickness,
        },
        ...startConnectedWalls,
      ],
      outsideWalls,
      dx: args.dx,
      dy: args.dy,
    });

    const endClamp = clampMovedNodeConnectedWallsAgainstWalls({
      node: originalEnd,
      connectedWalls: [
        {
          id: rootWall.id,
          a: originalStart,
          b: originalEnd,
          thickness: rootWall.thickness,
        },
        ...endConnectedWalls,
      ],
      outsideWalls,
      dx: args.dx,
      dy: args.dy,
    });

    const finalDx =
      Math.abs(startClamp.dx) <= Math.abs(endClamp.dx)
        ? startClamp.dx
        : endClamp.dx;

    const finalDy =
      Math.abs(startClamp.dy) <= Math.abs(endClamp.dy)
        ? startClamp.dy
        : endClamp.dy;

    rootWall.a = {
      x: originalStart.x + finalDx,
      y: originalStart.y + finalDy,
    };
    rootWall.b = {
      x: originalEnd.x + finalDx,
      y: originalEnd.y + finalDy,
    };

    for (const connectedInfo of startConnectedWalls) {
      const wall = getWallById(connectedInfo.id);
      if (!wall || wall.kind !== "segment") continue;

      if (sameNode(wall.a, originalStart)) {
        wall.a = {
          x: wall.a.x + finalDx,
          y: wall.a.y + finalDy,
        };
      }

      if (sameNode(wall.b, originalStart)) {
        wall.b = {
          x: wall.b.x + finalDx,
          y: wall.b.y + finalDy,
        };
      }
    }

    for (const connectedInfo of endConnectedWalls) {
      const wall = getWallById(connectedInfo.id);
      if (!wall || wall.kind !== "segment") continue;

      if (sameNode(wall.a, originalEnd)) {
        wall.a = {
          x: wall.a.x + finalDx,
          y: wall.a.y + finalDy,
        };
      }

      if (sameNode(wall.b, originalEnd)) {
        wall.b = {
          x: wall.b.x + finalDx,
          y: wall.b.y + finalDy,
        };
      }
    }

    const updated = refreshAllSegmentWalls();
    onChange?.();
    return updated;
  };

  const splitSegmentWallAtPoint = (args: { id: string; point: Pt }) => {
    const wall = getWallById(args.id);
    if (!wall || wall.kind !== "segment") return null;

    const projection = projectPointToSegment(args.point, wall.a, wall.b);
    const splitPoint = projection.point;

    console.log("[splitSegmentWallAtPoint:input]", {
      wallId: args.id,
      clickPoint: args.point,
      splitPoint,
      wallA: wall.a,
      wallB: wall.b,
    });

    const distToStart = distanceBetween(splitPoint, wall.a);
    const distToEnd = distanceBetween(splitPoint, wall.b);

    if (distToStart < 12 || sameNode(splitPoint, wall.a)) {
      console.log("[splitSegmentWallAtPoint:return-start]", {
        returned: wall.a,
      });
      return { ...wall.a };
    }

    if (distToEnd < 12 || sameNode(splitPoint, wall.b)) {
      console.log("[splitSegmentWallAtPoint:return-end]", {
        returned: wall.b,
      });
      return { ...wall.b };
    }

    if (
      !isLongEnough(wall.a, splitPoint) ||
      !isLongEnough(splitPoint, wall.b)
    ) {
      const fallback = distToStart <= distToEnd ? { ...wall.a } : { ...wall.b };

      console.log("[splitSegmentWallAtPoint:return-fallback]", {
        returned: fallback,
      });

      return fallback;
    }

    const index = walls.findIndex((item) => item.id === wall.id);
    if (index === -1) return null;

    removeWallStripVisual(canvas, wall.visual);
    removeWallDimensions(canvas, wall.dimensions);
    walls.splice(index, 1);

    const first = createSegmentWallItem({
      a: { ...wall.a },
      b: { ...splitPoint },
      thickness: wall.thickness,
    });

    const second = createSegmentWallItem({
      a: { ...splitPoint },
      b: { ...wall.b },
      thickness: wall.thickness,
    });

    walls.splice(index, 0, first, second);

    refreshAllSegmentWalls();
    onChange?.();

    console.log("[splitSegmentWallAtPoint:created]", {
      originalWallId: wall.id,
      firstWall: { id: first.id, a: first.a, b: first.b },
      secondWall: { id: second.id, a: second.a, b: second.b },
      returned: splitPoint,
    });

    const connectedAtSplit = getLinearWalls().filter(
      (item) => sameNode(item.a, splitPoint) || sameNode(item.b, splitPoint)
    );

    console.log("[splitSegmentWallAtPoint:connectedAtSplit]", {
      splitPoint,
      connectedWalls: connectedAtSplit.map((w) => ({
        id: w.id,
        a: w.a,
        b: w.b,
      })),
    });

    return { ...splitPoint };
  };

  const removeWall = (id: string) => {
    const index = walls.findIndex((wall) => wall.id === id);
    if (index === -1) return;

    const wall = walls[index];

    removeWallStripVisual(canvas, wall.visual);
    removeWallDimensions(canvas, wall.dimensions);

    walls.splice(index, 1);
    refreshAllSegmentWalls();
    onChange?.();
  };

  const clear = () => {
    for (const wall of walls) {
      removeWallStripVisual(canvas, wall.visual);
      removeWallDimensions(canvas, wall.dimensions);
    }

    walls.length = 0;
    onChange?.();
  };

  const dispose = () => {
    clear();
  };

  return {
    getWalls,
    getWallById,
    getLinearWalls,
    getFitObjects,
    getDefaultThickness,
    setDefaultThickness,
    addSegmentWall,
    addBlockWall,
    updateSegmentWall,
    moveSegmentWall,
    moveConnectedNode,
    offsetWallWithConnectedEnds,
    splitSegmentWallAtPoint,
    removeWall,
    clear,
    dispose,
  };
}
