import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { cardName } from "../../lib/format";
import type { CardSummary } from "../../lib/types";
import { ManaCost, Spinner } from "../ui";

export default function CardSearch({
  onPick,
  placeholder = "Buscar carta (português ou inglês)…",
  autoFocus,
}: {
  onPick: (card: CardSummary) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await api.search(term);
        if (mine === seq.current) {
          setResults(r);
          setActive(0);
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(t);
  }, [q]);

  function pick(card: CardSummary) {
    onPick(card);
    setQ("");
    setResults([]);
  }

  return (
    <div className="relative">
      <div className="flex h-10 items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 focus-within:border-accent">
        <Search className="size-4 text-faint" />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
            if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            if (e.key === "Enter" && results[active]) pick(results[active]);
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        />
        {loading && <Spinner />}
      </div>
      {results.length > 0 && (
        <ul className="scrollbar-thin absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-line bg-panel-2 shadow-xl shadow-black/40">
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                onClick={() => pick(c)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-2.5 py-2 text-left ${i === active ? "bg-panel-3" : ""}`}
              >
                {c.image_small ? <img src={c.image_small} className="h-11 w-8 rounded-sm object-cover" alt="" loading="lazy" /> : <div className="h-11 w-8 rounded-sm bg-panel-3" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{cardName(c)}</p>
                  <p className="truncate text-[12px] text-muted">
                    {c.name_pt && c.name_pt !== c.name_en ? `${c.name_en} · ` : ""}
                    {c.type_line}
                  </p>
                </div>
                <ManaCost cost={c.mana_cost} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
