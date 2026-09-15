import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import type { Bracket } from "../../lib/types";
import { D20 } from "../icons";
import { Seal, SectionTitle, Skeleton, Tag, cx } from "../ui";

const TAG_LABEL: Record<string, string> = { game_changer: "Game Changers", mass_land_denial: "Destruição de terrenos", extra_turn: "Turnos extras", tutor: "Tutores" };

/** Bracket de Commander com o raciocínio, recarregado quando a lista muda (a chave muda). */
export default function BracketPanel({ load, refreshKey }: { load: () => Promise<Bracket>; refreshKey: string }) {
  const [data, setData] = useState<Bracket | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      load()
        .then((b) => !cancelled && (setData(b), setError(null)))
        .catch((e) => !cancelled && setError((e as Error).message));
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (data && !data.applies) return null;
  return (
    <section className="space-y-3">
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <D20 size={17} /> nível da mesa
        </span>
      </SectionTitle>
      <div className="board p-4">
        {error && <p className="text-[14px] text-wine-300">Não consegui calcular o bracket: {error}</p>}
        {!data && !error && <Skeleton className="h-24" />}
        {data?.applies && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Seal size={52} tone={data.bracket >= 4 ? "bad" : data.bracket === 3 ? "warn" : "ok"}>
                <span className="font-display text-[28px]">{data.bracket}</span>
              </Seal>
              <div className="min-w-0">
                <p className="font-serif text-[19px] leading-tight font-semibold text-cream">
                  Bracket {data.bracket} · {data.name}
                </p>
                <p className="text-[14px] text-cream-dim first-letter:uppercase">{data.headline}</p>
              </div>
            </div>
            <ol className="grid grid-cols-5 gap-1" aria-label="escala de brackets">
              {data.brackets.map((b) => (
                <li
                  key={b.id}
                  title={`${b.id} · ${b.name}${b.fails.length ? ` — ${b.fails.join("; ")}` : ""}`}
                  className={cx(
                    "rounded-[3px] border px-1 py-1 text-center font-caps text-[12px] font-bold lowercase",
                    b.id === data.bracket ? "border-brass-400 bg-brass-400/15 text-brass-200" : b.fails.length ? "border-oak-700 text-cream-faint line-through decoration-wine-400/70" : "border-oak-700 text-cream-dim",
                  )}
                >
                  {b.id}
                </li>
              ))}
            </ol>
            {Object.entries(data.cards).map(([tag, names]) =>
              names.length ? (
                <div key={tag}>
                  <p className="mb-1 text-[13px] text-cream-faint">
                    {TAG_LABEL[tag] ?? tag} ({names.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {names.map((n) => (
                      <Tag key={n} tone={tag === "tutor" ? "neutral" : "brass"}>
                        {n}
                      </Tag>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
            {data.combos.two_card.length > 0 && (
              <div>
                <p className="mb-1 text-[13px] text-cream-faint">Combos de 2 cartas</p>
                <ul className="space-y-1 text-[14px] text-cream-dim">
                  {data.combos.two_card.map((c) => (
                    <li key={c.cards.join("+")}>
                      <span className="text-cream">{c.cards.join(" + ")}</span>
                      {c.produces.length ? <span className="text-cream-faint"> → {c.produces.slice(0, 2).join(", ")}</span> : null}
                      {c.arguable && <span className="text-cream-faint"> (discutível)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.reasons.length > 0 && (
              <details className="text-[14px] text-cream-faint">
                <summary className="cursor-pointer text-brass-300">por que não é mais baixo</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {data.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
            {data.notes.map((n) => (
              <p key={n} className="text-[13px] text-cream-faint">
                {n}
              </p>
            ))}
            {data.combos.checked && (
              <a href={data.combos.attribution_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-cream-faint hover:text-brass-300">
                {data.combos.attribution} <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
