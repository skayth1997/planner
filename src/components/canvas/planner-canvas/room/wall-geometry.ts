import type { Pt } from "../core/planner-types";

const EPS = 1e-6;

export const MIN_WALL_LENGTH = 12;
export const WALL_ENDPOINT_SNAP_DISTANCE = 14;
export const WALL_CONNECTION_TOLERANCE = 0.5;

export type LinearWallLike = {
  id: string;
  a: Pt;
  b: Pt;
  thickness: number;
};

function subtract(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function cross(a: Pt, b: Pt) {
  return a.x * b.y - a.y * b.x;
}

function dot(a: Pt, b: Pt) {
  return a.x * b.x + a.y * b.y;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function distanceBetween(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isLongEnough(a: Pt, b: Pt) {
  return distanceBetween(a, b) >= MIN_WALL_LENGTH;
}

function pointAt(a: Pt, b: Pt, t: number): Pt {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function projectPointToSegment(point: Pt, a: Pt, b: Pt) {
  const ab = subtract(b, a);
  const abLenSq = dot(ab, ab);

  if (abLenSq <= EPS) {
    return {
      point: { ...a },
      t: 0,
      distance: distanceBetween(point, a),
    };
  }

  const ap = subtract(point, a);
  const rawT = dot(ap, ab) / abLenSq;
  const t = clamp01(rawT);
  const projected = pointAt(a, b, t);

  return {
    point: projected,
    t,
    distance: distanceBetween(point, projected),
  };
}

type IntersectionHit = {
  t: number;
  u: number;
  point: Pt;
};

function samePoint(a: Pt, b: Pt) {
  return distanceBetween(a, b) <= EPS;
}

export function sameNode(a: Pt, b: Pt, tolerance = WALL_CONNECTION_TOLERANCE) {
  return distanceBetween(a, b) <= tolerance;
}

function sharesEndpoint(a: Pt, b: Pt, c: Pt, d: Pt) {
  return (
    samePoint(a, c) || samePoint(a, d) || samePoint(b, c) || samePoint(b, d)
  );
}

function getSegmentIntersection(
  a: Pt,
  b: Pt,
  c: Pt,
  d: Pt
): IntersectionHit | null {
  const r = subtract(b, a);
  const s = subtract(d, c);
  const rxs = cross(r, s);
  const qpxr = cross(subtract(c, a), r);

  if (Math.abs(rxs) <= EPS && Math.abs(qpxr) <= EPS) {
    const rr = dot(r, r);
    if (rr <= EPS) return null;

    const t0 = dot(subtract(c, a), r) / rr;
    const t1 = dot(subtract(d, a), r) / rr;

    const tMin = Math.max(0, Math.min(t0, t1));
    const tMax = Math.min(1, Math.max(t0, t1));

    if (tMax < 0 || tMin > 1 || tMax - tMin <= EPS) {
      return null;
    }

    return {
      t: clamp01(tMin),
      u: 0,
      point: pointAt(a, b, clamp01(tMin)),
    };
  }

  if (Math.abs(rxs) <= EPS) {
    return null;
  }

  const qp = subtract(c, a);
  const t = cross(qp, s) / rxs;
  const u = cross(qp, r) / rxs;

  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) {
    return null;
  }

  return {
    t: clamp01(t),
    u: clamp01(u),
    point: pointAt(a, b, clamp01(t)),
  };
}

export type WallCandidateAnalysis = {
  rawEnd: Pt;
  validEnd: Pt | null;
  invalidFrom: Pt | null;
  blockedAtStart: boolean;
  hasInvalidTail: boolean;
  canCommit: boolean;
};

export type WallConnectionTarget = {
  wall: LinearWallLike;
  point: Pt;
  t: number;
  distance: number;
};

export type WallCrossingTarget = {
  wall: LinearWallLike;
  point: Pt;
  t: number;
};

export type TerminalWallCandidateAnalysis = {
  rawEnd: Pt;
  validEnd: Pt | null;
  invalidFrom: Pt | null;
  blockedAtStart: boolean;
  hasInvalidTail: boolean;
  canCommit: boolean;
  targetWallId: string | null;
  targetPoint: Pt | null;
};

export function findNearestWallEndpoint(args: {
  point: Pt;
  walls: LinearWallLike[];
  ignoreWallId?: string | null;
  ignoreWallIds?: string[];
  maxDistance?: number;
}) {
  const {
    point,
    walls,
    ignoreWallId,
    ignoreWallIds,
    maxDistance = WALL_ENDPOINT_SNAP_DISTANCE,
  } = args;

  const ignoredIds = new Set<string>(ignoreWallIds ?? []);
  if (ignoreWallId) ignoredIds.add(ignoreWallId);

  let bestPoint: Pt | null = null;
  let bestDistance = maxDistance;

  for (const wall of walls) {
    if (ignoredIds.has(wall.id)) continue;

    const da = distanceBetween(point, wall.a);
    if (da <= bestDistance) {
      bestDistance = da;
      bestPoint = wall.a;
    }

    const db = distanceBetween(point, wall.b);
    if (db <= bestDistance) {
      bestDistance = db;
      bestPoint = wall.b;
    }
  }

  return bestPoint ? { ...bestPoint } : null;
}

export function snapPointToWallEndpoint(args: {
  point: Pt;
  walls: LinearWallLike[];
  ignoreWallId?: string | null;
  ignoreWallIds?: string[];
  maxDistance?: number;
}) {
  const snapped = findNearestWallEndpoint(args);
  return snapped ?? args.point;
}

export function findNearestWallConnectionTarget(args: {
  point: Pt;
  walls: LinearWallLike[];
  ignoreWallId?: string | null;
  ignoreWallIds?: string[];
  maxDistance?: number;
}) {
  const {
    point,
    walls,
    ignoreWallId,
    ignoreWallIds,
    maxDistance = 12,
  } = args;

  const ignoredIds = new Set<string>(ignoreWallIds ?? []);
  if (ignoreWallId) ignoredIds.add(ignoreWallId);

  let best: WallConnectionTarget | null = null;

  for (const wall of walls) {
    if (ignoredIds.has(wall.id)) continue;

    const projection = projectPointToSegment(point, wall.a, wall.b);
    if (projection.distance > maxDistance) continue;

    if (!best || projection.distance < best.distance) {
      best = {
        wall,
        point: projection.point,
        t: projection.t,
        distance: projection.distance,
      };
    }
  }

  return best;
}

export function findFirstWallCrossing(args: {
  start: Pt;
  end: Pt;
  walls: LinearWallLike[];
  ignoreWallId?: string | null;
  ignoreWallIds?: string[];
}) {
  const { start, end, walls, ignoreWallId, ignoreWallIds } = args;

  const ignoredIds = new Set<string>(ignoreWallIds ?? []);
  if (ignoreWallId) ignoredIds.add(ignoreWallId);

  let best: WallCrossingTarget | null = null;

  for (const wall of walls) {
    if (ignoredIds.has(wall.id)) continue;

    const hit = getSegmentIntersection(start, end, wall.a, wall.b);
    if (!hit) continue;

    if (sharesEndpoint(start, end, wall.a, wall.b)) continue;
    if (hit.t <= EPS || hit.t >= 1 - EPS) continue;

    if (!best || hit.t < best.t) {
      best = {
        wall,
        point: hit.point,
        t: hit.t,
      };
    }
  }

  return best;
}

export function analyzeWallCandidate(args: {
  start: Pt;
  end: Pt;
  walls: LinearWallLike[];
  ignoreWallId?: string | null;
  ignoreWallIds?: string[];
}) {
  const { start, end, walls, ignoreWallId, ignoreWallIds } = args;

  const ignoredIds = new Set<string>(ignoreWallIds ?? []);
  if (ignoreWallId) ignoredIds.add(ignoreWallId);

  let bestT = 1;
  let hitPoint: Pt | null = null;

  for (const wall of walls) {
    if (ignoredIds.has(wall.id)) continue;

    const hit = getSegmentIntersection(start, end, wall.a, wall.b);
    if (!hit) continue;

    if (sharesEndpoint(start, end, wall.a, wall.b)) continue;
    if (hit.t <= EPS) continue;

    if (hit.t < bestT) {
      bestT = hit.t;
      hitPoint = hit.point;
    }
  }

  const validEnd = hitPoint ?? end;
  const hasInvalidTail = hitPoint
    ? distanceBetween(validEnd, end) > EPS
    : false;
  const canCommit = isLongEnough(start, validEnd);

  return {
    rawEnd: end,
    validEnd,
    invalidFrom: hitPoint,
    blockedAtStart: false,
    hasInvalidTail,
    canCommit,
  };
}

export function analyzeWallCandidateWithTerminalTarget(args: {
  start: Pt;
  rawEnd: Pt;
  walls: LinearWallLike[];
  terminalTarget?: WallConnectionTarget | WallCrossingTarget | null;
  ignoreWallId?: string | null;
  ignoreWallIds?: string[];
}) {
  const {
    start,
    rawEnd,
    walls,
    terminalTarget,
    ignoreWallId,
    ignoreWallIds,
  } = args;

  const ignoredIds = new Set<string>(ignoreWallIds ?? []);
  if (ignoreWallId) ignoredIds.add(ignoreWallId);

  if (terminalTarget) {
    ignoredIds.add(terminalTarget.wall.id);
  }

  const desiredEnd = terminalTarget ? terminalTarget.point : rawEnd;

  let bestT = 1;
  let hitPoint: Pt | null = null;

  for (const wall of walls) {
    if (ignoredIds.has(wall.id)) continue;

    const hit = getSegmentIntersection(start, desiredEnd, wall.a, wall.b);
    if (!hit) continue;

    if (sharesEndpoint(start, desiredEnd, wall.a, wall.b)) continue;
    if (hit.t <= EPS) continue;

    if (hit.t < bestT) {
      bestT = hit.t;
      hitPoint = hit.point;
    }
  }

  if (hitPoint) {
    const validEnd = hitPoint;
    const canCommit = isLongEnough(start, validEnd);

    return {
      rawEnd,
      validEnd,
      invalidFrom: hitPoint,
      blockedAtStart: false,
      hasInvalidTail: distanceBetween(validEnd, desiredEnd) > EPS,
      canCommit,
      targetWallId: null,
      targetPoint: null,
    } as TerminalWallCandidateAnalysis;
  }

  const validEnd = desiredEnd;
  const canCommit = isLongEnough(start, validEnd);

  return {
    rawEnd,
    validEnd,
    invalidFrom: null,
    blockedAtStart: false,
    hasInvalidTail: false,
    canCommit,
    targetWallId: terminalTarget?.wall.id ?? null,
    targetPoint: terminalTarget ? terminalTarget.point : null,
  } as TerminalWallCandidateAnalysis;
}

export function canPlaceSegmentAgainstWalls(args: {
  a: Pt;
  b: Pt;
  walls: LinearWallLike[];
  ignoreWallId?: string | null;
  ignoreWallIds?: string[];
}) {
  const { a, b, walls, ignoreWallId, ignoreWallIds } = args;

  const ignoredIds = new Set<string>(ignoreWallIds ?? []);
  if (ignoreWallId) ignoredIds.add(ignoreWallId);

  if (!isLongEnough(a, b)) return false;

  for (const wall of walls) {
    if (ignoredIds.has(wall.id)) continue;
    if (sharesEndpoint(a, b, wall.a, wall.b)) continue;

    const hit = getSegmentIntersection(a, b, wall.a, wall.b);
    if (!hit) continue;

    return false;
  }

  return true;
}

export function canPlaceSegmentAgainstWallsWithTerminalTarget(args: {
  a: Pt;
  b: Pt;
  walls: LinearWallLike[];
  terminalTarget?: WallConnectionTarget | WallCrossingTarget | null;
  ignoreWallId?: string | null;
  ignoreWallIds?: string[];
}) {
  const {
    a,
    b,
    walls,
    terminalTarget,
    ignoreWallId,
    ignoreWallIds,
  } = args;

  const ignoredIds = new Set<string>(ignoreWallIds ?? []);
  if (ignoreWallId) ignoredIds.add(ignoreWallId);

  if (!isLongEnough(a, b)) return false;

  const terminalWallId = terminalTarget?.wall.id ?? null;

  for (const wall of walls) {
    if (ignoredIds.has(wall.id)) continue;
    if (sharesEndpoint(a, b, wall.a, wall.b)) continue;

    const hit = getSegmentIntersection(a, b, wall.a, wall.b);
    if (!hit) continue;

    if (terminalWallId && wall.id === terminalWallId) {
      const nearEnd = Math.abs(hit.t - 1) <= 0.001;
      if (nearEnd) {
        continue;
      }
    }

    return false;
  }

  return true;
}

export function clampMovedSegmentAgainstWalls(args: {
  a: Pt;
  b: Pt;
  dx: number;
  dy: number;
  walls: LinearWallLike[];
  ignoreWallId?: string | null;
  ignoreWallIds?: string[];
}) {
  const { a, b, dx, dy, walls, ignoreWallId, ignoreWallIds } = args;

  const candidateA = { x: a.x + dx, y: a.y + dy };
  const candidateB = { x: b.x + dx, y: b.y + dy };

  if (
    canPlaceSegmentAgainstWalls({
      a: candidateA,
      b: candidateB,
      walls,
      ignoreWallId,
      ignoreWallIds,
    })
  ) {
    return { dx, dy };
  }

  let low = 0;
  let high = 1;

  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;

    const testA = {
      x: a.x + dx * mid,
      y: a.y + dy * mid,
    };
    const testB = {
      x: b.x + dx * mid,
      y: b.y + dy * mid,
    };

    if (
      canPlaceSegmentAgainstWalls({
        a: testA,
        b: testB,
        walls,
        ignoreWallId,
        ignoreWallIds,
      })
    ) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    dx: dx * low,
    dy: dy * low,
  };
}

export function getLocallyConnectedWallIds(args: {
  rootId: string;
  walls: LinearWallLike[];
  tolerance?: number;
}) {
  const { rootId, walls, tolerance = WALL_CONNECTION_TOLERANCE } = args;

  const root = walls.find((wall) => wall.id === rootId);
  if (!root) return [];

  const ids = new Set<string>();
  ids.add(root.id);

  for (const wall of walls) {
    if (wall.id === root.id) continue;

    const touchesStart =
      sameNode(wall.a, root.a, tolerance) ||
      sameNode(wall.b, root.a, tolerance);

    const touchesEnd =
      sameNode(wall.a, root.b, tolerance) ||
      sameNode(wall.b, root.b, tolerance);

    if (touchesStart || touchesEnd) {
      ids.add(wall.id);
    }
  }

  return Array.from(ids);
}

function wallsShareConnection(
  wallA: LinearWallLike,
  wallB: LinearWallLike,
  tolerance = WALL_CONNECTION_TOLERANCE
) {
  return (
    sameNode(wallA.a, wallB.a, tolerance) ||
    sameNode(wallA.a, wallB.b, tolerance) ||
    sameNode(wallA.b, wallB.a, tolerance) ||
    sameNode(wallA.b, wallB.b, tolerance)
  );
}

export function getConnectedWallIds(args: {
  rootId: string;
  walls: LinearWallLike[];
  tolerance?: number;
}) {
  const { rootId, walls, tolerance = WALL_CONNECTION_TOLERANCE } = args;

  const root = walls.find((wall) => wall.id === rootId);
  if (!root) return [];

  const visited = new Set<string>();
  const queue: string[] = [rootId];

  while (queue.length) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;

    visited.add(currentId);

    const currentWall = walls.find((wall) => wall.id === currentId);
    if (!currentWall) continue;

    for (const candidate of walls) {
      if (visited.has(candidate.id)) continue;

      if (wallsShareConnection(currentWall, candidate, tolerance)) {
        queue.push(candidate.id);
      }
    }
  }

  return Array.from(visited);
}

export function getWallsConnectedToNode(args: {
  node: Pt;
  walls: LinearWallLike[];
  tolerance?: number;
  ignoreWallId?: string | null;
}) {
  const {
    node,
    walls,
    tolerance = WALL_CONNECTION_TOLERANCE,
    ignoreWallId,
  } = args;

  return walls.filter((wall) => {
    if (ignoreWallId && wall.id === ignoreWallId) return false;

    return (
      sameNode(wall.a, node, tolerance) || sameNode(wall.b, node, tolerance)
    );
  });
}

function moveWallNode(wall: LinearWallLike, node: Pt, dx: number, dy: number) {
  const nextA = sameNode(wall.a, node)
    ? { x: wall.a.x + dx, y: wall.a.y + dy }
    : wall.a;

  const nextB = sameNode(wall.b, node)
    ? { x: wall.b.x + dx, y: wall.b.y + dy }
    : wall.b;

  return {
    ...wall,
    a: nextA,
    b: nextB,
  };
}

function canPlaceMovedNodeWallsAgainstWalls(args: {
  movedWalls: LinearWallLike[];
  outsideWalls: LinearWallLike[];
}) {
  const { movedWalls, outsideWalls } = args;

  for (const movedWall of movedWalls) {
    if (!isLongEnough(movedWall.a, movedWall.b)) return false;

    for (const outsideWall of outsideWalls) {
      if (
        sharesEndpoint(movedWall.a, movedWall.b, outsideWall.a, outsideWall.b)
      ) {
        continue;
      }

      const hit = getSegmentIntersection(
        movedWall.a,
        movedWall.b,
        outsideWall.a,
        outsideWall.b
      );

      if (hit) return false;
    }
  }

  return true;
}

export function clampMovedNodeConnectedWallsAgainstWalls(args: {
  node: Pt;
  connectedWalls: LinearWallLike[];
  dx: number;
  dy: number;
  outsideWalls: LinearWallLike[];
}) {
  const { node, connectedWalls, dx, dy, outsideWalls } = args;

  const movedWalls = connectedWalls.map((wall) =>
    moveWallNode(wall, node, dx, dy)
  );

  if (
    canPlaceMovedNodeWallsAgainstWalls({
      movedWalls,
      outsideWalls,
    })
  ) {
    return { dx, dy };
  }

  let low = 0;
  let high = 1;

  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;

    const testWalls = connectedWalls.map((wall) =>
      moveWallNode(wall, node, dx * mid, dy * mid)
    );

    if (
      canPlaceMovedNodeWallsAgainstWalls({
        movedWalls: testWalls,
        outsideWalls,
      })
    ) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    dx: dx * low,
    dy: dy * low,
  };
}

