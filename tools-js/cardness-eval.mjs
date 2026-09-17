// Calibra o "isso é mesmo uma carta?" (frontend/src/vision/cardness.ts).
//
//   node --experimental-strip-types tools-js/cardness-eval.mjs [--video caminho] [--limit N]
//
// Positivos: a carta principal detectada em cada frame do vídeo sintético.
// Negativos: os OUTROS retângulos que o detector aceita no mesmo frame (caixa de arte, moldura, mesa) e
// recortes de fundo com proporção de carta. São exatamente os falsos positivos que enchiam a revisão.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const backend = path.join(root, "backend");
const python = path.join(backend, ".venv", "Scripts", "python.exe");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const video = path.resolve(opt("--video", path.join(backend, "data", "synth", "video100", "deck.mp4")));
const limit = Number(opt("--limit", "300"));

const require = createRequire(path.join(root, "frontend", "package.json"));
const { resolveCv, release } = await import("../frontend/src/vision/cv.ts");
const { detectCards, detectPrimaryCard, warpCard } = await import("../frontend/src/vision/detect.ts");
const { cardness } = await import("../frontend/src/vision/cardness.ts");
const { frameQuality } = await import("../frontend/src/vision/quality.ts");
const { quadIou } = await import("../frontend/src/vision/geometry.ts");
const { cv } = await resolveCv(require("@techstark/opencv-js"));

const positives = [];
const negatives = [];

function backgroundQuad(w, h, i) {
  // retângulo com proporção de carta numa área qualquer do frame (mesa, mão, fundo)
  const ch = Math.round(h * 0.45);
  const cw = Math.round((ch * 63) / 88);
  const x = Math.round((i * 137) % Math.max(1, w - cw));
  const y = Math.round((i * 89) % Math.max(1, h - ch));
  return [
    [x, y],
    [x + cw, y],
    [x + cw, y + ch],
    [x, y + ch],
  ];
}

const child = spawn(python, ["-m", "tools.dump_frames", video, "--limit", String(limit)], { cwd: backend, stdio: ["ignore", "pipe", "inherit"] });
let pending = [];
let pendingLen = 0;
const take = (n) => {
  const buf = pendingLen === n && pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingLen);
  const out = buf.subarray(0, n);
  const rest = buf.subarray(n);
  pending = rest.length ? [rest] : [];
  pendingLen = rest.length;
  return out;
};
let need = 16;
let header = null;
let frames = 0;

for await (const chunk of child.stdout) {
  pending.push(chunk);
  pendingLen += chunk.length;
  while (pendingLen >= need) {
    if (!header) {
      const h = take(16);
      header = { w: h.readInt32LE(0), h: h.readInt32LE(4), t: h.readDoubleLE(8) };
      need = header.w * header.h * 4;
      continue;
    }
    const bytes = take(need);
    const frame = new cv.Mat(header.h, header.w, cv.CV_8UC4);
    frame.data.set(bytes);
    const main = detectPrimaryCard(cv, frame, 800, null);
    if (main) {
      const warped = warpCard(cv, frame, main.pts);
      const q = frameQuality(cv, warped, main.pts, frame.cols, frame.rows);
      // só conta como positivo a carta bem apresentada (é o que a câmera deve capturar)
      if (main.kind === "full" && q.size > 0.08 && q.sharpness > 60) positives.push({ ...cardness(cv, warped), size: q.size });
      release(warped);
      const others = detectCards(cv, frame, { maxDim: 800, minAreaFrac: 0.01 }).filter((c) => quadIou(c.pts, main.pts) < 0.35);
      for (const o of others.slice(0, 2)) {
        const w2 = warpCard(cv, frame, o.pts);
        negatives.push({ ...cardness(cv, w2), kind: "outro retângulo" });
        release(w2);
      }
    }
    for (let k = 0; k < 3; k++) {
      const quad = backgroundQuad(frame.cols, frame.rows, frames * 3 + k);
      if (main && quadIou(quad, main.pts) > 0.05) continue; // fundo de verdade: longe da carta
      const bg = warpCard(cv, frame, quad);
      negatives.push({ ...cardness(cv, bg), kind: "fundo" });
      release(bg);
    }
    release(frame);
    frames++;
    header = null;
    need = 16;
  }
}

const stat = (list, key) => {
  const v = list.map((x) => x[key]).sort((a, b) => a - b);
  const at = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, p05: at(0.05), p25: at(0.25), mediana: at(0.5), p75: at(0.75), p95: at(0.95) };
};
console.log("frames:", frames);
for (const key of ["score", "layout", "border", "text", "detail"]) {
  console.log(key.padEnd(7), "carta  ", JSON.stringify(stat(positives, key)));
  console.log("".padEnd(7), "outros ", JSON.stringify(stat(negatives, key)));
}
for (const cut of [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]) {
  const keep = positives.filter((p) => p.score >= cut).length / Math.max(positives.length, 1);
  const leak = negatives.filter((p) => p.score >= cut).length / Math.max(negatives.length, 1);
  console.log(`corte ${cut.toFixed(2)} → cartas mantidas ${(keep * 100).toFixed(1)}% · lixo que passa ${(leak * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------- fórmulas candidatas
const kinds = [...new Set(negatives.map((n) => n.kind))];
for (const k of kinds) {
  const list = negatives.filter((n) => n.kind === k);
  console.log(`\nnegativo "${k}" (${list.length})`);
  for (const key of ["layout", "border", "text", "detail"]) console.log("  ", key.padEnd(7), JSON.stringify(stat(list, key)));
}
const formulas = {
  "layout+text": (c) => 0.62 * c.layout + 0.26 * c.text + 0.12 * c.detail,
  "layout forte": (c) => 0.75 * c.layout + 0.15 * c.text + 0.1 * c.detail,
  "só layout": (c) => c.layout,
  "layout*text": (c) => c.layout * (0.6 + 0.4 * c.text),
};
console.log("");
for (const [name, fn] of Object.entries(formulas)) {
  for (const cut of [0.5, 0.6, 0.7, 0.8]) {
    const keep = positives.filter((p) => fn(p) >= cut).length / positives.length;
    const leakBox = negatives.filter((n) => n.kind !== "fundo" && fn(n) >= cut).length / Math.max(negatives.filter((n) => n.kind !== "fundo").length, 1);
    const leakBg = negatives.filter((n) => n.kind === "fundo" && fn(n) >= cut).length / Math.max(negatives.filter((n) => n.kind === "fundo").length, 1);
    console.log(`${name.padEnd(13)} corte ${cut.toFixed(2)} → cartas ${(keep * 100).toFixed(1)}% · outro retângulo ${(leakBox * 100).toFixed(1)}% · fundo ${(leakBg * 100).toFixed(1)}%`);
  }
}
