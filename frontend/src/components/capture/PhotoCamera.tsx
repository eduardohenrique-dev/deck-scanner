import { Aperture, Check, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { analyzeSource, ISSUE_TEXT, QUALITY_LIMITS, type FrameQuality } from "../../lib/quality";
import { Button, Chip } from "../ui";

type Shot = { blob: Blob; url: string; quality: FrameQuality };

export default function PhotoCamera({ onClose, onSend, maxPhotos }: { onClose: () => void; onSend: (files: Blob[]) => Promise<void>; maxPhotos: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisCanvas = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const [live, setLive] = useState<FrameQuality | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [pending, setPending] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Câmera indisponível neste navegador. No celular use o endereço HTTPS ou envie as fotos pela galeria.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        timer = window.setInterval(() => {
          if (video.videoWidth) setLive(analyzeSource(video, video.videoWidth, video.videoHeight, analysisCanvas.current));
        }, 300);
      } catch (e) {
        setError(`Não foi possível abrir a câmera: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d")!.drawImage(video, 0, 0);
    const quality = analyzeSource(c, c.width, c.height);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        const shot = { blob, url: URL.createObjectURL(blob), quality };
        if (quality.issues.length) setPending(shot);
        else setShots((prev) => [...prev, shot]);
        navigator.vibrate?.(20);
      },
      "image/jpeg",
      0.92,
    );
  }

  async function send() {
    setSending(true);
    try {
      await onSend(shots.map((s) => s.blob));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  const liveTone = !live ? "neutral" : live.issues.length ? "warn" : "ok";
  const full = shots.length >= maxPhotos;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Aperture className="size-5 text-accent" />
          <span className="font-medium">Câmera guiada</span>
          <Chip>
            {shots.length}/{maxPhotos}
          </Chip>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:text-text" aria-label="Fechar">
          <X className="size-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
        {/* guia de enquadramento: fileiras de até 5 cartas */}
        <div className="pointer-events-none absolute inset-[8%] grid grid-cols-5 grid-rows-2 gap-[2%] opacity-35">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-md border-2 border-dashed border-white/80" />
          ))}
        </div>
        <div className="absolute left-1/2 top-3 flex max-w-[92%] -translate-x-1/2 flex-col items-center gap-1.5 text-center">
          <span className="rounded-full bg-black/70 px-3 py-1 text-[13px] backdrop-blur">
            Até 5 cartas por fileira · deixe 1 carta em comum com a foto anterior
          </span>
          {live && (
            <span className={`rounded-full px-3 py-1 text-[13px] backdrop-blur ${liveTone === "ok" ? "bg-ok/25 text-ok" : "bg-warn/25 text-warn"}`}>
              {live.issues.length ? ISSUE_TEXT[live.issues[0]] : "Nitidez e luz boas"}
            </span>
          )}
        </div>
        {live && (
          <div className="absolute bottom-3 left-3 w-40 space-y-1 rounded-lg bg-black/60 p-2 text-[11px] text-muted backdrop-blur">
            <Meter label="nitidez" value={Math.min(1, live.sharpness / (QUALITY_LIMITS.blur * 3))} bad={live.issues.includes("blur")} />
            <Meter label="reflexo" value={Math.min(1, live.glare / (QUALITY_LIMITS.glare * 2))} bad={live.issues.includes("glare")} inverse />
          </div>
        )}
        {error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-bad">{error}</div>}
      </div>

      <div className="border-t border-line bg-panel/95 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
        <div className="scrollbar-thin mb-3 flex min-h-16 gap-2 overflow-x-auto">
          {shots.map((s, i) => (
            <div key={s.url} className="relative shrink-0">
              <img src={s.url} className="h-16 w-24 rounded-md object-cover" alt={`foto ${i + 1}`} />
              <button
                onClick={() => setShots((prev) => prev.filter((x) => x !== s))}
                className="absolute right-0.5 top-0.5 rounded bg-black/70 p-0.5 text-muted hover:text-bad"
                aria-label="Remover foto"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="text-[13px] text-muted">{full ? "Limite de fotos atingido" : "Toque para fotografar"}</span>
          <button
            onClick={capture}
            disabled={full || !!error}
            className="pulse-ring size-16 rounded-full border-4 border-white bg-accent disabled:opacity-40"
            aria-label="Fotografar"
          />
          <Button variant="primary" className="justify-self-end" disabled={!shots.length} busy={sending} onClick={send} icon={<Upload className="size-4" />}>
            Enviar {shots.length || ""}
          </Button>
        </div>
      </div>

      {pending && (
        <div className="absolute inset-0 z-10 flex items-end bg-black/70 sm:items-center sm:justify-center">
          <div className="animate-pop w-full space-y-3 rounded-t-2xl border border-line bg-panel p-4 sm:max-w-md sm:rounded-2xl">
            <img src={pending.url} className="max-h-60 w-full rounded-lg object-contain" alt="foto capturada" />
            {pending.quality.issues.map((i) => (
              <p key={i} className="text-warn">
                {ISSUE_TEXT[i]}
              </p>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => setPending(null)}>
                Tirar de novo
              </Button>
              <Button
                icon={<Check className="size-4" />}
                onClick={() => {
                  setShots((prev) => [...prev, pending]);
                  setPending(null);
                }}
              >
                Usar mesmo assim
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Meter({ label, value, bad, inverse }: { label: string; value: number; bad: boolean; inverse?: boolean }) {
  return (
    <div>
      <div className="flex justify-between">
        <span>{label}</span>
        <span className={bad ? "text-warn" : "text-ok"}>{bad ? (inverse ? "alto" : "baixa") : "ok"}</span>
      </div>
      <div className="mt-0.5 h-1 rounded bg-white/15">
        <div className={`h-1 rounded ${bad ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}
