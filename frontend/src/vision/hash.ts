/**
 * Assinatura da arte (pHash de 256 bits) usada só para saber se a carta na câmera mudou.
 * Mesma normalização de backend/app/vision/hashing.py; o OpenCV.js não traz cv.dct,
 * então a DCT-II ortonormal das 16×16 frequências baixas é calculada aqui.
 */
import { release, type CV, type Mat } from "./cv.ts";
import { roundHalfEven } from "./geometry.ts";

const CANON_W = 146;
const CANON_H = 204;
const ART_BOX = [0.12, 0.13, 0.88, 0.52] as const;
const ART_X0 = roundHalfEven(ART_BOX[0] * CANON_W);
const ART_Y0 = roundHalfEven(ART_BOX[1] * CANON_H);
const ART_X1 = roundHalfEven(ART_BOX[2] * CANON_W);
const ART_Y1 = roundHalfEven(ART_BOX[3] * CANON_H);

const N = 64;
const K = 16;
const COS = (() => {
  const t = new Float64Array(K * N);
  for (let k = 0; k < K; k++) for (let i = 0; i < N; i++) t[k * N + i] = Math.cos((Math.PI * (2 * i + 1) * k) / (2 * N));
  return t;
})();
const NORM = (k: number) => Math.sqrt((k === 0 ? 1 : 2) / N);

function phash256(pixels: Uint8Array): Uint8Array {
  const proj = new Float64Array(K * N);
  for (let i = 0; i < N; i++) {
    const row = i * N;
    for (let l = 0; l < K; l++) {
      let s = 0;
      const base = l * N;
      for (let j = 0; j < N; j++) s += pixels[row + j] * COS[base + j];
      proj[l * N + i] = s;
    }
  }
  const low = new Float64Array(K * K);
  for (let k = 0; k < K; k++) {
    for (let l = 0; l < K; l++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += COS[k * N + i] * proj[l * N + i];
      low[k * K + l] = NORM(k) * NORM(l) * s;
    }
  }
  const sorted = Float64Array.from(low).sort();
  const median = (sorted[127] + sorted[128]) / 2;
  const bits = new Uint8Array(32);
  for (let b = 0; b < 256; b++) if (low[b] > median) bits[b >> 3] |= 0x80 >> (b & 7);
  return bits;
}

function artHash(cv: CV, gray: Mat): Uint8Array {
  const roi = gray.roi(new cv.Rect(ART_X0, ART_Y0, ART_X1 - ART_X0, ART_Y1 - ART_Y0));
  const small = new cv.Mat();
  cv.resize(roi, small, new cv.Size(N, N), 0, 0, cv.INTER_AREA);
  const bits = phash256(small.data);
  release(roi, small);
  return bits;
}

/** [assinatura, assinatura da carta girada 180°] da carta retificada (RGBA). */
export function artSignatures(cv: CV, card: Mat): [Uint8Array, Uint8Array] {
  const canon = new cv.Mat();
  const gray = new cv.Mat();
  const flipped = new cv.Mat();
  cv.resize(card, canon, new cv.Size(CANON_W, CANON_H), 0, 0, cv.INTER_AREA);
  cv.cvtColor(canon, gray, cv.COLOR_RGBA2GRAY);
  cv.flip(gray, flipped, -1);
  const out: [Uint8Array, Uint8Array] = [artHash(cv, gray), artHash(cv, flipped)];
  release(canon, gray, flipped);
  return out;
}

const POPCOUNT = (() => {
  const t = new Uint8Array(256);
  for (let i = 1; i < 256; i++) t[i] = t[i >> 1] + (i & 1);
  return t;
})();

export function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT[a[i] ^ b[i]];
  return d;
}
