import type { Pt } from "../core/planner-types";
import type { WallSegmentLike } from "./wall-manager";
import { sameNode } from "./wall-geometry";

export type DetectedRoom = {
  id: string;
  points: Pt[];
};

type NodeRef = {
  id: string;
  point: Pt;
};

type EdgeRef = {
  id: string;
  wallId: string;
  a: NodeRef;
  b: NodeRef;
};

const MIN_ROOM_EDGES = 3;

function pointKey(p: Pt) {
  return `${p.x.toFixed(3)}:${p.y.toFixed(3)}`;
}

function polygonArea(points: Pt[]) {
  let sum = 0;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }

  return sum / 2;
}

function canonicalRoomKey(points: Pt[]) {
  const keys = points.map(pointKey);
  if (!keys.length) return "";

  let best = keys.join("|");

  for (let i = 1; i < keys.length; i++) {
    const rotated = [...keys.slice(i), ...keys.slice(0, i)].join("|");
    if (rotated < best) best = rotated;
  }

  const reversed = [...keys].reverse();
  for (let i = 0; i < reversed.length; i++) {
    const rotated = [...reversed.slice(i), ...reversed.slice(0, i)].join("|");
    if (rotated < best) best = rotated;
  }

  return best;
}

function buildNodes(walls: WallSegmentLike[]) {
  const nodes: NodeRef[] = [];

  function getOrCreateNode(point: Pt) {
    const found = nodes.find((node) => sameNode(node.point, point));
    if (found) return found;

    const node: NodeRef = {
      id: `node-${nodes.length + 1}`,
      point: { ...point },
    };

    nodes.push(node);
    return node;
  }

  const edges: EdgeRef[] = walls.map((wall, index) => ({
    id: `edge-${index + 1}`,
    wallId: wall.id,
    a: getOrCreateNode(wall.a),
    b: getOrCreateNode(wall.b),
  }));

  return { nodes, edges };
}

function buildAdjacency(edges: EdgeRef[]) {
  const map = new Map<string, EdgeRef[]>();

  for (const edge of edges) {
    if (!map.has(edge.a.id)) map.set(edge.a.id, []);
    if (!map.has(edge.b.id)) map.set(edge.b.id, []);

    map.get(edge.a.id)!.push(edge);
    map.get(edge.b.id)!.push(edge);
  }

  return map;
}

function edgeOtherNode(edge: EdgeRef, nodeId: string) {
  return edge.a.id === nodeId ? edge.b : edge.a;
}

function dfsFindCycles(args: {
  startNode: NodeRef;
  currentNode: NodeRef;
  adjacency: Map<string, EdgeRef[]>;
  visitedEdgeIds: Set<string>;
  pathNodes: NodeRef[];
  found: Pt[][];
}) {
  const {
    startNode,
    currentNode,
    adjacency,
    visitedEdgeIds,
    pathNodes,
    found,
  } = args;

  const edges = adjacency.get(currentNode.id) ?? [];

  for (const edge of edges) {
    if (visitedEdgeIds.has(edge.id)) continue;

    const nextNode = edgeOtherNode(edge, currentNode.id);

    if (pathNodes.length >= MIN_ROOM_EDGES && nextNode.id === startNode.id) {
      found.push(pathNodes.map((node) => ({ ...node.point })));
      continue;
    }

    const alreadyInPath = pathNodes.some((node) => node.id === nextNode.id);
    if (alreadyInPath) continue;

    visitedEdgeIds.add(edge.id);

    dfsFindCycles({
      startNode,
      currentNode: nextNode,
      adjacency,
      visitedEdgeIds,
      pathNodes: [...pathNodes, nextNode],
      found,
    });

    visitedEdgeIds.delete(edge.id);
  }
}

export function detectRoomsFromWalls(walls: WallSegmentLike[]): DetectedRoom[] {
  if (walls.length < 3) return [];

  const { nodes, edges } = buildNodes(walls);
  const adjacency = buildAdjacency(edges);

  const rawCycles: Pt[][] = [];

  for (const node of nodes) {
    dfsFindCycles({
      startNode: node,
      currentNode: node,
      adjacency,
      visitedEdgeIds: new Set<string>(),
      pathNodes: [node],
      found: rawCycles,
    });
  }

  const unique = new Map<string, Pt[]>();

  for (const cycle of rawCycles) {
    if (cycle.length < 3) continue;

    const area = polygonArea(cycle);
    if (Math.abs(area) < 1) continue;

    const normalized = area < 0 ? [...cycle].reverse() : cycle;
    const key = canonicalRoomKey(normalized);

    if (!unique.has(key)) {
      unique.set(key, normalized);
    }
  }

  return Array.from(unique.values()).map((points, index) => ({
    id: `room-${index + 1}`,
    points,
  }));
}
