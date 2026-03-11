export type Pt = { x: number; y: number };

export function pointInPolygon(p: Pt, poly: Pt[]) {
  let inside = false;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];

    const intersect =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-12) + a.x;

    if (intersect) inside = !inside;
  }

  return inside;
}

export function polygonCentroid(poly: Pt[]) {
  let x = 0;
  let y = 0;

  for (const p of poly) {
    x += p.x;
    y += p.y;
  }

  return {
    x: x / poly.length,
    y: y / poly.length,
  };
}

export function nearestPointOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;

  const ab2 = abx * abx + aby * aby;
  const t = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
  const tt = Math.max(0, Math.min(1, t));

  return {
    x: a.x + abx * tt,
    y: a.y + aby * tt,
  };
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

function normalize(vx: number, vy: number) {
  const len = Math.hypot(vx, vy) || 1;
  return { x: vx / len, y: vy / len };
}

function lineIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;
  const x3 = p3.x;
  const y3 = p3.y;
  const x4 = p4.x;
  const y4 = p4.y;

  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-9) return null;

  const px =
    ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den;

  const py =
    ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den;

  return { x: px, y: py };
}

function signedArea(poly: Pt[]) {
  let area = 0;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }

  return area / 2;
}

export function insetPolygon(poly: Pt[], inset: number): Pt[] {
  if (poly.length < 3) return poly.map((p) => ({ ...p }));

  const area = signedArea(poly);
  const ccw = area > 0;

  const shiftedEdges = poly.map((curr, i) => {
    const next = poly[(i + 1) % poly.length];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;

    const dir = normalize(dx, dy);

    const inwardNormal = ccw
      ? { x: -dir.y, y: dir.x }
      : { x: dir.y, y: -dir.x };

    const a = {
      x: curr.x + inwardNormal.x * inset,
      y: curr.y + inwardNormal.y * inset,
    };

    const b = {
      x: next.x + inwardNormal.x * inset,
      y: next.y + inwardNormal.y * inset,
    };

    return { a, b };
  });

  const result: Pt[] = [];

  for (let i = 0; i < shiftedEdges.length; i++) {
    const prev =
      shiftedEdges[(i - 1 + shiftedEdges.length) % shiftedEdges.length];
    const curr = shiftedEdges[i];

    const hit = lineIntersection(prev.a, prev.b, curr.a, curr.b);

    if (hit) result.push(hit);
    else result.push({ ...curr.a });
  }

  return result;
}
