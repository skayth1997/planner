import type { Canvas, Line, Text } from "fabric";
import { Line as FabricLine, Text as FabricText } from "fabric";
import type { Pt } from "../core/planner-types";
import { buildWallStripPoints } from "./room-visual";

export type WallDimensionVisual = {
  topLineLeft: Line;
  topLineRight: Line;
  bottomLineLeft: Line;
  bottomLineRight: Line;

  startTopTick: Line;
  startBottomTick: Line;
  endTopTick: Line;
  endBottomTick: Line;

  topText: Text;
  bottomText: Text;

  startThicknessLine: Line | null;
  endThicknessLine: Line | null;

  startThicknessTickA: Line | null;
  startThicknessTickB: Line | null;
  endThicknessTickA: Line | null;
  endThicknessTickB: Line | null;

  startThicknessText: Text | null;
  endThicknessText: Text | null;
};

function createDimensionLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Line {
  return new FabricLine([x1, y1, x2, y2], {
    stroke: "#444",
    strokeWidth: 1,
    strokeLineCap: "square",
    strokeLineJoin: "miter",
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
  }) as Line;
}

function createHiddenDimensionLine(x: number, y: number): Line {
  return new FabricLine([x, y, x, y], {
    stroke: "#444",
    strokeWidth: 1,
    strokeLineCap: "square",
    strokeLineJoin: "miter",
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
    visible: false,
  }) as Line;
}

function createDimensionText(
  text: string,
  left: number,
  top: number,
  angleDeg: number
): Text {
  return new FabricText(text, {
    left,
    top,
    originX: "center",
    originY: "center",
    fontSize: 14,
    fontWeight: "600",
    fill: "#111",
    angle: angleDeg,
    backgroundColor: "rgba(255,255,255,0.9)",
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
  }) as Text;
}

function createHiddenDimensionText(
  left: number,
  top: number,
  angleDeg: number
): Text {
  return new FabricText("", {
    left,
    top,
    originX: "center",
    originY: "center",
    fontSize: 14,
    fontWeight: "600",
    fill: "#111",
    angle: angleDeg,
    backgroundColor: "rgba(255,255,255,0.9)",
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
    visible: false,
  }) as Text;
}

function normalizeTextAngle(angleDeg: number) {
  let a = angleDeg;

  while (a > 180) a -= 360;
  while (a <= -180) a += 360;

  if (a > 90) a -= 180;
  if (a <= -90) a += 180;

  return a;
}

function makePerpTick(center: Pt, nx: number, ny: number, size: number) {
  const half = size / 2;

  return {
    a: {
      x: center.x - nx * half,
      y: center.y - ny * half,
    },
    b: {
      x: center.x + nx * half,
      y: center.y + ny * half,
    },
  };
}

