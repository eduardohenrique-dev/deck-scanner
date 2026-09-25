import { Film, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { formatTime } from "../../lib/format";
import type { SessionState } from "../../lib/types";
import { Button, cx, Meter } from "../ui";
import ReadsStrip from "./ReadsStrip";
import { useScanner, visionLoaded } from "./useScanner";

/** Vídeo gravado folheando o deck: lido aqui no navegador, quadro a quadro, e só as cartas vão ao servidor. */
export default function VideoScanner({ sessionId, onState, onBusy }: { sessionId: string; onState: (s: SessionState) => void; onBusy?: (busy: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [done, setDone] = useState<{ name: string } | null>(null);
  const [firstLoad] = useState(() => !visionLoaded());
  const scanner = useScanner(sessionId, onState, { sound: false });
  const busy = scanner.phase !== "idle" && scanner.phase !== "error";

  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  function start(f: File) {
    if (!f.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v)$/i.test(f.name)) return;
    setFile(f);
    setDone(null);
    void scanner.startVideo(f, video.current!).then(() => setDone({ name: f.name }));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f && !busy) start(f);
  }

  const duration = video.current?.duration ?? 0;
  const at = scanner.report?.t ?? 0;

  return (
    <div className="space-y-4">
      <div className={cx("viewfinder aspect-video w-full", !busy && "hidden")}>
        <video ref={video} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
        {scanner.counted !== null && (
          <span className="absolute top-3 left-3 z-10 rounded-sm border border-oak-600 bg-oak-950/85 px-2.5 py-1 font-serif text-subhead text-cream">
            <strong className="tabular text-title-3">{scanner.counted}</strong> {scanner.counted === 1 ? "carta" : "cartas"}
          </span>
        )}
      </div>

      {busy ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-subhead">
            <span className="truncate text-cream-dim">
              <Film className="mr-1.5 inline size-4 text-brass-400" />
              {file?.name}
            </span>
            <span className="tabular text-cream-faint">
              {scanner.phase === "loading"
                ? firstLoad
                  ? "Preparando a lente (download único de ~13 MB)…"
                  : "Abrindo…"
                : scanner.phase === "finishing"
                  ? "Fechando as leituras…"
                  : `${formatTime(at)} de ${formatTime(duration)}`}
            </span>
          </div>
          <Meter value={scanner.phase === "running" ? scanner.progress ?? 0 : null} label="progresso da leitura do vídeo" />
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button icon={<Square className="size-4 fill-current" />} onClick={scanner.stop} disabled={scanner.phase !== "running"}>
              Parar aqui
            </Button>
            <p className="text-footnote text-cream-faint">Deixe esta aba aberta até terminar. O que já foi lido fica guardado mesmo se você parar.</p>
          </div>
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cx(
            "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-[background-color,border-color] duration-200",
            drag ? "border-brass-400 bg-brass-400/8" : "border-cream/12 hover:border-brass-400/50",
          )}
        >
          <span className="mb-2 grid size-16 place-items-center rounded-full bg-brass-300/10 text-brass-300 shadow-[inset_0_0_0_1px_rgb(235_198_116/0.2)]">
            <Upload className="size-7" />
          </span>
          <span className="font-display text-title-2 font-semibold text-cream">{done ? "Ler outro vídeo" : "Envie o vídeo do deck"}</span>
          <span className="max-w-md text-subhead text-cream-dim">
            Grave passando uma carta por vez, cada uma parada por meio segundo, com luz boa e fundo liso. O vídeo é lido aqui mesmo; não sobe inteiro para o servidor.
          </span>
          <span className="btn btn-primary mt-3">Escolher vídeo</span>
          <input
            ref={input}
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) start(f);
            }}
          />
        </label>
      )}

      {done && !busy && !scanner.error && (
        <p className="text-subhead text-moss-300">
          Vídeo lido{scanner.counted !== null ? `: ${scanner.counted} ${scanner.counted === 1 ? "carta" : "cartas"} na lista` : ""}. Confira a lista abaixo.
        </p>
      )}
      {scanner.error && (
        <p className="rounded-md bg-wine-600/14 px-4 py-3 text-subhead text-wine-300 shadow-[inset_0_0_0_1px_rgb(214_96_79/0.35)]" role="alert">
          {scanner.error}
        </p>
      )}
      <ReadsStrip reads={scanner.reads} />
    </div>
  );
}
