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
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  if (!data) return <p className="glass px-4 py-8 text-center text-subhead text-mist-faint">{res.error ?? "Não consegui montar a lista de compras."}</p>;
  if (!data.buy.length && !data.decide.length && !data.fetch.length)
    return (
      <div className="glass">
        <EmptyState art={<Coins size={44} />} title="Nada para comprar">
          Você tem todas as cartas deste deck. As que estiverem em outro lugar aparecem na aba de cartas físicas.
        </EmptyState>
      </div>
    );

  return (
    <div className="space-y-5">
      {data.buy.length > 0 && (
        <section className="glass overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist/6 px-4 py-4">
            <div>
              <p className="text-headline font-semibold text-mist">Comprar ({data.buy.reduce((n, i) => n + i.quantity, 0)})</p>
              <p className="text-footnote text-mist-faint">
                Estimativa <Money brl={data.total_brl} className="font-semibold" /> · dólar {data.fx.rate.toFixed(2).replace(".", ",")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon={<Copy className="size-4" />} onClick={copy}>
                Copiar lista
              </Button>
              <a href={data.ligamagic_list_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                Compra por lista <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
          <ul className="divide-y divide-mist/6">
            {data.buy.map((item) => (
              <li key={item.oracle_id} className="flex items-center gap-3 px-4 py-2">
                {item.image_small ? <img src={item.image_small} alt="" loading="lazy" className="card-img h-12 w-[34px] object-cover" /> : <span className="h-12 w-[34px]" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-serif text-body text-mist">
                    {item.quantity > 1 && <span className="tabular text-mist-faint">{item.quantity}× </span>}
                    {item.name_pt || item.name}
                  </p>
                  {item.name_pt && item.name && item.name_pt !== item.name && <p className="truncate text-footnote text-mist-faint italic">{item.name}</p>}
                </div>
                <span className="text-right">
                  <Money brl={item.unit_brl === null ? null : item.unit_brl * item.quantity} className="block text-subhead font-semibold" />
                  {item.quantity > 1 && item.unit_brl !== null && <span className="block text-caption text-mist-faint">{brl(item.unit_brl)} cada</span>}
                </span>
                <a href={item.ligamagic_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-icon" title="Ver preços na LigaMagic" aria-label={`Ver ${item.name} na LigaMagic`}>
                  <ExternalLink className="size-4" />
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-mist/6 px-4 py-3 text-footnote text-mist-faint">
            <span>Preço da Scryfall convertido pelo PTAX; loja brasileira costuma variar.</span>
            <Button
              size="sm"
              variant="tertiary"
              icon={<RefreshCw className="size-4" />}
              busy={res.loading}
              onClick={() => setRefreshTick((n) => n + 1)}
            >
              Atualizar preços
            </Button>
          </div>
        </section>
      )}

      {data.decide.length > 0 && (
        <section className="glass overflow-hidden">
          <p className="panel-head text-ember-300">Você tem, mas estão em outro deck</p>
          <ul className="divide-y divide-mist/6">
            {data.decide.map((item) => (
              <li key={item.oracle_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="min-w-0 flex-1 truncate font-serif text-body text-mist">
                  {item.quantity > 1 && <span className="text-mist-faint">{item.quantity}× </span>}
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
          <p className="px-4 pt-1 pb-4 text-footnote text-mist-faint">Decida se tira do outro deck (aba Cartas físicas) ou compra outra cópia.</p>
        </section>
      )}

      {data.fetch.length > 0 && (
        <section className="glass overflow-hidden">
          <p className="panel-head text-astral-300">Buscar na coleção</p>
          <ul className="divide-y divide-mist/6">
            {data.fetch.map((item) => (
              <li key={item.oracle_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="min-w-0 flex-1 truncate font-serif text-body text-mist">
                  {item.quantity > 1 && <span className="text-mist-faint">{item.quantity}× </span>}
                  {item.name_pt || item.name}
                </span>
                <span className="text-footnote text-mist-faint">{item.from.join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
