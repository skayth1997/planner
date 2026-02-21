export type Pt = { x: number; y: number };

export function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function dist2(a: Pt, b: Pt) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function projectPointToSegment(p: Pt, a: Pt, b: Pt) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;

  const ab2 = abx * abx + aby * aby;
  const rawT = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
  const t = clamp01(rawT);

  const q = { x: a.x + abx * t, y: a.y + aby * t };

  const dx = p.x - q.x;
  const dy = p.y - q.y;

  return { q, t, d2: dx * dx + dy * dy };
}
