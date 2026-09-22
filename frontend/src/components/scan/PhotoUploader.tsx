import { Camera, Check, ImagePlus, Loader2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { api } from "../../lib/api";
import { analyzeSource, ISSUE_TEXT, type FrameQuality } from "../../lib/quality";
import type { SessionState } from "../../lib/types";
import { cx, IconButton } from "../ui";

type Item = {
  id: string;
  file: File;
  thumb: string | null;
  status: "queued" | "sending" | "reading" | "done" | "error";
  cards: number;
  issues: FrameQuality["issues"];
  error?: string;
};

/** Limite do corpo de requisição na hospedagem (4,5 MB): fotos maiores são reduzidas antes do envio. */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SIDE = 3000;

async function prepare(file: File): Promise<{ blob: Blob; thumb: string | null; issues: FrameQuality["issues"] }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // formato que o navegador não abre (ex.: HEIC no Chrome): o servidor converte
    if (file.size > MAX_BYTES) throw new Error("foto grande demais e em formato que este navegador não reduz");
    return { blob: file, thumb: null, issues: [] };
  }
  const { issues } = analyzeSource(bitmap, bitmap.width, bitmap.height);
  const tw = 160;
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = tw;
  thumbCanvas.height = Math.round((bitmap.height / bitmap.width) * tw);
  thumbCanvas.getContext("2d")!.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumb = thumbCanvas.toDataURL("image/jpeg", 0.7);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_BYTES) {
    bitmap.close();
    return { blob: file, thumb, issues };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("não consegui preparar a foto");
  return { blob, thumb, issues };
}

/** Fotos da mesa: várias cartas por foto, enviadas uma a uma com o progresso da leitura em tempo real. */
export default function PhotoUploader({ sessionId, onState, onBusy }: { sessionId: string; onState: (s: SessionState) => void; onBusy?: (busy: boolean) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const working = useRef(false);
  const queue = useRef<Item[]>([]);
  const busy = items.some((i) => i.status === "queued" || i.status === "sending" || i.status === "reading");

  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function pump() {
    if (working.current) return;
    working.current = true;
    try {
      for (let item = queue.current.shift(); item; item = queue.current.shift()) {
        const id = item.id;
        update(id, { status: "sending" });
        try {
          const { blob, thumb, issues } = await prepare(item.file);
          update(id, { thumb, issues });
          // a mesma detecção pode chegar mais de uma vez (pendente → identificada): conta por id
          const seen = new Map<string, string>();
          let failed: string | null = null;
          await api.uploadPhoto(sessionId, blob, item.file.name || "foto.jpg", (ev) => {
            if (ev.type === "detection") {
              seen.set(ev.detection.id, ev.detection.status);
              update(id, { status: "reading", cards: [...seen.values()].filter((s) => s !== "noise" && s !== "edge").length });
            } else if (ev.type === "error") failed = ev.message;
          });
          update(id, failed ? { status: "error", error: failed } : { status: "done" });
          onState(await api.session(sessionId));
        } catch (e) {
          update(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      working.current = false;
    }
  }

  function add(files: FileList | File[]) {
    const fresh = [...files]
      .filter((f) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name))
      .map((file): Item => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, file, thumb: null, status: "queued", cards: 0, issues: [] }));
    if (!fresh.length) return;
    setItems((list) => [...list, ...fresh]);
    queue.current.push(...fresh);
    void pump();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    add(e.dataTransfer.files);
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    add([...(e.target.files ?? [])]);
    e.target.value = "";
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx("rounded-lg border-2 border-dashed px-5 py-10 text-center transition-[background-color,border-color] duration-200", drag ? "border-brass-400 bg-brass-400/8" : "border-cream/12")}
      >
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-brass-300/10 text-brass-300 shadow-[inset_0_0_0_1px_rgb(235_198_116/0.2)]">
          <ImagePlus className="size-7" />
        </span>
        <p className="mt-4 font-display text-title-2 font-semibold text-cream">Fotos da mesa</p>
        <p className="mx-auto mt-1 max-w-md text-subhead text-cream-dim">
          Até 9 cartas por foto, lado a lado e sem sobrepor, fotografadas de cima. Arraste as fotos para cá ou escolha abaixo.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <label className="btn btn-primary cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brass-300">
            <ImagePlus className="size-4" /> Escolher fotos
            <input type="file" accept="image/*" multiple className="sr-only" onChange={pick} />
          </label>
          <label className="btn btn-secondary cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brass-300 sm:hidden">
            <Camera className="size-4" /> Tirar foto
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
          </label>
        </div>
      </div>

      {items.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="well flex items-center gap-3 p-2 pr-1">
              {item.thumb ? (
                <img src={item.thumb} alt="" className="size-14 shrink-0 rounded-xs object-cover" />
              ) : (
                <span className="grid size-14 shrink-0 place-items-center rounded-xs bg-oak-800 text-cream-faint">
                  <ImagePlus className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-subhead text-cream">{item.file.name || "Foto"}</p>
                <p className={cx("flex items-center gap-1.5 text-footnote", item.status === "error" ? "text-wine-300" : item.status === "done" ? "text-moss-300" : "text-cream-faint")}>
                  {item.status === "queued" && "Na fila"}
                  {item.status === "sending" && (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Enviando…
                    </>
                  )}
                  {item.status === "reading" && (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Lendo · {item.cards} {item.cards === 1 ? "carta" : "cartas"}
                    </>
                  )}
                  {item.status === "done" && (
                    <>
                      <Check className="size-3.5" /> {item.cards} {item.cards === 1 ? "carta" : "cartas"}
                    </>
                  )}
                  {item.status === "error" && (item.error ?? "Falhou")}
                </p>
                {item.issues.length > 0 && item.status !== "error" && (
                  <p className="flex items-center gap-1 text-caption text-ember-300" title={item.issues.map((i) => ISSUE_TEXT[i]).join(" · ")}>
                    <TriangleAlert className="size-3.5 shrink-0" />
                    <span className="truncate">{ISSUE_TEXT[item.issues[0]]}</span>
                  </p>
                )}
              </div>
              {(item.status === "done" || item.status === "error") && (
                <IconButton label="Tirar da lista de envios" onClick={() => setItems((list) => list.filter((x) => x.id !== item.id))}>
                  <X className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
