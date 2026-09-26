import { ExternalLink } from "lucide-react";
import { cardName } from "../../lib/format";
import type { CardSummary, Fx, ValuedItem } from "../../lib/types";
import { Coins } from "../icons";
import { ArtThumb, Money } from "../mtg";
import { SectionTitle } from "../ui";

/** Valor estimado da lista e as cartas que pesam na balança. */
export default function ValueBox({
  value,
  valuable,
  cards,
}: {
  value: { total_usd: number; total_brl: number; fx: Fx; unpriced: number };
  valuable: ValuedItem[];
  cards: Map<string, CardSummary | null>;
}) {
  const rate = value.fx?.rate;
  return (
    <section className="space-y-3">
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <Coins size={20} className="text-arcane-300" /> Na balança
        </span>
      </SectionTitle>
      <div className="glass space-y-4 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <Money brl={value.total_brl} className="text-title-1 font-semibold tracking-[-0.02em]" />
          <span className="tabular text-footnote text-mist-faint">US$ {value.total_usd.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        {value.unpriced > 0 && <p className="text-footnote text-mist-faint">{value.unpriced === 1 ? "1 carta sem preço" : `${value.unpriced} cartas sem preço`} na Scryfall.</p>}
        {valuable.length > 0 && (
          <ul className="space-y-2">
            {valuable.slice(0, 6).map((item) => {
              const card = cards.get(item.card_ref_id);
              return (
                <li key={`${item.card_ref_id}-${item.finish}`} className="flex items-center gap-3">
                  <ArtThumb card={card} size={36} />
                  <span className="min-w-0 flex-1 truncate text-subhead text-mist">
                    {cardName(card)}
                    {item.quantity > 1 && <span className="text-mist-faint"> ×{item.quantity}</span>}
                    {item.finish === "foil" && <span className="text-astral-300"> foil</span>}
                  </span>
                  <Money brl={item.unit_brl} className="text-subhead font-semibold" />
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-caption leading-snug text-mist-faint">
          Estimativa: preço da Scryfall em dólar × PTAX {rate ? rate.toFixed(2).replace(".", ",") : "—"}. Para preço de loja,{" "}
          <a href="https://www.ligamagic.com.br/?view=cards/lista" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-arcane-300 hover:underline">
            LigaMagic <ExternalLink className="size-3" />
          </a>
          .
        </p>
      </div>
    </section>
  );
}
