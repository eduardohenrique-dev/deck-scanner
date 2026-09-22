import { ChevronLeft, ChevronRight, Maximize, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import BracketBoard from "../components/tournament/BracketBoard";
import RoundTimer from "../components/tournament/RoundTimer";
import StandingsTable from "../components/tournament/StandingsTable";
import { useLiveTournament } from "../components/tournament/useTournament";
import { BrandMark, Goblet } from "../components/icons";
import { Button, cx, EmptyState, IconButton, Spinner } from "../components/ui";
import { navigate } from "../lib/router";
import { bracketView } from "../tournament/bracket.ts";
import { currentRound, plannedRounds } from "../tournament/engine.ts";
import { standings } from "../tournament/standings.ts";
import type { Tournament } from "../tournament/types.ts";

type Screen = "pairings" | "standings" | "bracket";

/** Mesas em ordem alfabética: cada jogador acha o próprio nome e vê a mesa e o oponente. */
function Pairings({ t }: { t: Tournament }) {
  const r = currentRound(t);
  const names = new Map(t.players.map((p) => [p.id, p.name]));
  const rows = useMemo(() => {
    if (!r) return [];
    const out: { name: string; table: number | null; opponent: string | null; done: boolean }[] = [];
    for (const m of r.matches) {
      out.push({ name: names.get(m.a) ?? "?", table: m.table, opponent: m.b ? (names.get(m.b) ?? "?") : null, done: !!m.result && m.b !== null });
      if (m.b) out.push({ name: names.get(m.b) ?? "?", table: m.table, opponent: names.get(m.a) ?? "?", done: !!m.result });
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
            <span className="block truncate text-headline text-cream-dim">{x.opponent ? `contra ${x.opponent}` : "Folga: vitória por 2 a 0"}</span>
          </span>
        </div>
      ))}
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
    if (t.rounds.length && !t.playoff) list.push("pairings");
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
  const title = active === "pairings" ? `Rodada ${r?.number ?? 1} de ${plannedRounds(t)}: mesas` : active === "standings" ? "Classificação" : "Mata-mata";

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
        {r && active === "pairings" && t.settings.roundMinutes ? <RoundTimer round={r} minutes={t.settings.roundMinutes} size="xl" /> : null}
      </header>

      <main key={active} className="animate-rise mt-8 flex-1">
        {active === "pairings" && <Pairings t={t} />}
        {active === "standings" && (
          <div className="mx-auto max-w-5xl text-title-3">
            <StandingsTable rows={standings(t)} players={players} cut={t.structure.kind !== "single-elimination" ? t.structure.cut : null} limit={16} />
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
