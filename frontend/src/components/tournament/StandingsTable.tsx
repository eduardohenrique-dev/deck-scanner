import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { pct, record } from "../../tournament/export.ts";
import type { Player, Standing } from "../../tournament/types.ts";
import { IdentityPips } from "../mtg";
import { cx, Tag } from "../ui";

/**
 * Classificação com os desempates da MTR. No celular fica só o essencial (pontos e OMW); o resto aparece
 * a partir do tablet. A linha do corte marca quem vai para o mata-mata.
 */
export default function StandingsTable({
  rows,
  players,
  cut,
  onPlayer,
  compact,
  limit,
}: {
  rows: Standing[];
  players: Map<string, Player>;
  cut?: number | null;
  onPlayer?: (id: string) => void;
  compact?: boolean;
  limit?: number;
}) {
  const shown = limit ? rows.slice(0, limit) : rows;
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
          <tr className="text-caption font-semibold tracking-[0.06em] text-cream-faint uppercase">
            <th className="w-12 py-3 pl-4 text-left font-semibold">#</th>
            <th className="py-3 text-left font-semibold">Jogador</th>
            <th className="py-3 pr-3 text-right font-semibold">Pts</th>
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
            {onPlayer && <th className="w-8" aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const p = players.get(r.playerId);
            const top = r.rank === 1 && r.matchesPlayed > 0;
            return (
              <Fragment key={r.playerId}>
                <tr
                  className={cx("border-t border-cream/6 transition-colors", onPlayer && "cursor-pointer hover:bg-cream/5", r.dropped && "text-cream-faint")}
                  onClick={onPlayer ? () => onPlayer(r.playerId) : undefined}
                >
                  <td className={cx("tabular py-3 pl-4 font-bold", top ? "text-brass-200" : r.dropped ? "text-cream-faint" : "text-cream")}>{r.rank}</td>
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
                  <td className={cx("tabular py-3 pr-3 text-right text-headline font-bold", r.dropped ? "text-cream-faint" : "text-cream")}>{r.points}</td>
                  <td className={cx("tabular py-3 pr-3 text-right text-cream-dim", wide ? "max-sm:hidden" : "hidden")}>{record(r.wins, r.losses, r.draws)}</td>
                  <td className="tabular py-3 pr-3 text-right text-cream-dim">{r.matchesPlayed ? pct(r.omw) : "—"}</td>
                  <td className={cx("tabular py-3 pr-3 text-right text-cream-dim", wide ? "max-md:hidden" : "hidden")}>{r.matchesPlayed ? pct(r.gwp) : "—"}</td>
                  <td className={cx("tabular py-3 pr-4 text-right text-cream-dim", wide ? "max-md:hidden" : "hidden")}>{r.matchesPlayed ? pct(r.ogw) : "—"}</td>
                  {onPlayer && (
                    <td className="pr-3 text-cream-faint">
                      <ChevronRight className="size-4" />
                    </td>
                  )}
                </tr>
                {cutAfter.has(r.playerId) && r !== shown[shown.length - 1] && (
                  <tr aria-hidden="true">
                    <td colSpan={8} className="p-0">
                      <div className="relative h-[2px] bg-[linear-gradient(90deg,transparent,var(--color-brass-400)_12%,var(--color-brass-400)_88%,transparent)]">
                        <span className="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-brass-300 px-2 text-caption leading-[18px] font-semibold tracking-[0.08em] text-ink-900 uppercase">
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

function Who({ player, dropped }: { player: Player | undefined; dropped: boolean }) {
  return (
    <>
      <span className="min-w-0">
        <span className={cx("block truncate font-semibold", dropped ? "text-cream-faint" : "text-cream")}>{player?.name ?? "?"}</span>
        {player?.deck?.name && <span className="block truncate text-footnote text-cream-faint">{player.deck.name}</span>}
      </span>
      {player?.deck?.identity?.length ? <IdentityPips colors={player.deck.identity} size={14} /> : null}
      {dropped && <Tag tone="bad">Saiu</Tag>}
    </>
  );
}
