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

type SegmentWall = Extract<WallItem, { kind: "segment" }>;

type ConnectedNeighbor = {
  id: string;
  other: Pt;
};

type JoinEndpointData = {
  joinOther: Pt | null;
  tJoinHostOther: Pt | null;
  connectionCount: number;
};

type OuterDimensionChainData = {
  chainStart: Pt;
  chainEnd: Pt;
  ownerWallId: string;
  ownerStartConnected: boolean;
  ownerEndConnected: boolean;
};

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot(a: Pt, b: Pt) {
  return a.x * b.x + a.y * b.y;
}

function length(v: Pt) {
  return Math.hypot(v.x, v.y);
}

function normalize(v: Pt): Pt | null {
  const len = length(v);
  if (len < 0.0001) return null;
  return { x: v.x / len, y: v.y / len };
}

function isCollinearDirection(a: Pt, b: Pt, tolerance = 0.999) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;

  return Math.abs(dot(na, nb)) >= tolerance;
}

function areCollinearSegments(
  a1: Pt,
  a2: Pt,
  b1: Pt,
  b2: Pt,
  tolerance = 0.999
) {
  const da = normalize(sub(a2, a1));
  const db = normalize(sub(b2, b1));
  if (!da || !db) return false;

  if (Math.abs(dot(da, db)) < tolerance) {
    return false;
  }

  const ab = sub(b1, a1);
  const cross = da.x * ab.y - da.y * ab.x;
  return Math.abs(cross) < 0.001;
}

function pointKey(p: Pt) {
  return `${p.x.toFixed(3)}:${p.y.toFixed(3)}`;
}

function minPoint(a: Pt, b: Pt) {
  if (a.x !== b.x) return a.x < b.x ? a : b;
  return a.y <= b.y ? a : b;
}

function maxPoint(a: Pt, b: Pt) {
  if (a.x !== b.x) return a.x > b.x ? a : b;
  return a.y >= b.y ? a : b;
}

function comparePoints(a: Pt, b: Pt) {
  if (a.x !== b.x) return a.x - b.x;
  return a.y - b.y;
}

