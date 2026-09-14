import { ChevronDown, Layers, Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { cardName, CONFIDENCE_REVIEW, entryNeedsReview, SOURCE_LABEL, TYPE_LABEL, TYPE_ORDER, typeGroup } from "../../lib/format";
import type { Capture, Detection, SessionState } from "../../lib/types";
import { Button, Chip, EmptyState } from "../ui";
import CardSearch from "./CardSearch";
import EntryCard from "./EntryCard";
import IssuesPanel from "./IssuesPanel";

type Props = {
  state: SessionState;
  apply: (s: SessionState) => void;
  onShowCapture: (capture: Capture, detectionId?: string) => void;
};

export default function ReviewPanel({ state, apply, onShowCapture }: Props) {
  const { entries, detections, stats, format, game } = state;
  const [sort, setSort] = useState<"scan" | "type">("scan");
  const [adding, setAdding] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const detById = useMemo(() => new Map(detections.map((d) => [d.id, d])), [detections]);

  const detsFor = (ids: string[]) => {
    const out: Detection[] = [];
    for (const id of ids) {
      const d = detById.get(id);
      if (d) out.push(d);
      for (const other of detections) if (other.dup_of === id) out.push(other);
    }
    return out.filter((d, i, all) => all.indexOf(d) === i);
  };

  const pending = detections.filter((d) => d.status === "pending");
  const review = entries.filter((e) => entryNeedsReview(e) && e.quantity + e.quantity_detected > 0);
  const zones = (format.zones ?? ["deck"]).map((z) => ({ id: z, name: format.zone_labels?.[z] ?? game.zones.find((x) => x.id === z)?.name ?? z }));
  const reviewIds = new Set(review.map((e) => e.id));

  const ordered = [...entries].sort((a, b) =>
    sort === "type"
      ? TYPE_ORDER.indexOf(typeGroup(a.card?.front_type_line)) - TYPE_ORDER.indexOf(typeGroup(b.card?.front_type_line)) ||
        cardName(a.card).localeCompare(cardName(b.card))
      : a.position - b.position,
  );

  const ignored = detections.filter((d) => ["back", "token", "edge", "noise", "ignored"].includes(d.status) && !(d.dup_of && detById.has(d.dup_of)));
  const sources = Object.entries(stats.by_source).filter(([, n]) => n > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent">{stats.physical_cards} cartas físicas</Chip>
        {sources.map(([k, n]) => (
          <Chip key={k}>
            {n} por {SOURCE_LABEL[k] ?? k}
          </Chip>
        ))}
        {stats.merged_duplicates > 0 && <Chip tone="info">{stats.merged_duplicates} ocorrências repetidas unificadas</Chip>}
        {stats.backs > 0 && <Chip tone="info">{stats.backs} {stats.backs === 1 ? "carta de costas detectada" : "cartas de costas detectadas"}</Chip>}
        {stats.tokens > 0 && <Chip tone="info">{stats.tokens} token{stats.tokens > 1 ? "s" : ""} ignorado{stats.tokens > 1 ? "s" : ""}</Chip>}
        {stats.unidentified > 0 && <Chip tone="bad">{stats.unidentified} não identificada{stats.unidentified > 1 ? "s" : ""}</Chip>}
        {stats.vlm_calls > 0 && <Chip tone="info">{stats.vlm_calls} chamadas ao modelo</Chip>}
      </div>

      {pending.length > 0 && (
        <section className="rounded-2xl border border-info/30 bg-info/[0.04] p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin text-info" />
            Lendo {pending.length} {pending.length === 1 ? "carta" : "cartas"}…
          </p>
          <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
            {pending.slice(-12).map((d) => (
              <img key={d.id} src={d.crop_url} className="animate-pop h-24 w-[68px] shrink-0 rounded-md object-cover opacity-80" alt="" />
            ))}
          </div>
        </section>
      )}

      <IssuesPanel state={state} apply={apply} onShowCapture={onShowCapture} />

      {review.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">
            Conferir identificação <span className="text-sm font-normal text-muted">— confiança abaixo de {Math.round(CONFIDENCE_REVIEW * 100)}% ou aviso de regra</span>
          </h2>
          <div className="grid gap-2">
            {review.map((e) => (
              <EntryCard key={e.id} entry={e} state={state} detections={detsFor(e.detection_ids)} apply={apply} highlight expanded />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Layers className="size-5 text-muted" /> Lista
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-panel-2 p-0.5 text-[13px]">
              {(["scan", "type"] as const).map((s) => (
                <button key={s} onClick={() => setSort(s)} className={`rounded-md px-2.5 py-1 ${sort === s ? "bg-panel-3 text-text" : "text-muted"}`}>
                  {s === "scan" ? "ordem do scan" : "por tipo"}
                </button>
              ))}
            </div>
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding((a) => !a)}>
              Adicionar carta
            </Button>
          </div>
        </div>

        {adding && (
          <div className="rounded-xl border border-line bg-panel p-3">
            <p className="mb-2 text-sm text-muted">Carta que não apareceu em nenhuma captura:</p>
            <CardSearch autoFocus onPick={async (c) => apply(await api.addEntry(state.session.id, { card_ref_id: c.id, quantity: 1 }))} />
          </div>
        )}

        {entries.length === 0 && pending.length === 0 && (
          <EmptyState icon={<Layers className="size-8" />} title="Nenhuma carta ainda">
            Capture um vídeo ou fotos — as cartas aparecem aqui conforme são identificadas.
          </EmptyState>
        )}

        {zones.map((zone) => {
          const inZone = ordered.filter((e) => e.zone === zone.id && !reviewIds.has(e.id));
          const allInZone = entries.filter((e) => e.zone === zone.id);
          if (!allInZone.length) return null;
          const total = allInZone.reduce((s, e) => s + e.quantity, 0);
          let lastGroup = "";
          return (
            <div key={zone.id} className="space-y-2">
              {zones.length > 1 && (
                <h3 className="text-[13px] font-medium uppercase tracking-wide text-muted">
                  {zone.name} · {total}
                </h3>
              )}
              <div className="grid gap-2 xl:grid-cols-2">
                {inZone.map((e) => {
                  const g = typeGroup(e.card?.front_type_line);
                  const header = sort === "type" && g !== lastGroup ? TYPE_LABEL[g] : null;
                  lastGroup = g;
                  return (
                    <div key={e.id} className={header ? "xl:col-span-2" : ""}>
                      {header && <p className="mb-1 mt-2 text-[13px] text-faint">{header}</p>}
                      <EntryCard entry={e} state={state} detections={detsFor(e.detection_ids)} apply={apply} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {ignored.length > 0 && (
        <section className="rounded-xl border border-line bg-panel">
          <button onClick={() => setShowIgnored((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted">
            <span>Detectadas mas fora da lista ({ignored.length}): versos, tokens, cartas cortadas pela borda, ruído</span>
            <ChevronDown className={`size-4 transition-transform ${showIgnored ? "rotate-180" : ""}`} />
          </button>
          {showIgnored && (
            <div className="grid grid-cols-3 gap-2 px-4 pb-4 sm:grid-cols-6">
              {ignored.map((d) => {
                const cap = state.captures.find((c) => c.id === d.capture_id);
                return (
                  <button key={d.id} onClick={() => cap?.image_url && onShowCapture(cap, d.id)} className="text-left">
                    <img src={d.crop_url} className="aspect-[63/88] w-full rounded-md object-cover" alt="" loading="lazy" />
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {{ back: "verso", token: "token", edge: "cortada", noise: "ruído", ignored: "ignorada" }[d.status as string] ?? d.status}
                      {d.card ? ` · ${cardName(d.card)}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
