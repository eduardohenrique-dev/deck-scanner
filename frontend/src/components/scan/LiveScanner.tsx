import { Camera, Flashlight, FlashlightOff, Play, Square, SwitchCamera, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { brl } from "../../lib/format";
import { useMediaQuery, usePersistentState } from "../../lib/hooks";
import type { SessionState } from "../../lib/types";
import { Lens } from "../icons";
import { Button, cx, IconButton, Select } from "../ui";
import ReadsStrip from "./ReadsStrip";
import ScanOverlay, { guidance } from "./ScanOverlay";
import CardSearch from "../cards/CardSearch";
import { ALERT_KEY } from "./ScanOptions";
import { prepareVision, useScanner, visionLoaded, type Miss } from "./useScanner";

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
export default function LiveScanner({
  sessionId,
  onState,
  onBusy,
  fx,
}: {
  sessionId: string;
  onState: (s: SessionState) => void;
  onBusy?: (busy: boolean) => void;
  /** dólar do dia, para o aviso de carta valiosa */
  fx?: number | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>("off");
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [torch, setTorch] = useState<boolean | null>(null);
  const [sound, setSound] = usePersistentState("deckscanner:sound", true);
  const [cameraId, setCameraId] = usePersistentState<string | null>("deckscanner:camera", null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [firstLoad] = useState(() => !visionLoaded());
  const [alertBrl] = usePersistentState(ALERT_KEY, 0);
  const scanner = useScanner(sessionId, onState, { sound, alertBrl, fx });
  const running = scanner.phase === "running";
  const busy = scanner.phase !== "idle" && scanner.phase !== "error";

  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  // borda verde/vermelha: fica montada pelo tempo da animação (e vibra no celular)
  const [flash, setFlash] = useState(scanner.flash);
  useEffect(() => {
    const f = scanner.flash;
    if (!f) return;
    setFlash(f);
    navigator.vibrate?.(f.tone === "bad" ? [70, 60, 70] : f.tone === "gold" ? [30, 40, 30, 40, 30] : 35);
    const timer = window.setTimeout(() => setFlash((cur) => (cur?.id === f.id ? null : cur)), 780);
    return () => window.clearTimeout(timer);
  }, [scanner.flash]);

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

  async function listCameras() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setCameras(all.filter((d) => d.kind === "videoinput" && d.deviceId));
    } catch {
      setCameras([]);
    }
  }

  // quando uma webcam é plugada ou removida com a câmera aberta
  useEffect(() => {
    if (camera !== "on" || !navigator.mediaDevices?.addEventListener) return;
    const onChange = () => void listCameras();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [camera]);

  async function openCamera(deviceId: string | null = cameraId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unsupported");
      return;
    }
    // trocando de câmera o visor continua aberto (no celular não sai da tela cheia)
    if (!stream.current) setCamera("opening");
    void prepareVision().catch(() => undefined);
    const resolution = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const request = (id: string | null) =>
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: id ? { deviceId: { exact: id }, ...resolution } : { facingMode: { ideal: "environment" }, ...resolution },
      });
    try {
      stream.current?.getTracks().forEach((t) => t.stop());
      let media: MediaStream;
      try {
        media = await request(deviceId);
      } catch (e) {
        // a câmera lembrada pode ter sido desconectada: volta para a padrão
        if (!deviceId || (e as DOMException).name === "NotAllowedError") throw e;
        setCameraId(null);
        media = await request(null);
      }
      stream.current = media;
      const el = video.current!;
      el.srcObject = media;
      await el.play();
      setSize({ w: el.videoWidth || 1280, h: el.videoHeight || 720 });
      const track = media.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch(caps.torch ? false : null);
      setActiveId(track.getSettings?.().deviceId ?? null);
      setCamera("on");
      // os nomes das câmeras só aparecem depois da permissão
      void listCameras();
    } catch (e) {
      const name = (e as DOMException).name;
      setCamera(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
    }
  }

  function switchCamera(id: string) {
    if (id === activeId) return;
    setCameraId(id);
    void openCamera(id);
  }

  function nextCamera() {
    if (cameras.length < 2) return;
    const i = cameras.findIndex((c) => c.deviceId === activeId);
    switchCamera(cameras[(i + 1) % cameras.length].deviceId);
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
            {flash && <div key={flash.id} className="edge-flash" data-tone={flash.tone} aria-hidden="true" />}
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
                {immersive && cameras.length > 1 && (
                  <IconButton label="Trocar de câmera" onClick={nextCamera} disabled={busy} title={busy ? "Termine a leitura para trocar de câmera" : undefined}>
                    <SwitchCamera className="size-[18px]" />
                  </IconButton>
                )}
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
          <CameraMessage state={camera} onOpen={() => void openCamera()} />
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
            {!immersive && cameras.length > 1 && (
              <label className="flex min-w-0 items-center gap-2 text-[14px] text-cream-faint sm:ml-auto">
                <Camera className="size-4 shrink-0 text-brass-400" aria-hidden="true" />
                <span className="sr-only">Câmera</span>
                <Select
                  value={activeId ?? ""}
                  onChange={(e) => switchCamera(e.target.value)}
                  disabled={busy}
                  title={busy ? "Termine a leitura para trocar de câmera" : "Escolher câmera"}
                  className="h-10 w-auto max-w-[16rem] truncate"
                >
                  {cameras.map((c, i) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {cameraName(c, i)}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {!immersive && size.w > 0 && (
              <span className="tabular text-[13px] text-cream-faint" title="resolução que a câmera está entregando">
                {size.w}×{size.h}
              </span>
            )}
            <p className={cx("text-[14px] text-cream-faint", immersive && "basis-full text-center")}>
              {scanner.phase === "loading" && firstLoad
                ? "Na primeira vez o leitor de imagem é baixado (cerca de 13 MB)."
                : scanner.pending > 0
                  ? `enviando ${scanner.pending} ${scanner.pending === 1 ? "leitura" : "leituras"}…`
                  : running
                    ? "Segure cada carta parada até piscar verde; tire do quadro antes da próxima."
                    : null}
            </p>
          </div>
        )}

        {scanner.treasure && camera === "on" && (
          <div className="animate-rise relative z-20 flex items-center gap-3 rounded-[6px] border border-brass-500/80 bg-brass-500/12 p-2.5" role="status">
            <img src={scanner.treasure.preview} alt="" className="card-img aspect-[488/680] w-11 shrink-0 border border-brass-600/60 object-cover" />
            <p className="min-w-0 flex-1 text-[15px] text-cream">
              <span className="font-serif font-semibold">{scanner.treasure.name}</span>
              <span className="block text-[14px] text-brass-200">carta valiosa · {brl(scanner.treasure.brl)}</span>
            </p>
            <IconButton label="Fechar aviso" onClick={scanner.dismissTreasure} className="shrink-0">
              <X className="size-4" />
            </IconButton>
          </div>
        )}

        {scanner.miss && camera === "on" && (
          <MissPanel key={scanner.miss.detectionId} miss={scanner.miss} dropUp={immersive} onPick={scanner.resolveMiss} onDismiss={scanner.dismissMiss} />
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

/** A câmera não reconheceu a carta: mostrar de novo (automático) ou dizer o nome. */
function MissPanel({ miss, dropUp, onPick, onDismiss }: { miss: Miss; dropUp: boolean; onPick: (cardRefId: string) => Promise<void>; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    // z-20: a animação cria um contexto de empilhamento; sem isso a lista de nomes fica atrás das dicas do visor
    <div className="animate-rise relative z-20 flex gap-3 rounded-[6px] border border-wine-600/70 bg-wine-600/10 p-2.5" role="alert">
      <img src={miss.preview} alt="" className="card-img aspect-[488/680] w-12 shrink-0 self-start border border-wine-600/60 object-cover sm:w-14" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-serif text-[16px] leading-tight font-semibold text-cream">
              {miss.reason === "back" ? "Esse é o verso da carta" : "Não reconheci essa carta"}
            </p>
            <p className="text-[13px] leading-snug text-cream-dim">
              {miss.reason === "back" ? "Vire a carta e mostre de novo, ou digite o nome." : "Mostre de novo mais perto e sem reflexo, ou digite o nome."}
            </p>
          </div>
          <IconButton label="Deixar para a revisão" title="Deixar para a revisão" onClick={onDismiss} className="-mt-1 -mr-1 shrink-0">
            <X className="size-4" />
          </IconButton>
        </div>
        <CardSearch
          dropUp={dropUp}
          placeholder="Qual carta é? Digite o nome…"
          onPick={async (card) => {
            setBusy(true);
            setErr(null);
            try {
              await onPick(card.id);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
              setBusy(false);
            }
          }}
        />
        {busy && <p className="text-[13px] text-cream-faint">anotando…</p>}
        {err && <p className="text-[13px] text-wine-300">{err}</p>}
      </div>
    </div>
  );
}

/** Rótulo legível: tira o código "(046d:0825)" que o Windows e o Chrome penduram no nome. */
function cameraName(device: MediaDeviceInfo, index: number) {
  const name = device.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
  return name || `Câmera ${index + 1}`;
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
