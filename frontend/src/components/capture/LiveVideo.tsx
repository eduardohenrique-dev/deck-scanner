import { CircleStop, Hand, ScanLine, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveEvent } from "../../lib/useSession";
import type { FrameState } from "../../lib/types";
import { cardName } from "../../lib/format";
import { Button, Chip } from "../ui";

type Props = {
  sessionId: string;
  onClose: () => void;
  subscribe: (fn: (ev: LiveEvent) => void) => () => void;
};

const SEND_INTERVAL_MS = 100; // ~10 fps
const MAX_SIDE = 960;

export default function LiveVideo({ sessionId, onClose, subscribe }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const frameCanvas = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const sending = useRef(false);
  const [phase, setPhase] = useState<"starting" | "running" | "stopping" | "error">("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [read, setRead] = useState<{ id: string; name: string; ok: boolean }[]>([]);

  const beep = useCallback((ok: boolean) => {
    try {
      const ctx = audioRef.current;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = ok ? 880 : 330;
      gain.gain.value = 0.07;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.07);
      navigator.vibrate?.(ok ? 25 : [40, 40, 40]);
    } catch {
      /* áudio indisponível */
    }
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      wsRef.current?.close();
    } catch {
      /* já fechado */
    }
    wsRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    audioRef.current = new AudioContext();
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase("error");
        setMessage("Este navegador não liberou a câmera. No celular, abra pelo endereço HTTPS (npm run dev:mobile) ou envie um vídeo gravado.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${location.host}/api/sessions/${sessionId}/live`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        ws.onopen = () => {
          setPhase("running");
          timerRef.current = window.setInterval(sendFrame, SEND_INTERVAL_MS);
        };
        ws.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data.type === "frame_state") setFrame(data);
          if (data.type === "stopped") {
            cleanup();
            onClose();
          }
        };
        ws.onerror = () => {
          setPhase("error");
          setMessage("Conexão com o servidor caiu.");
        };
      } catch (e) {
        setPhase("error");
        setMessage(`Não foi possível abrir a câmera: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      cleanup();
      void audioRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(
    () =>
      subscribe((ev) => {
        if (ev.type !== "detection") return;
        const d = ev.detection;
        if (d.status === "pending" || d.dup_of) return;
        if (d.status === "identified" || d.status === "unidentified" || d.status === "back" || d.status === "token") {
          setRead((prev) => {
            if (prev.some((p) => p.id === d.id)) return prev;
            const name = d.status === "identified" ? cardName(d.card) : d.status === "back" ? "verso de carta" : d.status === "token" ? `token: ${cardName(d.card)}` : "não identificada";
            beep(d.status === "identified");
            return [{ id: d.id, name, ok: d.status === "identified" }, ...prev].slice(0, 30);
          });
        }
      }),
    [subscribe, beep],
  );

  function sendFrame() {
    const ws = wsRef.current;
    const video = videoRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !video || sending.current || ws.bufferedAmount > 250_000) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
    const c = frameCanvas.current;
    c.width = Math.round(vw * scale);
    c.height = Math.round(vh * scale);
    c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
    sending.current = true;
    const t = performance.now();
    c.toBlob(
      async (blob) => {
        sending.current = false;
        if (!blob || ws.readyState !== WebSocket.OPEN) return;
        const jpeg = new Uint8Array(await blob.arrayBuffer());
        const payload = new Uint8Array(8 + jpeg.length);
        new DataView(payload.buffer).setFloat64(0, t, true);
        payload.set(jpeg, 8);
        ws.send(payload);
      },
      "image/jpeg",
      0.72,
    );
  }

  // desenha o contorno rastreado sobre o vídeo (object-contain)
  useEffect(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!frame?.quad || !video.videoWidth) return;
    const s = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const ox = (rect.width - video.videoWidth * s) / 2;
    const oy = (rect.height - video.videoHeight * s) / 2;
    ctx.lineWidth = 4;
    ctx.strokeStyle = frame.group_frames >= 3 ? "#3fcf8e" : "#f2b544";
    ctx.beginPath();
    frame.quad.forEach(([x, y], i) => {
      const px = ox + x * video.videoWidth * s;
      const py = oy + y * video.videoHeight * s;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
  }, [frame]);

  function stop() {
    setPhase("stopping");
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send("stop");
      window.setTimeout(() => {
        cleanup();
        onClose();
      }, 30000);
    } else {
      cleanup();
      onClose();
    }
  }

  const hint =
    phase !== "running"
      ? null
      : !frame?.tracking
        ? "Mostre uma carta por vez, bem enquadrada"
        : frame.group_frames < 3
          ? "Segure a carta parada…"
          : "Lida — pode passar para a próxima";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <ScanLine className="size-5 text-accent" />
          <span className="font-medium">Câmera ao vivo</span>
          <Chip tone="ok">{read.filter((r) => r.ok).length} lidas</Chip>
          {frame?.dropped ? <Chip>descartados {frame.dropped}</Chip> : null}
        </div>
        <button onClick={stop} className="rounded-md p-1.5 text-muted hover:text-text" aria-label="Fechar">
          <X className="size-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {hint && (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-sm backdrop-blur">
            <Hand className="mr-1.5 inline size-4 text-accent" />
            {hint}
          </div>
        )}
        {phase === "starting" && <div className="absolute inset-0 grid place-items-center text-muted">Abrindo câmera…</div>}
        {phase === "error" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm space-y-3">
              <p className="text-bad">{message}</p>
              <Button onClick={onClose}>Voltar</Button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line bg-panel/95 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
        <div className="scrollbar-thin mb-3 flex gap-2 overflow-x-auto">
          {read.length === 0 && <span className="text-sm text-muted">As cartas aparecem aqui conforme são lidas.</span>}
          {read.map((r) => (
            <span key={r.id} className={`animate-pop shrink-0 rounded-md px-2 py-1 text-[13px] ${r.ok ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>
              {r.name}
            </span>
          ))}
        </div>
        <Button variant="danger" size="lg" className="w-full" onClick={stop} busy={phase === "stopping"} icon={<CircleStop className="size-5" />}>
          {phase === "stopping" ? "Finalizando leitura…" : "Parar e revisar"}
        </Button>
      </div>
    </div>
  );
}