function canPlaceWallGroupAgainstWalls(args: {
  groupWalls: LinearWallLike[];
  outsideWalls: LinearWallLike[];
}) {
  const { groupWalls, outsideWalls } = args;

  for (const groupWall of groupWalls) {
    if (!isLongEnough(groupWall.a, groupWall.b)) return false;

    for (const outsideWall of outsideWalls) {
      if (
        sharesEndpoint(groupWall.a, groupWall.b, outsideWall.a, outsideWall.b)
      ) {
        continue;
      }

      const hit = getSegmentIntersection(
        groupWall.a,
        groupWall.b,
        outsideWall.a,
        outsideWall.b
      );

      if (hit) return false;
    }
  }

  return true;
}

export function clampMovedConnectedWallsAgainstWalls(args: {
  groupWalls: LinearWallLike[];
  dx: number;
  dy: number;
  outsideWalls: LinearWallLike[];
}) {
  const { groupWalls, dx, dy, outsideWalls } = args;

  const movedGroup = groupWalls.map((wall) => ({
    ...wall,
    a: { x: wall.a.x + dx, y: wall.a.y + dy },
    b: { x: wall.b.x + dx, y: wall.b.y + dy },
  }));

  if (
    canPlaceWallGroupAgainstWalls({
      groupWalls: movedGroup,
      outsideWalls,
    })
  ) {
    return { dx, dy };
  }

  let low = 0;
  let high = 1;

  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;

    const testGroup = groupWalls.map((wall) => ({
      ...wall,
      a: { x: wall.a.x + dx * mid, y: wall.a.y + dy * mid },
      b: { x: wall.b.x + dx * mid, y: wall.b.y + dy * mid },
    }));

    if (
      canPlaceWallGroupAgainstWalls({
        groupWalls: testGroup,
        outsideWalls,
      })
    ) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    dx: dx * low,
    dy: dy * low,
  };
}
