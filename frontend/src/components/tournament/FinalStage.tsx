import { Undo2 } from "lucide-react";
import { useMemo } from "react";
import { finalists, listPt } from "../../tournament/engine.ts";
import { standings } from "../../tournament/standings.ts";
import type { Tournament } from "../../tournament/types.ts";
import { Crown } from "../icons";
import { Board, Button } from "../ui";
import PodCard from "./PodCard";
import StandingsTable from "./StandingsTable";
import type { Dispatch } from "./useTournament";

/**
 * Mesa final do mesão, como no cEDH Europa: os 4 primeiros das rodadas, sem tempo limite, na ordem da
 * classificação (o 1º começa). Mesa que empata recomeça; termina com um vencedor ou com o prêmio dividido.
 */
export default function FinalStage({ t, dispatch, onPlayer }: { t: Tournament; dispatch: Dispatch; onPlayer: (id: string) => void }) {
  const players = useMemo(() => new Map(t.players.map((p) => [p.id, p])), [t.players]);
  const table = useMemo(() => standings(t), [t]);
  const tied = t.tiebreak?.players ?? finalists(t);
  const points = new Map(table.map((s) => [s.playerId, s.points]));
  const names = tied.map((id) => players.get(id)?.name ?? "?");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-6">
        <Board className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5 sm:p-6">
          <span className="grid size-14 shrink-0 place-items-center rounded-md bg-gold-300/12 text-gold-300 shadow-[inset_0_0_0_1px_rgb(232_193_90/0.25)]">
            <Crown size={28} />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <p className="eyebrow">Top {tied.length} das rodadas</p>
            <h2 className="mt-1 font-display text-title-1 font-semibold text-mist">{t.tiebreak ? "A mesa final" : `${tied.length} finalistas`}</h2>
            <p className="mt-1 text-subhead text-mist-dim">
              {t.tiebreak
                ? "Sem tempo limite: vale até alguém vencer, e se a partida empatar começa outra. Joga primeiro quem está mais acima na lista. Se os finalistas combinarem, dá para dividir o prêmio."
                : `${listPt(names)} jogam a mesa final, sem tempo limite, nessa ordem de jogo: o 1º das rodadas começa. Quem vencer é o campeão; os outros ficam na ordem da classificação.`}
            </p>
          </div>
          {!t.tiebreak && (
            <Button variant="primary" size="lg" icon={<Crown size={18} />} onClick={() => dispatch({ type: "makeFinal", at: new Date().toISOString() }, { undo: "Final montada" })}>
              Montar a final
            </Button>
          )}
        </Board>

        {t.tiebreak && (
          <>
            <PodCard
              pod={t.tiebreak}
              title="Final"
              final
              players={players}
              points={points}
              scoring={t.settings.points}
              onResult={(result) => dispatch({ type: "finalResult", result, at: new Date().toISOString() }, { undo: result ? "Resultado da final lançado" : "Resultado da final apagado" })}
            />
            {!t.tiebreak.result && (
              <Button variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => dispatch({ type: "unmakeFinal" }, { undo: "Final desfeita" })}>
                Desfazer a final e voltar às rodadas
              </Button>
            )}
          </>
        )}
      </div>

      <aside className="space-y-3">
        <h2 className="font-display text-title-3 font-semibold text-mist">Classificação das rodadas</h2>
        <StandingsTable rows={table} players={players} onPlayer={onPlayer} compact variant="pods" />
      </aside>
    </div>
  );
}
