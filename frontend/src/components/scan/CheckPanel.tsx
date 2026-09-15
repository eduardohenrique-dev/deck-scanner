import { ArrowRight, Check, ExternalLink, Repeat } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { FINISH_NAME, LANGUAGE_NAME } from "../../lib/format";
import { Link, navigate } from "../../lib/router";
import { toast, toastError } from "../../lib/toast";
import type { CheckCard, CheckResult, PrintRef, SessionState } from "../../lib/types";
import { Scales } from "../icons";
import { Button, Confirm, cx, SectionTitle, Tag } from "../ui";

type Available = Extract<CheckResult, { available: true }>;

const name = (c: CheckCard) => c.name_pt || c.name || "—";

function printLabel(p: PrintRef) {
  return [p.set_code?.toUpperCase(), p.collector_number && `#${p.collector_number}`, LANGUAGE_NAME[p.language] ?? p.language, p.finish !== "nonfoil" && FINISH_NAME[p.finish]]
    .filter(Boolean)
    .join(" ");
}

/** Conferência: o baralho físico contra a lista salva — faltando, sobrando e trocadas. */
export default function CheckPanel({ state, scanning }: { state: SessionState; scanning: boolean }) {
  const check = state.check;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!check) return null;
  if (!check.available)
    return (
      <section className="board p-4 text-[15px] text-cream-dim">
        <Scales size={20} className="mr-2 inline text-brass-400" /> Não dá para conferir: {check.reason}.
      </section>
    );
  const c: Available = check;
  const s = c.summary;
  const started = s.scanned > 0;

  async function apply() {
    setBusy(true);
    try {
      const res = await api.applyCheck(state.session.id);
      toast("Lista do deck atualizada — a versão anterior ficou no histórico");
      navigate(`/decks/${res.deck_id}`);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <SectionTitle aside={<Link to={`/decks/${c.deck.id}`} className="inline-flex items-center gap-1 text-[14px] text-brass-300 hover:underline">abrir deck <ExternalLink className="size-3.5" /></Link>}>
        <span className="inline-flex items-center gap-2">
          <Scales size={17} /> conferência · {c.deck.name}
        </span>
      </SectionTitle>
      <div className="board space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <Num label="na lista" value={s.expected} />
          <Num label="lidas" value={s.scanned} />
          <Num label="conferem" value={s.ok} tone="ok" />
          <Num label="faltando" value={s.missing} tone={s.missing ? "warn" : undefined} />
          <Num label="sobrando" value={s.extra} tone={s.extra ? "bad" : undefined} className="max-sm:col-start-2" />
        </div>

        {!started ? (
          <p className="text-[15px] text-cream-faint">Escaneie o deck inteiro. A comparação com a lista salva aparece aqui conforme as cartas são lidas.</p>
        ) : c.matches ? (
          <p className="parchment flex items-center gap-2 px-3 py-2.5 font-serif text-[17px] text-ink-900">
            <Check className="size-5 text-moss-600" /> Tudo confere: o baralho bate com a lista salva.
          </p>
        ) : (
          <>
            {scanning && <p className="text-[14px] text-cream-faint">Ainda lendo — os números mudam até a última carta.</p>}

            {c.likely_swaps.length > 0 && (
              <Group title="provavelmente trocadas" hint="saiu uma, entrou outra do mesmo tipo">
                {c.likely_swaps.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[15px]">
                    <span className="text-wine-300 line-through decoration-wine-400/60">{name(p.out)}</span>
                    <ArrowRight className="size-4 text-cream-faint" />
                    <span className="text-cream">{name(p.in)}</span>
                  </li>
                ))}
              </Group>
            )}
            {c.missing.length > 0 && (
              <Group title={`faltando (${s.missing})`} hint="estão na lista, não apareceram no scan">
                {c.missing.map((m) => (
                  <Row key={m.oracle_id} card={m} qty={m.quantity} detail={m.expected && m.expected > 1 ? `${m.scanned ?? 0} de ${m.expected}` : undefined} />
                ))}
              </Group>
            )}
            {c.extra.length > 0 && (
              <Group title={`sobrando (${s.extra})`} hint="apareceram no scan, não estão na lista">
                {c.extra.map((m) => (
                  <Row key={m.oracle_id} card={m} qty={m.quantity} detail={m.expected ? `lista tem ${m.expected}` : undefined} />
                ))}
              </Group>
            )}
            {c.swapped.length > 0 && (
              <Group title={`outra edição ou idioma (${s.swapped})`} hint="mesma carta, impressão diferente da lista">
                {c.swapped.map((m) => (
                  <li key={m.oracle_id} className="px-3 py-2">
                    <p className="flex items-center gap-2 font-serif text-[16px] text-cream">
                      <Repeat className="size-4 text-steel-300" /> {name(m)}
                    </p>
                    <p className="text-[13px] text-cream-faint">
                      lista: {m.expected_prints.map(printLabel).join(", ")} · no scan: {m.scanned_prints.map(printLabel).join(", ")}
                    </p>
                  </li>
                ))}
              </Group>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-oak-700 pt-3">
              <p className="max-w-md text-[14px] text-cream-faint">A lista do deck mudou de propósito? Atualize com o que foi escaneado; a versão atual fica guardada no histórico.</p>
              <Button disabled={scanning} onClick={() => setConfirm(true)}>
                usar o scan como lista
              </Button>
            </div>
          </>
        )}
      </div>
      <Confirm open={confirm} title="Atualizar a lista do deck?" confirmLabel="atualizar lista" busy={busy} onConfirm={apply} onClose={() => setConfirm(false)}>
        <p>
          A lista de <strong className="text-cream">{c.deck.name}</strong> passa a ser exatamente o que foi escaneado ({s.scanned} cartas).
        </p>
        <p>A versão atual fica no histórico do deck e pode ser comparada depois.</p>
      </Confirm>
    </section>
  );
}

function Num({ label, value, tone, className }: { label: string; value: number; tone?: "ok" | "warn" | "bad"; className?: string }) {
  return (
    <div className={cx("board-sunken px-2.5 py-2", className)}>
      <div className="font-caps text-[12px] font-bold lowercase tracking-[0.05em] text-cream-faint">{label}</div>
      <div className={cx("tabular font-serif text-[23px] leading-tight font-semibold", tone === "ok" ? "text-moss-300" : tone === "warn" ? "text-amber-300" : tone === "bad" ? "text-wine-300" : "text-cream")}>{value}</div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="font-caps text-[15px] font-bold lowercase tracking-[0.04em] text-brass-300">{title}</span>
        <span className="text-[13px] text-cream-faint">{hint}</span>
      </p>
      <ul className="board-sunken divide-y divide-oak-700">{children}</ul>
    </div>
  );
}

function Row({ card, qty, detail }: { card: CheckCard; qty: number; detail?: string }) {
  return (
    <li className="flex items-center gap-3 px-3 py-1.5">
      {card.image_small ? <img src={card.image_small} alt="" loading="lazy" className="card-img h-11 w-8 object-cover" /> : <span className="h-11 w-8" />}
      <span className="min-w-0 flex-1 truncate font-serif text-[16px] text-cream">{name(card)}</span>
      {detail && <span className="text-[13px] text-cream-faint">{detail}</span>}
      <Tag>{qty}×</Tag>
    </li>
  );
}
