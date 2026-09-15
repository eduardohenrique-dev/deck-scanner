// Tempo por etapa da visão do navegador em alguns frames do vídeo sintético.
//   node --experimental-strip-types tools-js/profile-vision.mjs [--frames 40]
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const backend = path.join(root, "backend");
const args = process.argv.slice(2);
const count = Number(args[args.indexOf("--frames") + 1] || 40);

const require = createRequire(path.join(root, "frontend", "package.json"));
const { resolveCv, release } = await import("../frontend/src/vision/cv.ts");
const { detectCards, warpCard } = await import("../frontend/src/vision/detect.ts");
const { artSignatures } = await import("../frontend/src/vision/hash.ts");
const { frameQuality } = await import("../frontend/src/vision/quality.ts");
const { cv } = await resolveCv(require("@techstark/opencv-js"));

const child = spawn(path.join(backend, ".venv", "Scripts", "python.exe"), ["-m", "tools.dump_frames", path.join(backend, "data", "synth", "video100", "deck.mp4"), "--limit", String(count)], { cwd: backend, stdio: ["ignore", "pipe", "inherit"] });
const chunks = [];
for await (const c of child.stdout) chunks.push(c);
const all = Buffer.concat(chunks);
const frames = [];
for (let o = 0; o < all.length; ) {
  const w = all.readInt32LE(o);
  const h = all.readInt32LE(o + 4);
  o += 16;
  frames.push({ w, h, data: all.subarray(o, o + w * h * 4) });
  o += w * h * 4;
}

const time = (fn) => {
  const t = performance.now();
  const r = fn();
  return [r, performance.now() - t];
};
for (const dim of [960, 800, 640, 480]) {
  const acc = { detect: 0, warp: 0, sig: 0, quality: 0, found: 0 };
  for (const f of frames) {
    const mat = new cv.Mat(f.h, f.w, cv.CV_8UC4);
    mat.data.set(f.data);
    const [quads, td] = time(() => detectCards(cv, mat, { maxDim: dim, minAreaFrac: 0.02 }));
    acc.detect += td;
    if (quads.length) {
      acc.found++;
      const [warped, tw] = time(() => warpCard(cv, mat, quads[0].pts));
      acc.warp += tw;
      acc.sig += time(() => artSignatures(cv, warped))[1];
      acc.quality += time(() => frameQuality(cv, warped, quads[0].pts, f.w, f.h))[1];
      release(warped);
    }
    release(mat);
  }
  const n = frames.length;
  console.log(`dim ${dim}: detect ${(acc.detect / n).toFixed(1)} ms · warp ${(acc.warp / n).toFixed(1)} · assinatura ${(acc.sig / n).toFixed(1)} · qualidade ${(acc.quality / n).toFixed(1)} · com carta ${acc.found}/${n}`);
}
