import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { brl } from "../../lib/format";
import { useResource } from "../../lib/hooks";
import { toast, toastError } from "../../lib/toast";
import { Coins } from "../icons";
import { Money } from "../mtg";
import { Button, EmptyState, Skeleton, Tag } from "../ui";

/** O que falta para montar o deck fisicamente: quanto custa, onde buscar e o texto pronto para a LigaMagic. */
export default function ShoppingPanel({ deckId, refreshKey }: { deckId: string; refreshKey: string }) {
  const [refreshTick, setRefreshTick] = useState(0);
  const res = useResource(() => api.shoppingList(deckId, refreshTick > 0), [deckId, refreshKey, refreshTick]);
  const data = res.data;

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.ligamagic_list_text);
      toast("Lista copiada — cole na Compra por Lista da LigaMagic");
    } catch {
      toastError(new Error("Não consegui copiar; selecione o texto e copie manualmente"));
    }
  }

  if (res.loading && !data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  if (!data) return <p className="board px-4 py-6 text-cream-faint">{res.error ?? "Não consegui montar a lista de compras."}</p>;
  if (!data.buy.length && !data.decide.length && !data.fetch.length)
    return (
      <div className="board">
        <EmptyState art={<Coins size={46} />} title="Nada para comprar">
          Você tem todas as cartas deste deck. As que estiverem em outro lugar aparecem na aba de cartas físicas.
        </EmptyState>
      </div>
    );

  return (
    <div className="space-y-5">
      {data.buy.length > 0 && (
        <section className="board overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-oak-700 px-4 py-3">
            <div>
              <p className="font-caps text-[15px] font-bold lowercase tracking-[0.04em] text-brass-300">comprar ({data.buy.reduce((n, i) => n + i.quantity, 0)})</p>
              <p className="text-[14px] text-cream-faint">
                estimativa <Money brl={data.total_brl} className="font-semibold" /> · dólar {data.fx.rate.toFixed(2).replace(".", ",")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="brass" icon={<Copy className="size-4" />} onClick={copy}>
                copiar lista
              </Button>
              <a
                href={data.ligamagic_list_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-[5px] border border-brass-600/80 px-3 font-caps text-[14px] font-bold lowercase tracking-[0.03em] text-brass-300 hover:bg-brass-400/10"
              >
                compra por lista <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
          <ul className="divide-y divide-oak-700/70">
            {data.buy.map((item) => (
              <li key={item.oracle_id} className="flex items-center gap-3 px-4 py-2">
                {item.image_small ? <img src={item.image_small} alt="" loading="lazy" className="card-img h-12 w-[34px] object-cover" /> : <span className="h-12 w-[34px]" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-serif text-[16px] text-cream">
                    {item.quantity > 1 && <span className="tabular text-cream-faint">{item.quantity}× </span>}
                    {item.name_pt || item.name}
                  </p>
                  {item.name_pt && item.name && item.name_pt !== item.name && <p className="truncate text-[13px] text-cream-faint italic">{item.name}</p>}
                </div>
                <span className="text-right">
                  <Money brl={item.unit_brl === null ? null : item.unit_brl * item.quantity} className="block text-[15px]" />
                  {item.quantity > 1 && item.unit_brl !== null && <span className="block text-[12px] text-cream-faint">{brl(item.unit_brl)} cada</span>}
                </span>
                <a href={item.ligamagic_url} target="_blank" rel="noreferrer" className="grid size-9 place-items-center rounded-[5px] text-cream-faint hover:bg-oak-700 hover:text-brass-300" title="Ver preços na LigaMagic" aria-label={`Ver ${item.name} na LigaMagic`}>
                  <ExternalLink className="size-4" />
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-oak-700 px-4 py-2.5 text-[13px] text-cream-faint">
            <span>Preço da Scryfall convertido pelo PTAX; loja brasileira costuma variar.</span>
            <Button
              size="xs"
              variant="ghost"
              icon={<RefreshCw className="size-3.5" />}
              busy={res.loading}
              onClick={() => setRefreshTick((n) => n + 1)}
            >
              atualizar preços
            </Button>
          </div>
        </section>
      )}

      {data.decide.length > 0 && (
        <section className="board overflow-hidden">
          <p className="border-b border-oak-700 px-4 py-3 font-caps text-[15px] font-bold lowercase tracking-[0.04em] text-amber-300">
            você tem, mas estão em outro deck
          </p>
          <ul className="divide-y divide-oak-700/70">
            {data.decide.map((item) => (
              <li key={item.oracle_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="min-w-0 flex-1 truncate font-serif text-[16px] text-cream">
                  {item.quantity > 1 && <span className="text-cream-faint">{item.quantity}× </span>}
                  {item.name_pt || item.name}
                </span>
                {item.decks.map((d) => (
                  <Tag key={d} tone="warn">
                    {d}
                  </Tag>
                ))}
              </li>
            ))}
          </ul>
          <p className="px-4 pb-3 text-[13px] text-cream-faint">Decida se tira do outro deck (aba cartas físicas) ou compra outra cópia.</p>
        </section>
      )}

      {data.fetch.length > 0 && (
        <section className="board overflow-hidden">
          <p className="border-b border-oak-700 px-4 py-3 font-caps text-[15px] font-bold lowercase tracking-[0.04em] text-steel-300">buscar na coleção</p>
          <ul className="divide-y divide-oak-700/70">
            {data.fetch.map((item) => (
              <li key={item.oracle_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="min-w-0 flex-1 truncate font-serif text-[16px] text-cream">
                  {item.quantity > 1 && <span className="text-cream-faint">{item.quantity}× </span>}
                  {item.name_pt || item.name}
                </span>
                <span className="text-[14px] text-cream-faint">{item.from.join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
