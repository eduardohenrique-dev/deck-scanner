import { AlertTriangle, ChevronDown, RotateCcw, Trash2 } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { cardName, CONDITION_NAME, CONFIDENCE_REVIEW, LANGUAGE_NAME, secondaryName, SOURCE_LABEL, usdPrice } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import type { CardSummary, DeckState, Detection, Entry, FormatRule, GameMeta, SessionState } from "../../lib/types";
import CardSearch from "../cards/CardSearch";
import { Crown } from "../icons";
import { ArtThumb, CardImage, ConditionBadge, ConfidenceSeal, FinishMark, LanguagePill, ManaCost, SetSymbol } from "../mtg";
import { Button, cx, IconButton, Modal, Select, Stepper, Tag } from "../ui";

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
    <li id={`entry-${entry.id}`} className={cx("border-b border-oak-700/70 last:border-b-0", entry.quantity === 0 && "opacity-60")}>
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="tabular grid h-9 w-9 shrink-0 place-items-center rounded-[4px] border border-oak-600 bg-oak-950/70 font-serif text-[18px] font-semibold text-cream" title="quantidade na lista">
          {entry.quantity}
        </span>
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          <ArtThumb card={card} size={54} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {entry.is_commander && <Crown size={17} className="shrink-0 text-brass-300" />}
              <span className="truncate font-serif text-[17px] leading-tight font-semibold text-cream">{cardName(card)}</span>
              <span className="ml-1 hidden shrink-0 sm:inline">
                <ManaCost cost={card?.mana_cost} size={15} />
              </span>
            </span>
            <span className="flex items-center gap-2 truncate text-[13px] text-cream-faint">
              {secondaryName(card) && <span className="truncate italic">{secondaryName(card)}</span>}
              <span className="hidden truncate sm:inline">{card?.front_type_line}</span>
            </span>
          </span>
        </button>
        <span className="hidden items-center gap-1.5 md:flex">
          <SetSymbol card={card} size={17} />
          <span
            className={cx("font-mono text-[12px] uppercase", uncertainPrint ? "text-amber-300 underline decoration-dotted underline-offset-2" : "text-cream-faint")}
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
          <AlertTriangle className="size-[18px] shrink-0 text-amber-400" aria-label="há avisos nesta carta" />
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
        <div className="animate-rise grid gap-4 bg-oak-950/35 px-3 pt-2 pb-4 sm:grid-cols-[auto_1fr]">
          <div className="flex gap-2">
            {det?.crop_url ? (
              <figure className="w-[132px] space-y-1">
                <CardImage src={det.crop_url} alt="recorte da sua carta" />
                <figcaption className="text-center text-[12px] text-cream-faint">sua carta</figcaption>
              </figure>
            ) : (
              <div className="card-img grid aspect-[488/680] w-[132px] place-items-center border border-dashed border-oak-600 px-2 text-center text-[13px] text-cream-faint">
                adicionada à mão
              </div>
            )}
            <figure className="w-[132px] space-y-1">
              <CardImage card={card} />
              <figcaption className="text-center text-[12px] text-cream-faint">oficial</figcaption>
            </figure>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-cream-dim">
              <span className="inline-flex items-center gap-1.5">
                <SetSymbol card={card} size={16} />
                {card?.set_name} · #{card?.collector_number}
              </span>
              {usd !== null && fxRate && <span className="tabular text-brass-200">≈ {(usd * fxRate).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>}
              {det?.source && <span className="text-cream-faint">identificada {SOURCE_LABEL[det.source] ?? det.source}</span>}
            </div>

            {entry.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5 text-[14px] text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {w}
              </p>
            ))}
            {entry.exception && entry.quantity_detected > 1 && !entry.exception.restricted && (
              <p className="text-[14px] text-steel-300">Sem limite de cópias: {entry.exception.reason}</p>
            )}
            {ownedElsewhere?.length ? (
              <p className="text-[14px] text-steel-300">Você já tem esta carta montada em {ownedElsewhere.join(", ")}.</p>
            ) : null}
            {notes
              .filter((n) => !n.includes("multimodal"))
              .slice(0, 4)
              .map((n) => (
                <p key={n} className="text-[14px] text-cream-faint">
                  {n}
                </p>
              ))}
            {condition && !entry.condition && condition.confidence >= 0.5 && (
              <p className="text-[14px] text-cream-faint">
                Condição estimada pela foto: {condition.grade} ({CONDITION_NAME[condition.grade]}). Ajuste abaixo se não for isso.
              </p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="mb-1 text-[13px] text-cream-faint">
                  {entry.quantity_detected > 0 ? `${entry.quantity_detected} escaneada${entry.quantity_detected > 1 ? "s" : ""}` : "quantidade"}
                </p>
                <div className="flex items-center gap-2">
                  <Stepper value={entry.quantity} busy={busy} onChange={(v) => patch({ quantity_override: v })} />
                  {entry.quantity_override !== null && entry.quantity_detected > 0 && (
                    <Button size="xs" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => patch({ reset_quantity: true })}>
                      automático
                    </Button>
                  )}
                </div>
              </div>
              {zones.length > 1 && (
                <label className="block">
                  <span className="mb-1 block text-[13px] text-cream-faint">zona</span>
                  <Select className="h-9 w-40" value={entry.zone} disabled={busy} onChange={(e) => patch({ zone: e.target.value, is_commander: e.target.value === "commander" })}>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-[13px] text-cream-faint">idioma</span>
                <Select className="h-9 w-36" value={entry.language ?? "en"} disabled={busy} onChange={(e) => patch({ language: e.target.value })}>
                  {game.languages.map((l) => (
                    <option key={l.id} value={l.id}>
                      {LANGUAGE_NAME[l.id] ?? l.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] text-cream-faint">acabamento</span>
                <Select className="h-9 w-32" value={entry.finish ?? "nonfoil"} disabled={busy} onChange={(e) => patch({ finish: e.target.value })}>
                  {game.finishes.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] text-cream-faint">condição</span>
                <Select className="h-9 w-28" value={entry.condition ?? ""} disabled={busy} onChange={(e) => patch({ condition: e.target.value })}>
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
                <Button size="sm" variant={entry.is_commander ? "brass" : "outline"} icon={<Crown size={16} />} busy={busy} onClick={() => patch({ is_commander: !entry.is_commander })}>
                  {entry.is_commander ? "é o comandante" : "marcar comandante"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
                trocar carta ou impressão
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-4" />}
                busy={busy}
                onClick={() => run(() => api.deleteEntry<AnyState>(entry.id), entry.quantity_detected ? "Carta tirada da lista (a leitura continua registrada)" : "Carta removida")}
              >
                tirar da lista
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
          <p className="mb-2 text-[15px] text-cream-dim">Carta errada? Procure a certa. A correção fica guardada e melhora as próximas leituras.</p>
          <CardSearch autoFocus onPick={onPick} />
        </div>
        <div>
          <p className="mb-2 text-[15px] text-cream-dim">Mesma carta, outra impressão ou idioma:</p>
          {!prints && <p className="text-cream-faint">carregando impressões…</p>}
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
            {prints?.slice(0, 40).map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className={cx("rounded-[5px] border p-1 text-left transition-colors", p.id === entry.card_ref_id ? "border-brass-400 bg-brass-400/10" : "border-oak-600 hover:border-brass-600")}
              >
                <CardImage card={p} />
                <span className="mt-1 flex items-center gap-1 text-[12px] text-cream-faint">
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
