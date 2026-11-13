import { ArrowRight, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import DeckTome from "../components/deck/DeckTome";
import { Candle, Chest, Goblet, Lens, Scales, Tome } from "../components/icons";
import { progressLine } from "../components/tournament/labels";
import { ArtThumb, Money } from "../components/mtg";
import SessionRow from "../components/scan/SessionRow";
import { Board, Button, cx, EmptyState, LINK, SectionTitle, Skeleton, Tag } from "../components/ui";
import { api } from "../lib/api";
import { cardName, plural } from "../lib/format";
import { useResource } from "../lib/hooks";
import { Link, navigate } from "../lib/router";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default function Home({ name }: { name?: string | null }) {
  const sessions = useResource(() => api.sessions(), []);
  const decks = useResource(() => api.decks(), []);
  const summary = useResource(() => api.collectionSummary(), []);
  const tournaments = useResource(() => api.tournaments(), []);
  const live = (tournaments.data ?? []).find((t) => t.status === "running");
  const topIds = (summary.data?.top ?? []).map((t) => t.card_ref_id);
  const topCards = useResource(async () => Promise.all(topIds.slice(0, 4).map((id) => api.card(id))), [topIds.slice(0, 4).join(",")]);

  const loading = sessions.loading || decks.loading;
  const firstVisit = !loading && !sessions.data?.length && !decks.data?.length;
  const cards = summary.data?.total ?? 0;

  const actions = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <ActionTile primary area="scan" icon={<Lens size={24} />} title="Escanear um deck" text="Câmera, fotos ou vídeo: a lista sai pronta." onClick={() => navigate("/escanear")} />
      <ActionTile area="decks" icon={<Scales size={24} />} title="Conferir um deck" text="Bater o baralho com a lista salva." onClick={() => navigate("/escanear?finalidade=conferir")} />
      <ActionTile area="collection" icon={<Chest size={24} />} title="Guardar cartas" text="Registrar na pasta, na caixa ou solto." onClick={() => navigate("/escanear?finalidade=colecao")} />
      <ActionTile area="tournament" icon={<Goblet size={24} />} title="Organizar um torneio" text="Suíço, corte e mata-mata, com desempates." onClick={() => navigate("/torneios")} />
    </div>
  );

  if (firstVisit)
    return (
      <div className="space-y-10">
        <section className="max-w-3xl space-y-5 pt-2">
          <p className="slant">a mesa está posta</p>
          <h1 className="font-display text-display font-semibold text-mist sm:text-hero">
            Espalhe as cartas.
            <br />
            <span className="text-area-soft">A taverna anota.</span>
          </h1>
          <p className="max-w-xl text-body text-mist-dim">
            Folheie o baralho diante da câmera ou fotografe a mesa. A lista sai pronta para LigaMagic, Moxfield e Arena, e cada carta física fica registrada no deck, na pasta ou na caixa onde está.
          </p>
        </section>
        {actions}
        <Board>
          <EmptyState
            art={<Candle size={44} />}
            title="Primeira rodada por conta da casa"
            action={
              <Button variant="primary" onClick={() => navigate("/escanear")} iconRight={<ArrowRight className="size-4" />}>
                Escanear o primeiro deck
              </Button>
            }
          >
            Separe um deck, boa luz e um fundo liso. Com a câmera ao vivo, passe uma carta por vez e segure meio segundo: um bipe confirma cada leitura.
          </EmptyState>
        </Board>
      </div>
    );

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0 space-y-1">
          <p className="slant">{greeting()}</p>
          <h1 className="tilt max-w-full truncate pr-2 font-display text-title-2 font-semibold text-mist sm:text-display">{name || "Início"}</h1>
        </div>
        {cards > 0 && (
          <dl className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:min-w-[26rem]">
            <Stat label="Cartas" value={summary.data ? cards.toLocaleString("pt-BR") : null} />
            <Stat label="Decks" value={decks.data ? String(decks.data.length) : null} />
            <Stat label="Valor" value={summary.data ? <Money brl={summary.data.value.total_brl} /> : null} />
          </dl>
        )}
      </header>

      {live && (
        <Link to={`/torneios/${live.id}`} data-area="tournament" className="pop group glass flex items-center gap-4 border-l-[3px] border-l-area px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center text-area-soft">
            <Goblet size={24} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-headline font-semibold text-mist group-hover:text-mist">{live.name}</span>
              <Tag tone="live">Em andamento</Tag>
            </span>
            <span className="block truncate text-footnote text-mist-faint">{progressLine({ ...live.summary, status: live.status })}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-mist-faint group-hover:text-area-soft" />
        </Link>
      )}

      {actions}

      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="min-w-0">
          <SectionTitle aside={<Link to="/escanear" className={LINK}>Novo scan</Link>}>Últimas mesas</SectionTitle>
          <Board className="mt-3 p-1.5">
            {sessions.loading ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : sessions.data?.length ? (
              <ul>
                {sessions.data.slice(0, 6).map((s) => (
                  <SessionRow key={s.id} session={s} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-subhead text-mist-faint">Nenhum scan ainda. As mesas que você abrir aparecem aqui.</p>
            )}
          </Board>
        </section>

        <div className="min-w-0 space-y-10">
          <section>
            <SectionTitle aside={<Link to="/decks" className={LINK}>{decks.data ? plural(decks.data.length, "deck", "decks") : "Decks"}</Link>}>Na estante</SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {decks.loading
                ? [0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[4/3.6] rounded-lg" />)
                : decks.data?.slice(0, 6).map((d) => <DeckTome key={d.id} deck={d} />)}
              {!decks.loading && !decks.data?.length && (
                <Link to="/escanear" className="glass col-span-full flex items-center gap-4 px-5 py-5 text-mist-dim transition-colors hover:text-mist">
                  <Tome size={28} className="shrink-0 text-area-soft" />
                  <span className="min-w-0 flex-1 text-subhead">Os decks que você salvar a partir de um scan ficam aqui, com versões e cartas físicas.</span>
                  <ChevronRight className="size-5 shrink-0 text-mist-faint" />
                </Link>
              )}
            </div>
          </section>

          {cards > 0 && (
            <section>
              <SectionTitle aside={<Link to="/colecao" className={LINK}>Abrir coleção</Link>}>Mais valiosas</SectionTitle>
              <Board className="mt-3 p-1.5">
                {topCards.data?.length ? (
                  <ul>
                    {topCards.data.map((card, i) => (
                      <li key={card.id} className="flex items-center gap-3 rounded-md px-3 py-2">
                        <ArtThumb card={card} size={44} />
                        <span className="min-w-0 flex-1 truncate font-serif text-headline font-semibold text-mist">{cardName(card)}</span>
                        <Money brl={summary.data?.top[i]?.unit_brl} className="text-subhead font-semibold" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-2 p-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                )}
              </Board>
              {summary.data?.value.fx && (
                <p className="mt-2 px-1 text-caption text-mist-faint">
                  Estimativa pela Scryfall (USD) × dólar PTAX {summary.data.value.fx.rate.toFixed(2).replace(".", ",")}. Preço de loja: LigaMagic.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionTile({ icon, title, text, onClick, primary, area }: { icon: ReactNode; title: string; text: string; onClick: () => void; primary?: boolean; area: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-area={primary ? undefined : area}
      className={cx(
        "pop group relative flex items-center gap-4 px-4 py-4 text-left sm:flex-col sm:items-start sm:gap-3 sm:px-5 sm:py-5 sm:odd:-rotate-[0.7deg] sm:even:rotate-[0.7deg]",
        primary ? "rounded-lg border-2 border-night-950 bg-white shadow-[var(--hard)]" : "glass border-t-[3px] border-t-area",
      )}
    >
      <span className={cx("grid size-10 shrink-0 place-items-center", primary ? "text-ink-900" : "text-area-soft")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cx("block font-caps text-title-3 leading-6 tracking-[0.03em] uppercase", primary ? "text-ink-900" : "text-mist")}>{title}</span>
        <span className={cx("mt-0.5 block text-footnote", primary ? "text-ink-700" : "text-mist-faint")}>{text}</span>
      </span>
      <ChevronRight className={cx("size-5 shrink-0 sm:hidden", primary ? "text-ink-700" : "text-mist-faint")} />
    </button>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode | null }) {
  return (
    <div className="well px-4 py-3">
      <dt className="eyebrow !text-mist-faint">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-title-3 font-semibold text-mist">{value ?? <Skeleton className="mt-1 h-6 w-14" />}</dd>
    </div>
  );
}