function distance(a: Pt, b: Pt) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: Pt, b: Pt): Pt {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function dot(a: Pt, b: Pt) {
  return a.x * b.x + a.y * b.y;
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(v: Pt, s: number): Pt {
  return { x: v.x * s, y: v.y * s };
}

function length(v: Pt) {
  return Math.hypot(v.x, v.y);
}

function normalize(v: Pt): Pt | null {
  const len = length(v);
  if (len < 0.0001) return null;
  return { x: v.x / len, y: v.y / len };
}

function leftNormal(v: Pt): Pt {
  return { x: -v.y, y: v.x };
}

function createOffsetDimensionSegmentFromFace(args: {
  faceStart: Pt;
  faceEnd: Pt;
  wallCenterMid: Pt;
  offset: number;
}) {
  const { faceStart, faceEnd, wallCenterMid, offset } = args;

  const dx = faceEnd.x - faceStart.x;
  const dy = faceEnd.y - faceStart.y;
  const len = Math.hypot(dx, dy) || 1;

  let ux = dx / len;
  let uy = dy / len;

  let nx = -uy;
  let ny = ux;

  const faceMid = midpoint(faceStart, faceEnd);
  const awayFromCenter = {
    x: faceMid.x - wallCenterMid.x,
    y: faceMid.y - wallCenterMid.y,
  };

  if (dot({ x: nx, y: ny }, awayFromCenter) < 0) {
    nx = -nx;
    ny = -ny;
  }

  return {
    start: {
      x: faceStart.x + nx * offset,
      y: faceStart.y + ny * offset,
    },
    end: {
      x: faceEnd.x + nx * offset,
      y: faceEnd.y + ny * offset,
    },
    ux,
    uy,
    nx,
    ny,
    length: len,
  };
}

function buildBaseWallFaces(centerA: Pt, centerB: Pt, thickness: number) {
  const dir = normalize(sub(centerB, centerA));

  if (!dir) {
    const half = thickness / 2;
    return {
      top: {
        start: { x: centerA.x - half, y: centerA.y - half },
        end: { x: centerA.x + half, y: centerA.y - half },
      },
      bottom: {
        start: { x: centerA.x - half, y: centerA.y + half },
        end: { x: centerA.x + half, y: centerA.y + half },
      },
    };
  }

  const n = leftNormal(dir);
  const half = thickness / 2;

  return {
    top: {
      start: add(centerA, mul(n, half)),
      end: add(centerB, mul(n, half)),
    },
    bottom: {
      start: add(centerA, mul(n, -half)),
      end: add(centerB, mul(n, -half)),
    },
  };
}

function buildParallelFaceOnChosenSide(args: {
  centerStart: Pt;
  centerEnd: Pt;
  thickness: number;
  useTopSide: boolean;
}) {
  const { centerStart, centerEnd, thickness, useTopSide } = args;

  const base = buildBaseWallFaces(centerStart, centerEnd, thickness);
  return useTopSide ? base.top : base.bottom;
}

type FaceGeom = {
  start: Pt;
  end: Pt;
};

type DimensionSideVisual = {
  lineLeft: Line;
  lineRight: Line;
  startTick: Line;
  endTick: Line;
  text: Text;
};

function createDimensionSide(args: {
  faceStart: Pt;
  faceEnd: Pt;
  wallCenterMid: Pt;
  angleDeg: number;
  tickSize: number;
  textGap: number;
  hidden?: boolean;
  startTickVisible?: boolean;
  endTickVisible?: boolean;
}) {
  const {
    faceStart,
    faceEnd,
    wallCenterMid,
    angleDeg,
    tickSize,
    textGap,
    hidden = false,
    startTickVisible = true,
    endTickVisible = true,
  } = args;

  const dim = createOffsetDimensionSegmentFromFace({
    faceStart,
    faceEnd,
    wallCenterMid,
    offset: 16,
  });

  const startPt = dim.start;
  const endPt = dim.end;
  const displayLength = distance(startPt, endPt);

  const safeGap = Math.min(textGap, Math.max(0, displayLength - 16));
  const mid = midpoint(startPt, endPt);

  const gapHalfX = dim.ux * (safeGap / 2);
  const gapHalfY = dim.uy * (safeGap / 2);

  const gapStart = {
    x: mid.x - gapHalfX,
    y: mid.y - gapHalfY,
  };

  const gapEnd = {
    x: mid.x + gapHalfX,
    y: mid.y + gapHalfY,
  };

  const lineLeft = hidden
    ? createHiddenDimensionLine(startPt.x, startPt.y)
    : createDimensionLine(startPt.x, startPt.y, gapStart.x, gapStart.y);

  const lineRight = hidden
    ? createHiddenDimensionLine(endPt.x, endPt.y)
    : createDimensionLine(gapEnd.x, gapEnd.y, endPt.x, endPt.y);

  const startTickPts = makePerpTick(startPt, dim.nx, dim.ny, tickSize);
  const endTickPts = makePerpTick(endPt, dim.nx, dim.ny, tickSize);

  const startTick =
    hidden || !startTickVisible
      ? createHiddenDimensionLine(startPt.x, startPt.y)
      : createDimensionLine(
          startTickPts.a.x,
          startTickPts.a.y,
          startTickPts.b.x,
          startTickPts.b.y
        );

  const endTick =
    hidden || !endTickVisible
      ? createHiddenDimensionLine(endPt.x, endPt.y)
      : createDimensionLine(
          endTickPts.a.x,
          endTickPts.a.y,
          endTickPts.b.x,
          endTickPts.b.y
        );

  const text = hidden
    ? createHiddenDimensionText(mid.x, mid.y, angleDeg)
    : createDimensionText(
        Math.round(displayLength).toString(),
        mid.x,
        mid.y,
        angleDeg
      );

  return {
    lineLeft,
    lineRight,
    startTick,
    endTick,
    text,
  };
}

export function createWallDimensions(
  canvas: Canvas,
  centerA: Pt,
  centerB: Pt,
  thickness: number,
  options?: {
    showStartThickness?: boolean;
    showEndThickness?: boolean;
    startJoinOther?: Pt | null;
    endJoinOther?: Pt | null;
    startConnected?: boolean;
    endConnected?: boolean;
    startConnectionCount?: number;
    endConnectionCount?: number;
    startTJoinHostOther?: Pt | null;
    endTJoinHostOther?: Pt | null;

    outerDimensionChainStart?: Pt | null;
    outerDimensionChainEnd?: Pt | null;
    outerDimensionVisible?: boolean;
    outerDimensionStartConnected?: boolean;
    outerDimensionEndConnected?: boolean;

    topStartTickVisible?: boolean;
    topEndTickVisible?: boolean;
    bottomStartTickVisible?: boolean;
    bottomEndTickVisible?: boolean;
  }
): WallDimensionVisual {
  const showStartThickness = options?.showStartThickness ?? true;
  const showEndThickness = options?.showEndThickness ?? true;

  const startConnected = options?.startConnected ?? false;
  const endConnected = options?.endConnected ?? false;

  const dx = centerB.x - centerA.x;
  const dy = centerB.y - centerA.y;
  const baseLength = Math.hypot(dx, dy) || 1;

  const ux = dx / baseLength;
  const uy = dy / baseLength;

  const angleRad = Math.atan2(dy, dx);
  const angleDeg = normalizeTextAngle((angleRad * 180) / Math.PI);

  const stripPoints = buildWallStripPoints(centerA, centerB, thickness, {
    startJoinOther: options?.startJoinOther ?? null,
    endJoinOther: options?.endJoinOther ?? null,
    startConnectionCount: options?.startConnectionCount ?? 0,
    endConnectionCount: options?.endConnectionCount ?? 0,
    startTJoinHostOther: options?.startTJoinHostOther ?? null,
    endTJoinHostOther: options?.endTJoinHostOther ?? null,
  });

  const topGeomStart = stripPoints[0];
  const topGeomEnd = stripPoints[1];
  const bottomGeomStart = stripPoints[3];
  const bottomGeomEnd = stripPoints[2];

  const localTopLen = distance(topGeomStart, topGeomEnd);
  const localBottomLen = distance(bottomGeomStart, bottomGeomEnd);

  const outerIsTop = localTopLen >= localBottomLen;

  let topFace: FaceGeom = {
    start: topGeomStart,
    end: topGeomEnd,
  };

  let bottomFace: FaceGeom = {
    start: bottomGeomStart,
    end: bottomGeomEnd,
  };

  const hasOuterChain =
    !!options?.outerDimensionChainStart && !!options?.outerDimensionChainEnd;

  if (hasOuterChain) {
    const mergedOuterFace = buildParallelFaceOnChosenSide({
      centerStart: options!.outerDimensionChainStart!,
      centerEnd: options!.outerDimensionChainEnd!,
      thickness,
      useTopSide: outerIsTop,
    });

    if (outerIsTop) {
      topFace = mergedOuterFace;
    } else {
      bottomFace = mergedOuterFace;
    }
  }

  const wallCenterMid = midpoint(centerA, centerB);

  const textGap = 56;
  const tickSize = 18;

  const outerDimensionVisible = options?.outerDimensionVisible ?? true;

  const topIsHidden = outerIsTop && !outerDimensionVisible;
  const bottomIsHidden = !outerIsTop && !outerDimensionVisible;

  const defaultTopStartTickVisible = !startConnected;
  const defaultTopEndTickVisible = !endConnected;
  const defaultBottomStartTickVisible = !startConnected;
  const defaultBottomEndTickVisible = !endConnected;

  const mergedOuterStartTickVisible = !(outerIsTop
    ? options?.outerDimensionStartConnected ?? false
    : options?.outerDimensionStartConnected ?? false);

  const mergedOuterEndTickVisible = !(outerIsTop
    ? options?.outerDimensionEndConnected ?? false
    : options?.outerDimensionEndConnected ?? false);

  const topStartTickVisible = outerIsTop
    ? options?.topStartTickVisible ?? mergedOuterStartTickVisible
    : options?.topStartTickVisible ?? defaultTopStartTickVisible;

  const topEndTickVisible = outerIsTop
    ? options?.topEndTickVisible ?? mergedOuterEndTickVisible
    : options?.topEndTickVisible ?? defaultTopEndTickVisible;

  const bottomStartTickVisible = !outerIsTop
    ? options?.bottomStartTickVisible ?? mergedOuterStartTickVisible
    : options?.bottomStartTickVisible ?? defaultBottomStartTickVisible;

  const bottomEndTickVisible = !outerIsTop
    ? options?.bottomEndTickVisible ?? mergedOuterEndTickVisible
    : options?.bottomEndTickVisible ?? defaultBottomEndTickVisible;

  const topSide = createDimensionSide({
    faceStart: topFace.start,
    faceEnd: topFace.end,
    wallCenterMid,
    angleDeg,
    tickSize,
    textGap,
    hidden: topIsHidden,
    startTickVisible: topStartTickVisible,
    endTickVisible: topEndTickVisible,
  });

  const bottomSide = createDimensionSide({
    faceStart: bottomFace.start,
    faceEnd: bottomFace.end,
    wallCenterMid,
    angleDeg,
    tickSize,
    textGap,
    hidden: bottomIsHidden,
    startTickVisible: bottomStartTickVisible,
    endTickVisible: bottomEndTickVisible,
  });

  const topLineLeft = topSide.lineLeft;
  const topLineRight = topSide.lineRight;
  const bottomLineLeft = bottomSide.lineLeft;
  const bottomLineRight = bottomSide.lineRight;

  const startTopTick = topSide.startTick;
  const startBottomTick = bottomSide.startTick;
  const endTopTick = topSide.endTick;
  const endBottomTick = bottomSide.endTick;

  const topText = topSide.text;
  const bottomText = bottomSide.text;

  const thicknessAngle = normalizeTextAngle(angleDeg + 90);

  let startThicknessLine: Line | null = null;
  let startThicknessTickA: Line | null = null;
  let startThicknessTickB: Line | null = null;
  let startThicknessText: Text | null = null;

  if (showStartThickness) {
    const startOuter = stripPoints[0];
    const startInner = stripPoints[3];

    startThicknessLine = createDimensionLine(
      startOuter.x,
      startOuter.y,
      startInner.x,
      startInner.y
    );

    const startTickAPts = makePerpTick(startOuter, ux, uy, tickSize);
    const startTickBPts = makePerpTick(startInner, ux, uy, tickSize);

    startThicknessTickA = createDimensionLine(
      startTickAPts.a.x,
      startTickAPts.a.y,
      startTickAPts.b.x,
      startTickAPts.b.y
    );

    startThicknessTickB = createDimensionLine(
      startTickBPts.a.x,
      startTickBPts.a.y,
      startTickBPts.b.x,
      startTickBPts.b.y
    );

    const startThicknessMid = midpoint(startOuter, startInner);

    startThicknessText = createDimensionText(
      Math.round(distance(startOuter, startInner)).toString(),
      startThicknessMid.x - ux * 16,
      startThicknessMid.y - uy * 16,
      thicknessAngle
    );
  }

  let endThicknessLine: Line | null = null;
  let endThicknessTickA: Line | null = null;
  let endThicknessTickB: Line | null = null;
  let endThicknessText: Text | null = null;

  if (showEndThickness) {
    const endOuter = stripPoints[1];
    const endInner = stripPoints[2];

    endThicknessLine = createDimensionLine(
      endOuter.x,
      endOuter.y,
      endInner.x,
      endInner.y
    );

    const endTickAPts = makePerpTick(endOuter, ux, uy, tickSize);
    const endTickBPts = makePerpTick(endInner, ux, uy, tickSize);

    endThicknessTickA = createDimensionLine(
      endTickAPts.a.x,
      endTickAPts.a.y,
      endTickAPts.b.x,
      endTickAPts.b.y
    );

    endThicknessTickB = createDimensionLine(
      endTickBPts.a.x,
      endTickBPts.a.y,
      endTickBPts.b.x,
      endTickBPts.b.y
    );

    const endThicknessMid = midpoint(endOuter, endInner);

    endThicknessText = createDimensionText(
      Math.round(distance(endOuter, endInner)).toString(),
      endThicknessMid.x + ux * 16,
      endThicknessMid.y + uy * 16,
      thicknessAngle
    );
  }

  const objects = [
    topLineLeft,
    topLineRight,
    bottomLineLeft,
    bottomLineRight,
    startTopTick,
    startBottomTick,
    endTopTick,
    endBottomTick,
    topText,
    bottomText,
    startThicknessLine,
    endThicknessLine,
    startThicknessTickA,
    startThicknessTickB,
    endThicknessTickA,
    endThicknessTickB,
    startThicknessText,
    endThicknessText,
  ].filter(Boolean);

  for (const obj of objects) {
    canvas.add(obj as any);
  }

  return {
    topLineLeft,
    topLineRight,
    bottomLineLeft,
    bottomLineRight,
    startTopTick,
    startBottomTick,
    endTopTick,
    endBottomTick,
    topText,
    bottomText,
    startThicknessLine,
    endThicknessLine,
    startThicknessTickA,
    startThicknessTickB,
    endThicknessTickA,
    endThicknessTickB,
    startThicknessText,
    endThicknessText,
  };
}

export function removeWallDimensions(
  canvas: Canvas,
  dims: WallDimensionVisual | null | undefined
) {
  if (!dims) return;

  const objects = [
    dims.topLineLeft,
    dims.topLineRight,
    dims.bottomLineLeft,
    dims.bottomLineRight,
    dims.startTopTick,
    dims.startBottomTick,
    dims.endTopTick,
    dims.endBottomTick,
    dims.topText,
    dims.bottomText,
    dims.startThicknessLine,
    dims.endThicknessLine,
    dims.startThicknessTickA,
    dims.startThicknessTickB,
    dims.endThicknessTickA,
    dims.endThicknessTickB,
    dims.startThicknessText,
    dims.endThicknessText,
  ].filter(Boolean);

  for (const obj of objects) {
    canvas.remove(obj as any);
  }
}
