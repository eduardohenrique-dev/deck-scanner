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
        className={cx("rounded-[6px] border-2 border-dashed px-5 py-8 text-center transition-colors", drag ? "border-brass-400 bg-brass-400/8" : "border-oak-600")}
      >
        <ImagePlus className="mx-auto size-8 text-brass-400" />
        <p className="mt-2 font-serif text-[20px] font-semibold text-cream">Fotos da mesa</p>
        <p className="mx-auto mt-1 max-w-md text-[15px] text-cream-dim">
          Até 9 cartas por foto, lado a lado e sem sobrepor, fotografadas de cima. Arraste as fotos para cá ou escolha abaixo.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-[5px] border border-brass-700 bg-[linear-gradient(180deg,var(--color-brass-300),var(--color-brass-500))] px-4 font-caps text-[15px] font-bold lowercase tracking-[0.03em] text-ink-900 shadow-[inset_0_1px_0_rgb(255_244_210/0.55),0_1px_0_rgb(0_0_0/0.5)] focus-within:outline-2 focus-within:outline-brass-300">
            <ImagePlus className="size-4" /> escolher fotos
            <input type="file" accept="image/*" multiple className="sr-only" onChange={pick} />
          </label>
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-[5px] border border-brass-600/80 bg-oak-900/40 px-4 font-caps text-[15px] font-bold lowercase tracking-[0.03em] text-brass-300 focus-within:outline-2 focus-within:outline-brass-300 sm:hidden">
            <Camera className="size-4" /> tirar foto
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
          </label>
        </div>
      </div>

      {items.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="board-sunken flex items-center gap-3 p-2">
              {item.thumb ? (
                <img src={item.thumb} alt="" className="h-14 w-14 shrink-0 rounded-[3px] object-cover" />
              ) : (
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[3px] bg-oak-800 text-cream-faint">
                  <ImagePlus className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-cream">{item.file.name || "foto"}</p>
                <p className={cx("flex items-center gap-1.5 text-[13px]", item.status === "error" ? "text-wine-300" : item.status === "done" ? "text-moss-300" : "text-cream-faint")}>
                  {item.status === "queued" && "na fila"}
                  {item.status === "sending" && (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> enviando…
                    </>
                  )}
                  {item.status === "reading" && (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> lendo · {item.cards} {item.cards === 1 ? "carta" : "cartas"}
                    </>
                  )}
                  {item.status === "done" && (
                    <>
                      <Check className="size-3.5" /> {item.cards} {item.cards === 1 ? "carta" : "cartas"}
                    </>
                  )}
                  {item.status === "error" && (item.error ?? "falhou")}
                </p>
                {item.issues.length > 0 && item.status !== "error" && (
                  <p className="flex items-center gap-1 text-[12px] text-amber-300" title={item.issues.map((i) => ISSUE_TEXT[i]).join(" · ")}>
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
