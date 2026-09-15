/**
 * Worker de visão: recebe frames (ImageBitmap), roda detecção + agrupamento em OpenCV.js
 * e devolve o estado de cada frame e as leituras prontas (JPEG) para envio.
 */
import cvModule from "@techstark/opencv-js";
import { release, resolveCv, type CV, type Mat, type RawImage } from "./cv.ts";
import type { WorkerIn, WorkerOut } from "./protocol.ts";
import { FrameProcessor, type Sighting } from "./scanner.ts";

const scope = self as unknown as {
  postMessage(message: WorkerOut, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
};
const post = (message: WorkerOut) => scope.postMessage(message);

let cv: CV | null = null;
let processor: FrameProcessor | null = null;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let encoding: Promise<void> = Promise.resolve();

async function jpeg(raw: RawImage, quality: number): Promise<Blob> {
  const c = new OffscreenCanvas(raw.width, raw.height);
  c.getContext("2d")!.putImageData(new ImageData(raw.data as Uint8ClampedArray<ArrayBuffer>, raw.width, raw.height), 0, 0);
  return c.convertToBlob({ type: "image/jpeg", quality });
}

function onSighting(s: Sighting) {
  encoding = encoding.then(async () => {
    const cards = await Promise.all(s.frames.map((f) => jpeg(f.card, 0.88)));
    const contexts = await Promise.all(s.frames.map((f) => jpeg(f.context, 0.85)));
    post({ type: "sighting", meta: s.meta, cards, contexts });
  });
}

function toMat(bitmap: ImageBitmap): Mat {
  const { width, height } = bitmap;
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    context = canvas.getContext("2d", { willReadFrequently: true });
  }
  context!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context!.getImageData(0, 0, width, height);
  const mat = new cv!.Mat(height, width, cv!.CV_8UC4);
  mat.data.set(pixels.data);
  return mat;
}

scope.onmessage = async (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init": {
        const started = performance.now();
        if (!cv) cv = (await resolveCv(cvModule)).cv;
        post({ type: "ready", ms: Math.round(performance.now() - started) });
        break;
      }
      case "start":
        processor?.dispose();
        processor = new FrameProcessor(cv!, onSighting, msg.detectMaxDim);
        break;
      case "frame": {
        if (!processor || !cv) {
          msg.bitmap.close();
          break;
        }
        const mat = toMat(msg.bitmap);
        try {
          post({ type: "frame", report: processor.push(mat, msg.t) });
        } catch (err) {
          release(mat);
          throw err;
        }
        break;
      }
      case "flush":
        processor?.flush();
        await encoding;
        post({ type: "flushed", groups: processor?.groups ?? 0 });
        processor?.dispose();
        processor = null;
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
