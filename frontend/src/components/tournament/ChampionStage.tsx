import { RotateCcw, Share2 } from "lucide-react";
import { useMemo } from "react";
import { bracketView, playoffPlacing } from "../../tournament/bracket.ts";
import { champions, cutOf, listPt } from "../../tournament/engine.ts";
import { podRecord, record } from "../../tournament/export.ts";
import { standings } from "../../tournament/standings.ts";
import type { Tournament } from "../../tournament/types.ts";
import { Crown } from "../icons";
import { IdentityPips } from "../mtg";
import { Board, Button, cx } from "../ui";
import StandingsTable from "./StandingsTable";
import type { Dispatch } from "./useTournament";

/** Brasas que sobem atrás do campeão (poucas, lentas; com "reduzir movimento" ficam paradas). */
function Embers() {
  const sparks = Array.from({ length: 14 }, (_, i) => i);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {sparks.map((i) => (
        <span
          key={i}
          className="ember absolute bottom-0 block rounded-full bg-brass-300"
          style={{
            left: `${6 + ((i * 53) % 88)}%`,
            width: 3 + (i % 3),
            height: 3 + (i % 3),
            animationDelay: `${(i * 0.37) % 3.2}s`,
            animationDuration: `${3.6 + (i % 5) * 0.5}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function ChampionStage({ t, dispatch, onShare }: { t: Tournament; dispatch: Dispatch; onShare: () => void }) {
  const players = useMemo(() => new Map(t.players.map((p) => [p.id, p])), [t.players]);
  const table = useMemo(() => standings(t), [t]);
  const pods = t.structure.kind === "pods";
  const won = champions(t);
  const shared = won.length > 1;
  const champId = won[0] ?? null;
  const champ = champId ? players.get(champId) : null;
  // mesão: a final só decide o campeão; os outros lugares seguem os pontos das rodadas, e quem empata
  // em pontos divide a posição (como na classificação)
  const rest = table.filter((s) => !won.includes(s.playerId));
  const placing = t.playoff
    ? playoffPlacing(bracketView(t.playoff))
    : pods
      ? [
          ...won.map((playerId) => ({ playerId, place: 1 })),
          ...rest.slice(0, 3).map((s) => ({ playerId: s.playerId, place: won.length + 1 + rest.filter((x) => x.points > s.points).length })),
        ]
      : table.slice(0, 4).map((s, i) => ({ playerId: s.playerId, place: i + 1 }));
  const row = table.find((s) => s.playerId === champId);
  const podium = placing.filter((p) => p.place > 1).slice(0, 3);
  const phase = t.structure.kind === "round-robin" ? "todos contra todos" : pods ? "rodadas" : "suíço";

  return (
    <div className="space-y-8">
      <section className="glass relative overflow-hidden px-6 pt-12 pb-10 text-center sm:px-10 sm:pt-16">
        {champ?.deck?.art && <img src={champ.deck.art} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />}
        <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_0%,rgb(235_198_116/0.28),transparent_70%),linear-gradient(180deg,transparent_40%,rgb(22_16_12/0.85))]" />
        <Embers />
        <div className="relative">
          <Crown size={56} className="animate-pop mx-auto text-brass-300 drop-shadow-[0_4px_18px_rgb(235_198_116/0.6)]" />
          <p className="eyebrow mt-3 text-brass-300">{shared ? "Campeões · prêmio dividido" : t.playoff || pods ? "Campeão" : "Primeiro lugar"}</p>
          <h2 className={cx("animate-rise mt-2 font-display font-semibold text-cream", shared ? "text-title-1 sm:text-display" : "text-display sm:text-hero")}>
            {shared ? listPt(won.map((id) => players.get(id)?.name ?? "?")) : (champ?.name ?? "—")}
          </h2>
          {!shared && champ?.deck && (
            <p className="mt-3 flex items-center justify-center gap-2 text-headline text-cream-dim">
              {champ.deck.identity?.length ? <IdentityPips colors={champ.deck.identity} size={18} /> : null}
              {champ.deck.name}
            </p>
          )}
          {!shared && row && (
            <p className="mt-2 text-subhead text-cream-faint">
              {pods ? podRecord(row.wins, row.draws, row.losses) : record(row.wins, row.losses, row.draws)} {pods ? "nas" : "no"} {phase} · {row.points} pts
              {pods && t.tiebreak?.result ? " · venceu a final" : ""}
            </p>
          )}
          {shared && <p className="mt-3 text-subhead text-cream-faint">Os finalistas combinaram dividir o prêmio na final.</p>}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button variant="primary" size="lg" icon={<Share2 className="size-5" />} onClick={onShare}>
              Compartilhar resultado
            </Button>
          </div>
        </div>
      </section>

      {podium.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {podium.map((p) => {
            const pl = players.get(p.playerId);
            return (
              <Board key={p.playerId} className="flex items-center gap-4 p-4">
                <span className={cx("tabular grid size-12 shrink-0 place-items-center rounded-full text-title-3 font-bold", p.place === 2 ? "bg-cream/12 text-cream" : "bg-brass-700/40 text-brass-200")}>{p.place}º</span>
                <span className="min-w-0">
                  <span className="block truncate text-headline font-semibold text-cream">{pl?.name}</span>
                  <span className="block truncate text-footnote text-cream-faint">{pl?.deck?.name ?? (pods ? "Pela pontuação" : p.place === 2 ? "Vice-campeão" : "Semifinal")}</span>
                </span>
              </Board>
            );
          })}
        </div>
      )}

      {t.rounds.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-title-3 font-semibold text-cream">Classificação {pods ? "das" : "do"} {phase}</h2>
          <StandingsTable rows={table} players={players} cut={cutOf(t.structure)} variant={pods ? "pods" : "duel"} />
        </section>
      )}

      <div className="flex justify-center">
        <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => dispatch({ type: "reopen" }, { undo: "Torneio reaberto" })}>
          Reabrir o torneio
        </Button>
      </div>
    </div>
  );
}
