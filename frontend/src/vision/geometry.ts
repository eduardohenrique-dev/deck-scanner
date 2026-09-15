/** Geometria de quadriláteros (porta de backend/app/vision/detect.py, sem alocar Mats). */
export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt];

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function centroid(pts: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

export function signedArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const polygonArea = (pts: readonly Pt[]) => Math.abs(signedArea(pts));

/** Arredondamento do numpy/Python (metade para o par). */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Horário a partir do canto superior-esquerdo, em retrato (lado 0→1 é o curto). */
export function orderQuad(input: readonly Pt[]): Quad {
  const c = centroid(input);
  let pts = [...input].sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  let start = 0;
  for (let i = 1; i < 4; i++) if (pts[i][0] + pts[i][1] < pts[start][0] + pts[start][1]) start = i;
  pts = [...pts.slice(start), ...pts.slice(0, start)];
  const w = dist(pts[0], pts[1]) + dist(pts[3], pts[2]);
  const h = dist(pts[1], pts[2]) + dist(pts[0], pts[3]);
  if (w > h) pts = [...pts.slice(1), pts[0]];
  return pts.map((p) => [p[0], p[1]] as Pt) as Quad;
}

export const quadWidth = (q: Quad) => (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
export const quadHeight = (q: Quad) => (dist(q[1], q[2]) + dist(q[0], q[3])) / 2;

export function anglesOk(q: Quad, lo = 55, hi = 125): [boolean, number] {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4];
    const b = q[i];
    const c = q[(i + 1) % 4];
    const v1: Pt = [a[0] - b[0], a[1] - b[1]];
    const v2: Pt = [c[0] - b[0], c[1] - b[1]];
    const denom = Math.hypot(...v1) * Math.hypot(...v2);
    if (denom <= 1e-6) return [false, 90];
    const cos = Math.min(1, Math.max(-1, (v1[0] * v2[0] + v1[1] * v2[1]) / denom));
    const ang = (Math.acos(cos) * 180) / Math.PI;
    if (ang < lo || ang > hi) return [false, Math.abs(ang - 90)];
    worst = Math.max(worst, Math.abs(ang - 90));
  }
  return [true, worst];
}

/** Lados correspondentes paralelos (contornos concêntricos da mesma carta). */
export function sidesParallel(a: Quad, b: Quad, maxDeg = 2.5): boolean {
  for (let i = 0; i < 4; i++) {
    const va: Pt = [a[(i + 1) % 4][0] - a[i][0], a[(i + 1) % 4][1] - a[i][1]];
    const vb: Pt = [b[(i + 1) % 4][0] - b[i][0], b[(i + 1) % 4][1] - b[i][1]];
    const cos = Math.abs(va[0] * vb[0] + va[1] * vb[1]) / Math.max(Math.hypot(...va) * Math.hypot(...vb), 1e-6);
    if ((Math.acos(Math.min(1, cos)) * 180) / Math.PI > maxDeg) return false;
  }
  return true;
}

function clipByEdge(subject: Pt[], a: Pt, b: Pt, sign: number): Pt[] {
  const out: Pt[] = [];
  const side = (p: Pt) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  for (let i = 0; i < subject.length; i++) {
    const p = subject[i];
    const q = subject[(i + 1) % subject.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

/** Área da interseção de dois polígonos convexos (equivale a cv2.intersectConvexConvex). */
export function convexIntersectionArea(a: readonly Pt[], b: readonly Pt[]): number {
  let poly: Pt[] = [...a];
  const sign = signedArea(b) >= 0 ? 1 : -1;
  for (let i = 0; i < b.length; i++) {
    poly = clipByEdge(poly, b[i], b[(i + 1) % b.length], sign);
    if (poly.length < 3) return 0;
  }
  return polygonArea(poly);
}

export function quadIou(a: Quad, b: Quad): number {
  const inter = convexIntersectionArea(a, b);
  const union = polygonArea(a) + polygonArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** Ponto dentro do polígono ou sobre a borda (cv2.pointPolygonTest(..., False) >= 0). */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const onSegment =
      Math.abs(cross) < 1e-9 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
    if (onSegment) return true;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointLineDist(p: Pt, a: Pt, b: Pt): number {
  const ab: Pt = [b[0] - a[0], b[1] - a[1]];
  const denom = Math.hypot(...ab);
  if (denom < 1e-6) return dist(p, a);
  return Math.abs(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])) / denom;
}

/** Ângulo (0–180°) do eixo longo do quadrilátero em retrato. */
export function longAxisAngle(q: Quad): number {
  const vx = (q[3][0] - q[0][0] + (q[2][0] - q[1][0])) / 2;
  const vy = (q[3][1] - q[0][1] + (q[2][1] - q[1][1])) / 2;
  const deg = (Math.atan2(vy, vx) * 180) / Math.PI;
  return ((deg % 180) + 180) % 180;
}

export function median(values: readonly number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
