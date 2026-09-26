import { ArrowDownToLine, CircleCheck, PackageOpen, ShoppingCart, TriangleAlert } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import { LANGUAGE_NAME, LOCATION_LABEL } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import type { AllocationItem, CardSummary, CopyRef, DeckState } from "../../lib/types";
import { Chest } from "../icons";
import { ArtThumb } from "../mtg";
import { Button, Confirm, cx, Meter, Tag } from "../ui";

const place = (c: CopyRef) => (c.location_type === "loose" ? "Solto" : `${LOCATION_LABEL[c.location_type ?? ""] ?? ""} ${c.location_name ?? ""}`.trim());

function copyLabel(c: CopyRef) {
  return [c.language && c.language !== "en" ? LANGUAGE_NAME[c.language] ?? c.language : null, c.finish && c.finish !== "nonfoil" ? c.finish : null, c.condition].filter(Boolean).join(" · ");
}

/** Cartas físicas: o que já está no deck, o que dá para trazer da coleção, o que está preso em outro deck e o que falta comprar. */
export default function AllocationPanel({ state, onState, onShop }: { state: DeckState; onState: (s: DeckState) => void; onShop: () => void }) {
  const report = state.allocation;
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ copyId: string; message: string } | null>(null);
  const cards = useMemo(() => {
    const byEntry = new Map(state.entries.map((e) => [e.id, e.card]));
    return (item: AllocationItem): CardSummary | null => byEntry.get(item.entry_ids[0]) ?? null;
  }, [state.entries]);

  const t = report.totals;
  const groups = {
    conflict: report.items.filter((i) => i.conflict > 0 && i.move === 0),
    move: report.items.filter((i) => i.move > 0),
    buy: report.items.filter((i) => i.buy > 0),
    ok: report.items.filter((i) => i.status === "ok"),
  };

  async function run(key: string, fn: () => Promise<{ state: DeckState; result?: any }>, done: (r: any) => string) {
    setBusy(key);
    try {
      const res = await fn();
      onState(res.state);
      toast(done(res.result));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function bring(copyId: string, force = false) {
    setBusy(copyId);
    try {
      const res = await api.allocate(state.deck.id, copyId, force);
      onState(res.state);
      setConflict(null);
      toast("Carta trazida para o deck");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict({ copyId, message: e.message });
      else toastError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="glass space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-body text-mist-dim">
            <strong className="tabular text-title-2 font-semibold text-mist">{t.here}</strong> de {t.needed} cartas físicas neste deck
          </p>
          {report.complete && <Tag tone="ok">Deck montado</Tag>}
        </div>
        <Meter value={t.needed ? t.here / t.needed : 0} tone={report.complete ? "ok" : "arcane"} label="cartas físicas no deck" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-subhead text-mist-dim">
          {t.move > 0 && <span className="text-astral-300">{t.move} na coleção</span>}
          {t.conflict > 0 && <span className="text-ember-300">{t.conflict} em outros decks</span>}
          {t.buy > 0 && <span className="text-wine-300">{t.buy} para comprar</span>}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {t.move > 0 && (
            <Button
              variant="primary"
              size="sm"
              icon={<ArrowDownToLine className="size-4" />}
              busy={busy === "auto"}
              onClick={() => run("auto", () => api.autoAllocate(state.deck.id), (r) => `${r?.moved ?? 0} cartas trazidas da coleção`)}
            >
              Trazer da coleção ({t.move})
            </Button>
          )}
          {report.extra.length > 0 && (
            <Button
              size="sm"
              icon={<PackageOpen className="size-4" />}
              busy={busy === "release"}
              onClick={() => run("release", () => api.releaseExtra(state.deck.id), (r) => `${r?.moved ?? 0} sobras devolvidas para Solto`)}
            >
              Devolver sobras ({report.extra.length})
            </Button>
          )}
          {t.buy > 0 && (
            <Button size="sm" variant="tertiary" icon={<ShoppingCart className="size-4" />} onClick={onShop}>
              Ver lista de compras
            </Button>
          )}
        </div>
        <p className="text-footnote text-mist-faint">“Trazer da coleção” só usa cartas soltas, de pastas e caixas. Cartas de outros decks nunca saem sem você confirmar.</p>
      </div>

      {groups.conflict.length > 0 && (
        <Section title="Presas em outro deck" tone="warn" icon={<TriangleAlert className="size-4" />}>
          {groups.conflict.map((item) => (
            <ItemRow key={item.oracle_id} item={item} card={cards(item)}>
              {item.warnings.map((w) => (
                <p key={w} className="text-subhead text-ember-300">
                  {w}
                </p>
              ))}
              <ul className="mt-2 flex flex-wrap gap-2">
                {item.in_other_decks.slice(0, 4).map((c) => (
                  <li key={c.id}>
                    <Button size="sm" variant="secondary" busy={busy === c.id} onClick={() => bring(c.id)}>
                      Trazer do {c.location_name}
                    </Button>
                  </li>
                ))}
              </ul>
            </ItemRow>
          ))}
        </Section>
      )}

      {groups.move.length > 0 && (
        <Section title="Na coleção, fora do deck" tone="info" icon={<Chest size={16} />}>
          {groups.move.map((item) => (
            <ItemRow key={item.oracle_id} item={item} card={cards(item)}>
              <ul className="mt-2 flex flex-wrap gap-2">
                {item.available.slice(0, 4).map((c) => (
                  <li key={c.id}>
                    <Button size="sm" busy={busy === c.id} onClick={() => bring(c.id)} title={copyLabel(c) || undefined}>
                      Trazer de {place(c)}
                    </Button>
                  </li>
                ))}
              </ul>
            </ItemRow>
          ))}
        </Section>
      )}

      {groups.buy.length > 0 && (
        <Section title="Você não tem" tone="bad" icon={<ShoppingCart className="size-4" />}>
          {groups.buy.map((item) => (
            <ItemRow key={item.oracle_id} item={item} card={cards(item)}>
              <p className="text-footnote text-mist-faint">{item.buy === 1 ? "Falta 1 cópia" : `Faltam ${item.buy} cópias`}</p>
            </ItemRow>
          ))}
        </Section>
      )}

      {report.extra.length > 0 && (
        <Section title="No deck, mas fora da lista" tone="neutral" icon={<PackageOpen className="size-4" />}>
          {report.extra.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-subhead text-mist-dim">
              {state.entries.find((e) => e.card_ref_id === c.card_ref_id)?.card?.name_pt ?? c.card_ref_id.slice(0, 8)} {copyLabel(c) && <span className="text-mist-faint">({copyLabel(c)})</span>}
            </li>
          ))}
        </Section>
      )}

      {groups.ok.length > 0 && (
        <details className="glass group overflow-hidden">
          <summary className="panel-head cursor-pointer border-b-0 text-moss-300 group-open:border-b">
            <CircleCheck className="size-4" /> Já no deck ({groups.ok.reduce((n, i) => n + Math.min(i.here, i.needed), 0)})
          </summary>
          <ul className="grid gap-x-4 px-4 py-3 sm:grid-cols-2">
            {groups.ok.map((item) => (
              <li key={item.oracle_id} className="truncate py-0.5 text-subhead text-mist-dim">
                {item.needed > 1 ? `${item.needed}× ` : ""}
                {item.name}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Confirm
        open={!!conflict}
        title="Tirar de outro deck?"
        confirmLabel="Trazer mesmo assim"
        busy={!!conflict && busy === conflict.copyId}
        onConfirm={() => conflict && bring(conflict.copyId, true)}
        onClose={() => setConflict(null)}
      >
        <p>{conflict?.message}</p>
        <p>Se trouxer, o outro deck fica com uma cópia a menos e passa a mostrar a falta.</p>
      </Confirm>
    </div>
  );
}

function Section({ title, tone, icon, children }: { title: string; tone: "warn" | "info" | "bad" | "neutral"; icon: ReactNode; children: ReactNode }) {
  const color = { warn: "text-ember-300", info: "text-astral-300", bad: "text-wine-300", neutral: "text-mist-dim" }[tone];
  return (
    <section className="glass overflow-hidden">
      <h3 className={cx("panel-head", color)}>
        {icon} {title}
      </h3>
      <ul className="divide-y divide-mist/6">{children}</ul>
    </section>
  );
}

function ItemRow({ item, card, children }: { item: AllocationItem; card: CardSummary | null; children: ReactNode }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <ArtThumb card={card} size={48} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-baseline justify-between gap-2">
          <span className="truncate font-serif text-body font-semibold text-mist">{item.name}</span>
          <span className="tabular shrink-0 text-footnote text-mist-faint">
            {item.here}/{item.needed} no deck
          </span>
        </p>
        {children}
      </div>
    </li>
  );
}
