/**
 * Detecção de retângulos de carta e retificação — porta de backend/app/vision/detect.py
 * (mesmos mapas binários, filtros e supressão de contornos repetidos). Imagens de entrada em RGBA.
 */
import { release, type CV, type Mat } from "./cv.ts";
import {
  anglesOk,
  centroid,
  convexIntersectionArea,
  dist,
  orderQuad,
  pointLineDist,
  polygonArea,
  quadHeight,
  quadIou,
  quadWidth,
  roundHalfEven,
  sidesParallel,
  type Pt,
  type Quad,
} from "./geometry.ts";

export const CARD_RATIO = 88 / 63;
export const WARP_W = 488;
export const WARP_H = 680;
const RATIO_MIN = 1.18;
const RATIO_MAX = 1.7;

export type CardKind = "full" | "edge";

export interface CardQuad {
  pts: Quad;
  score: number;
  area: number;
  ratio: number;
  support: number;
  kind: CardKind;
}

function uint8Median(data: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const n = data.length;
  const lo = (n - 1) >> 1;
  const hi = n >> 1;
  let acc = 0;
  let loVal = -1;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (loVal < 0 && acc > lo) loVal = v;
    if (acc > hi) return (loVal + v) / 2;
  }
  return loVal;
}

/** Os mesmos 7 mapas binários do backend; cada contorno fechado vira candidato a carta. */
function binaryMaps(cv: CV, small: Mat, gray: Mat): Mat[] {
  const k3 = cv.Mat.ones(3, 3, cv.CV_8U);
  const anchor = new cv.Point(-1, -1);
  const bv = cv.morphologyDefaultBorderValue();
  const blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
  const med = uint8Median(blur.data);
  const maps: Mat[] = [];
  const edges = new cv.Mat();
  const dilated = new cv.Mat();

  const auto = new cv.Mat();
  cv.Canny(blur, edges, Math.trunc(Math.max(10, 0.66 * med)), Math.trunc(Math.min(255, 1.33 * med + 20)), 3, false);
  cv.dilate(edges, dilated, k3, anchor, 2, cv.BORDER_CONSTANT, bv);
  cv.morphologyEx(dilated, auto, cv.MORPH_CLOSE, k3, anchor, 1, cv.BORDER_CONSTANT, bv);
  maps.push(auto);

  // sem dilatação: preserva o vão fino entre cartas encostadas
  const strong = new cv.Mat();
  cv.Canny(blur, edges, 40, 120, 3, false);
  cv.morphologyEx(edges, strong, cv.MORPH_CLOSE, k3, anchor, 1, cv.BORDER_CONSTANT, bv);
  maps.push(strong);

  const weak = new cv.Mat();
  cv.Canny(blur, edges, 20, 60, 3, false);
  cv.dilate(edges, weak, k3, anchor, 1, cv.BORDER_CONSTANT, bv);
  maps.push(weak);

  // borda preta das cartas contra fundos mais claros
  const block = Math.max(15, Math.floor(Math.min(gray.rows, gray.cols) / 16) | 1);
  const adapt = new cv.Mat();
  cv.adaptiveThreshold(blur, edges, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, 8);
  cv.morphologyEx(edges, adapt, cv.MORPH_CLOSE, k3, anchor, 2, cv.BORDER_CONSTANT, bv);
  maps.push(adapt);

  const otsu = new cv.Mat();
  cv.threshold(blur, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  maps.push(otsu);
  const otsuInv = new cv.Mat();
  cv.bitwise_not(otsu, otsuInv);
  maps.push(otsuInv);

  // cartas de borda clara/colorida: o canal de saturação ajuda em mesas neutras
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
  const channels = new cv.MatVector();
  cv.split(hsv, channels);
  const sat = channels.get(1);
  const satBlur = new cv.Mat();
  cv.GaussianBlur(sat, satBlur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
  cv.Canny(satBlur, edges, 30, 90, 3, false);
  const satEdges = new cv.Mat();
  cv.dilate(edges, satEdges, k3, anchor, 2, cv.BORDER_CONSTANT, bv);
  maps.push(satEdges);

  release(k3, blur, edges, dilated, rgb, hsv, sat, satBlur);
  channels.delete();
  return maps;
}

function contourQuads(cv: CV, cnt: Mat): Pt[][] {
  const hull = new cv.Mat();
  const approx = new cv.Mat();
  try {
    cv.convexHull(cnt, hull, false, true);
    const peri = cv.arcLength(hull, true);
    for (const eps of [0.02, 0.035, 0.05]) {
      cv.approxPolyDP(hull, approx, eps * peri, true);
      if (approx.rows === 4) {
        const d = approx.data32S;
        return [[[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]]];
      }
    }
    // dedos cobrindo um canto etc.: retângulo mínimo — não segue a perspectiva, só vale se nada melhor
    const rect = cv.minAreaRect(hull);
    const rw = rect.size.width;
    const rh = rect.size.height;
    if (rw * rh > 0 && cv.contourArea(hull) / (rw * rh) >= 0.86) {
      return [cv.RotatedRect.points(rect).map((p: { x: number; y: number }) => [Math.fround(p.x), Math.fround(p.y)] as Pt)];
    }
    return [];
  } finally {
    release(hull, approx);
  }
}

function edgeSupport(q: Quad, edges: Uint8Array, w: number, h: number, samples = 48): number {
  let hits = 0;
  let total = 0;
  const step = (0.92 - 0.08) / (samples - 1);
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    for (let s = 0; s < samples; s++) {
      const t = s === samples - 1 ? 0.92 : 0.08 + s * step;
      const x = Math.min(w - 1, Math.max(0, roundHalfEven(a[0] * (1 - t) + b[0] * t)));
      const y = Math.min(h - 1, Math.max(0, roundHalfEven(a[1] * (1 - t) + b[1] * t)));
      if (edges[y * w + x] > 0) hits++;
      total++;
    }
  }
  return hits / Math.max(total, 1);
}

function contourArea32S(d: Int32Array): number {
  let s = 0;
  const n = d.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += d[2 * i] * d[2 * j + 1] - d[2 * j] * d[2 * i + 1];
  }
  return Math.abs(s) / 2;
}

