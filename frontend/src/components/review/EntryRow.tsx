import { ChevronDown, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { cardName, CONDITION_NAME, CONFIDENCE_REVIEW, LANGUAGE_NAME, secondaryName, SOURCE_LABEL, usdPrice } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import type { CardSummary, DeckState, Detection, Entry, FormatRule, GameMeta, SessionState } from "../../lib/types";
import CardSearch from "../cards/CardSearch";
import { Crown } from "../icons";
import { ArtThumb, CardImage, ConditionBadge, ConfidenceSeal, FinishMark, LanguagePill, ManaCost, SetSymbol } from "../mtg";
import { Button, cx, IconButton, Modal, Select, Skeleton, Stepper, Tag } from "../ui";

type AnyState = SessionState | DeckState;

type Props = {
  entry: Entry;
  format: FormatRule;
  game: GameMeta;
  detections?: Detection[];
  ownedElsewhere?: string[];
  onState: (s: AnyState) => void;
  defaultOpen?: boolean;
  fxRate?: number;
};

function EntryRowImpl({ entry, format, game, detections = [], ownedElsewhere, onState, defaultOpen, fxRate }: Props) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const card = entry.card;
  const det = detections[0];
  const notes = [...new Set(detections.flatMap((d) => d.notes))];
  const uncertainPrint = notes.some((n) => n.startsWith("impressão incerta"));
  const uncertainLang = notes.some((n) => n.startsWith("idioma não confirmado"));
  const overLimit = entry.quantity_detected > entry.quantity && entry.quantity_override === null;
  const zones = (format.zones ?? ["deck"]).map((z) => ({ id: z, name: format.zone_labels?.[z] ?? game.zones.find((x) => x.id === z)?.name ?? z }));
  const usd = usdPrice(card, entry.finish);
  const condition = det?.condition ?? null;

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  async function run(fn: () => Promise<AnyState>, done?: string) {
    setBusy(true);
    try {
      const next = await fn();
      onState(next);
      if (next.print_warning) toast(next.print_warning.message, { tone: "info", ttl: 8000 });
      else if (done) toast(done);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const patch = (body: Record<string, unknown>, done?: string) => run(() => api.patchEntry<AnyState>(entry.id, body), done);

  return (
    <li id={`entry-${entry.id}`} className={cx("border-b border-mist/6 last:border-b-0", entry.quantity === 0 && "opacity-60")}>
      <div className="flex min-h-16 items-center gap-3 px-3 py-2">
        <span className="well tabular grid size-10 shrink-0 place-items-center text-headline font-semibold text-mist" title="quantidade na lista">
          {entry.quantity}
        </span>
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          <ArtThumb card={card} size={54} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {entry.is_commander && <Crown size={17} className="shrink-0 text-arcane-300" />}
              <span className="truncate font-serif text-headline leading-tight font-semibold text-mist">{cardName(card)}</span>
              <span className="ml-1 hidden shrink-0 sm:inline">
                <ManaCost cost={card?.mana_cost} size={15} />
              </span>
            </span>
            <span className="flex items-center gap-2 truncate text-footnote text-mist-faint">
              {secondaryName(card) && <span className="truncate italic">{secondaryName(card)}</span>}
              <span className="hidden truncate sm:inline">{card?.front_type_line}</span>
            </span>
          </span>
        </button>
        <span className="hidden items-center gap-1.5 md:flex">
          <SetSymbol card={card} size={17} />
          <span
            className={cx("font-mono text-caption uppercase", uncertainPrint ? "text-ember-300 underline decoration-dotted underline-offset-2" : "text-mist-faint")}
            title={uncertainPrint ? "Impressão incerta: a arte é igual em mais de uma edição. Confira o símbolo da coleção." : undefined}
          >
            {card?.set_code}
            {uncertainPrint && "?"}
          </span>
          <LanguagePill lang={entry.language} uncertain={uncertainLang} />
          <FinishMark finish={entry.finish} />
          <ConditionBadge condition={entry.condition} estimate={condition} />
        </span>
        {(entry.warnings.length > 0 || overLimit) && (
          <TriangleAlert className="size-[18px] shrink-0 text-ember-400" aria-label="há avisos nesta carta" />
        )}
        {ownedElsewhere?.length ? (
          <span className="hidden lg:inline">
            <Tag tone="info" title={`Você já tem esta carta alocada em: ${ownedElsewhere.join(", ")}`}>
              em outro deck
            </Tag>
          </span>
        ) : null}
        {/* selo só quando a leitura pede conferência: nas outras a confiança alta é o normal e poluiria a lista */}
        {entry.detection_ids.length > 0 && entry.confidence !== null && entry.confidence < CONFIDENCE_REVIEW && <ConfidenceSeal value={entry.confidence} />}
        <IconButton label={open ? "Recolher" : "Detalhes"} onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={cx("size-5 transition-transform", open && "rotate-180")} />
        </IconButton>
      </div>

      {open && (
        <div className="animate-rise grid gap-4 bg-night-950/25 px-4 pt-2 pb-5 sm:grid-cols-[auto_1fr]">
          <div className="flex gap-2">
            {det?.crop_url ? (
              <figure className="w-[132px] space-y-1">
                <CardImage src={det.crop_url} alt="recorte da sua carta" />
                <figcaption className="text-center text-caption text-mist-faint">Sua carta</figcaption>
              </figure>
            ) : (
              <div className="card-img grid aspect-[488/680] w-[132px] place-items-center border border-dashed border-mist/15 px-2 text-center text-footnote text-mist-faint">
                Adicionada à mão
              </div>
            )}
            <figure className="w-[132px] space-y-1">
              <CardImage card={card} />
              <figcaption className="text-center text-caption text-mist-faint">Oficial</figcaption>
            </figure>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-subhead text-mist-dim">
              <span className="inline-flex items-center gap-1.5">
                <SetSymbol card={card} size={16} />
                {card?.set_name} · #{card?.collector_number}
              </span>
              {usd !== null && fxRate && <span className="tabular text-arcane-200">≈ {(usd * fxRate).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>}
              {det?.source && <span className="text-mist-faint">identificada {SOURCE_LABEL[det.source] ?? det.source}</span>}
            </div>

            {entry.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 text-subhead text-ember-300">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {w}
              </p>
            ))}
            {entry.exception && entry.quantity_detected > 1 && !entry.exception.restricted && (
              <p className="text-subhead text-astral-300">Sem limite de cópias: {entry.exception.reason}</p>
            )}
            {ownedElsewhere?.length ? (
              <p className="text-subhead text-astral-300">Você já tem esta carta montada em {ownedElsewhere.join(", ")}.</p>
            ) : null}
            {notes
              .filter((n) => !n.includes("multimodal"))
              .slice(0, 4)
              .map((n) => (
                <p key={n} className="text-footnote text-mist-faint">
                  {n}
                </p>
              ))}
            {condition && !entry.condition && condition.confidence >= 0.5 && (
              <p className="text-footnote text-mist-faint">
                Condição estimada pela foto: {condition.grade} ({CONDITION_NAME[condition.grade]}). Ajuste abaixo se não for isso.
              </p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="mb-1 text-footnote text-mist-faint">
                  {entry.quantity_detected > 0 ? `${entry.quantity_detected} escaneada${entry.quantity_detected > 1 ? "s" : ""}` : "Quantidade"}
                </p>
                <div className="flex items-center gap-2">
                  <Stepper value={entry.quantity} busy={busy} onChange={(v) => patch({ quantity_override: v })} />
                  {entry.quantity_override !== null && entry.quantity_detected > 0 && (
                    <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => patch({ reset_quantity: true })}>
                      Automático
                    </Button>
                  )}
                </div>
              </div>
              {zones.length > 1 && (
                <label className="block">
                  <span className="mb-1 block text-footnote text-mist-faint">Zona</span>
                  <Select className="h-10 w-40" value={entry.zone} disabled={busy} onChange={(e) => patch({ zone: e.target.value, is_commander: e.target.value === "commander" })}>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-footnote text-mist-faint">Idioma</span>
                <Select className="h-10 w-36" value={entry.language ?? "en"} disabled={busy} onChange={(e) => patch({ language: e.target.value })}>
                  {game.languages.map((l) => (
                    <option key={l.id} value={l.id}>
                      {LANGUAGE_NAME[l.id] ?? l.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-footnote text-mist-faint">Acabamento</span>
                <Select className="h-10 w-32" value={entry.finish ?? "nonfoil"} disabled={busy} onChange={(e) => patch({ finish: e.target.value })}>
                  {game.finishes.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-footnote text-mist-faint">Condição</span>
                <Select className="h-10 w-28" value={entry.condition ?? ""} disabled={busy} onChange={(e) => patch({ condition: e.target.value })}>
                  <option value="">—</option>
                  {game.conditions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {format.requires_commander && (
                <Button size="sm" variant={entry.is_commander ? "primary" : "secondary"} icon={<Crown size={16} />} busy={busy} onClick={() => patch({ is_commander: !entry.is_commander })}>
                  {entry.is_commander ? "É o comandante" : "Marcar comandante"}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
                Trocar carta ou impressão
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-4" />}
                busy={busy}
                onClick={() => run(() => api.deleteEntry<AnyState>(entry.id), entry.quantity_detected ? "Carta tirada da lista (a leitura continua registrada)" : "Carta removida")}
              >
                Tirar da lista
              </Button>
            </div>
          </div>
        </div>
      )}

      {changing && <ChangeCard entry={entry} onClose={() => setChanging(false)} onPick={(c) => patch({ card_ref_id: c.id }, "Identificação corrigida — o sistema aprendeu com isso").then(() => setChanging(false))} />}
    </li>
  );
}

export const EntryRow = memo(EntryRowImpl);

function ChangeCard({ entry, onClose, onPick }: { entry: Entry; onClose: () => void; onPick: (c: CardSummary) => void }) {
  const [prints, setPrints] = useState<CardSummary[] | null>(null);
  useEffect(() => {
    api.card(entry.card_ref_id).then((c) => setPrints(c.prints ?? [])).catch(() => setPrints([]));
  }, [entry.card_ref_id]);
  return (
    <Modal open onClose={onClose} title="Trocar carta" width="lg">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-subhead text-mist-dim">Carta errada? Procure a certa. A correção fica guardada e melhora as próximas leituras.</p>
          <CardSearch autoFocus onPick={onPick} />
        </div>
        <div>
          <p className="mb-2 text-subhead text-mist-dim">Mesma carta, outra impressão ou idioma:</p>
          {!prints && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="aspect-[488/680] rounded-md" />
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {prints?.slice(0, 40).map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className={cx(
                  "rounded-md p-1.5 text-left transition-[box-shadow,background-color,transform] duration-300 active:scale-[0.97]",
                  p.id === entry.card_ref_id ? "bg-arcane-400/10 shadow-[inset_0_0_0_1.5px_var(--color-arcane-400)]" : "shadow-[inset_0_0_0_1px_rgb(214_204_255/0.08)] hover:bg-mist/5 hover:shadow-[inset_0_0_0_1px_rgb(185_164_255/0.4)]",
                )}
              >
                <CardImage card={p} />
                <span className="mt-1 flex items-center gap-1 text-caption text-mist-faint">
                  <SetSymbol card={p} size={13} />
                  <span className="truncate font-mono uppercase">
                    {p.set_code} {p.collector_number}
                  </span>
                  <span className="ml-auto font-mono uppercase">{p.lang}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
