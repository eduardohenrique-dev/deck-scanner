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
      className="group board relative flex flex-col overflow-hidden transition-transform duration-200 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
    >
      <div className="relative aspect-[16/9] overflow-hidden border-b border-brass-700/60 bg-oak-750">
        {art ? (
          <img src={art} alt="" loading="lazy" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
        ) : (
          <div className="grid h-full place-items-center font-display text-[40px] text-oak-600">{deck.name.slice(0, 1)}</div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-oak-950/90 to-transparent" />
        <div className="absolute bottom-2 left-3 flex items-center gap-2">
          <IdentityPips colors={deck.identity} size={17} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3.5 pt-2.5 pb-3">
        <h3 className="truncate font-serif text-[19px] leading-snug font-semibold text-cream group-hover:text-brass-200">{deck.name}</h3>
        <p className="truncate text-[14px] text-cream-faint">
          {deck.format_name ?? deck.format_id}
          {deck.commanders?.length ? ` · ${deck.commanders.join(" & ")}` : ""}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2 text-[13px] text-cream-dim">
          <span className="tabular">{deck.card_count} cartas</span>
          <span className="text-cream-faint">{relativeDay(deck.updated_at ?? deck.created_at)}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-oak-950" title={`${deck.physical_count ?? 0} cartas físicas registradas neste deck`}>
          <div className="h-full bg-brass-500" style={{ width: `${Math.round(physicalShare * 100)}%` }} />
        </div>
      </div>
    </Link>
  );
}
