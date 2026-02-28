import type { Pt, WallSeg } from "../core/planner-types";

export function getWallsFromRoomPolygon(getRoomPoints: () => Pt[]): WallSeg[] {
  const poly = getRoomPoints();
  const segs: WallSeg[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    segs.push({ id: `seg-${i}`, a, b });
  }
  return segs;
}
