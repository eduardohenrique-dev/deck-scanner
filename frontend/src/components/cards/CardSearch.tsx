import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useDebounced } from "../../lib/hooks";
import type { CardSummary } from "../../lib/types";
import { ArtThumb, ManaCost, SetSymbol } from "../mtg";
import { cx, Spinner } from "../ui";

/** Busca com autocomplete (nome em português ou inglês, sem acento, parcial). */
export default function CardSearch({
  onPick,
  autoFocus,
  placeholder = "Nome da carta (português ou inglês)",
  lang = "pt",
  className,
  dropUp,
}: {
  onPick: (card: CardSummary) => void;
  autoFocus?: boolean;
  placeholder?: string;
  lang?: string;
  className?: string;
  /** abre a lista para cima (campo encostado no rodapé da tela) */
  dropUp?: boolean;
}) {
  const place = dropUp ? "bottom-full mb-1" : "top-full mt-1";
  const [text, setText] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 220);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .search(query, lang, 12)
      .then((r) => {
        if (!cancelled) {
          setResults(r);
          setActive(0);
          setOpen(true);
        }
      })
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, lang]);

  function pick(card: CardSummary) {
    onPick(card);
    setText("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className={cx("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-mist-faint" />
        <input
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !results.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          className="field h-11 pr-10 pl-10"
        />
        {loading && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2" />}
      </div>
      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className={cx("glass-float scrollbar-thin absolute inset-x-0 z-30 max-h-80 overflow-y-auto p-1.5", place)}
        >
          {results.map((card, i) => (
            <li
              key={card.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(card);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx("flex min-h-12 cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5", i === active && "bg-mist/8")}
            >
              <ArtThumb card={card} size={46} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-serif text-body font-semibold text-mist">{card.name_pt || card.name_en}</span>
                  <ManaCost cost={card.mana_cost} size={14} />
                </span>
                <span className="block truncate text-footnote text-mist-faint">
                  {card.name_pt && card.name_pt !== card.name_en ? `${card.name_en} · ` : ""}
                  {card.type_line}
                </span>
              </span>
              <SetSymbol card={card} size={16} />
            </li>
          ))}
        </ul>
      )}
      {open && query.length >= 2 && !loading && results.length === 0 && (
        <p className={cx("glass-float absolute inset-x-0 z-30 px-4 py-3 text-footnote text-mist-faint", place)}>
          Nenhuma carta com esse nome.
        </p>
      )}
    </div>
  );
}
