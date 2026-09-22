import { Link } from "../../lib/router";
import type { Deck } from "../../lib/types";
import { relativeDay } from "../../lib/format";
import { IdentityPips } from "../mtg";

/** Deck como um tomo na estante: arte do comandante no alto, nome em serifa, identidade e contagem. */
export default function DeckTome({ deck }: { deck: Deck }) {
  const art = deck.cover?.image_normal?.replace("/normal/", "/art_crop/");
  const physicalShare = deck.card_count ? Math.min(1, (deck.physical_count ?? 0) / deck.card_count) : 0;
  return (
    <Link
      to={`/decks/${deck.id}`}
      className="group glass relative flex flex-col overflow-hidden transition-transform duration-500 ease-spring hover:-translate-y-1 focus-visible:-translate-y-1 active:scale-[0.98] active:duration-100"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-oak-750">
        {art ? (
          <img src={art} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]" />
        ) : (
          <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_50%_40%,rgb(235_198_116/0.12),transparent_70%)] font-display text-display text-brass-700">{deck.name.slice(0, 1)}</div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-oak-950/90 via-oak-950/35 to-transparent" />
        <div className="absolute bottom-2 left-3 flex items-center gap-2">
          <IdentityPips colors={deck.identity} size={17} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-4 pt-3 pb-4">
        <h3 className="truncate font-serif text-headline font-semibold text-cream group-hover:text-brass-100">{deck.name}</h3>
        <p className="truncate text-footnote text-cream-faint">
          {deck.format_name ?? deck.format_id}
          {deck.commanders?.length ? ` · ${deck.commanders.join(" & ")}` : ""}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2 text-footnote text-cream-dim">
          <span className="tabular">{deck.card_count} cartas</span>
          <span className="text-cream-faint">{relativeDay(deck.updated_at ?? deck.created_at)}</span>
        </div>
        <div className="well mt-1 h-1.5 overflow-hidden rounded-full" title={`${deck.physical_count ?? 0} cartas físicas registradas neste deck`}>
          <div className="h-full rounded-full bg-[linear-gradient(180deg,var(--color-brass-200),var(--color-brass-400))]" style={{ width: `${Math.round(physicalShare * 100)}%` }} />
        </div>
      </div>
    </Link>
  );
}
