import { ArrowLeftRight, Copy, Search, Shuffle, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "../../lib/toast";
import { currentRound, cutOf, plannedRounds, roundComplete } from "../../tournament/engine.ts";
import { pairingsText } from "../../tournament/export.ts";
import { meetings, pairKey } from "../../tournament/pairing.ts";
import { podKey, podMeetings } from "../../tournament/pods.ts";
import { standings } from "../../tournament/standings.ts";
import type { Pod, Tournament } from "../../tournament/types.ts";
import { Board, Button, Confirm, cx, Input, Menu, Segmented, Tabs, Tag } from "../ui";
import MatchCard from "./MatchCard";
import PodCard from "./PodCard";
import RoundTimer from "./RoundTimer";
import StandingsTable from "./StandingsTable";
import type { Dispatch } from "./useTournament";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** Rodadas: as mesas com placar de um toque, o relógio, a troca manual e a classificação ao lado. */
export default function RoundsStage({ t, dispatch, onPlayer }: { t: Tournament; dispatch: Dispatch; onPlayer: (id: string) => void }) {
  const cur = currentRound(t);
  const [shown, setShown] = useState<number>(cur?.number ?? 1);
  const [filter, setFilter] = useState<"pending" | "all">("all");
  const [q, setQ] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"repair" | "delete" | null>(null);
  const [mobileView, setMobileView] = useState<"tables" | "standings">("tables");
  // rodada nova emparelhada (ou desfeita): a tela acompanha a atual
  useEffect(() => setShown(t.rounds.length || 1), [t.rounds.length]);
  const round = t.rounds.find((r) => r.number === shown) ?? cur;
  const players = useMemo(() => new Map(t.players.map((p) => [p.id, p])), [t.players]);
  const table = useMemo(() => standings(t), [t]);
  const before = useMemo(() => new Map(standings({ ...t, rounds: t.rounds.filter((r) => r.number < (round?.number ?? 1)) }).map((s) => [s.playerId, s.points])), [t, round?.number]);
  const earlier = useMemo(() => meetings(t.rounds.filter((r) => r.number < (round?.number ?? 1))).pairs, [t.rounds, round?.number]);
  const podsBefore = useMemo(() => podMeetings(t.rounds.filter((r) => r.number < (round?.number ?? 1))), [t.rounds, round?.number]);
  if (!round) return null;

  const isCurrent = round.number === t.rounds.length;
  const locked = !!t.playoff || !!t.tiebreak;
  const pods = round.pods ?? [];
  const isPods = pods.length > 0;
  const played = isPods ? pods.filter((p) => p.result).length : round.matches.filter((m) => m.b !== null && m.result).length;
  const tables = isPods ? pods.length : round.matches.filter((m) => m.b !== null).length;
  const anyResult = played > 0;
  const k = norm(q.trim());
  const found = (ids: (string | null)[], table: number | null) => !k || ids.some((id) => id && norm(players.get(id)?.name ?? "").includes(k)) || String(table ?? "") === q.trim();
  const matches = round.matches.filter((m) => !(filter === "pending" && (m.b === null || m.result)) && found([m.a, m.b], m.table));
  const shownPods = pods.filter((p) => !(filter === "pending" && p.result) && found(p.players, p.table));
  const repeatsOf = (p: Pod) => {
    let n = 0;
    for (let i = 0; i < p.players.length; i++) for (let j = i + 1; j < p.players.length; j++) n += podsBefore.has(podKey(p.players[i], p.players[j])) ? 1 : 0;
    return n;
  };

  function pick(id: string) {
    if (!picked) return setPicked(id);
    if (picked === id) return setPicked(null);
    const a = players.get(picked)?.name;
    const b = players.get(id)?.name;
    const ok = dispatch({ type: "swap", round: round!.number, x: picked, y: id }, { undo: `${a} e ${b} trocaram de mesa` });
    if (ok) setPicked(null);
  }

  async function copyPairings() {
    try {
      await navigator.clipboard.writeText(pairingsText(t, round!.number));
      toast("Mesas copiadas: é só colar no grupo");
    } catch {
      toast("Não consegui copiar.", { tone: "bad" });
    }
  }

  const header = (
    <Board className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 p-5 sm:p-6">
      <div className="min-w-0">
        <p className="eyebrow">{isCurrent ? (roundComplete(round) ? "Rodada completa" : "Em jogo") : "Rodada anterior"}</p>
        <h2 className="mt-1 font-display text-title-1 font-semibold text-mist sm:text-display">
          Rodada {round.number} <span className="text-mist-faint">de {plannedRounds(t)}</span>
        </h2>
        <p className="mt-1 text-subhead text-mist-dim">
          <span className="tabular">{played}</span> de <span className="tabular">{tables}</span> {tables === 1 ? "mesa lançada" : "mesas lançadas"}
          {isPods && <span className="text-mist-faint"> · mesas de {[...new Set(pods.map((p) => p.players.length))].sort((a, b) => b - a).join(" e ")}</span>}
        </p>
      </div>
      {isCurrent && t.settings.roundMinutes ? (
        <RoundTimer
          round={round}
          minutes={t.settings.roundMinutes}
          overNote={isPods ? "Tempo! Termina o turno e cada vivo joga mais 1" : undefined}
          onAction={locked ? undefined : (action) => dispatch({ type: "timer", round: round.number, action, at: new Date().toISOString() })}
        />
      ) : null}
      <Menu
        label="Ações da rodada"
        items={[
          { label: "Copiar as mesas", icon: <Copy className="size-[18px]" />, onSelect: () => void copyPairings() },
          ...(isCurrent && !locked
            ? [
                { label: swapping ? "Parar de trocar" : "Trocar jogadores de mesa", icon: <ArrowLeftRight className="size-[18px]" />, onSelect: () => (setSwapping((s) => !s), setPicked(null)), disabled: anyResult && !swapping, hint: anyResult ? "Só mesas sem placar" : undefined },
                { label: "Emparelhar de novo", icon: <Shuffle className="size-[18px]" />, onSelect: () => setConfirm("repair"), disabled: anyResult || t.structure.kind === "round-robin" },
                ...(round.number > 1 ? [{ label: "Desfazer a rodada", icon: <Trash2 className="size-[18px]" />, tone: "danger" as const, onSelect: () => setConfirm("delete"), disabled: anyResult }] : []),
              ]
            : []),
        ]}
      />
    </Board>
  );

  const grid = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          label="Filtrar mesas"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `Todas (${tables})` },
            { value: "pending", label: `Pendentes (${tables - played})` },
          ]}
        />
        <div className="relative min-w-44 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mist-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar jogador ou mesa" aria-label="Procurar jogador ou mesa" className="pl-9" />
        </div>
      </div>
      {swapping && (
        <div className="glass-float flex items-center gap-3 px-4 py-3" role="status">
          <ArrowLeftRight className="size-5 shrink-0 text-arcane-300" />
          <p className="min-w-0 flex-1 text-subhead text-mist">
            {picked ? `Agora toque em quem vai para o lugar de ${players.get(picked)?.name}.` : isPods ? "Toque em dois jogadores de mesas diferentes para trocá-los de lugar." : "Toque em dois jogadores para trocá-los de mesa (vale também para a folga)."}
          </p>
          <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => (setSwapping(false), setPicked(null))}>
            Pronto
          </Button>
        </div>
      )}
      {isPods ? (
        shownPods.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {shownPods.map((p) => (
              <PodCard
                key={p.id}
                pod={p}
                players={players}
                points={before}
                scoring={t.settings.points}
                repeats={repeatsOf(p)}
                onResult={locked ? undefined : (result) => dispatch({ type: "podResult", round: round.number, pod: p.id, result, at: new Date().toISOString() }, { undo: result ? `Mesa ${p.table} lançada` : `Resultado da mesa ${p.table} apagado` })}
                swap={swapping && isCurrent ? { picked, onPick: pick } : undefined}
              />
            ))}
          </div>
        ) : (
          <p className="glass px-4 py-8 text-center text-subhead text-mist-faint">{filter === "pending" && !q ? "Todas as mesas desta rodada já têm resultado." : "Nenhuma mesa com esse nome."}</p>
        )
      ) : matches.length ? (
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {matches.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              players={players}
              points={before}
              bestOf={t.settings.bestOf}
              rematch={!!m.b && (earlier.get(pairKey(m.a, m.b)) ?? 0) > 0}
              onScore={locked ? undefined : (score) => dispatch({ type: "result", round: round.number, match: m.id, score, at: new Date().toISOString() }, { undo: score ? `Mesa ${m.table} lançada` : `Placar da mesa ${m.table} apagado` })}
              swap={swapping && isCurrent ? { picked, onPick: pick } : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="glass px-4 py-8 text-center text-subhead text-mist-faint">{filter === "pending" && !q ? "Todas as mesas desta rodada já têm placar." : "Nenhuma mesa com esse nome."}</p>
      )}
      {locked && (
        <p className="text-footnote text-mist-faint">
          {t.tiebreak ? "A final já foi montada: os resultados das rodadas ficaram travados. Para corrigir, desfaça a final na etapa Final." : "O corte já foi feito: os placares do suíço ficaram travados. Para corrigir, desfaça o corte na etapa Corte."}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {t.rounds.length > 1 && (
        <Tabs
          value={String(round.number)}
          onChange={(v) => setShown(Number(v))}
          tabs={t.rounds.map((r) => ({
            value: String(r.number),
            label: `Rodada ${r.number}`,
            badge: roundComplete(r) ? null : <span className="size-2 rounded-full bg-astral-300" aria-label="em jogo" />,
          }))}
        />
      )}
      {header}
      <div className="lg:hidden">
        <Segmented
          label="Ver"
          value={mobileView}
          onChange={setMobileView}
          className="w-full"
          options={[
            { value: "tables", label: "Mesas" },
            { value: "standings", label: "Classificação" },
          ]}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className={cx(mobileView !== "tables" && "max-lg:hidden")}>{grid}</div>
        <aside className={cx("space-y-3", mobileView !== "standings" && "max-lg:hidden")}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-title-3 font-semibold text-mist">Classificação</h2>
            {cutOf(t.structure) !== null && <Tag tone="arcane">Top {cutOf(t.structure)}</Tag>}
          </div>
          <StandingsTable rows={table} players={players} cut={cutOf(t.structure)} onPlayer={onPlayer} compact variant={isPods ? "pods" : "duel"} />
          <p className="px-1 text-footnote text-mist-faint">
            {isPods
              ? "Ordem: pontos, vitórias e força dos adversários. Empate em 1º depois da última rodada vai para a final. Toque num jogador para ver o histórico."
              : "Desempates: pontos, OMW, GW e OGW, com piso de 33% (regra da Wizards). Toque num jogador para ver o histórico."}
          </p>
        </aside>
      </div>

      <Confirm
        open={confirm === "repair"}
        title="Emparelhar esta rodada de novo?"
        confirmLabel="Emparelhar de novo"
        onConfirm={() => {
          dispatch({ type: "repair", round: round.number, nonce: Date.now() % 100000 }, { undo: "Rodada emparelhada de novo" });
          setConfirm(null);
        }}
        onClose={() => setConfirm(null)}
      >
        <p>
          {isPods
            ? "As mesas desta rodada são montadas outra vez, com as mesmas regras (o mínimo de reencontros e pontos parecidos juntos)."
            : "As mesas desta rodada são sorteadas outra vez, com as mesmas regras (pontos, sem revanche, folga para quem ainda não teve)."}
        </p>
      </Confirm>
      <Confirm
        open={confirm === "delete"}
        title={`Desfazer a rodada ${round.number}?`}
        confirmLabel="Desfazer a rodada"
        danger
        onConfirm={() => {
          dispatch({ type: "deleteRound", round: round.number }, { undo: `Rodada ${round.number} desfeita` });
          setShown(round.number - 1);
          setConfirm(null);
        }}
        onClose={() => setConfirm(null)}
      >
        <p>As mesas somem e o torneio volta para o fim da rodada {round.number - 1}. Nenhum placar é perdido: esta rodada ainda não tem nenhum.</p>
      </Confirm>
    </div>
  );
}
