import { AlertTriangle, Crown, Minus, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { cardName, languageLabel, price, secondaryName, SOURCE_LABEL } from "../../lib/format";
import type { CardSummary, Detection, Entry, SessionState } from "../../lib/types";
import { Button, Chip, ConfidenceBadge, ManaCost, Modal } from "../ui";
import CardSearch from "./CardSearch";

type Props = {
  entry: Entry;
  state: SessionState;
  detections: Detection[];
  apply: (s: SessionState) => void;
  highlight?: boolean;
  expanded?: boolean;
};

export default function EntryCard({ entry, state, detections, apply, highlight, expanded }: Props) {
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [zoom, setZoom] = useState(false);
  const card = entry.card;
  const zones = (state.format.zones ?? ["deck"]).map((z) => ({
    id: z,
    name: state.format.zone_labels?.[z] ?? state.game.zones.find((x) => x.id === z)?.name ?? z,
  }));
  const primaryDet = detections[0];
  const overLimit = entry.quantity_detected > entry.quantity && entry.quantity_override === null;

  async function run(fn: () => Promise<SessionState>) {
    setBusy(true);
    try {
      apply(await fn());
    } finally {
      setBusy(false);
    }
  }

  const setQty = (q: number) => run(() => api.patchEntry(entry.id, { quantity_override: Math.max(0, q) }));

  return (
    <article
      id={`entry-${entry.id}`}
      className={`animate-pop rounded-xl border bg-panel p-3 transition-colors ${highlight ? "border-warn/60" : "border-line"} ${entry.quantity === 0 ? "opacity-60" : ""}`}
    >
      <div className="flex gap-3">
        <button onClick={() => setZoom(true)} className="flex shrink-0 gap-1.5" title="Comparar recorte e imagem oficial">
          {primaryDet ? (
            <img src={primaryDet.crop_url} className={`${expanded ? "h-40 w-[114px]" : "h-28 w-20"} rounded-md bg-panel-2 object-cover`} alt="recorte da captura" loading="lazy" />
          ) : (
            <div className={`${expanded ? "h-40 w-[114px]" : "h-28 w-20"} grid place-items-center rounded-md border border-dashed border-line text-center text-[11px] text-faint`}>
              adicionada à mão
            </div>
          )}
          {card?.image_normal ? (
            <img src={card.image_normal} className={`${expanded ? "h-40 w-[114px]" : "h-28 w-20"} rounded-md bg-panel-2 object-cover`} alt={card.name_en} loading="lazy" />
          ) : null}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-semibold leading-tight">
                {entry.is_commander && <Crown className="mr-1 inline size-4 text-accent" />}
                {cardName(card)}
              </h3>
              {secondaryName(card) && <p className="truncate text-[13px] text-muted">{secondaryName(card)}</p>}
            </div>
            <ManaCost cost={card?.mana_cost} className="shrink-0" />
          </div>
          <p className="truncate text-[12px] text-faint">{card?.type_line}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <Chip className="font-mono uppercase">
              {card?.set_code} {card?.collector_number}
            </Chip>
            <select
              value={entry.language ?? "en"}
              disabled={busy}
              onChange={(e) => run(() => api.patchEntry(entry.id, { language: e.target.value }))}
              className="rounded-md bg-panel-3 px-1 py-0.5 text-muted outline-none"
              aria-label="Idioma"
            >
              {state.game.languages.map((l) => (
                <option key={l.id} value={l.id}>
                  {languageLabel(l.id)}
                </option>
              ))}
            </select>
            <select
              value={entry.finish ?? "nonfoil"}
              disabled={busy}
              onChange={(e) => run(() => api.patchEntry(entry.id, { finish: e.target.value }))}
              className="rounded-md bg-panel-3 px-1 py-0.5 text-muted outline-none"
              aria-label="Acabamento"
            >
              {state.game.finishes.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {entry.detection_ids.length > 0 ? <ConfidenceBadge value={entry.confidence} /> : <Chip>manual</Chip>}
            {primaryDet?.source && <span className="text-faint">{SOURCE_LABEL[primaryDet.source] ?? primaryDet.source}</span>}
            {price(card, entry.finish) && <span className="text-faint">{price(card, entry.finish)}</span>}
          </div>
          {entry.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1 text-[13px] text-warn">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {w}
            </p>
          ))}
          {entry.exception && entry.quantity_detected > 1 && !entry.exception.restricted && (
            <p className="text-[12px] text-info">Sem limite de cópias: {entry.exception.reason}</p>
          )}
          {detections
            .flatMap((d) => d.notes)
            .filter((n, i, all) => all.indexOf(n) === i && !n.includes("multimodal") && !n.startsWith("impressão incerta"))
            .slice(0, 2)
            .map((n) => (
              <p key={n} className="text-[12px] text-muted">
                {n}
              </p>
            ))}
          {detections.some((d) => d.notes.some((n) => n.startsWith("impressão incerta"))) && (
            <p className="text-[12px] text-faint" title="A mesma arte existe em outras coleções; confira set e número se a impressão importar (coleção/preço).">
              impressão incerta — mesma arte em outras coleções
            </p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
        <div className="flex items-center gap-1 rounded-lg bg-panel-2 p-0.5">
          <button onClick={() => setQty(entry.quantity - 1)} disabled={busy || entry.quantity <= 0} className="grid size-8 place-items-center rounded-md hover:bg-panel-3 disabled:opacity-30" aria-label="Diminuir">
            <Minus className="size-4" />
          </button>
          <span className="w-7 text-center font-semibold">{entry.quantity}</span>
          <button onClick={() => setQty(entry.quantity + 1)} disabled={busy} className="grid size-8 place-items-center rounded-md hover:bg-panel-3" aria-label="Aumentar">
            <Plus className="size-4" />
          </button>
        </div>
        <span className={`text-[12px] ${overLimit ? "text-warn" : "text-faint"}`}>
          {entry.quantity_detected > 0 ? `${entry.quantity_detected} detectada${entry.quantity_detected > 1 ? "s" : ""}` : "não escaneada"}
          {entry.quantity_override !== null && " · ajuste manual"}
        </span>
        {entry.quantity_override !== null && entry.quantity_detected > 0 && (
          <button onClick={() => run(() => api.patchEntry(entry.id, { reset_quantity: true }))} className="text-[12px] text-muted underline-offset-2 hover:underline">
            <RotateCcw className="mr-0.5 inline size-3" />
            automático
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {zones.length > 1 && (
            <select
              value={entry.zone}
              disabled={busy}
              onChange={(e) => run(() => api.patchEntry(entry.id, { zone: e.target.value, is_commander: e.target.value === "commander" }))}
              className="h-8 rounded-md border border-line bg-panel-2 px-1.5 text-[13px] outline-none"
              aria-label="Zona"
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          )}
          {state.format.requires_commander && (
            <Button size="sm" variant={entry.is_commander ? "primary" : "ghost"} onClick={() => run(() => api.patchEntry(entry.id, { is_commander: !entry.is_commander }))} icon={<Crown className="size-3.5" />}>
              {entry.is_commander ? "Comandante" : "Marcar comandante"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setChanging(true)} icon={<RefreshCw className="size-3.5" />}>
            Trocar
          </Button>
          <button onClick={() => run(() => api.deleteEntry(entry.id))} disabled={busy} className="grid size-8 place-items-center rounded-md text-faint hover:bg-bad/15 hover:text-bad" aria-label="Remover">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <Modal open={zoom} onClose={() => setZoom(false)} title={cardName(card)} wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <figure>
            <figcaption className="mb-1.5 text-[13px] text-muted">Recorte da captura</figcaption>
            {primaryDet ? <img src={primaryDet.crop_url} className="w-full rounded-lg" alt="recorte" /> : <p className="text-muted">Carta adicionada manualmente.</p>}
            {detections.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detections.map((d) => (
                  <img key={d.id} src={d.crop_url} className="h-20 rounded" alt="outra cópia" />
                ))}
              </div>
            )}
          </figure>
          <figure>
            <figcaption className="mb-1.5 text-[13px] text-muted">
              Imagem oficial · {card?.set_name} #{card?.collector_number}
            </figcaption>
            {card?.image_normal && <img src={card.image_normal} className="w-full rounded-lg" alt={card.name_en} />}
          </figure>
        </div>
      </Modal>

      <ChangeCardModal open={changing} onClose={() => setChanging(false)} entry={entry} onDone={(s) => { apply(s); setChanging(false); }} />
    </article>
  );
}

function ChangeCardModal({ open, onClose, entry, onDone }: { open: boolean; onClose: () => void; entry: Entry; onDone: (s: SessionState) => void }) {
  const [prints, setPrints] = useState<CardSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPrints(null);
    api.card(entry.card_ref_id).then((c) => setPrints(c.prints ?? []));
  }, [open, entry.card_ref_id]);

  async function choose(cardRefId: string) {
    setBusy(true);
    try {
      onDone(await api.patchEntry(entry.id, { card_ref_id: cardRefId }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Trocar identificação" wide>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm text-muted">Carta errada? Busque a certa — o sistema aprende com a correção.</p>
          <CardSearch autoFocus onPick={(c) => choose(c.id)} />
        </div>
        <div>
          <p className="mb-1.5 text-sm text-muted">Mesma carta, outra impressão:</p>
          {!prints && <p className="text-sm text-faint">carregando impressões…</p>}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {prints?.slice(0, 36).map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => choose(p.id)}
                className={`rounded-lg border p-1 text-left text-[11px] transition-colors ${p.id === entry.card_ref_id ? "border-accent" : "border-line hover:border-panel-3"}`}
              >
                {p.image_small && <img src={p.image_small} className="w-full rounded" alt="" loading="lazy" />}
                <span className="mt-0.5 block truncate font-mono uppercase text-muted">
                  {p.set_code} {p.collector_number} · {p.lang}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