function analyzeEndpointJoin(args: {
  node: Pt;
  otherSelf: Pt;
  neighbors: ConnectedNeighbor[];
}): JoinEndpointData {
  const { node, otherSelf, neighbors } = args;

  if (!neighbors.length) {
    return {
      joinOther: null,
      tJoinHostOther: null,
      connectionCount: 0,
    };
  }

  if (neighbors.length === 1) {
    return {
      joinOther: neighbors[0].other,
      tJoinHostOther: null,
      connectionCount: 1,
    };
  }

  const selfDir = normalize(sub(otherSelf, node));
  if (!selfDir) {
    return {
      joinOther: null,
      tJoinHostOther: null,
      connectionCount: neighbors.length,
    };
  }

  const collinearNeighbors: ConnectedNeighbor[] = [];
  const perpendicularNeighbors: ConnectedNeighbor[] = [];

  for (const neighbor of neighbors) {
    const neighborDir = normalize(sub(neighbor.other, node));
    if (!neighborDir) continue;

    if (isCollinearDirection(selfDir, neighborDir)) {
      collinearNeighbors.push(neighbor);
    } else {
      perpendicularNeighbors.push(neighbor);
    }
  }

  if (collinearNeighbors.length >= 1 && perpendicularNeighbors.length >= 1) {
    return {
      joinOther: perpendicularNeighbors[0].other,
      tJoinHostOther: null,
      connectionCount: neighbors.length,
    };
  }

  if (collinearNeighbors.length === 0 && perpendicularNeighbors.length >= 2) {
    return {
      joinOther: null,
      tJoinHostOther: perpendicularNeighbors[0].other,
      connectionCount: neighbors.length,
    };
  }

  return {
    joinOther: perpendicularNeighbors[0]?.other ?? neighbors[0]?.other ?? null,
    tJoinHostOther: null,
    connectionCount: neighbors.length,
  };
}

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
      .filter((wall): wall is SegmentWall => wall.kind === "segment")
      .map((wall) => ({
        id: wall.id,
        a: wall.a,
        b: wall.b,
        thickness: wall.thickness,
      }));
  };

  const getFitObjects = () => walls.map((wall) => wall.visual.band);

  const getConnectedNeighborsAtNode = (wall: SegmentWall, node: Pt) => {
    const linearWalls = getLinearWalls().filter((item) => item.id !== wall.id);

    return linearWalls
      .filter((item) => sameNode(item.a, node) || sameNode(item.b, node))
      .map((item) => ({
        id: item.id,
        other: sameNode(item.a, node) ? item.b : item.a,
      }));
  };

  const getJoinData = (wall: SegmentWall) => {
    const startNeighbors = getConnectedNeighborsAtNode(wall, wall.a);
    const endNeighbors = getConnectedNeighborsAtNode(wall, wall.b);

    const start = analyzeEndpointJoin({
      node: wall.a,
      otherSelf: wall.b,
      neighbors: startNeighbors,
    });

    const end = analyzeEndpointJoin({
      node: wall.b,
      otherSelf: wall.a,
      neighbors: endNeighbors,
    });

    return {
      startJoinOther: start.joinOther,
      endJoinOther: end.joinOther,
      startTJoinHostOther: start.tJoinHostOther,
      endTJoinHostOther: end.tJoinHostOther,
      startConnectionCount: start.connectionCount,
      endConnectionCount: end.connectionCount,
    };
  };

  const findCollinearChainForWall = (wall: SegmentWall): SegmentWall[] => {
    const dir = normalize(sub(wall.b, wall.a));
    if (!dir) return [wall];

    const segmentWalls = walls.filter(
      (item): item is SegmentWall => item.kind === "segment"
    );

    const result: SegmentWall[] = [];
    const queue: SegmentWall[] = [wall];
    const visited = new Set<string>();

    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;

      visited.add(current.id);
      result.push(current);

      const currentDir = normalize(sub(current.b, current.a));
      if (!currentDir || !isCollinearDirection(dir, currentDir)) continue;

      for (const candidate of segmentWalls) {
        if (visited.has(candidate.id)) continue;

        const candidateDir = normalize(sub(candidate.b, candidate.a));
        if (!candidateDir || !isCollinearDirection(dir, candidateDir)) continue;

        const sharesNode =
          sameNode(candidate.a, current.a) ||
          sameNode(candidate.a, current.b) ||
          sameNode(candidate.b, current.a) ||
          sameNode(candidate.b, current.b);

        if (sharesNode) {
          queue.push(candidate);
        }
      }
    }

    return result;
  };

  const getOuterDimensionChainData = (
    wall: SegmentWall
  ): OuterDimensionChainData | null => {
    const chain = findCollinearChainForWall(wall);
    if (chain.length <= 1) return null;

    const dir = normalize(sub(wall.b, wall.a));
    if (!dir) return null;

    const endpointUseCount = new Map<string, number>();
    const pointByKey = new Map<string, Pt>();

    for (const item of chain) {
      const aKey = pointKey(item.a);
      const bKey = pointKey(item.b);

      endpointUseCount.set(aKey, (endpointUseCount.get(aKey) ?? 0) + 1);
      endpointUseCount.set(bKey, (endpointUseCount.get(bKey) ?? 0) + 1);

      pointByKey.set(aKey, item.a);
      pointByKey.set(bKey, item.b);
    }

    const chainEnds = Array.from(endpointUseCount.entries())
      .filter(([, count]) => count === 1)
      .map(([key]) => pointByKey.get(key)!)
      .sort(comparePoints);

    if (chainEnds.length !== 2) {
      return null;
    }

    const chainStart = minPoint(chainEnds[0], chainEnds[1]);
    const chainEnd = maxPoint(chainEnds[0], chainEnds[1]);

    const ownerWall = chain.slice().sort((a, b) => a.id.localeCompare(b.id))[0];

    return {
      chainStart,
      chainEnd,
      ownerWallId: ownerWall.id,
      ownerStartConnected: false,
      ownerEndConnected: false,
    };
  };

  const refreshSegmentWallGraphics = (wall: SegmentWall) => {
    const joinData = getJoinData(wall);
    const outerChain = getOuterDimensionChainData(wall);

    updateWallStripVisual(wall.visual, wall.a, wall.b, wall.thickness, {
      selectable: false,
      evented: true,
      startJoinOther: joinData.startJoinOther,
      endJoinOther: joinData.endJoinOther,
      startConnectionCount: joinData.startConnectionCount,
      endConnectionCount: joinData.endConnectionCount,
      startTJoinHostOther: joinData.startTJoinHostOther,
      endTJoinHostOther: joinData.endTJoinHostOther,
      showStartCap: joinData.startConnectionCount === 0,
      showEndCap: joinData.endConnectionCount === 0,
    });

    removeWallDimensions(canvas, wall.dimensions);

    const startIsCorner =
      joinData.startConnectionCount > 0 &&
      !joinData.startTJoinHostOther &&
      !!joinData.startJoinOther;

    const endIsCorner =
      joinData.endConnectionCount > 0 &&
      !joinData.endTJoinHostOther &&
      !!joinData.endJoinOther;

    const topStartTickVisible =
      startIsCorner || joinData.startConnectionCount === 0;
    const topEndTickVisible = endIsCorner || joinData.endConnectionCount === 0;

    const bottomStartTickVisible =
      startIsCorner || joinData.startConnectionCount === 0;

    const bottomEndTickVisible =
      endIsCorner || joinData.endConnectionCount === 0;

    wall.dimensions = createWallDimensions(
      canvas,
      wall.a,
      wall.b,
      wall.thickness,
      {
        showStartThickness: joinData.startConnectionCount === 0,
        showEndThickness: joinData.endConnectionCount === 0,
        startJoinOther: joinData.startJoinOther,
        endJoinOther: joinData.endJoinOther,
        startConnected: joinData.startConnectionCount > 0,
        endConnected: joinData.endConnectionCount > 0,
        startConnectionCount: joinData.startConnectionCount,
        endConnectionCount: joinData.endConnectionCount,
        startTJoinHostOther: joinData.startTJoinHostOther,
        endTJoinHostOther: joinData.endTJoinHostOther,
        outerDimensionChainStart: outerChain?.chainStart ?? null,
        outerDimensionChainEnd: outerChain?.chainEnd ?? null,
        outerDimensionVisible: outerChain
          ? outerChain.ownerWallId === wall.id
          : true,
        outerDimensionStartConnected: outerChain
          ? outerChain.ownerStartConnected
          : joinData.startConnectionCount > 0,
        outerDimensionEndConnected: outerChain
          ? outerChain.ownerEndConnected
          : joinData.endConnectionCount > 0,
        topStartTickVisible,
        topEndTickVisible,
        bottomStartTickVisible,
        bottomEndTickVisible,
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
  }): SegmentWall => {
    const id = `wall-${wallCounter++}`;

    const visual = createWallStripVisual(args.a, args.b, args.thickness, {
      kind: "wall-segment",
      selectable: false,
      evented: true,
      startJoinOther: null,
      endJoinOther: null,
      startConnectionCount: 0,
      endConnectionCount: 0,
      startTJoinHostOther: null,
      endTJoinHostOther: null,
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
        startConnected: false,
        endConnected: false,
        startConnectionCount: 0,
        endConnectionCount: 0,
        startTJoinHostOther: null,
        endTJoinHostOther: null,
        outerDimensionChainStart: null,
        outerDimensionChainEnd: null,
        outerDimensionVisible: true,
        outerDimensionStartConnected: false,
        outerDimensionEndConnected: false,
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

    const distToStart = distanceBetween(splitPoint, wall.a);
    const distToEnd = distanceBetween(splitPoint, wall.b);

    if (distToStart < 12 || sameNode(splitPoint, wall.a)) {
      return { ...wall.a };
    }

    if (distToEnd < 12 || sameNode(splitPoint, wall.b)) {
      return { ...wall.b };
    }

    if (
      !isLongEnough(wall.a, splitPoint) ||
      !isLongEnough(splitPoint, wall.b)
    ) {
      return distToStart <= distToEnd ? { ...wall.a } : { ...wall.b };
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

    return { ...splitPoint };
  };

  const tryMergeWallsOnce = () => {
    const segmentWalls = walls.filter(
      (item): item is SegmentWall => item.kind === "segment"
    );

    for (let i = 0; i < segmentWalls.length; i++) {
      const w1 = segmentWalls[i];

      for (let j = i + 1; j < segmentWalls.length; j++) {
        const w2 = segmentWalls[j];

        if (w1.id === w2.id) continue;
        if (w1.thickness !== w2.thickness) continue;

        let shared: Pt | null = null;

        if (sameNode(w1.a, w2.a)) shared = w1.a;
        else if (sameNode(w1.a, w2.b)) shared = w1.a;
        else if (sameNode(w1.b, w2.a)) shared = w1.b;
        else if (sameNode(w1.b, w2.b)) shared = w1.b;

        if (!shared) continue;

        if (!areCollinearSegments(w1.a, w1.b, w2.a, w2.b)) continue;

        const endpoints: Pt[] = [];

        const addUniquePoint = (point: Pt) => {
          if (!endpoints.some((p) => sameNode(p, point))) {
            endpoints.push({ ...point });
          }
        };

        if (!sameNode(w1.a, shared)) addUniquePoint(w1.a);
        if (!sameNode(w1.b, shared)) addUniquePoint(w1.b);
        if (!sameNode(w2.a, shared)) addUniquePoint(w2.a);
        if (!sameNode(w2.b, shared)) addUniquePoint(w2.b);

        if (endpoints.length !== 2) continue;
        if (!isLongEnough(endpoints[0], endpoints[1])) continue;

        removeWallStripVisual(canvas, w1.visual);
        removeWallDimensions(canvas, w1.dimensions);
        removeWallStripVisual(canvas, w2.visual);
        removeWallDimensions(canvas, w2.dimensions);

        const index1 = walls.findIndex((wall) => wall.id === w1.id);
        const index2 = walls.findIndex((wall) => wall.id === w2.id);

        const indexes = [index1, index2]
          .filter((index) => index !== -1)
          .sort((a, b) => b - a);

        for (const index of indexes) {
          walls.splice(index, 1);
        }

        const mergedWall = createSegmentWallItem({
          a: endpoints[0],
          b: endpoints[1],
          thickness: w1.thickness,
        });

        walls.push(mergedWall);
        return true;
      }
    }

    return false;
  };

  const normalizeWallGraph = () => {
    let merged = true;

    while (merged) {
      merged = tryMergeWallsOnce();
    }
  };

  const removeWall = (id: string) => {
    const index = walls.findIndex((wall) => wall.id === id);
    if (index === -1) return;

    const wall = walls[index];

    removeWallStripVisual(canvas, wall.visual);
    removeWallDimensions(canvas, wall.dimensions);

    walls.splice(index, 1);

    normalizeWallGraph();

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
