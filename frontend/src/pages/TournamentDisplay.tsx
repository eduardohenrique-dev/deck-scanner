import { ChevronLeft, ChevronRight, Maximize, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import BracketBoard from "../components/tournament/BracketBoard";
import RoundTimer from "../components/tournament/RoundTimer";
import StandingsTable from "../components/tournament/StandingsTable";
import { useLiveTournament } from "../components/tournament/useTournament";
import { BrandMark, Crown, Goblet } from "../components/icons";
import { Button, cx, EmptyState, IconButton, Spinner } from "../components/ui";
import { navigate } from "../lib/router";
import { bracketView } from "../tournament/bracket.ts";
import { currentRound, cutOf, listPt, plannedRounds } from "../tournament/engine.ts";
import { podResultText } from "../tournament/export.ts";
import { isPodTournament, standings } from "../tournament/standings.ts";
import type { Tournament } from "../tournament/types.ts";

type Screen = "pairings" | "standings" | "bracket" | "final";

/** Mesas em ordem alfabética: cada jogador acha o próprio nome e vê a mesa e o oponente (no mesão, a mesa toda). */
function Pairings({ t }: { t: Tournament }) {
  const r = currentRound(t);
  const names = new Map(t.players.map((p) => [p.id, p.name]));
  const rows = useMemo(() => {
    if (!r) return [];
    const out: { name: string; table: number | null; opponent: string | null; done: boolean }[] = [];
    for (const m of r.matches) {
      out.push({ name: names.get(m.a) ?? "?", table: m.table, opponent: m.b ? `contra ${names.get(m.b) ?? "?"}` : null, done: !!m.result && m.b !== null });
      if (m.b) out.push({ name: names.get(m.b) ?? "?", table: m.table, opponent: `contra ${names.get(m.a) ?? "?"}`, done: !!m.result });
    }
    for (const pod of r.pods ?? []) {
      for (const id of pod.players) {
        const others = pod.players.filter((x) => x !== id).map((x) => names.get(x) ?? "?");
        out.push({ name: names.get(id) ?? "?", table: pod.table, opponent: `com ${listPt(others)}`, done: !!pod.result });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, t.players]);
  if (!r) return null;
  return (
    <div className="columns-1 gap-6 md:columns-2 2xl:columns-3">
      {rows.map((x) => (
        <div key={`${x.name}-${x.table}`} className={cx("mb-3 flex break-inside-avoid items-center gap-5 rounded-lg px-5 py-4", x.done ? "bg-cream/4 opacity-60" : "glass")}>
          <span className="tabular grid size-16 shrink-0 place-items-center rounded-md bg-[linear-gradient(180deg,var(--color-brass-200),var(--color-brass-400))] text-title-1 font-bold text-ink-900 shadow-[inset_0_1px_0_rgb(255_252_240/0.7)]">
            {x.table ?? "—"}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-title-2 font-semibold text-cream">{x.name}</span>
            <span className="block truncate text-headline text-cream-dim">{x.opponent ?? "Folga: vitória por 2 a 0"}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Final do mesão: quem joga e, depois, como terminou. */
function FinalScreen({ t }: { t: Tournament }) {
  const pod = t.tiebreak!;
  const names = new Map(t.players.map((p) => [p.id, p.name]));
  const name = (id: string) => names.get(id) ?? "?";
  return (
    <div className="mx-auto max-w-4xl space-y-6 text-center">
      <Crown size={72} className="mx-auto text-brass-300 drop-shadow-[0_4px_18px_rgb(235_198_116/0.6)]" />
      <p className="text-title-2 text-cream-dim">{pod.result ? podResultText(pod.result, name) : "Empate na liderança · sem tempo limite"}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {pod.players.map((id) => (
          <div key={id} className="glass px-6 py-5 text-title-1 font-semibold text-cream">
            {name(id)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Modo telão: tela cheia para projetar mesas, classificação e bracket durante o evento. */
export default function TournamentDisplay({ id }: { id: string }) {
  const { t, error } = useLiveTournament(id);
  const [screen, setScreen] = useState<Screen>("pairings");
  const [auto, setAuto] = useState(true);
  const screens = useMemo<Screen[]>(() => {
    if (!t) return ["pairings"];
    const list: Screen[] = [];
    if (t.tiebreak) list.push("final");
    else if (t.rounds.length && !t.playoff) list.push("pairings");
    if (t.rounds.length) list.push("standings");
    if (t.playoff) list.push("bracket");
    return list.length ? list : ["pairings"];
  }, [t]);
  const active = screens.includes(screen) ? screen : screens[0];

  useEffect(() => {
    if (!auto || screens.length < 2) return;
    const timer = window.setInterval(() => setScreen((s) => screens[(screens.indexOf(s) + 1) % screens.length]), 20_000);
    return () => window.clearInterval(timer);
  }, [auto, screens]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setScreen((s) => screens[(screens.indexOf(s) + 1) % screens.length]);
      if (e.key === "ArrowLeft") setScreen((s) => screens[(screens.indexOf(s) - 1 + screens.length) % screens.length]);
      if (e.key.toLowerCase() === "f") void document.documentElement.requestFullscreen?.().catch(() => undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screens]);

  if (error && !t)
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <EmptyState art={<Goblet size={44} />} title="Não consegui abrir o telão" action={<Button onClick={() => location.reload()}>Tentar de novo</Button>}>
          {error}
        </EmptyState>
      </div>
    );
  if (!t)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-8" />
      </div>
    );

  const r = currentRound(t);
  const players = new Map(t.players.map((p) => [p.id, p]));
  const title =
    active === "pairings" ? `Rodada ${r?.number ?? 1} de ${plannedRounds(t)}: mesas` : active === "standings" ? "Classificação" : active === "final" ? "Final de desempate" : "Mata-mata";

  return (
    <div className="flex min-h-dvh flex-col px-6 py-6 sm:px-10 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <BrandMark size={44} />
          <div className="min-w-0">
            <p className="eyebrow">{t.name}</p>
            <h1 className="truncate font-display text-display font-semibold text-cream">{title}</h1>
          </div>
        </div>
        {r && active === "pairings" && t.settings.roundMinutes ? (
          <RoundTimer round={r} minutes={t.settings.roundMinutes} size="xl" overNote={r.pods?.length ? "Tempo! Termina o turno e cada jogador vivo faz mais 1" : undefined} />
        ) : null}
      </header>

      <main key={active} className="animate-rise mt-8 flex-1">
        {active === "pairings" && <Pairings t={t} />}
        {active === "final" && t.tiebreak && <FinalScreen t={t} />}
        {active === "standings" && (
          <div className="mx-auto max-w-5xl text-title-3">
            <StandingsTable rows={standings(t)} players={players} cut={cutOf(t.structure)} limit={16} variant={isPodTournament(t) ? "pods" : "duel"} />
          </div>
        )}
        {active === "bracket" && t.playoff && <BracketBoard view={bracketView(t.playoff)} players={players} bestOf={t.settings.playoffBestOf} large />}
      </main>

      {/* controles discretos: somem da vista na projeção, mas continuam no teclado (← → F) */}
      <footer className="mt-6 flex items-center justify-between gap-3 opacity-40 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <div className="flex items-center gap-1">
          <IconButton label="Tela anterior" onClick={() => setScreen(screens[(screens.indexOf(active) - 1 + screens.length) % screens.length])}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <IconButton label={auto ? "Parar de alternar" : "Alternar sozinho"} onClick={() => setAuto((a) => !a)}>
            {auto ? <Pause className="size-5" /> : <Play className="size-5" />}
          </IconButton>
          <IconButton label="Próxima tela" onClick={() => setScreen(screens[(screens.indexOf(active) + 1) % screens.length])}>
            <ChevronRight className="size-5" />
          </IconButton>
          <span className="ml-2 text-footnote text-cream-faint">Atualiza sozinho · ← → trocam a tela · F tela cheia</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Tela cheia" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}>
            <Maximize className="size-5" />
          </IconButton>
          <IconButton label="Sair do telão" onClick={() => navigate(`/torneios/${id}`)}>
            <X className="size-5" />
          </IconButton>
        </div>
      </footer>
    </div>
  );
}
