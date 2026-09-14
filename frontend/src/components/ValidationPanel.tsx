import { AlertCircle, CheckCircle2, Crown, Info, Mountain, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import type { SessionState } from "../lib/types";
import { Button, Chip, IdentityPips, ProgressBar } from "./ui";

export default function ValidationPanel({ state, apply }: { state: SessionState; apply: (s: SessionState) => void }) {
  const v = state.validation;
  const [applying, setApplying] = useState(false);
  const size = v.totals.size;
  const target = size?.exact ?? size?.min ?? null;
  const errors = v.issues.filter((i) => i.severity === "error");
  const warnings = v.issues.filter((i) => i.severity === "warning");
  const infos = v.issues.filter((i) => i.severity === "info");
  const lands = v.suggestions?.mtg_basic_lands;
  const sideboard = v.totals.by_zone?.sideboard ?? 0;

  function scrollTo(entryIds: string[]) {
    const el = entryIds.length ? document.getElementById(`entry-${entryIds[0]}`) : null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.animate([{ outline: "2px solid #f2b544" }, { outline: "2px solid transparent" }], { duration: 1600 });
  }

  async function applyLands() {
    setApplying(true);
    try {
      apply(await api.applySuggestion(state.session.id, "mtg_basic_lands"));
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Validação · {v.format_name}</h2>
        {v.valid ? (
          <Chip tone="ok">
            <CheckCircle2 className="size-3.5" /> válido
          </Chip>
        ) : (
          <Chip tone="bad">
            {errors.length} {errors.length === 1 ? "problema" : "problemas"}
          </Chip>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-semibold tabular-nums">{v.totals.count}</span>
          <span className="text-sm text-muted">
            {target ? `${size?.exact ? "de" : "mínimo"} ${target} cartas` : "cartas (sem limite)"}
          </span>
        </div>
        {target && <ProgressBar value={Math.min(1, v.totals.count / target)} />}
        <p className="text-[13px] text-muted">
          {v.totals.missing > 0 && <span className="text-warn">Faltam {v.totals.missing}. </span>}
          {v.totals.excess > 0 && <span className="text-bad">Sobram {v.totals.excess}. </span>}
          {sideboard > 0 && `Sideboard: ${sideboard}.`}
        </p>
      </div>

      {v.commander && (
        <div className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            <Crown className="size-4 text-accent" /> Comandante
            {v.commander.pairing && <Chip>{v.commander.pairing}</Chip>}
          </span>
          {v.commander.entry_ids.length ? <IdentityPips colors={v.commander.identity} /> : <span className="text-warn">não marcado</span>}
        </div>
      )}

      {[...errors, ...warnings, ...infos].length > 0 && (
        <ul className="scrollbar-thin max-h-[40vh] space-y-1.5 overflow-y-auto pr-1">
          {[...errors, ...warnings, ...infos].map((i, idx) => (
            <li key={idx}>
              <button onClick={() => scrollTo(i.entry_ids)} className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-panel-2">
                {i.severity === "error" && <AlertCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
                {i.severity === "warning" && <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />}
                {i.severity === "info" && <Info className="mt-0.5 size-4 shrink-0 text-info" />}
                <span className={i.severity === "error" ? "text-text" : "text-muted"}>{i.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lands && (
        <div className="space-y-2 rounded-lg border border-line bg-panel-2 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Mountain className="size-4 text-accent" /> Terrenos básicos
          </p>
          {lands.applicable ? (
            <>
              <p className="text-sm">
                Sugestão: <strong>+{lands.basics_to_add}</strong> básicos → <span className="text-accent">{lands.summary}</span>
              </p>
              <ul className="space-y-0.5 text-[12px] text-muted">
                {lands.reasoning?.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-1.5">
                {lands.by_color
                  ?.filter((c) => c.add > 0)
                  .map((c) => (
                    <Chip key={c.color}>
                      {c.add}× {c.basic}
                    </Chip>
                  ))}
              </div>
              <Button size="sm" variant="primary" busy={applying} onClick={applyLands}>
                Adicionar básicos sugeridos
              </Button>
            </>
          ) : (
            <p className="text-[13px] text-muted">{lands.reason}</p>
          )}
        </div>
      )}
    </section>
  );
}
