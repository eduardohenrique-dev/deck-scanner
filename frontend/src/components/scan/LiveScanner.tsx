import { Camera, Flashlight, FlashlightOff, Play, Square, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMediaQuery, usePersistentState } from "../../lib/hooks";
import type { SessionState } from "../../lib/types";
import { Lens } from "../icons";
import { Button, cx, IconButton } from "../ui";
import ReadsStrip from "./ReadsStrip";
import ScanOverlay, { guidance } from "./ScanOverlay";
import { prepareVision, useScanner, visionLoaded } from "./useScanner";

type CameraState = "off" | "opening" | "on" | "denied" | "unsupported" | "failed";

const DOT: Record<string, string> = {
  neutral: "bg-cream-faint",
  brass: "bg-brass-300 animate-pulse",
  ok: "bg-moss-400",
  warn: "bg-amber-400",
  bad: "bg-wine-400",
  info: "bg-steel-400",
};

/** Câmera ao vivo: passe uma carta por vez; cada carta parada vira uma leitura enviada ao servidor. */
export default function LiveScanner({ sessionId, onState, onBusy }: { sessionId: string; onState: (s: SessionState) => void; onBusy?: (busy: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>("off");
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [torch, setTorch] = useState<boolean | null>(null);
  const [sound, setSound] = usePersistentState("deckscanner:sound", true);
  const [firstLoad] = useState(() => !visionLoaded());
  const scanner = useScanner(sessionId, onState, { sound });
  const running = scanner.phase === "running";
  const busy = scanner.phase !== "idle" && scanner.phase !== "error";

  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  const closeCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera("off");
    setTorch(null);
  }, []);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  // tela acesa enquanto lê
  useEffect(() => {
    if (!running || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request("screen").then((l) => (lock = l), () => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, [running]);

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unsupported");
      return;
    }
    setCamera("opening");
    void prepareVision().catch(() => undefined);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      stream.current = media;
      const el = video.current!;
      el.srcObject = media;
      await el.play();
      setSize({ w: el.videoWidth || 1280, h: el.videoHeight || 720 });
      const track = media.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch(caps.torch ? false : null);
      setCamera("on");
    } catch (e) {
      const name = (e as DOMException).name;
      setCamera(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
    }
  }

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  }

  const tip = guidance(scanner.report, running);
  const counted = scanner.counted;
  // no celular a câmera aberta ocupa a tela inteira: visor em cima, controles e leituras embaixo
  const phone = useMediaQuery("(max-width: 639px)");
  const immersive = phone && camera === "on";

  useEffect(() => {
    if (!immersive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [immersive]);

  return (
    <div className={immersive ? "fixed inset-0 z-50 flex flex-col bg-oak-950" : "space-y-4"}>
      <div
        className={cx(
          "viewfinder",
          immersive ? "min-h-0 flex-1 rounded-none border-0 shadow-none" : "mx-auto aspect-[3/4] max-h-[68dvh] w-full sm:aspect-[4/3]",
          camera !== "on" && "grid place-items-center",
        )}
      >
        <video
          ref={video}
          muted
          playsInline
          onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          className={cx("absolute inset-0 h-full w-full object-cover", camera !== "on" && "invisible")}
        />
        {camera === "on" ? (
          <>
            <ScanOverlay report={running ? scanner.report : null} width={size.w} height={size.h} showGuide />
            <div className="absolute top-[max(env(safe-area-inset-top),12px)] right-3 left-3 z-10 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {immersive && !busy && (
                  <IconButton label="Fechar câmera" onClick={closeCamera} className="border border-oak-600 bg-oak-950/85">
                    <X className="size-5" />
                  </IconButton>
                )}
                {(counted !== null || running) && (
                  <span className="rounded-[5px] border border-oak-600 bg-oak-950/85 px-2.5 py-1 font-serif text-[15px] text-cream">
                    <strong className="tabular text-[19px]">{counted ?? 0}</strong> {counted === 1 ? "carta" : "cartas"}
                  </span>
                )}
              </div>
              <div className="flex gap-1 rounded-[6px] border border-oak-600 bg-oak-950/85 p-0.5">
                {torch !== null && (
                  <IconButton label={torch ? "Desligar lanterna" : "Ligar lanterna"} onClick={toggleTorch}>
                    {torch ? <FlashlightOff className="size-[18px]" /> : <Flashlight className="size-[18px]" />}
                  </IconButton>
                )}
                <IconButton label={sound ? "Silenciar o aviso de leitura" : "Tocar aviso a cada leitura"} onClick={() => setSound(!sound)}>
                  {sound ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
                </IconButton>
              </div>
            </div>
            <div className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-2.5 rounded-[5px] border border-oak-600 bg-oak-950/88 px-3 py-2.5" role="status" aria-live="polite">
              <span className={cx("size-2.5 shrink-0 rounded-full", DOT[tip.tone])} />
              <span className="text-[15px] leading-snug text-cream">{tip.text}</span>
              {running && scanner.fps > 0 && <span className="tabular ml-auto shrink-0 text-[12px] text-cream-faint">{scanner.fps} q/s</span>}
            </div>
          </>
        ) : (
          <CameraMessage state={camera} onOpen={openCamera} />
        )}
      </div>

      <div className={cx(immersive ? "space-y-3 border-t border-brass-700/60 bg-oak-900 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]" : "space-y-4")}>
        {camera === "on" && (
          <div className="flex flex-wrap items-center gap-3">
            {running ? (
              <Button variant="brass" size="lg" icon={<Square className="size-4 fill-current" />} onClick={scanner.stop} className={immersive ? "flex-1" : undefined}>
                terminar leitura
              </Button>
            ) : (
              <Button
                variant="brass"
                size="lg"
                icon={<Play className="size-4 fill-current" />}
                busy={scanner.phase === "loading" || scanner.phase === "finishing"}
                onClick={() => video.current && void scanner.startLive(video.current)}
                className={immersive ? "flex-1" : undefined}
              >
                {scanner.phase === "loading" ? (firstLoad ? "preparando a lente…" : "abrindo…") : scanner.phase === "finishing" ? "fechando as leituras…" : "começar a leitura"}
              </Button>
            )}
            {!busy && !immersive && (
              <Button variant="ghost" onClick={closeCamera}>
                fechar câmera
              </Button>
            )}
            <p className={cx("text-[14px] text-cream-faint", immersive && "basis-full text-center")}>
              {scanner.phase === "loading" && firstLoad
                ? "Na primeira vez o leitor de imagem é baixado (cerca de 13 MB)."
                : scanner.pending > 0
                  ? `enviando ${scanner.pending} ${scanner.pending === 1 ? "leitura" : "leituras"}…`
                  : running
                    ? "Segure cada carta parada por meio segundo."
                    : null}
            </p>
          </div>
        )}

        {scanner.error && (
          <p className="rounded-[5px] border border-wine-600/60 bg-wine-600/10 px-3 py-2 text-[14px] text-wine-300" role="alert">
            {scanner.error}
          </p>
        )}

        <ReadsStrip reads={scanner.reads} />
      </div>
    </div>
  );
}

function CameraMessage({ state, onOpen }: { state: CameraState; onOpen: () => void }) {
  if (state === "denied")
    return (
      <Message title="O navegador bloqueou a câmera">
        Libere o acesso à câmera nas permissões do site (o cadeado ao lado do endereço) e tente de novo.
        <Button className="mt-4" onClick={onOpen} icon={<Camera className="size-4" />}>
          tentar de novo
        </Button>
      </Message>
    );
  if (state === "unsupported")
    return (
      <Message title="Câmera indisponível aqui">
        O navegador só libera a câmera em páginas seguras (https). Use o endereço https do app ou envie um vídeo gravado.
      </Message>
    );
  if (state === "failed")
    return (
      <Message title="Não consegui abrir a câmera">
        Ela pode estar em uso por outro aplicativo.
        <Button className="mt-4" onClick={onOpen} icon={<Camera className="size-4" />}>
          tentar de novo
        </Button>
      </Message>
    );
  return (
    <Message title="Câmera ao vivo" icon={<Lens size={40} />}>
      Passe o baralho uma carta por vez, parada no centro por meio segundo. Nada é gravado: só o recorte de cada carta vai para o servidor.
      <Button className="mt-4" variant="brass" size="lg" busy={state === "opening"} onClick={onOpen} icon={<Camera className="size-5" />}>
        abrir câmera
      </Button>
    </Message>
  );
}

function Message({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative z-10 flex max-w-sm flex-col items-center px-6 text-center">
      {icon && <div className="mb-3 text-brass-400">{icon}</div>}
      <p className="font-serif text-[21px] font-semibold text-cream">{title}</p>
      <div className="mt-1 flex flex-col items-center text-[15px] text-cream-dim">{children}</div>
    </div>
  );
}
