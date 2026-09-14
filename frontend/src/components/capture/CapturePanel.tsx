import { AlertTriangle, Camera, CheckCircle2, Film, ImagePlus, Images, Loader2, Upload, Video } from "lucide-react";
import { useRef, useState } from "react";
import { upload } from "../../lib/api";
import { analyzeSource, ISSUE_TEXT } from "../../lib/quality";
import type { Capture, SessionState } from "../../lib/types";
import type { LiveEvent } from "../../lib/useSession";
import { Button, Chip, ProgressBar } from "../ui";
import LiveVideo from "./LiveVideo";
import PhotoCamera from "./PhotoCamera";

const MAX_PHOTOS = 30;

type Props = {
  state: SessionState;
  subscribe: (fn: (ev: LiveEvent) => void) => () => void;
  onChanged: () => void;
  onOpenCapture: (capture: Capture) => void;
};

export default function CapturePanel({ state, subscribe, onChanged, onOpenCapture }: Props) {
  const { session, captures } = state;
  const [live, setLive] = useState(false);
  const [camera, setCamera] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<{ file: File; url: string; issues: string[] }[]>([]);
  const [dragging, setDragging] = useState(false);
  const videoInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const photos = captures.filter((c) => c.type === "image");
  const secure = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  async function sendVideo(file: File) {
    setError(null);
    setUploadProgress(0);
    try {
      await upload(`/api/sessions/${session.id}/video`, [file], "file", setUploadProgress);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploadProgress(null);
    }
  }

  async function sendPhotos(files: Blob[]) {
    setError(null);
    if (photos.length + files.length > MAX_PHOTOS) {
      setError(`Máximo de ${MAX_PHOTOS} fotos por sessão (já há ${photos.length}).`);
      return;
    }
    setUploadProgress(0);
    try {
      await upload(`/api/sessions/${session.id}/photos`, files, "files", setUploadProgress);
      setQueued([]);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setUploadProgress(null);
    }
  }

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    const analyzed = await Promise.all(
      files.map(async (file) => {
        const url = URL.createObjectURL(file);
        try {
          const bmp = await createImageBitmap(file);
          const q = analyzeSource(bmp, bmp.width, bmp.height);
          return { file, url, issues: q.issues.map((i) => ISSUE_TEXT[i]) };
        } catch {
          return { file, url, issues: [] };
        }
      }),
    );
    setQueued((prev) => [...prev, ...analyzed].slice(0, MAX_PHOTOS - photos.length));
  }

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          {session.mode === "video" ? <Film className="size-5 text-accent" /> : <Images className="size-5 text-accent" />}
          {session.mode === "video" ? "Captura por vídeo" : "Captura por fotos"}
        </h2>
        {session.mode === "photo" && <Chip>{photos.length}/{MAX_PHOTOS} fotos</Chip>}
      </div>

      {session.mode === "video" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="primary" size="lg" icon={<Video className="size-5" />} onClick={() => setLive(true)} disabled={!secure}>
            Câmera ao vivo
          </Button>
          <Button size="lg" icon={<Upload className="size-5" />} onClick={() => videoInput.current?.click()} busy={uploadProgress !== null}>
            Enviar ou gravar vídeo
          </Button>
          <input
            ref={videoInput}
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && sendVideo(e.target.files[0])}
          />
          <p className="text-[13px] leading-relaxed text-muted sm:col-span-2">
            Folheie devagar, uma carta por vez, sem cobrir a carta com os dedos. Cada carta precisa ficar parada por meio segundo. Boa luz e fundo liso ajudam.
            {!secure && " A câmera ao vivo exige HTTPS (no celular use npm run dev:mobile); gravar pelo app de câmera funciona sempre."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button variant="primary" size="lg" icon={<Camera className="size-5" />} onClick={() => setCamera(true)} disabled={!secure || photos.length >= MAX_PHOTOS}>
              Câmera guiada
            </Button>
            <Button size="lg" icon={<ImagePlus className="size-5" />} onClick={() => photoInput.current?.click()}>
              Escolher fotos
            </Button>
          </div>
          <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={`rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${dragging ? "border-accent bg-accent/5 text-text" : "border-line text-muted"}`}
          >
            Arraste fotos aqui · fileiras de até 5 cartas · 1 carta em comum entre fotos vizinhas
          </div>
          {queued.length > 0 && (
            <div className="space-y-2">
              <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
                {queued.map((q) => (
                  <div key={q.url} className="w-28 shrink-0">
                    <img src={q.url} className="h-20 w-28 rounded-md object-cover" alt={q.file.name} />
                    {q.issues.length > 0 ? (
                      <p className="mt-1 text-[11px] leading-tight text-warn">{q.issues[0]}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-ok">qualidade ok</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="primary" busy={uploadProgress !== null} onClick={() => sendPhotos(queued.map((q) => q.file)).catch(() => null)} icon={<Upload className="size-4" />}>
                  Enviar {queued.length} {queued.length === 1 ? "foto" : "fotos"}
                </Button>
                <Button variant="ghost" onClick={() => setQueued([])}>
                  Limpar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {uploadProgress !== null && (
        <div className="mt-3 space-y-1">
          <p className="text-[13px] text-muted">Enviando… {Math.round(uploadProgress * 100)}%</p>
          <ProgressBar value={uploadProgress} />
        </div>
      )}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}

      {captures.length > 0 && (
        <ul className="mt-4 space-y-2">
          {captures.map((c) => (
            <CaptureRow key={c.id} capture={c} onOpen={() => onOpenCapture(c)} />
          ))}
        </ul>
      )}

      {live && <LiveVideo sessionId={session.id} subscribe={subscribe} onClose={() => { setLive(false); onChanged(); }} />}
      {camera && <PhotoCamera maxPhotos={MAX_PHOTOS - photos.length} onClose={() => setCamera(false)} onSend={sendPhotos} />}
    </section>
  );
}

function CaptureRow({ capture, onOpen }: { capture: Capture; onOpen: () => void }) {
  const q = capture.quality ?? {};
  const label = capture.type === "image" ? `Foto ${capture.idx}` : capture.original_name === "câmera ao vivo" ? "Câmera ao vivo" : capture.original_name || "Vídeo";
  const warnings: string[] = (q.warnings ?? []).map((w: "blur" | "glare" | "dark") => ISSUE_TEXT[w]);
  return (
    <li className="flex items-center gap-3 rounded-lg bg-panel-2 px-3 py-2">
      {capture.image_url ? (
        <button onClick={onOpen} className="shrink-0">
          <img src={capture.image_url} className="h-10 w-14 rounded object-cover" alt={label} />
        </button>
      ) : (
        <div className="grid h-10 w-14 shrink-0 place-items-center rounded bg-panel-3 text-muted">
          <Film className="size-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {label}
          {capture.status === "done" && <CheckCircle2 className="size-4 text-ok" />}
          {capture.status === "processing" && <Loader2 className="size-4 animate-spin text-info" />}
          {capture.status === "error" && <AlertTriangle className="size-4 text-bad" />}
        </p>
        <p className="truncate text-[12px] text-muted">
          {capture.status === "queued" && "na fila"}
          {capture.status === "processing" && (capture.type === "video" ? `processando ${capture.progress ? Math.round(capture.progress * 100) + "%" : "…"}` : "detectando cartas…")}
          {capture.status === "done" && capture.type === "image" && `${q.detected ?? 0} cartas inteiras${q.partial ? ` · ${q.partial} parciais/cortadas` : ""}`}
          {capture.status === "done" && capture.type === "video" && `${q.sampled ?? "?"} frames analisados · ${q.groups ?? "?"} exibições de carta`}
          {capture.status === "error" && (capture.error ?? "erro")}
          {warnings.length > 0 && <span className="ml-1 text-warn">· {warnings[0]}</span>}
        </p>
        {capture.status === "processing" && capture.type === "video" && <ProgressBar value={capture.progress} className="mt-1" />}
      </div>
    </li>
  );
}
