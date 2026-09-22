import { Check } from "lucide-react";
import { useState } from "react";
import { toast, toastError } from "../../lib/toast";
import type { DeckState, Entry, FormatRule, Issue, SessionState, Validation } from "../../lib/types";
import { IdentityPips } from "../mtg";
import { Button, cx, Meter, SectionTitle } from "../ui";

const SEVERITY: Record<Issue["severity"], { pin: string; stripe: string; label: string }> = {
  error: { pin: "bg-wine-400", stripe: "border-l-wine-600", label: "impede o formato" },
  warning: { pin: "bg-ember-400", stripe: "border-l-ember-600", label: "confira" },
  info: { pin: "bg-verdigris-400", stripe: "border-l-verdigris-600", label: "nota" },
};

/** Quadro de avisos: estado da validação atualizado a cada mudança da lista. */
export default function NoticeBoard({
  validation,
  format,
  entries,
  onJump,
  applySuggestion,
}: {
  validation: Validation;
  format: FormatRule;
  entries: Entry[];
  onJump?: (entryId: string) => void;
  applySuggestion?: (type: string) => Promise<SessionState | DeckState>;
}) {
  const [busy, setBusy] = useState(false);
  const size = validation.totals.size;
  const target = size?.exact ?? size?.min ?? null;
  const count = validation.totals.count;
  const issues = [...validation.issues].sort((a, b) => "error warning info".indexOf(a.severity) - "error warning info".indexOf(b.severity));
  // só sugere básicos quando eles praticamente fecham o deck (no meio do scan a sugestão só atrapalha)
  const landSuggestion = validation.suggestions?.mtg_basic_lands;
  const lands = landSuggestion?.applicable && (landSuggestion.remaining_nonland ?? 0) <= 10 ? landSuggestion : undefined;
  const commanderNames = (validation.commander?.entry_ids ?? [])
    .map((id) => entries.find((e) => e.id === id)?.card)
    .filter(Boolean)
    .map((c) => c!.name_pt || c!.name_en);

  return (
    <section className="space-y-3">
      <SectionTitle>Quadro de avisos</SectionTitle>
      <div className="glass space-y-4 p-4 sm:p-5">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-serif text-headline font-semibold text-cream">{validation.format_name}</span>
            <span className="tabular text-subhead text-cream-dim">
              <strong className="text-title-3 text-cream">{count}</strong>
              {target ? ` de ${target}` : " cartas"}
            </span>
          </div>
          {target ? (
            <Meter
              className="mt-2"
              value={Math.min(1, count / target)}
              tone={count === target || (size?.min && !size.exact && count >= size.min) ? "ok" : count > target ? "warn" : "brass"}
              label="tamanho do deck"
            />
          ) : null}
          <p className="mt-1.5 text-footnote text-cream-faint">
            {validation.totals.missing > 0
              ? `Faltam ${validation.totals.missing}`
              : validation.totals.excess > 0
                ? `Sobram ${validation.totals.excess}`
                : validation.valid
                  ? "Tudo em ordem para este formato"
                  : "Tamanho certo"}
          </p>
        </div>

        {format.requires_commander && (
          <div className="well flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-footnote text-cream-faint">Comandante</p>
              <p className={cx("truncate font-serif text-body font-semibold", commanderNames.length ? "text-cream" : "text-ember-300")}>
                {commanderNames.length ? commanderNames.join(" & ") : "Ainda não marcado"}
              </p>
            </div>
            {validation.commander?.identity?.length ? <IdentityPips colors={validation.commander.identity} size={18} /> : null}
          </div>
        )}

        {issues.length === 0 ? (
          <p className="flex items-center gap-2 text-subhead text-moss-300">
            <Check className="size-4" /> Nenhum aviso pendurado no quadro.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {issues.slice(0, 40).map((issue, i) => {
              const s = SEVERITY[issue.severity];
              return (
                <li key={`${issue.code}-${i}`} className={cx("parchment relative border-l-4 py-2 pr-2.5 pl-3 text-subhead", s.stripe, i % 2 ? "rotate-[0.25deg]" : "-rotate-[0.2deg]")}>
                  <span className={cx("absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full shadow-[0_1px_1px_rgb(0_0_0/0.5)]", s.pin)} aria-hidden="true" />
                  <p className="text-ink-900">{issue.message}</p>
                  {issue.entry_ids.length > 0 && onJump && (
                    <button type="button" onClick={() => onJump(issue.entry_ids[0])} className="mt-1 text-footnote font-semibold text-brass-700 underline-offset-2 hover:underline">
                      Ver na lista
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {lands?.applicable && applySuggestion && (
          <div className="well space-y-2 px-4 py-4">
            <p className="font-serif text-body font-semibold text-cream">Terrenos básicos sugeridos</p>
            <p className="text-subhead text-cream-dim">{lands.summary}</p>
            <ul className="space-y-1 text-footnote text-cream-faint">
              {lands.by_color?.filter((c) => c.add > 0).map((c) => (
                <li key={c.color} className="flex items-center gap-2">
                  <IdentityPips colors={[c.color]} size={15} />
                  <span>
                    +{c.add} {c.basic} <span className="text-cream-faint">({c.final_sources} fontes)</span>
                  </span>
                </li>
              ))}
            </ul>
            {lands.reasoning?.length ? (
              <details className="text-footnote text-cream-faint">
                <summary className="cursor-pointer text-brass-300">Por que essa divisão</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {lands.reasoning.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await applySuggestion("mtg_basic_lands");
                  toast("Terrenos básicos adicionados");
                } catch (e) {
                  toastError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Adicionar {lands.basics_to_add} básicos
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
