import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { pct, podRecord, record } from "../../tournament/export.ts";
import { podTied } from "../../tournament/standings.ts";
import type { Player, Standing } from "../../tournament/types.ts";
import { IdentityPips } from "../mtg";
import { cx, Tag } from "../ui";

/**
 * Classificação com os desempates da MTR. No celular fica só o essencial (pontos e OMW); o resto aparece
 * a partir do tablet. A linha do corte marca quem vai para o mata-mata.
 *
 * No mesão ("pods") vale o desempate do cEDH: pontos, MW%, pontos médios dos adversários e OMW%. Só quem
 * empata em todos divide a posição (1, 1, 3…); empate total em 1º vai para a final.
 */
export default function StandingsTable({
  rows,
  players,
  cut,
  onPlayer,
  compact,
  limit,
  variant = "duel",
}: {
  rows: Standing[];
  players: Map<string, Player>;
  cut?: number | null;
  onPlayer?: (id: string) => void;
  compact?: boolean;
  limit?: number;
  variant?: "duel" | "pods";
}) {
  const pods = variant === "pods";
  const shown = limit ? rows.slice(0, limit) : rows;
  const position = new Map(rows.map((r) => [r.playerId, pods ? 1 + rows.findIndex((x) => podTied(x, r)) : r.rank]));
  // o corte conta só quem continua no torneio
  let active = 0;
  const cutAfter = new Set<string>();
  if (cut) {
    for (const r of rows) {
      if (r.dropped) continue;
      active++;
      if (active === cut) cutAfter.add(r.playerId);
    }
  }
  const wide = !compact;
  return (
    <div className="glass overflow-hidden">
      <table className="w-full border-collapse text-subhead">
        <thead>
          <tr className="text-caption font-semibold tracking-[0.06em] text-mist-faint uppercase">
            <th className="w-12 py-3 pl-4 text-left font-semibold">#</th>
            <th className="py-3 text-left font-semibold">Jogador</th>
            <th className="py-3 pr-3 text-right font-semibold">Pts</th>
            {pods ? (
              <>
                <th className={cx("py-3 pr-3 text-right font-semibold", wide ? "max-sm:hidden" : "hidden")} title="Vitórias, empates no tempo e derrotas">
                  V–E–D
                </th>
                <th className={cx("py-3 pr-3 text-right font-semibold", wide ? "max-md:hidden" : "hidden")} title="Aproveitamento: pontos ÷ (mesas × pontos da vitória)">
                  MW
                </th>
                <th className="py-3 pr-3 text-right font-semibold" title="Pontos médios dos adversários">
                  Adv
                </th>
                <th className={cx("py-3 pr-4 text-right font-semibold", wide ? "max-sm:hidden" : "hidden")} title="Aproveitamento médio dos adversários (piso de 1 ÷ pontos da vitória)">
                  OMW
                </th>
              </>
            ) : (
              <>
                <th className={cx("py-3 pr-3 text-right font-semibold", wide ? "max-sm:hidden" : "hidden")}>V–D–E</th>
                <th className="py-3 pr-3 text-right font-semibold" title="Média de aproveitamento dos oponentes (piso de 33%)">
                  OMW
                </th>
                <th className={cx("py-3 pr-3 text-right font-semibold", wide ? "max-md:hidden" : "hidden")} title="Aproveitamento em games">
                  GW
                </th>
                <th className={cx("py-3 pr-4 text-right font-semibold", wide ? "max-md:hidden" : "hidden")} title="Média de aproveitamento em games dos oponentes">
                  OGW
                </th>
              </>
            )}
            {onPlayer && <th className="w-8" aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const p = players.get(r.playerId);
            const rank = position.get(r.playerId) ?? r.rank;
            const top = rank === 1 && r.matchesPlayed > 0;
            return (
              <Fragment key={r.playerId}>
                <tr
                  className={cx("border-t border-mist/6 transition-colors", onPlayer && "cursor-pointer hover:bg-mist/5", r.dropped && "text-mist-faint")}
                  onClick={onPlayer ? () => onPlayer(r.playerId) : undefined}
                >
                  <td className={cx("tabular py-3 pl-4 font-bold", top ? "text-area-soft" : r.dropped ? "text-mist-faint" : "text-mist")}>{rank}</td>
                  <td className="min-w-0 py-2.5 pr-2">
                    {onPlayer ? (
                      <button type="button" className="flex w-full min-w-0 items-center gap-2 text-left outline-offset-4" onClick={(e) => (e.stopPropagation(), onPlayer(r.playerId))}>
                        <Who player={p} dropped={r.dropped} />
                      </button>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2">
                        <Who player={p} dropped={r.dropped} />
                      </div>
                    )}
                  </td>
                  <td className={cx("tabular py-3 pr-3 text-right text-headline font-bold", r.dropped ? "text-mist-faint" : "text-mist")}>{r.points}</td>
                  {pods ? (
                    <>
                      <td className={cx("tabular py-3 pr-3 text-right whitespace-nowrap text-mist-dim", wide ? "max-sm:hidden" : "hidden")}>{podRecord(r.wins, r.draws, r.losses)}</td>
                      <td className={cx("tabular py-3 pr-3 text-right text-mist-dim", wide ? "max-md:hidden" : "hidden")}>{r.matchesPlayed ? pct(r.mwp) : "—"}</td>
                      <td className="tabular py-3 pr-3 text-right text-mist-dim">{r.matchesPlayed ? avgPts(r.oamp ?? 0) : "—"}</td>
                      <td className={cx("tabular py-3 pr-4 text-right text-mist-dim", wide ? "max-sm:hidden" : "hidden")}>{r.matchesPlayed ? pct(r.omw) : "—"}</td>
                    </>
                  ) : (
                    <>
                      <td className={cx("tabular py-3 pr-3 text-right text-mist-dim", wide ? "max-sm:hidden" : "hidden")}>{record(r.wins, r.losses, r.draws)}</td>
                      <td className="tabular py-3 pr-3 text-right text-mist-dim">{r.matchesPlayed ? pct(r.omw) : "—"}</td>
                      <td className={cx("tabular py-3 pr-3 text-right text-mist-dim", wide ? "max-md:hidden" : "hidden")}>{r.matchesPlayed ? pct(r.gwp) : "—"}</td>
                      <td className={cx("tabular py-3 pr-4 text-right text-mist-dim", wide ? "max-md:hidden" : "hidden")}>{r.matchesPlayed ? pct(r.ogw) : "—"}</td>
                    </>
                  )}
                  {onPlayer && (
                    <td className="pr-3 text-mist-faint">
                      <ChevronRight className="size-4" />
                    </td>
                  )}
                </tr>
                {cutAfter.has(r.playerId) && r !== shown[shown.length - 1] && (
                  <tr aria-hidden="true">
                    <td colSpan={8} className="p-0">
                      <div className="relative h-[2px] bg-[linear-gradient(90deg,transparent,var(--area)_12%,var(--area)_88%,transparent)]">
                        <span className="absolute top-1/2 right-4 -translate-y-1/2 rounded-md bg-area-soft px-2 text-caption leading-[18px] font-semibold tracking-[0.08em] text-ink-900 uppercase">
                          Corte · Top {cut}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const avgPts = (x: number) => x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Who({ player, dropped }: { player: Player | undefined; dropped: boolean }) {
  return (
    <>
      <span className="min-w-0">
        <span className={cx("block truncate font-semibold", dropped ? "text-mist-faint" : "text-mist")}>{player?.name ?? "?"}</span>
        {player?.deck?.name && <span className="block truncate text-footnote text-mist-faint">{player.deck.name}</span>}
      </span>
      {player?.deck?.identity?.length ? <IdentityPips colors={player.deck.identity} size={14} /> : null}
      {dropped && <Tag tone="bad">Saiu</Tag>}
    </>
  );
}
