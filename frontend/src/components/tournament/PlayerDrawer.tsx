import { useMemo } from "react";
import { record } from "../../tournament/export.ts";
import { history, standings } from "../../tournament/standings.ts";
import type { Tournament } from "../../tournament/types.ts";
import { IdentityPips } from "../mtg";
import { cx, Drawer, Tag } from "../ui";
import { scoreLabel } from "./MatchCard";

const OUTCOME = { win: { label: "Vitória", tone: "ok" as const }, loss: { label: "Derrota", tone: "bad" as const }, draw: { label: "Empate", tone: "neutral" as const }, bye: { label: "Folga", tone: "ok" as const } };

/** Histórico de um jogador: rodada a rodada, com oponente, placar e os números dele na tabela. */
export default function PlayerDrawer({ t, playerId, onClose }: { t: Tournament; playerId: string | null; onClose: () => void }) {
  const player = t.players.find((p) => p.id === playerId);
  const names = useMemo(() => new Map(t.players.map((p) => [p.id, p.name])), [t.players]);
  const row = useMemo(() => standings(t).find((s) => s.playerId === playerId), [t, playerId]);
  const games = useMemo(() => (playerId ? history(t, playerId) : []), [t, playerId]);
  return (
    <Drawer open={!!player} onClose={onClose} title={player?.name ?? ""}>
      {player && (
        <div className="space-y-6">
          <div className="space-y-2">
            {player.deck && (
              <p className="flex items-center gap-2 text-headline text-cream-dim">
                {player.deck.identity?.length ? <IdentityPips colors={player.deck.identity} size={16} /> : null}
                {player.deck.name}
              </p>
            )}
            {player.droppedAfter !== null && <Tag tone="bad">{player.droppedAfter === 0 ? "Saiu antes de jogar" : `Saiu após a rodada ${player.droppedAfter}`}</Tag>}
          </div>
          {row && (
            <dl className="grid grid-cols-3 gap-2">
              {[
                ["Posição", `${row.rank}º`],
                ["Pontos", String(row.points)],
                ["V–D–E", record(row.wins, row.losses, row.draws)],
              ].map(([k, v]) => (
                <div key={k} className="well px-4 py-3">
                  <dt className="text-caption text-cream-faint">{k}</dt>
                  <dd className="tabular mt-0.5 text-title-3 font-semibold text-cream">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <section>
            <h3 className="eyebrow mb-2">Partidas</h3>
            {games.length ? (
              <ol className="well divide-y divide-cream/6">
                {games.map((g) => {
                  const o = OUTCOME[g.outcome];
                  return (
                    <li key={`${g.round}-${g.opponent}`} className="flex items-center gap-3 px-4 py-3">
                      <span className="tabular w-8 shrink-0 text-footnote font-semibold text-cream-faint">R{g.round}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-subhead text-cream">{g.opponent ? `contra ${names.get(g.opponent) ?? "?"}` : "Sem adversário"}</span>
                        {g.table && <span className="block text-caption text-cream-faint">Mesa {g.table}</span>}
                      </span>
                      <span className={cx("tabular text-subhead font-semibold", g.outcome === "win" || g.outcome === "bye" ? "text-cream" : "text-cream-dim")}>{scoreLabel(g.score)}</span>
                      <Tag tone={o.tone}>{o.label}</Tag>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-subhead text-cream-faint">Ainda sem partidas com placar.</p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
