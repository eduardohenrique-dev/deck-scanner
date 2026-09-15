import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { Detection, SessionState } from "../../lib/types";
import { SAME_THRESH } from "../../vision/grouper";
import { hamming } from "../../vision/hash";
import type { FrameReport, SightingMeta, WorkerIn, WorkerOut } from "../../vision/protocol";

export type ScanPhase = "idle" | "loading" | "running" | "finishing" | "error";

export type ReadItem = {
  key: string;
  group: number;
  status: "sending" | "done" | "failed";
  preview: string;
  detection?: Detection;
  merged?: boolean;
  /** leitura falha substituída por uma nova leitura da mesma carta */
  replaced?: boolean;
};

/** Pisca na borda do visor: verde para carta anotada, vermelho para carta não reconhecida. */
export type Flash = { tone: "ok" | "bad"; id: number };

/** Carta que a câmera não reconheceu: mostrar de novo ou dizer o nome. */
export type Miss = { key: string; detectionId: string; preview: string; reason: "unknown" | "back" };

/** ~10 leituras por segundo, como na calibração do agrupamento. */
const FRAME_INTERVAL_MS = 100;
const MAX_SIDE = 1280;
const LIVE_DETECT_DIM = 800;
const VIDEO_DETECT_DIM = 960;
const KEEP_READS = 60;

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

// O worker (OpenCV.js, ~13 MB) é carregado uma vez e reaproveitado entre capturas.
let shared: { worker: Worker; ready: Promise<number> } | null = null;

function visionWorker() {
  if (shared) return shared;
  const worker = new Worker(new URL("../../vision/scanner.worker.ts", import.meta.url), { type: "module" });
  const ready = new Promise<number>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === "ready") resolve(e.data.ms);
      else if (e.data.type === "error") reject(new Error(e.data.message));
      else return;
      worker.removeEventListener("message", onMessage);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", (e) => reject(new Error(e.message || "não consegui carregar a leitura de imagem")), { once: true });
  });
  worker.postMessage({ type: "init" } satisfies WorkerIn);
  const entry = { worker, ready };
  shared = entry;
  ready.catch(() => {
    if (shared === entry) shared = null;
    worker.terminate();
  });
  return entry;
}

/** Começa a baixar/compilar a visão antes do clique em "começar" (ex.: ao abrir a câmera). */
export function prepareVision(): Promise<number> {
  const { ready } = visionWorker();
  return ready;
}

export const visionLoaded = () => shared !== null;

function fit(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", done);
      resolve();
    };
    const timer = window.setTimeout(done, 4000);
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

let audio: AudioContext | null = null;
/** "Tim" curto de confirmação de leitura. */
export function chime() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1320, t);
    osc.frequency.exponentialRampToValueAtTime(990, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  } catch {
    /* sem áudio: segue em silêncio */
  }
}

type Run = { captureId: string; stop: boolean; live: boolean; worker: Worker };

/** Falha e acerto seguidos com a mesma arte são a mesma carta mostrada de novo. */
const RESHOW_WINDOW_MS = 30_000;

type Failed = { key: string; detectionId: string; sig: number[]; at: number };

/**
 * Captura por câmera ao vivo ou arquivo de vídeo: frames vão para o worker de visão,
 * cada carta vira uma leitura enviada ao servidor em ordem, e no fim a captura é fechada.
 */
