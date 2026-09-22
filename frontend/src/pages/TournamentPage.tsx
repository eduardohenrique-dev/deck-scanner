import { ArrowRight, Cloud, CloudOff, Crown, Loader2, MonitorPlay, Play, Share2, Shuffle, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Goblet } from "../components/icons";
import ChampionStage from "../components/tournament/ChampionStage";
import ExportSheet from "../components/tournament/ExportSheet";
import { STAGE_LABEL, STATUS_LABEL, STATUS_TONE } from "../components/tournament/labels";
import PlayerDrawer from "../components/tournament/PlayerDrawer";
import PlayersStage from "../components/tournament/PlayersStage";
import { BracketStage, CutStage } from "../components/tournament/PlayoffStage";
import RoundsStage from "../components/tournament/RoundsStage";
import SetupStage from "../components/tournament/SetupStage";
import { useTournament, type Dispatch, type SaveState } from "../components/tournament/useTournament";
import { Board, Button, Confirm, cx, EmptyState, InlineEdit, Menu, Skeleton, StepIndicator, Tag, type Step } from "../components/ui";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import { bracketView } from "../tournament/bracket.ts";
import { champion, currentRound, isDraft, listPt, nextRoundBlocker, pendingTables, stage, stages, startBlocker, status } from "../tournament/engine.ts";
import { dateLabel, structureLabel } from "../tournament/export.ts";
import { plannedRounds } from "../tournament/engine.ts";
import type { StageId, Tournament } from "../tournament/types.ts";

type Action = { label: string; icon?: ReactNode; onClick?: () => void; reason?: string | null };

const SAVE: Record<SaveState, { label: string; icon: ReactNode }> = {
  saved: { label: "Salvo", icon: <Cloud className="size-3.5" /> },
  saving: { label: "Salvando…", icon: <Loader2 className="size-3.5 animate-spin" /> },
  pending: { label: "Salvando…", icon: <Loader2 className="size-3.5 animate-spin" /> },
  offline: { label: "Sem internet: guardado neste aparelho", icon: <CloudOff className="size-3.5" /> },
  error: { label: "Não salvou ainda: tentando de novo", icon: <TriangleAlert className="size-3.5" /> },
};