export function detectCards(cv: CV, img: Mat, opts: { maxDim?: number; minAreaFrac?: number; maxAreaFrac?: number } = {}): CardQuad[] {
  const { maxDim = 1280, minAreaFrac = 0.003, maxAreaFrac = 0.7 } = opts;
  const H = img.rows;
  const W = img.cols;
  const scale = Math.min(1, maxDim / Math.max(H, W));
  let small = img;
  if (scale < 1) {
    small = new cv.Mat();
    cv.resize(img, small, new cv.Size(Math.trunc(W * scale), Math.trunc(H * scale)), 0, 0, cv.INTER_AREA);
  }
  const h = small.rows;
  const w = small.cols;
  const imgArea = h * w;
  const gray = new cv.Mat();
  cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
  const supportBlur = new cv.Mat();
  const supportCanny = new cv.Mat();
  const supportMat = new cv.Mat();
  const k5 = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.GaussianBlur(gray, supportBlur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
  cv.Canny(supportBlur, supportCanny, 30, 100, 3, false);
  cv.dilate(supportCanny, supportMat, k5, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
  release(supportBlur, supportCanny, k5);
  const supportEdges = supportMat.data;

  const raw: CardQuad[] = [];
  const maps = binaryMaps(cv, small, gray);
  const hierarchy = new cv.Mat();
  for (const m of maps) {
    const contours = new cv.MatVector();
    cv.findContours(m, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const n = contours.size();
    for (let ci = 0; ci < n; ci++) {
      const cnt = contours.get(ci);
      const area = contourArea32S(cnt.data32S);
      if (area < minAreaFrac * imgArea || area > maxAreaFrac * imgArea) {
        cnt.delete();
        continue;
      }
      const quads = contourQuads(cv, cnt);
      cnt.delete();
      for (const rawQ of quads) {
        const q = orderQuad(rawQ);
        const sides = [0, 1, 2, 3].map((i) => dist(q[i], q[(i + 1) % 4]));
        if (Math.min(...sides) < 12) continue;
        if (Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]) < 0.6) continue;
        if (Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3]) < 0.6) continue;
        const [ok, dev] = anglesOk(q);
        if (!ok) continue;
        const qarea = polygonArea(q);
        if (qarea < minAreaFrac * imgArea || qarea > maxAreaFrac * imgArea) continue;
        const ratio = (sides[1] + sides[3]) / 2 / ((sides[0] + sides[2]) / 2);
        const support = edgeSupport(q, supportEdges, w, h);
        if (support < 0.35) continue;
        const ratioFit = Math.max(0, 1 - Math.abs(ratio - CARD_RATIO) / 0.3);
        const score = 0.5 * support + 0.3 * ratioFit + 0.2 * (1 - dev / 35);
        if (ratio >= RATIO_MIN && ratio <= RATIO_MAX) raw.push({ pts: q, score, area: qarea, ratio, support, kind: "full" });
      }
    }
    contours.delete();
  }
  release(hierarchy, gray, supportMat, ...maps);
  if (small !== img) release(small);

  const kept = nms(raw);
  const margin = 0.006 * Math.max(w, h);
  for (const q of kept) {
    if (q.pts.some(([x, y]) => x <= margin || x >= w - 1 - margin || y <= margin || y >= h - 1 - margin)) q.kind = "edge";
    q.pts = q.pts.map(([x, y]) => [Math.fround(x / scale), Math.fround(y / scale)] as Pt) as Quad;
    q.area = q.area / (scale * scale);
  }
  const rowKey = (q: CardQuad) => roundHalfEven(centroid(q.pts)[1] / Math.max(quadHeight(q.pts), 1));
  kept.sort((a, b) => rowKey(a) - rowKey(b) || centroid(a.pts)[0] - centroid(b.pts)[0]);
  return kept;
}

