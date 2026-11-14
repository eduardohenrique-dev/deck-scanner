import { LogIn, LogOut, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandMark, Crown } from "../components/icons";
import RoundTimer from "../components/tournament/RoundTimer";
import StandingsTable from "../components/tournament/StandingsTable";
import { Board, Button, cx, Spinner, Tag } from "../components/ui";
import { api, ApiError, type PublicTournament as Data } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Link, useLocation } from "../lib/router";
import { toastError } from "../lib/toast";
import { champions, currentRound, isDraft, plannedRounds } from "../tournament/engine.ts";
import { isPodTournament, standings } from "../tournament/standings.ts";
import type { Round, Tournament } from "../tournament/types.ts";
import Login from "./Login";

/**
 * Página do link público do torneio: abre sem login. Antes do início, mostra os inscritos e deixa a
 * pessoa se inscrever com a própria conta; depois, o relógio da rodada, a mesa dela em destaque
 * (pela conta ou pelo `?j=` do link do Telegram), todas as mesas e a classificação.
 */
export default function PublicTournament({ token }: { token: string }) {
  const auth = useAuth();
  const { query } = useLocation();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const signedIn = auth.status === "signed-in" || auth.status === "local";

  const load = async (fresh = false) => {
    try {
      const rec = await api.publicTournament(token, fresh ? undefined : version.current || undefined);
      if (!rec) return;
      version.current = rec.version;
      setData(rec);
      setError(null);
    } catch (e) {
      if (!version.current) setError(e instanceof ApiError && e.status === 404 ? "Este link de torneio não existe ou foi apagado." : String((e as Error).message));
    }
  };

  useEffect(() => {
    void load(true);
    // a cada 2 s: quando o organizador dá o start, o relógio começa aqui quase junto
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(), 2000);
    const back = () => document.visibilityState === "visible" && void load(true);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // quem entrou agora volta a ver a página como ele mesmo (com a mesa destacada)
  useEffect(() => {
    if (auth.status !== "loading") void load(true);
    if (signedIn && loggingIn) {
      setLoggingIn(false);
      void join();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status]);

  async function join() {
    if (!signedIn) return setLoggingIn(true);
    setBusy(true);
    try {
      await api.joinTournament(token);
      await load(true);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await api.leaveTournament(token);
      await load(true);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  if (loggingIn && auth.status === "signed-out") return <Login warning="Entre ou crie a sua conta para se inscrever no torneio." />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-5 pb-16 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Deck Scanner">
          <BrandMark size={28} />
          <span className="font-brand text-title-3 leading-none font-extrabold tracking-[0.02em] text-mist uppercase">Deck Scanner</span>
        </Link>
        {auth.status === "signed-in" && (
          <Link to="/conta" className="max-w-40 truncate text-footnote font-semibold text-mist-dim underline-offset-2 hover:underline">
            {auth.user.name || auth.user.email}
          </Link>
        )}
      </header>
      {error ? (
        <Board className="p-6 text-center text-body text-mist-dim">{error}</Board>
      ) : !data ? (
        <div className="grid flex-1 place-items-center">
          <Spinner className="size-7" />
        </div>
      ) : (
        <Body t={data.doc} me={data.me ?? query.get("j")} mine={!!data.me} signedIn={signedIn} busy={busy} onJoin={join} onLeave={leave} />
      )}
    </div>
  );
}

function Body({ t, me, mine, signedIn, busy, onJoin, onLeave }: { t: Tournament; me: string | null; mine: boolean; signedIn: boolean; busy: boolean; onJoin: () => void; onLeave: () => void }) {
  const players = useMemo(() => new Map(t.players.map((p) => [p.id, p])), [t.players]);
  const name = (id: string) => players.get(id)?.name ?? "?";
  const round = currentRound(t);
  const pods = isPodTournament(t) || t.structure.kind === "pods";
  const table = useMemo(() => (t.rounds.length ? standings(t) : []), [t]);
  const won = champions(t);
  const draft = isDraft(t);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="slant">{draft ? "Inscrições abertas" : t.finishedAt ? "Encerrado" : t.tiebreak ? "Mesa final" : round ? `Rodada ${round.number} de ${plannedRounds(t)}` : "Em andamento"}</p>
        <h1 className="tilt font-display text-title-2 font-semibold text-mist sm:text-display">{t.name}</h1>
        {t.gameFormat && <p className="text-subhead text-mist-dim">{t.gameFormat}</p>}
      </div>

      {won.length > 0 && (
        <Board className="flex items-center gap-4 p-5">
          <Crown size={36} className="shrink-0 text-gold-300" />
          <div>
            <p className="eyebrow">{won.length > 1 ? "Campeões" : "Campeão"}</p>
            <p className="font-display text-title-1 text-mist">{won.map(name).join(" e ")}</p>
          </div>
        </Board>
      )}

      {draft && (
        <Board className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-headline text-mist">{t.players.length === 1 ? "1 inscrito" : `${t.players.length} inscritos`}</p>
            {mine ? (
              <div className="flex items-center gap-2">
                <Tag tone="ok">Você está inscrito</Tag>
                <Button size="sm" variant="ghost" icon={<LogOut className="size-4" />} onClick={onLeave} busy={busy}>
                  Sair
                </Button>
              </div>
            ) : (
              <Button variant="primary" icon={signedIn ? <UserPlus className="size-4" /> : <LogIn className="size-4" />} onClick={onJoin} busy={busy}>
                {signedIn ? "Entrar no torneio" : "Entrar com a minha conta"}
              </Button>
            )}
          </div>
          {mine && (
            <p className="text-footnote text-mist-dim">
              Para receber a sua mesa no Telegram a cada rodada, conecte o Telegram na sua{" "}
              <Link to="/conta" className="font-semibold text-area-soft underline underline-offset-2">
                conta
              </Link>
              .
            </p>
          )}
          <ul className="flex flex-wrap gap-2">
            {t.players.map((p) => (
              <li key={p.id} className={cx("chip chip-pill", p.id === me && "!bg-area !text-area-ink")}>
                {p.name}
              </li>
            ))}
          </ul>
        </Board>
      )}

      {!draft && !t.finishedAt && (t.tiebreak ? <FinalTable t={t} me={me} name={name} /> : round && <RoundView t={t} round={round} me={me} name={name} pods={pods} />)}

      {table.length > 0 && (
        <section className="space-y-3">
          <h2 className="slant !text-title-3 !leading-7">Classificação</h2>
          <StandingsTable rows={table} players={players} compact variant={pods ? "pods" : "duel"} />
        </section>
      )}
    </div>
  );
}

/** No celular o relógio grande não cabe ao lado do título. */
const wideScreen = () => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;

type Seats = { table: number | null; ids: string[] };

function seatsOf(round: Round): Seats[] {
  const out: Seats[] = [
    ...(round.pods ?? []).map((p) => ({ table: p.table, ids: p.players })),
    ...round.matches.map((m) => ({ table: m.b ? m.table : null, ids: m.b ? [m.a, m.b] : [m.a] })),
  ];
  return out.sort((a, b) => (a.table ?? 1e9) - (b.table ?? 1e9));
}

function RoundView({ t, round, me, name, pods }: { t: Tournament; round: Round; me: string | null; name: (id: string) => string; pods: boolean }) {
  const all = seatsOf(round);
  const mine = me ? all.find((s) => s.ids.includes(me)) : undefined;
  return (
    <>
      <Board className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="eyebrow">Relógio da rodada</p>
          {!round.timer.startedAt && <p className="mt-1 text-subhead text-mist-dim">Parado. Começa em todas as mesas quando o organizador der o start.</p>}
          {round.timer.pausedAt && <p className="mt-1 text-subhead text-mist-dim">Pausado pelo organizador.</p>}
        </div>
        <RoundTimer round={round} minutes={t.settings.roundMinutes} size={wideScreen() ? "xl" : "md"} overNote={pods ? "Tempo! Quem está no turno termina; sem vencedor, é empate" : undefined} />
      </Board>
      {mine && (
        <Board className="space-y-2 p-5" data-area="scan">
          <p className="eyebrow">Sua mesa</p>
          <p className="font-display text-title-1 text-mist">{mine.table === null ? "Folga nesta rodada" : `Mesa ${mine.table}`}</p>
          {mine.table !== null && (
            <ol className="space-y-1 text-headline text-mist-dim">
              {mine.ids.map((id, i) => (
                <li key={id} className={cx(id === me && "font-semibold text-mist")}>
                  {pods ? `${i + 1}º · ` : ""}
                  {name(id)}
                  {id === me ? " (você)" : ""}
                </li>
              ))}
            </ol>
          )}
          {pods && mine.table !== null && <p className="text-footnote text-mist-faint">A ordem da lista é a ordem de jogo.</p>}
        </Board>
      )}
      <section className="space-y-3">
        <h2 className="slant !text-title-3 !leading-7">Mesas</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {all.map((s, i) => {
            const result = s.table === null ? null : round.pods?.find((p) => p.table === s.table)?.result ?? round.matches.find((m) => m.table === s.table)?.result;
            return (
              <Board key={i} className={cx("overflow-hidden", me && s.ids.includes(me) && "ring-2 ring-area")}>
                <div className="band">
                  <span>{s.table === null ? "Folga" : `Mesa ${s.table}`}</span>
                  {result ? <span className="tabular text-caption normal-case">lançada</span> : null}
                </div>
                <ul className="px-4 py-2 text-subhead">
                  {s.ids.map((id) => (
                    <li key={id} className={cx("py-1", id === me ? "font-semibold text-mist" : "text-mist-dim")}>
                      {name(id)}
                    </li>
                  ))}
                </ul>
              </Board>
            );
          })}
        </div>
      </section>
    </>
  );
}

function FinalTable({ t, me, name }: { t: Tournament; me: string | null; name: (id: string) => string }) {
  const pod = t.tiebreak!;
  return (
    <Board className="space-y-3 p-5">
      <p className="eyebrow">Mesa final · sem tempo limite</p>
      <ol className="space-y-1 text-headline">
        {pod.players.map((id, i) => (
          <li key={id} className={cx(id === me ? "font-semibold text-mist" : "text-mist-dim")}>
            {i + 1}º · {name(id)}
            {id === me ? " (você)" : ""}
          </li>
        ))}
      </ol>
      <p className="text-footnote text-mist-faint">Começa quem está em primeiro na lista.</p>
    </Board>
  );
}