export default function TournamentPage({ id }: { id: string }) {
  const { t, error, save, dispatch } = useTournament(id);
  const [view, setView] = useState<StageId | null>(null);
  const [player, setPlayer] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deal, setDeal] = useState(false);
  const onDealt = useCallback(() => setDeal(false), []);

  // a tela acompanha a etapa quando ela avança (gerar rodada, corte, final)
  const current = t ? (isDraft(t) ? null : stage(t)) : null;
  useEffect(() => {
    if (current) setView(current);
  }, [current]);

  if (error && !t)
    return (
      <Board>
        <EmptyState art={<Goblet size={44} />} title="Não encontrei este torneio" action={<Button onClick={() => navigate("/torneios")}>Ver os torneios</Button>}>
          {error}
        </EmptyState>
      </Board>
    );
  if (!t)
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-2/3 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );

  const draftStage: StageId = t.players.length > 0 && view !== "setup" ? "players" : "setup";
  const now: StageId = isDraft(t) ? (view === "players" ? "players" : draftStage) : stage(t);
  const shown: StageId = view && reachable(t, view, now) ? view : now;
  const list = stages(t);
  const nowIdx = list.indexOf(now);
  const steps: Step[] = list.map((s, i) => ({ id: s, label: STAGE_LABEL[s], state: i < nowIdx ? "done" : i === nowIdx ? "now" : "todo" }));
  const action = primaryAction(t, shown, {
    goto: setView,
    start: () => setStarting(true),
    pairNext: () => dispatch({ type: "pairNext" }, { undo: `Rodada ${t.rounds.length + 1} emparelhada` }),
    finish: () => dispatch({ type: "finish", at: new Date().toISOString() }, { undo: "Torneio encerrado" }),
    share: () => setSharing(true),
  });
  const st = status(t);

  async function remove() {
    try {
      await api.deleteTournament(id);
      toast("Torneio apagado");
      navigate("/torneios");
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div className="space-y-6">
      <header className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 space-y-2 max-sm:basis-full max-sm:pr-12">
          <p className="eyebrow flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{dateLabel(t.date)}</span>
            {t.gameFormat && <span>· {t.gameFormat}</span>}
            <span>· {structureLabel(t.structure, plannedRounds(t))}</span>
          </p>
          <h1 className="font-display text-title-1 font-semibold text-cream sm:text-display">
            <InlineEdit label="Nome do torneio" value={t.name} placeholder="Torneio sem nome" onSave={async (name) => void (name && dispatch({ type: "rename", name }))} className="font-display" />
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <Tag tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Tag>
            <span className={cx("inline-flex items-center gap-1.5 text-footnote", save === "offline" || save === "error" ? "text-ember-300" : "text-cream-faint")} aria-live="polite">
              {SAVE[save].icon}
              {SAVE[save].label}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 max-sm:absolute max-sm:top-0 max-sm:-right-2">
          <ActionButton action={action} className="max-sm:hidden" />
          <Menu
            items={[
              { label: "Compartilhar e exportar", icon: <Share2 className="size-[18px]" />, onSelect: () => setSharing(true) },
              { label: "Abrir o telão", icon: <MonitorPlay className="size-[18px]" />, onSelect: () => window.open(`/torneios/${id}/telao`, "_blank", "noopener"), disabled: isDraft(t), hint: isDraft(t) ? "Disponível depois que o torneio começar" : undefined },
              { label: "Apagar torneio", icon: <Trash2 className="size-[18px]" />, tone: "danger", onSelect: () => setDeleting(true) },
            ]}
          />
        </div>
      </header>

      <StepIndicator steps={steps} current={shown} onSelect={(s) => setView(s as StageId)} />

      <div key={shown} className="animate-rise">
        {shown === "setup" && <SetupStage t={t} dispatch={dispatch} />}
        {shown === "players" && <PlayersStage t={t} dispatch={dispatch} onPlayer={setPlayer} />}
        {shown === "rounds" && <RoundsStage t={t} dispatch={dispatch} onPlayer={setPlayer} />}
        {shown === "cut" && <CutStage t={t} dispatch={dispatch} onPlayer={setPlayer} onDrawn={() => setDeal(true)} />}
        {shown === "bracket" && <BracketStage t={t} dispatch={dispatch} deal={deal} onDealt={onDealt} />}
        {shown === "champion" && <ChampionStage t={t} dispatch={dispatch} onShare={() => setSharing(true)} />}
      </div>

      {/* no celular a ação da etapa fica sempre à mão, acima da barra de navegação */}
      {action && <div className="h-20 sm:hidden" aria-hidden="true" />}
      {action && (
        <div className="bar-glass fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 py-3 shadow-[inset_0_1px_0_rgb(255_226_184/0.1),0_-8px_24px_-16px_rgb(0_0_0/0.8)] sm:hidden">
          <ActionButton action={action} className="w-full" />
        </div>
      )}

      <PlayerDrawer t={t} playerId={player} onClose={() => setPlayer(null)} />
      {sharing && <ExportSheet t={t} onClose={() => setSharing(false)} />}
      <StartConfirm t={t} open={starting} onClose={() => setStarting(false)} dispatch={dispatch} onStarted={(s) => setView(s)} />
      <Confirm open={deleting} title={`Apagar ${t.name}?`} confirmLabel="Apagar torneio" danger onConfirm={() => void remove()} onClose={() => setDeleting(false)}>
        <p>Jogadores, rodadas, placares e o bracket somem de todos os aparelhos. Não tem volta.</p>
      </Confirm>
    </div>
  );
}

/** Dá para abrir uma etapa já alcançada (ou a de configuração, sempre). */
function reachable(t: Tournament, view: StageId, now: StageId) {
  const list = stages(t);
  if (view === "setup" || view === "players") return true;
  return list.indexOf(view) <= list.indexOf(now) && list.includes(view);
}