function nms(cands: CardQuad[]): CardQuad[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const kept: CardQuad[] = [];
  for (const c of sorted) {
    let dup = false;
    for (let idx = 0; idx < kept.length; idx++) {
      const k = kept[idx];
      const inter = convexIntersectionArea(c.pts, k.pts);
      const union = c.area + k.area - inter;
      if (union > 0 && inter / union > 0.65) {
        dup = true;
        // contornos concêntricos da mesma carta (moldura interna, borda, sleeve): prefere o mais externo com boa evidência
        if (c.area > k.area * 1.03 && c.support >= 0.9 * k.support && inter / k.area > 0.9 && sidesParallel(c.pts, k.pts)) kept[idx] = c;
        break;
      }
    }
    if (!dup) kept.push(c);
  }
  const contained: number[][] = kept.map(() => []);
  kept.forEach((a, i) =>
    kept.forEach((b, j) => {
      if (i === j || b.area >= a.area * 0.75) return;
      if (convexIntersectionArea(a.pts, b.pts) / Math.max(b.area, 1) > 0.85) contained[i].push(j);
    }),
  );
  const groups = new Set(kept.map((_, i) => i).filter((i) => isGroup(kept[i], contained[i].map((j) => kept[j]))));
  return kept.filter((_, i) => !groups.has(i) && !contained.some((inner, j) => inner.includes(i) && !groups.has(j)));
}

function sharedSides(inner: CardQuad, outer: CardQuad, tol: number): number {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const a = inner.pts[i];
    const b = inner.pts[(i + 1) % 4];
    for (let k = 0; k < 4; k++) {
      const c = outer.pts[k];
      const d = outer.pts[(k + 1) % 4];
      if (pointLineDist(a, c, d) < tol && pointLineDist(b, c, d) < tol) {
        count++;
        break;
      }
    }
  }
  return count;
}

/** Contêiner de várias cartas (ex.: duas cartas encostadas viram um retângulo só). */
function isGroup(outer: CardQuad, inner: CardQuad[]): boolean {
  const disjoint = (qs: CardQuad[]) => {
    const chosen: CardQuad[] = [];
    for (const q of [...qs].sort((a, b) => b.area - a.area)) {
      if (chosen.every((c) => convexIntersectionArea(q.pts, c.pts) / Math.min(q.area, c.area) < 0.2)) chosen.push(q);
    }
    return chosen;
  };
  if (disjoint(inner.filter((q) => q.area >= 0.03 * outer.area && q.area <= 0.5 * outer.area)).length >= 3) return true;
  const tol = 0.03 * Math.min(quadWidth(outer.pts), quadHeight(outer.pts));
  const big = disjoint(inner.filter((q) => q.area >= 0.25 * outer.area && sharedSides(q, outer, tol) >= 2));
  return big.length >= 2 && big.reduce((s, q) => s + q.area, 0) >= 0.75 * outer.area;
}

/** Modo vídeo: a carta dominante (maior e mais central); `prior` favorece a carta já rastreada. */
export function detectPrimaryCard(cv: CV, frame: Mat, maxDim = 960, prior: Quad | null = null): CardQuad | null {
  const quads = detectCards(cv, frame, { maxDim, minAreaFrac: 0.02 });
  if (!quads.length) return null;
  const W = frame.cols;
  const H = frame.rows;
  const center: Pt = [W / 2, H / 2];
  const diag = Math.hypot(W, H);
  const rank = (q: CardQuad) => {
    const d = dist(centroid(q.pts), center) / diag;
    let r = (q.area / (W * H)) * (0.6 + q.score) * (1.2 - d) * (q.kind === "edge" ? 0.5 : 1);
    if (prior && quadIou(q.pts, prior) >= 0.6) r *= 2;
    return r;
  };
  let best = quads[0];
  let bestRank = rank(best);
  for (const q of quads.slice(1)) {
    const r = rank(q);
    if (r > bestRank) {
      best = q;
      bestRank = r;
    }
  }
  return best;
}

/** Carta retificada (retrato) a partir do quadrilátero; `expand` amplia em volta do centro (imagem de contexto). */
export function warpCard(cv: CV, img: Mat, pts: Quad, outW = WARP_W, outH = WARP_H, expand = 0): Mat {
  let q: Pt[] = pts.map(([x, y]) => [Math.fround(x), Math.fround(y)]);
  if (expand) {
    const c = centroid(q);
    q = q.map(([x, y]) => [c[0] + (x - c[0]) * (1 + expand), c[1] + (y - c[1]) * (1 + expand)]);
  }
  const sideH = Math.max(dist(q[1], q[2]), dist(q[0], q[3]));
  const interH = Math.trunc(Math.min(Math.max(outH, sideH), 1400));
  const interW = roundHalfEven((interH * outW) / outH);
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, q.flat());
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, interW - 1, 0, interW - 1, interH - 1, 0, interH - 1]);
  const M = cv.getPerspectiveTransform(src, dst);
  let warped = new cv.Mat();
  cv.warpPerspective(img, warped, M, new cv.Size(interW, interH), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
  if (interW !== outW || interH !== outH) {
    const out = new cv.Mat();
    cv.resize(warped, out, new cv.Size(outW, outH), 0, 0, cv.INTER_AREA);
    release(warped);
    warped = out;
  }
  release(src, dst, M);
  return warped;
}