export function useScanner(sessionId: string, onState: (s: SessionState) => void, opts: { sound?: boolean } = {}) {
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FrameReport | null>(null);
  const [reads, setReads] = useState<ReadItem[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [counted, setCounted] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [fps, setFps] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [miss, setMiss] = useState<Miss | null>(null);
  const failed = useRef<Failed | null>(null);
  const run = useRef<Run | null>(null);
  const uploads = useRef<Promise<void>>(Promise.resolve());
  const onStateRef = useRef(onState);
  const soundRef = useRef(opts.sound ?? true);
  onStateRef.current = onState;
  soundRef.current = opts.sound ?? true;

  // a lista na tela acompanha a captura: recarrega o estado da sessão no máximo a cada 2,5 s
  const lastRefresh = useRef(0);
  const refreshing = useRef(false);
  const generation = useRef(0);
  const refreshSoon = useCallback(() => {
    const now = performance.now();
    if (refreshing.current || now - lastRefresh.current < 2500) return;
    refreshing.current = true;
    lastRefresh.current = now;
    const gen = generation.current;
    api
      .session(sessionId)
      .then((s) => gen === generation.current && onStateRef.current(s))
      .catch(() => undefined)
      .finally(() => (refreshing.current = false));
  }, [sessionId]);

  const previews = useRef(new Set<string>());
  useEffect(() => {
    const urls = previews.current;
    return () => {
      if (run.current) run.current.stop = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const blink = useCallback((tone: Flash["tone"]) => setFlash({ tone, id: performance.now() }), []);

  /** O que a leitura respondida significa para quem está com a carta na mão (só ao vivo). */
  const judge = useCallback(
    (token: Run, group: number, key: string, preview: string, sig: number[], detection: Detection, merged: boolean) => {
      const status = detection.status;
      // a mesma carta mostrada de novo depois de uma falha: a leitura que falhou sai da revisão
      const prev = failed.current;
      if (prev && status !== "noise" && performance.now() - prev.at < RESHOW_WINDOW_MS && sig.length
        && prev.sig.length === sig.length && hamming(Uint8Array.from(prev.sig), Uint8Array.from(sig)) <= SAME_THRESH) {
        failed.current = null;
        setReads((r) => r.map((x) => (x.key === prev.key ? { ...x, replaced: true } : x)));
        setMiss((m) => (m?.detectionId === prev.detectionId ? null : m));
        void api.setStatus(prev.detectionId, "ignored").then(() => refreshSoon(), () => undefined);
      }
      if (status === "identified" || status === "token") {
        if (merged) return;
        blink("ok");
        setMiss((m) => (m && failed.current?.detectionId === m.detectionId ? m : null));
        if (soundRef.current) chime();
      } else if (status === "unidentified" || status === "back") {
        blink("bad");
        failed.current = { key, detectionId: detection.id, sig, at: performance.now() };
        setMiss({ key, detectionId: detection.id, preview, reason: status === "back" ? "back" : "unknown" });
        // carta ainda parada no quadro: mais uma leitura com frames novos (o worker confere se é a mesma)
        if (status === "unidentified" && !token.stop) token.worker.postMessage({ type: "rearm", group } satisfies WorkerIn);
      }
    },
    [blink, refreshSoon],
  );

  const enqueue = useCallback(
    (token: Run, meta: SightingMeta, cards: Blob[], contexts: Blob[], sig: number[]) => {
      const captureId = token.captureId;
      const key = `${captureId}:${meta.group}`;
      const preview = URL.createObjectURL(cards[0]);
      previews.current.add(preview);
      setReads((r) => {
        const next = [{ key, group: meta.group, status: "sending" as const, preview }, ...r];
        for (const old of next.slice(KEEP_READS)) {
          URL.revokeObjectURL(old.preview);
          previews.current.delete(old.preview);
        }
        return next.slice(0, KEEP_READS);
      });
      setPending((n) => n + 1);
      const update = (patch: Partial<ReadItem>) => setReads((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      uploads.current = uploads.current.then(async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            const res = await api.postSighting(sessionId, { ...meta, capture_id: captureId }, cards.map((card, i) => ({ card, context: contexts[i] ?? null })));
            update({ status: "done", detection: res.detection, merged: res.merged });
            setCounted(res.physical_cards);
            if (token.live) judge(token, meta.group, key, preview, sig, res.detection, res.merged);
            else if (soundRef.current && res.detection.status === "identified" && !res.merged) chime();
            refreshSoon();
            break;
          } catch (e) {
            const permanent = e instanceof ApiError && e.status >= 400 && e.status < 500;
            if (permanent || attempt >= 4) {
              update({ status: "failed" });
              break;
            }
            await sleep(700 * attempt);
          }
        }
        setPending((n) => n - 1);
      });
    },
    [sessionId, refreshSoon, judge],
  );

  /** Liga o worker a esta captura; devolve funções para mandar frames e fechar. */
  const connect = useCallback(
    (worker: Worker, token: Run) => {
      let waiting: { resolve: (r: FrameReport) => void; reject: (e: Error) => void } | null = null;
      let flushed: (() => void) | null = null;
      const onMessage = (e: MessageEvent<WorkerOut>) => {
        const msg = e.data;
        if (msg.type === "frame") {
          waiting?.resolve(msg.report);
          waiting = null;
        } else if (msg.type === "sighting") {
          enqueue(token, msg.meta, msg.cards, msg.contexts, msg.sig);
        } else if (msg.type === "flushed") {
          flushed?.();
        } else if (msg.type === "error") {
          waiting?.reject(new Error(msg.message));
          waiting = null;
          flushed?.();
        }
      };
      worker.addEventListener("message", onMessage);
      return {
        frame: (bitmap: ImageBitmap, t: number) =>
          new Promise<FrameReport>((resolve, reject) => {
            waiting = { resolve, reject };
            worker.postMessage({ type: "frame", t, bitmap } satisfies WorkerIn, [bitmap]);
          }),
        flush: () =>
          new Promise<void>((resolve) => {
            flushed = resolve;
            worker.postMessage({ type: "flush" } satisfies WorkerIn);
          }),
        detach: () => worker.removeEventListener("message", onMessage),
      };
    },
    [enqueue],
  );

  const begin = useCallback(
    async (type: "live" | "video", name: string | undefined, detectDim: number) => {
      if (run.current) return null;
      setError(null);
      setPhase("loading");
      try {
        const { worker, ready } = visionWorker();
        await ready;
        const capture = await api.createCapture(sessionId, type, name);
        const token: Run = { captureId: capture.id, stop: false, live: type === "live", worker };
        run.current = token;
        worker.postMessage({ type: "start", detectMaxDim: detectDim, live: type === "live" } satisfies WorkerIn);
        failed.current = null;
        setMiss(null);
        setCounted(null);
        setPhase("running");
        return { worker, token, link: connect(worker, token) };
      } catch (e) {
        setPhase("error");
        setError(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [sessionId, connect],
  );

  const finish = useCallback(
    async (token: Run, link: ReturnType<typeof connect>) => {
      setPhase("finishing");
      try {
        await link.flush();
        await uploads.current;
        const final = await api.finishCapture(sessionId, token.captureId);
        generation.current++; // uma recarga atrasada não sobrescreve o estado final
        onStateRef.current(final);
        setPhase("idle");
      } catch (e) {
        setPhase("error");
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        link.detach();
        run.current = null;
        setReport(null);
        setProgress(null);
      }
    },
    [sessionId],
  );

  const startLive = useCallback(
    async (video: HTMLVideoElement) => {
      const started = await begin("live", undefined, LIVE_DETECT_DIM);
      if (!started) return;
      const { token, link } = started;
      const t0 = performance.now();
      let last = 0;
      let frames = 0;
      let windowStart = t0;
      try {
        while (!token.stop) {
          if (video.readyState < 2 || document.hidden || !video.videoWidth) {
            await sleep(150);
            continue;
          }
          const wait = FRAME_INTERVAL_MS - (performance.now() - last);
          if (wait > 0) await sleep(wait);
          last = performance.now();
          const { w, h } = fit(video.videoWidth, video.videoHeight, MAX_SIDE);
          const bitmap = await createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" });
          setReport(await link.frame(bitmap, (last - t0) / 1000));
          frames++;
          if (last - windowStart >= 1000) {
            setFps(Math.round((frames * 1000) / (last - windowStart)));
            frames = 0;
            windowStart = last;
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      await finish(token, link);
    },
    [begin, finish],
  );

  const startVideo = useCallback(
    async (file: File, video: HTMLVideoElement) => {
      const url = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      video.src = url;
      const loaded = await new Promise<boolean>((resolve) => {
        video.onloadedmetadata = () => resolve(true);
        video.onerror = () => resolve(false);
      });
      if (!loaded || !Number.isFinite(video.duration) || video.duration <= 0) {
        setPhase("error");
        setError("Não consegui abrir esse vídeo neste navegador. Vídeos MP4 (H.264) funcionam em qualquer lugar.");
        URL.revokeObjectURL(url);
        return;
      }
      const started = await begin("video", file.name, VIDEO_DETECT_DIM);
      if (!started) {
        URL.revokeObjectURL(url);
        return;
      }
      const { token, link } = started;
      const duration = video.duration;
      try {
        for (let i = 0; !token.stop; i++) {
          const t = i * (FRAME_INTERVAL_MS / 1000);
          if (t >= duration) break;
          await seek(video, t);
          const { w, h } = fit(video.videoWidth, video.videoHeight, MAX_SIDE);
          const bitmap = await createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" });
          setReport(await link.frame(bitmap, t));
          setProgress(Math.min(1, t / duration));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      await finish(token, link);
      URL.revokeObjectURL(url);
    },
    [begin, finish],
  );

  const stop = useCallback(() => {
    if (run.current) run.current.stop = true;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setPhase((p) => (p === "error" ? "idle" : p));
  }, []);

  /** Deixa a carta não reconhecida para a revisão depois. */
  const dismissMiss = useCallback(() => {
    setMiss(null);
    failed.current = null;
  }, []);

  /** A pessoa disse qual carta era. */
  const resolveMiss = useCallback(
    async (cardRefId: string) => {
      const m = miss;
      if (!m) return;
      const state = await api.identify(m.detectionId, cardRefId);
      generation.current++;
      onStateRef.current(state);
      const d = state.detections.find((x) => x.id === m.detectionId);
      if (d) setReads((r) => r.map((x) => (x.key === m.key ? { ...x, detection: d } : x)));
      if (failed.current?.detectionId === m.detectionId) failed.current = null;
      setMiss(null);
      blink("ok");
      if (soundRef.current) chime();
    },
    [miss, blink],
  );

  return { phase, error, report, reads, progress, counted, pending, fps, flash, miss, startLive, startVideo, stop, clearError, dismissMiss, resolveMiss };
}
