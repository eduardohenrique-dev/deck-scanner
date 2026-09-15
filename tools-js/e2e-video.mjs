// Teste ponta a ponta da visão do NAVEGADOR (frontend/src/vision) com o vídeo sintético.
//
//   node --experimental-strip-types tools-js/e2e-video.mjs [--video caminho] [--limit N] [--no-upload] [--live]
//
// O Python só decodifica o vídeo (tools/dump_frames.py); detecção, agrupamento e escolha dos melhores
// frames rodam no código TypeScript do app. As leituras vão para a API local (http://127.0.0.1:8420)
// e o resultado é comparado com a verdade por tools/e2e.py report.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

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
const limit = Number(opt("--limit", "0"));
const api = opt("--api", "http://127.0.0.1:8420");
const upload = !args.includes("--no-upload");
const detectDim = Number(opt("--detect-dim", "960"));

const require = createRequire(path.join(root, "frontend", "package.json"));
const { resolveCv } = await import("../frontend/src/vision/cv.ts");
const { FrameProcessor } = await import("../frontend/src/vision/scanner.ts");
const { LIVE_OPTIONS } = await import("../frontend/src/vision/grouper.ts");
const live = args.includes("--live");
const t0 = Date.now();
const { cv } = await resolveCv(require("@techstark/opencv-js"));
console.error(`OpenCV.js pronto em ${Date.now() - t0} ms`);

// ------------------------------------------------------------------ PNG (sem dependências)
function png({ data, width, height }) {
  const rowLen = width * 3 + 1;
  const rows = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    let o = y * rowLen + 1;
    let s = y * width * 4;
    for (let x = 0; x < width; x++, s += 4) {
      rows[o++] = data[s];
      rows[o++] = data[s + 1];
      rows[o++] = data[s + 2];
    }
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rows, { level: 3 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function call(method, url, body) {
  const res = await fetch(api + url, { method, body, headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ------------------------------------------------------------------ sessão e captura
let session = null;
let capture = null;
if (upload) {
  session = await call("POST", "/api/sessions", JSON.stringify({ game_id: "mtg", format_id: "commander", mode: "video", name: "e2e vídeo (navegador)", settings: { default_language: "en" } }));
  capture = await call("POST", `/api/sessions/${session.id}/captures`, JSON.stringify({ type: live ? "live" : "video", original_name: path.basename(video) }));
  console.error(`sessão ${session.id}`);
}

let queue = Promise.resolve();
let sightings = 0;
let uploaded = 0;
const onSighting = (s) => {
  sightings++;
  if (!upload) return;
  const meta = { ...s.meta, capture_id: capture.id };
  const files = s.frames.map((f) => ({ card: png(f.card), context: png(f.context) }));
  queue = queue.then(async () => {
    const form = new FormData();
    form.append("meta", JSON.stringify(meta));
    files.forEach((f, i) => {
      form.append("cards", new Blob([f.card], { type: "image/png" }), `card-${i}.png`);
      form.append("contexts", new Blob([f.context], { type: "image/png" }), `context-${i}.png`);
    });
    await call("POST", `/api/sessions/${session.id}/sightings`, form);
    uploaded++;
  });
};

// --live: agrupamento da câmera ao vivo (lê com a carta parada; outra carta só depois de sair ou trocar a arte)
const processor = new FrameProcessor(cv, onSighting, detectDim, live ? LIVE_OPTIONS : {});

// ------------------------------------------------------------------ frames do Python
const child = spawn(python, ["-m", "tools.dump_frames", video, ...(limit ? ["--limit", String(limit)] : [])], { cwd: backend, stdio: ["ignore", "pipe", "inherit"] });
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
let frames = 0;
let totalMs = 0;
let worstMs = 0;
let need = 16;
let header = null;
const started = Date.now();
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
    const mat = new cv.Mat(header.h, header.w, cv.CV_8UC4);
    mat.data.set(bytes);
    const report = processor.push(mat, header.t);
    frames++;
    totalMs += report.ms;
    worstMs = Math.max(worstMs, report.ms);
    if (frames % 200 === 0) console.error(`${frames} frames · ${report.groups} cartas · ${(totalMs / frames).toFixed(0)} ms/frame`);
    header = null;
    need = 16;
    // deixa as leituras irem para a API entre os frames
    await new Promise((r) => setImmediate(r));
  }
}
processor.flush();
await queue;
const summary = { frames, groups: processor.groups, sightings, uploaded, ms_per_frame: +(totalMs / Math.max(frames, 1)).toFixed(1), worst_ms: worstMs, seconds: (Date.now() - started) / 1000 };
console.error(JSON.stringify(summary));

if (upload) {
  await call("POST", `/api/sessions/${session.id}/captures/${capture.id}/finish`);
  const report = spawnSync(python, ["-m", "tools.e2e", "report", "--session", session.id, "--dir", path.dirname(video)], { cwd: backend, encoding: "utf8" });
  process.stdout.write(report.stdout);
  if (report.status !== 0) process.stderr.write(report.stderr);
}
