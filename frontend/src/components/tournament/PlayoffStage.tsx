import { Shuffle, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { bracketSize, bracketView } from "../../tournament/bracket.ts";
import { cutOf, qualified } from "../../tournament/engine.ts";
import { standings } from "../../tournament/standings.ts";
import type { Tournament } from "../../tournament/types.ts";
import { Board, Button, Confirm, Segmented } from "../ui";
import BracketBoard from "./BracketBoard";
import StandingsTable from "./StandingsTable";
import type { Dispatch } from "./useTournament";

/** Corte: quem passou, como a chave vai ser montada e o botão de sorteio. */
export function CutStage({ t, dispatch, onDrawn, onPlayer }: { t: Tournament; dispatch: Dispatch; onDrawn: () => void; onPlayer: (id: string) => void }) {
  const players = useMemo(() => new Map(t.players.map((p) => [p.id, p])), [t.players]);
  const table = useMemo(() => standings(t), [t]);
  const [seeding, setSeeding] = useState(t.settings.seeding);
  const cut = cutOf(t.structure) ?? 0;
  const ids = qualified(t);
  const size = bracketSize(ids.length);
  const byes = size - ids.length;

  function draw() {
    const next = dispatch({ type: "cut", seeding, at: new Date().toISOString(), nonce: Date.now() % 100000 }, { undo: seeding === "random" ? "Bracket sorteado" : "Bracket montado" });
    if (next) onDrawn();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-3">
        <h2 className="font-display text-title-3 font-semibold text-cream">Classificação final do suíço</h2>
        <StandingsTable rows={table} players={players} cut={cut} onPlayer={onPlayer} />
      </div>
      <aside className="space-y-4">
        <Board className="space-y-5 p-5 sm:p-6">
          <div>
            <p className="eyebrow">O corte</p>
            <h2 className="mt-1 font-display text-title-2 font-semibold text-cream">Top {cut}</h2>
            <p className="mt-2 text-subhead text-cream-dim">
              {ids.length < cut ? `Só ${ids.length} continuam no torneio: todos entram. ` : ""}
              Chave de {size}
              {byes ? `, com folga na primeira fase para ${byes === 1 ? "o seed 1" : `os seeds 1 a ${byes}`}.` : ", sem folgas."}
            </p>
          </div>
          <div>
            <p className="mb-2 text-footnote font-medium text-cream-dim">Como montar</p>
            <Segmented
              label="Como montar o bracket"
              value={seeding}
              onChange={setSeeding}
              className="w-full"
              options={[
                { value: "standings", label: "Classificação" },
                { value: "random", label: "Sorteio" },
              ]}
            />
            <p className="mt-2 text-footnote text-cream-faint">{seeding === "standings" ? "1º × último do corte; 1º e 2º só se cruzam na final." : "Quem ganhou folga pela classificação fica com ela; o resto é sorteado."}</p>
          </div>
          <Button variant="primary" size="lg" className="w-full" icon={<Shuffle className="size-5" />} onClick={draw}>
            {seeding === "random" ? "Sortear bracket" : "Montar bracket"}
          </Button>
        </Board>
      </aside>
    </div>
  );
}

/** Mata-mata: a chave com os placares; o vencedor avança sozinho e a final coroa o campeão. */
export function BracketStage({ t, dispatch, deal, onDealt }: { t: Tournament; dispatch: Dispatch; deal: boolean; onDealt: () => void }) {
  const players = useMemo(() => new Map(t.players.map((p) => [p.id, p])), [t.players]);
  const [undoCut, setUndoCut] = useState(false);
  if (!t.playoff) return null;
  const view = bracketView(t.playoff);
  const left = view.rounds.flat().filter((s) => !s.bye && !s.winner).length;
  const canUncut = t.structure.kind !== "single-elimination" && !Object.keys(t.playoff.results).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-subhead text-cream-dim">
          {view.champion ? "A final está decidida." : `${left} ${left === 1 ? "partida para jogar" : "partidas para jogar"}. Toque numa partida para lançar o placar; o vencedor avança sozinho.`}
        </p>
        {canUncut && (
          <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setUndoCut(true)}>
            Desfazer o corte
          </Button>
        )}
      </div>
      <Board className="p-4 sm:p-6">
        <BracketBoard
          view={view}
          players={players}
          bestOf={t.settings.playoffBestOf}
          deal={deal}
          onDealt={onDealt}
          onScore={(key, score) => dispatch({ type: "bracketResult", key, score, at: new Date().toISOString() }, { undo: score ? "Placar lançado" : "Placar apagado" })}
        />
      </Board>
      <Confirm
        open={undoCut}
        title="Desfazer o corte?"
        confirmLabel="Desfazer o corte"
        onConfirm={() => {
          dispatch({ type: "uncut" }, { undo: "Corte desfeito" });
          setUndoCut(false);
        }}
        onClose={() => setUndoCut(false)}
      >
        <p>A chave some e os placares do suíço voltam a poder ser corrigidos. Depois é só fazer o corte de novo.</p>
      </Confirm>
    </div>
  );
}
