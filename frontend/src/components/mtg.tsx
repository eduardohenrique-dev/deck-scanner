import { Sparkles } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { artCrop, cardName, CONDITION_NAME, confidenceTone, LANGUAGE_NAME, RARITY_COLOR, secondaryName } from "../lib/format";
import type { CardSummary, Condition } from "../lib/types";
import { cx, Seal, Tag } from "./ui";

/** Símbolos oficiais servidos pela Scryfall ({W/U} → WU.svg). */
export function ManaCost({ cost, size = 17, className }: { cost: string | null | undefined; size?: number; className?: string }) {
  if (!cost) return null;
  const symbols = cost.match(/\{[^}]+\}|\/\//g) ?? [];
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-[2px]", className)} aria-label={`custo ${cost}`}>
      {symbols.map((s, i) =>
        s === "//" ? (
          <span key={i} className="px-0.5 text-cream-faint">
            /
          </span>
        ) : (
          <img
            key={i}
            src={`https://svgs.scryfall.io/card-symbols/${s.slice(1, -1).replace(/\//g, "").toUpperCase()}.svg`}
            alt={s}
            width={size}
            height={size}
            loading="lazy"
            className="mana-symbol"
          />
        ),
      )}
    </span>
  );
}

export function IdentityPips({ colors, size = 16 }: { colors: string[] | undefined; size?: number }) {
  const list = colors && colors.length ? colors : ["C"];
  return (
    <span className="inline-flex items-center gap-[2px]" aria-label={`identidade ${list.join("")}`}>
      {list.map((c) => (
        <img key={c} src={`https://svgs.scryfall.io/card-symbols/${c}.svg`} alt={c} width={size} height={size} className="mana-symbol" />
      ))}
    </span>
  );
}

export function SetSymbol({ card, size = 18, className }: { card: CardSummary | null | undefined; size?: number; className?: string }) {
  if (!card) return null;
  const icon = card.set_icon || `https://svgs.scryfall.io/sets/${card.set_code}.svg`;
  const style = { width: size, height: size, "--icon": `url("${icon}")`, "--rarity": RARITY_COLOR[card.rarity] } as CSSProperties;
  return <span className={cx("set-icon shrink-0", className)} style={style} title={`${card.set_name} · ${card.rarity}`} role="img" aria-label={card.set_name} />;
}

export function PrintLabel({ card, className }: { card: CardSummary | null | undefined; className?: string }) {
  if (!card) return null;
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-footnote text-cream-faint", className)}>
      <SetSymbol card={card} size={15} />
      <span className="font-mono uppercase tracking-tight">{card.set_code}</span>
      <span className="tabular">#{card.collector_number}</span>
    </span>
  );
}

export function CardName({ card, className, sub = true }: { card: CardSummary | null | undefined; className?: string; sub?: boolean }) {
  const secondary = sub ? secondaryName(card) : null;
  return (
    <span className={cx("min-w-0", className)}>
      <span className="block truncate font-serif text-headline leading-tight font-semibold text-cream">{cardName(card)}</span>
      {secondary && <span className="block truncate text-footnote text-cream-faint italic">{secondary}</span>}
    </span>
  );
}

export function LanguagePill({ lang, uncertain }: { lang: string | null | undefined; uncertain?: boolean }) {
  const code = (lang || "en").toLowerCase();
  return (
    <Tag tone={uncertain ? "warn" : "neutral"} title={`${LANGUAGE_NAME[code] ?? code}${uncertain ? " (não confirmado pela imagem)" : ""}`} className="font-mono text-caption uppercase">
      {code}
      {uncertain && "?"}
    </Tag>
  );
}

export function FinishMark({ finish }: { finish: string | null | undefined }) {
  if (!finish || finish === "nonfoil") return null;
  return (
    <Tag tone="info" title={finish === "etched" ? "etched (foil gravado)" : "foil"}>
      <Sparkles className="size-3.5" />
      {finish}
    </Tag>
  );
}

export function ConditionBadge({ condition, estimate }: { condition?: string | null; estimate?: Condition | null }) {
  const grade = condition || (estimate && estimate.confidence >= 0.5 ? estimate.grade : null);
  if (!grade) return null;
  const estimated = !condition && !!estimate;
  const tone = grade === "NM" ? "ok" : grade === "SP" ? "neutral" : grade === "MP" ? "warn" : "bad";
  return (
    <Tag tone={tone} title={`${CONDITION_NAME[grade] ?? grade}${estimated ? ` — estimada pela foto (confiança ${Math.round((estimate?.confidence ?? 0) * 100)}%)` : ""}`}>
      {grade}
      {estimated && <span className="text-caption opacity-75">est.</span>}
    </Tag>
  );
}

export function ConfidenceSeal({ value, size = 26 }: { value: number | null | undefined; size?: number }) {
  const tone = confidenceTone(value);
  if (tone === "neutral") return null;
  const pct = Math.round((value ?? 0) * 100);
  return (
    <Seal tone={tone} size={size} title={`confiança ${pct}%`}>
      <span className="text-[10px]">{pct}</span>
    </Seal>
  );
}

/** Imagem oficial com cantos de carta; enquanto carrega mostra o verso gasto (sem saltos de layout). */
export function CardImage({ card, src, alt, className, eager }: { card?: CardSummary | null; src?: string | null; alt?: string; className?: string; eager?: boolean }) {
  const url = src ?? card?.image_normal ?? card?.faces?.[0]?.image_normal ?? null;
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={cx("card-img relative aspect-[488/680] overflow-hidden bg-oak-800 ring-1 ring-black/60", className)}>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-[linear-gradient(135deg,var(--color-oak-750),var(--color-oak-850))]" />}
      {url && (
        <img
          src={url}
          alt={alt ?? cardName(card)}
          loading={eager ? "eager" : "lazy"}
          onLoad={() => setLoaded(true)}
          className={cx("absolute inset-0 h-full w-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")}
        />
      )}
    </div>
  );
}

export function ArtThumb({ card, className, size = 44 }: { card: CardSummary | null | undefined; className?: string; size?: number }) {
  const url = artCrop(card);
  return (
    <span
      className={cx("inline-block shrink-0 overflow-hidden rounded-xs bg-oak-750 ring-1 ring-brass-700/60", className)}
      style={{ width: size, height: Math.round(size * 0.73) }}
    >
      {url && <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />}
    </span>
  );
}

export function Money({ brl, className, muted }: { brl: number | null | undefined; className?: string; muted?: boolean }) {
  if (brl === null || brl === undefined) return <span className={cx("text-cream-faint", className)}>—</span>;
  return (
    <span className={cx("tabular whitespace-nowrap", muted ? "text-cream-faint" : "text-brass-200", className)}>
      {brl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
    </span>
  );
}