function ActionButton({ action, className }: { action: Action | null; className?: string }) {
  if (!action) return null;
  const disabled = !action.onClick || !!action.reason;
  return (
    <div className={cx("flex flex-col items-stretch gap-1 sm:items-end", className)}>
      <Button variant="primary" icon={action.icon} disabled={disabled} onClick={action.onClick} className="max-sm:w-full">
        {action.label}
      </Button>
      {action.reason && (
        <span className="flex items-center gap-1.5 text-footnote text-cream-dim max-sm:justify-center">
          <TriangleAlert className="size-3.5 shrink-0 text-ember-300" /> {action.reason}
        </span>
      )}
    </div>
  );
}

/** A ação principal de cada etapa, com o motivo quando ainda não dá. */
function primaryAction(
  t: Tournament,
  shown: StageId,
  go: { goto: (s: StageId) => void; start: () => void; pairNext: () => void; finish: () => void; share: () => void },
): Action | null {
  const draft = isDraft(t);
  switch (shown) {
    case "setup":
      return draft ? { label: "Continuar para inscrições", icon: <ArrowRight className="size-4" />, onClick: () => go.goto("players") } : null;
    case "players":
      return draft ? { label: "Começar torneio", icon: <Play className="size-4 fill-current" />, onClick: go.start, reason: startBlocker(t) } : null;
    case "rounds": {
      if (t.playoff || t.finishedAt) return null;
      // na última rodada planejada, a próxima ação é o corte (ou encerrar), liberada quando todas as mesas tiverem placar
      if (t.rounds.length >= plannedRounds(t)) {
        const cur = currentRound(t);
        const pending = cur ? pendingTables(cur) : [];
        const reason = pending.length ? (pending.length === 1 ? `Falta o placar da mesa ${pending[0]}.` : `Faltam os placares das mesas ${listPt(pending.map(String))}.`) : null;
        if (t.structure.kind !== "single-elimination" && t.structure.cut !== null) return { label: `Fazer o corte (Top ${t.structure.cut})`, icon: <ArrowRight className="size-4" />, onClick: () => go.goto("cut"), reason };
        return { label: "Encerrar torneio", icon: <Crown size={18} />, onClick: go.finish, reason };
      }
      const reason = nextRoundBlocker(t);
      return { label: `Gerar rodada ${t.rounds.length + 1}`, icon: <Shuffle className="size-4" />, onClick: go.pairNext, reason };
    }
    case "cut":
      return null; // o botão de montar/sortear fica no painel do corte
    case "bracket": {
      if (!t.playoff) return null;
      const view = bracketView(t.playoff);
      if (view.champion) return { label: "Ver o campeão", icon: <Crown size={18} />, onClick: () => go.goto("champion") };
      const left = view.rounds.flat().filter((s) => !s.bye && !s.winner).length;
      return { label: "Coroar campeão", icon: <Crown size={18} />, reason: `${left === 1 ? "Falta 1 partida" : `Faltam ${left} partidas`} do mata-mata.` };
    }
    case "champion":
      return champion(t) ? { label: "Compartilhar resultado", icon: <Share2 className="size-4" />, onClick: go.share } : null;
  }
}

function StartConfirm({ t, open, onClose, dispatch, onStarted }: { t: Tournament; open: boolean; onClose: () => void; dispatch: Dispatch; onStarted: (s: StageId) => void }) {
  const text = useMemo(() => {
    if (t.structure.kind === "single-elimination") return t.settings.seeding === "random" ? "A chave é sorteada agora." : "A chave sai na ordem da lista de inscritos.";
    if (t.structure.kind === "round-robin") return "A primeira rodada sai agora; a tabela completa já fica definida.";
    return "A rodada 1 é sorteada agora. As próximas saem pelos pontos, sem revanche.";
  }, [t.structure.kind, t.settings.seeding]);
  return (
    <Confirm
      open={open}
      title="Começar o torneio?"
      confirmLabel="Começar"
      onConfirm={() => {
        const next = dispatch({ type: "start", at: new Date().toISOString() }, { undo: t.structure.kind === "single-elimination" ? "Torneio começou: chave montada" : "Torneio começou: rodada 1 sorteada" });
        onClose();
        if (next) onStarted(stage(next));
      }}
      onClose={onClose}
    >
      <p>
        As inscrições fecham com {t.players.length} jogadores. {text}
      </p>
      <p className="text-footnote text-cream-faint">Enquanto nenhum placar for lançado, dá para desfazer.</p>
    </Confirm>
  );
}
