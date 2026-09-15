import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import DeckTome from "../components/deck/DeckTome";
import { Candle, Chest, Coins, Lens, Scales, Tome } from "../components/icons";
import { ArtThumb, Money } from "../components/mtg";
import SessionRow from "../components/scan/SessionRow";
import { Board, Button, EmptyState, SectionTitle, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { plural } from "../lib/format";
import { useResource } from "../lib/hooks";
import { Link, navigate } from "../lib/router";

export default function Home() {
  const sessions = useResource(() => api.sessions(), []);
  const decks = useResource(() => api.decks(), []);
  const summary = useResource(() => api.collectionSummary(), []);
  const topIds = (summary.data?.top ?? []).map((t) => t.card_ref_id);
  const topCards = useResource(async () => Promise.all(topIds.slice(0, 4).map((id) => api.card(id))), [topIds.slice(0, 4).join(",")]);

  const firstVisit = !sessions.loading && !decks.loading && !sessions.data?.length && !decks.data?.length;

  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="kicker text-[14px]">a mesa está posta</p>
            <h1 className="font-display text-[40px] leading-[1.02] font-semibold text-cream sm:text-[52px]">
              Espalhe as cartas.
              <br />
              <span className="text-brass-300">A taverna anota.</span>
            </h1>
            <p className="max-w-xl text-[17px] text-cream-dim">
              Folheie o baralho diante da câmera ou fotografe a mesa. A lista sai pronta para LigaMagic, Moxfield e Arena, e cada carta física fica registrada
              no deck, na pasta ou na caixa onde está.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <ActionPlaque
              icon={<Lens size={26} />}
              title="Escanear"
              text="montar a lista de um deck"
              onClick={() => navigate("/escanear")}
              primary
            />
            <ActionPlaque icon={<Scales size={26} />} title="Conferir" text="bater o baralho com a lista salva" onClick={() => navigate("/escanear?finalidade=conferir")} />
            <ActionPlaque icon={<Chest size={26} />} title="Guardar" text="colocar cartas na coleção" onClick={() => navigate("/escanear?finalidade=colecao")} />
          </div>
        </div>

        <Board className="flex flex-col p-5">
          <SectionTitle aside={<Link to="/colecao" className="text-[14px] text-brass-300 hover:underline">abrir coleção</Link>}>
            o balcão
          </SectionTitle>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="cartas" value={summary.data ? summary.data.total.toLocaleString("pt-BR") : null} />
            <Stat label="decks" value={decks.data ? String(decks.data.length) : null} />
            <Stat label="valor" value={summary.data ? <Money brl={summary.data.value.total_brl} /> : null} />
          </div>
          <div className="mt-5 flex-1">
            <p className="mb-2 flex items-center gap-2 text-[14px] text-cream-faint">
              <Coins size={16} /> cartas mais valiosas
            </p>
            {topCards.data?.length ? (
              <ul className="space-y-1.5">
                {topCards.data.map((card, i) => (
                  <li key={card.id} className="flex items-center gap-3">
                    <ArtThumb card={card} size={40} />
                    <span className="min-w-0 flex-1 truncate font-serif text-[16px] text-cream">{card.name_pt || card.name_en}</span>
                    <Money brl={summary.data?.top[i]?.unit_brl} className="text-[15px]" />
                  </li>
                ))}
              </ul>
            ) : summary.loading ? (
              <div className="space-y-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : (
              <p className="text-[15px] text-cream-faint">Quando você guardar cartas na coleção, as mais valiosas aparecem aqui.</p>
            )}
          </div>
          {summary.data?.value.fx && (
            <p className="mt-4 text-[12px] text-cream-faint">
              Estimativa pela Scryfall (USD) × dólar PTAX {summary.data.value.fx.rate.toFixed(2).replace(".", ",")}. Preço real de loja: LigaMagic.
            </p>
          )}
        </Board>
      </section>

      {firstVisit ? (
        <Board className="p-2">
          <EmptyState art={<Candle size={52} />} title="Primeira rodada por conta da casa" action={<Button variant="brass" onClick={() => navigate("/escanear")} iconRight={<ArrowRight className="size-4" />}>Escanear o primeiro deck</Button>}>
            Separe um deck, boa luz e um fundo liso. Com a câmera ao vivo, passe uma carta por vez e segure meio segundo. Um bipe confirma cada leitura.
          </EmptyState>
        </Board>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <section>
            <SectionTitle aside={<Link to="/escanear" className="text-[14px] text-brass-300 hover:underline">novo scan</Link>}>últimas mesas</SectionTitle>
            <Board className="mt-3 p-1.5">
              {sessions.loading ? (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : sessions.data?.length ? (
                <ul>{sessions.data.slice(0, 6).map((s) => <SessionRow key={s.id} session={s} />)}</ul>
              ) : (
                <p className="px-3 py-6 text-center text-cream-faint">Nenhum scan ainda.</p>
              )}
            </Board>
          </section>
          <section>
            <SectionTitle aside={<Link to="/decks" className="text-[14px] text-brass-300 hover:underline">{decks.data ? plural(decks.data.length, "deck", "decks") : "decks"}</Link>}>
              na estante
            </SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {decks.loading
                ? [0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[4/3.6]" />)
                : decks.data?.slice(0, 6).map((d) => <DeckTome key={d.id} deck={d} />)}
              {!decks.loading && !decks.data?.length && (
                <div className="col-span-full flex items-center gap-3 rounded-[6px] border border-dashed border-oak-600 px-4 py-6 text-cream-dim">
                  <Tome size={28} className="text-brass-500" />
                  <span>Os decks que você salvar a partir de um scan ficam aqui, com versões e cartas físicas.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ActionPlaque({ icon, title, text, onClick, primary }: { icon: ReactNode; title: string; text: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={
        primary
          ? "group flex flex-col items-start gap-2 rounded-[6px] border border-brass-700 bg-[linear-gradient(180deg,var(--color-brass-300),var(--color-brass-500))] px-4 py-3.5 text-left text-ink-900 shadow-[inset_0_1px_0_rgb(255_244_210/0.55),0_2px_0_rgb(0_0_0/0.5)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
          : "group board flex flex-col items-start gap-2 px-4 py-3.5 text-left transition-transform hover:-translate-y-0.5 hover:border-brass-600 active:translate-y-0"
      }
    >
      <span className={primary ? "text-ink-700" : "text-brass-300"}>{icon}</span>
      <span className={`font-caps text-[20px] leading-none font-bold lowercase tracking-[0.03em] ${primary ? "" : "text-cream group-hover:text-brass-200"}`}>{title}</span>
      <span className={`text-[14px] leading-snug ${primary ? "text-ink-700" : "text-cream-faint"}`}>{text}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode | null }) {
  return (
    <div className="board-sunken px-3 py-2.5">
      <div className="font-caps text-[13px] font-bold lowercase tracking-[0.05em] text-cream-faint">{label}</div>
      <div className="tabular mt-0.5 truncate font-serif text-[23px] leading-tight font-semibold text-cream">{value ?? <Skeleton className="mt-1 h-6 w-14" />}</div>
    </div>
  );
}
