/** Nitidez, reflexo e frontalidade da carta retificada — porta de backend/app/vision/quality.py. */
import { release, type CV, type Mat } from "./cv.ts";
import { dist, polygonArea, type Quad } from "./geometry.ts";

export interface FrameQuality {
  sharpness: number;
  glare: number;
  frontal: number;
  size: number;
  score: number;
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export function sharpness(cv: CV, card: Mat): number {
  const gray = new cv.Mat();
  const small = new cv.Mat();
  const lap = new cv.Mat();
  const mean = new cv.Mat();
  const std = new cv.Mat();
  cv.cvtColor(card, gray, cv.COLOR_RGBA2GRAY);
  cv.resize(gray, small, new cv.Size(244, 340), 0, 0, cv.INTER_AREA);
  cv.Laplacian(small, lap, cv.CV_32F, 1, 1, 0, cv.BORDER_DEFAULT);
  cv.meanStdDev(lap, mean, std);
  const value = std.data64F[0] ** 2;
  release(gray, small, lap, mean, std);
  return value;
}

export function glareRatio(cv: CV, card: Mat): number {
  const small = new cv.Mat();
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  cv.resize(card, small, new cv.Size(244, 340), 0, 0, cv.INTER_AREA);
  cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
  const d = hsv.data;
  let hits = 0;
  for (let i = 0; i < d.length; i += 3) if (d[i + 2] >= 240 && d[i + 1] <= 50) hits++;
  const ratio = hits / (d.length / 3);
  release(small, rgb, hsv);
  return ratio;
}

export function frontalness(q: Quad): number {
  const s = [0, 1, 2, 3].map((i) => dist(q[i], q[(i + 1) % 4]));
  const r1 = Math.min(s[0], s[2]) / Math.max(s[0], s[2], 1e-6);
  const r2 = Math.min(s[1], s[3]) / Math.max(s[1], s[3], 1e-6);
  const ratio = (s[1] + s[3]) / 2 / Math.max((s[0] + s[2]) / 2, 1e-6);
  const ratioFit = Math.max(0, 1 - Math.abs(ratio - 88 / 63) / 0.35);
  return 0.35 * r1 + 0.35 * r2 + 0.3 * ratioFit;
}

export const sharpNorm = (value: number) => Math.min(1, Math.max(0, (Math.log10(Math.max(value, 1)) - 1.3) / (3.2 - 1.3)));

export function frameQuality(cv: CV, card: Mat, pts: Quad, frameW: number, frameH: number): FrameQuality {
  const sharp = sharpness(cv, card);
  const glare = glareRatio(cv, card);
  const front = frontalness(pts);
  const size = polygonArea(pts) / (frameW * frameH);
  const score = 0.55 * sharpNorm(sharp) + 0.25 * (1 - Math.min(1, glare * 8)) + 0.2 * front;
  return { sharpness: round(sharp, 1), glare: round(glare, 4), frontal: round(front, 3), size: round(size, 4), score: round(score, 4) };
}
