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

function pointOnOffsetTrack(args: {
  origin: Pt;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  axisDistance: number;
  normalOffset: number;
}): Pt {
  const { origin, ux, uy, nx, ny, axisDistance, normalOffset } = args;

  return {
    x: origin.x + ux * axisDistance + nx * normalOffset,
    y: origin.y + uy * axisDistance + ny * normalOffset,
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
  }
): WallDimensionVisual {
  const showStartThickness = options?.showStartThickness ?? true;
  const showEndThickness = options?.showEndThickness ?? true;

  const dx = centerB.x - centerA.x;
  const dy = centerB.y - centerA.y;
  const baseLength = Math.hypot(dx, dy) || 1;

  const ux = dx / baseLength;
  const uy = dy / baseLength;

  const nx = -uy;
  const ny = ux;

  const angleRad = Math.atan2(dy, dx);
  const angleDeg = normalizeTextAngle((angleRad * 180) / Math.PI);

  const stripPoints = buildWallStripPoints(centerA, centerB, thickness, {
    startJoinOther: options?.startJoinOther ?? null,
    endJoinOther: options?.endJoinOther ?? null,
  });

  const topGeomStart = stripPoints[0];
  const topGeomEnd = stripPoints[1];
  const bottomGeomStart = stripPoints[3];
  const bottomGeomEnd = stripPoints[2];

  const geometricTopLength = distance(topGeomStart, topGeomEnd);
  const geometricBottomLength = distance(bottomGeomStart, bottomGeomEnd);

  const hasStartJoin = !!options?.startJoinOther;
  const hasEndJoin = !!options?.endJoinOther;

  const startReduction = hasStartJoin ? thickness : 0;
  const endReduction = hasEndJoin ? thickness : 0;
  const totalReduction = startReduction + endReduction;

  let topDisplayLength = baseLength;
  let bottomDisplayLength = baseLength;

  let topIsPreserved = true;

  if (totalReduction > 0) {
    const reducedLength = Math.max(0, baseLength - totalReduction);
    topIsPreserved = geometricTopLength >= geometricBottomLength;

    if (topIsPreserved) {
      topDisplayLength = baseLength;
      bottomDisplayLength = reducedLength;
    } else {
      topDisplayLength = reducedLength;
      bottomDisplayLength = baseLength;
    }
  }

  const innerStartExtend = 4;
  const innerEndExtend = 4;

  const topStartAxis =
    totalReduction === 0 || topIsPreserved
      ? 0
      : Math.max(0, startReduction - (hasStartJoin ? innerStartExtend : 0));

  const topEndAxis =
    totalReduction === 0 || topIsPreserved
      ? baseLength
      : Math.min(
        baseLength,
        baseLength - endReduction + (hasEndJoin ? innerEndExtend : 0)
      );

  const bottomStartAxis =
    totalReduction === 0 || !topIsPreserved
      ? 0
      : Math.max(0, startReduction - (hasStartJoin ? innerStartExtend : 0));

  const bottomEndAxis =
    totalReduction === 0 || !topIsPreserved
      ? baseLength
      : Math.min(
        baseLength,
        baseLength - endReduction + (hasEndJoin ? innerEndExtend : 0)
      );

  const mainOffset = thickness / 2 + 16;

  const topOffset = +mainOffset;
  const bottomOffset = -mainOffset;

  let topStartPt = pointOnOffsetTrack({
    origin: centerA,
    ux,
    uy,
    nx,
    ny,
    axisDistance: topStartAxis,
    normalOffset: topOffset,
  });

  let topEndPt = pointOnOffsetTrack({
    origin: centerA,
    ux,
    uy,
    nx,
    ny,
    axisDistance: topEndAxis,
    normalOffset: topOffset,
  });

  let bottomStartPt = pointOnOffsetTrack({
    origin: centerA,
    ux,
    uy,
    nx,
    ny,
    axisDistance: bottomStartAxis,
    normalOffset: bottomOffset,
  });

  let bottomEndPt = pointOnOffsetTrack({
    origin: centerA,
    ux,
    uy,
    nx,
    ny,
    axisDistance: bottomEndAxis,
    normalOffset: bottomOffset,
  });

  if (totalReduction > 0 && hasEndJoin) {
    if (topIsPreserved) {
      topEndPt = {
        x: topGeomEnd.x + nx * (mainOffset - thickness / 2),
        y: topGeomEnd.y + ny * (mainOffset - thickness / 2),
      };
    } else {
      bottomEndPt = {
        x: bottomGeomEnd.x - nx * (mainOffset - thickness / 2),
        y: bottomGeomEnd.y - ny * (mainOffset - thickness / 2),
      };
    }
  }

  const textGap = 56;
  const tickSize = 18;

  const topMid = midpoint(topStartPt, topEndPt);
  const bottomMid = midpoint(bottomStartPt, bottomEndPt);

  const gapHalfX = ux * (textGap / 2);
  const gapHalfY = uy * (textGap / 2);

  const topGapStart = { x: topMid.x - gapHalfX, y: topMid.y - gapHalfY };
  const topGapEnd = { x: topMid.x + gapHalfX, y: topMid.y + gapHalfY };

  const bottomGapStart = {
    x: bottomMid.x - gapHalfX,
    y: bottomMid.y - gapHalfY,
  };
  const bottomGapEnd = {
    x: bottomMid.x + gapHalfX,
    y: bottomMid.y + gapHalfY,
  };

  const topLineLeft = createDimensionLine(
    topStartPt.x,
    topStartPt.y,
    topGapStart.x,
    topGapStart.y
  );

  const topLineRight = createDimensionLine(
    topGapEnd.x,
    topGapEnd.y,
    topEndPt.x,
    topEndPt.y
  );

  const bottomLineLeft = createDimensionLine(
    bottomStartPt.x,
    bottomStartPt.y,
    bottomGapStart.x,
    bottomGapStart.y
  );

  const bottomLineRight = createDimensionLine(
    bottomGapEnd.x,
    bottomGapEnd.y,
    bottomEndPt.x,
    bottomEndPt.y
  );

  const startTopTickPts = makePerpTick(topStartPt, nx, ny, tickSize);
  const startBottomTickPts = makePerpTick(bottomStartPt, nx, ny, tickSize);
  const endTopTickPts = makePerpTick(topEndPt, nx, ny, tickSize);
  const endBottomTickPts = makePerpTick(bottomEndPt, nx, ny, tickSize);

  const hideTopStartTick =
    totalReduction > 0 && !topIsPreserved && hasStartJoin;
  const hideTopEndTick = totalReduction > 0 && !topIsPreserved && hasEndJoin;
  const hideBottomStartTick =
    totalReduction > 0 && topIsPreserved && hasStartJoin;
  const hideBottomEndTick = totalReduction > 0 && topIsPreserved && hasEndJoin;

  const startTopTick = hideTopStartTick
    ? createHiddenDimensionLine(topStartPt.x, topStartPt.y)
    : createDimensionLine(
        startTopTickPts.a.x,
        startTopTickPts.a.y,
        startTopTickPts.b.x,
        startTopTickPts.b.y
      );

  const startBottomTick = hideBottomStartTick
    ? createHiddenDimensionLine(bottomStartPt.x, bottomStartPt.y)
    : createDimensionLine(
        startBottomTickPts.a.x,
        startBottomTickPts.a.y,
        startBottomTickPts.b.x,
        startBottomTickPts.b.y
      );

  const endTopTick = hideTopEndTick
    ? createHiddenDimensionLine(topEndPt.x, topEndPt.y)
    : createDimensionLine(
        endTopTickPts.a.x,
        endTopTickPts.a.y,
        endTopTickPts.b.x,
        endTopTickPts.b.y
      );

  const endBottomTick = hideBottomEndTick
    ? createHiddenDimensionLine(bottomEndPt.x, bottomEndPt.y)
    : createDimensionLine(
        endBottomTickPts.a.x,
        endBottomTickPts.a.y,
        endBottomTickPts.b.x,
        endBottomTickPts.b.y
      );

  const topText = createDimensionText(
    Math.round(topDisplayLength).toString(),
    topMid.x,
    topMid.y,
    angleDeg
  );

  const bottomText = createDimensionText(
    Math.round(bottomDisplayLength).toString(),
    bottomMid.x,
    bottomMid.y,
    angleDeg
  );

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
