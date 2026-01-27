export type Pt = { x: number; y: number };

export function pointInPolygon(p: Pt, poly: Pt[]) {
  // Ray casting
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersect =
      (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-12) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: Pt[]) {
  // Simple average centroid (good enough for convex-ish room)
  let x = 0,
    y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

export function nearestPointOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;

  const ab2 = abx * abx + aby * aby;
  const t = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;

  const tt = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * tt, y: a.y + aby * tt };
}

export function nearestPointOnPolygon(p: Pt, poly: Pt[]) {
  let best = poly[0];
  let bestD2 = Number.POSITIVE_INFINITY;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const q = nearestPointOnSegment(p, a, b);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = q;
    }
  }

  return best;
}
