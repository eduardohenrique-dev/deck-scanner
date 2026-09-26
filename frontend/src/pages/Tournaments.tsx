import { ChevronRight, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Goblet } from "../components/icons";
import { progressLine, serverSummary, STATUS_LABEL, STATUS_TONE, todayIso } from "../components/tournament/labels";
import { Board, Button, EmptyState, Field, Input, Modal, PageTitle, Skeleton, Tag } from "../components/ui";
import { api, type TournamentRow } from "../lib/api";
import { relativeDay } from "../lib/format";
import { usePersistentState, useResource } from "../lib/hooks";
import { Link, navigate } from "../lib/router";
import { toastError } from "../lib/toast";
import { createTournament } from "../tournament/engine.ts";
import { dateLabel } from "../tournament/export.ts";
import { randomSeed } from "../tournament/rng.ts";

type Filter = "all" | "running" | "draft" | "finished";

export default function Tournaments() {
  const list = useResource(() => api.tournaments(), []);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = usePersistentState<Filter>("deckscanner:tournaments-filter", "all");
  const rows = list.data ?? [];
  const counts = useMemo(() => ({ running: rows.filter((r) => r.status === "running").length, draft: rows.filter((r) => r.status === "draft").length, finished: rows.filter((r) => r.status === "finished").length }), [rows]);
  const shown = rows.filter((r) => filter === "all" || r.status === filter);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle title="Torneios">Suíço, corte e mata-mata: emparelhamento, desempates e bracket calculados na hora, do jeito da Wizards.</PageTitle>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Novo torneio
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar torneios">
          {(
            [
              ["all", `Todos (${rows.length})`],
              ["running", `Em andamento (${counts.running})`],
              ["draft", `Rascunhos (${counts.draft})`],
              ["finished", `Finalizados (${counts.finished})`],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" className="chip chip-pill" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {list.loading && !list.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : list.error && !list.data ? (
        <Board>
          <EmptyState art={<Goblet size={44} />} title="Não consegui abrir os torneios" action={<Button onClick={() => void list.reload()}>Tentar de novo</Button>}>
            {list.error}
          </EmptyState>
        </Board>
      ) : shown.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => (
            <TournamentCard key={r.id} row={r} />
          ))}
        </div>
      ) : rows.length ? (
        <p className="glass px-4 py-8 text-center text-subhead text-mist-faint">Nenhum torneio com esse filtro.</p>
      ) : (
        <Board>
          <EmptyState
            art={<Goblet size={44} />}
            title="Nenhum torneio na casa"
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Novo torneio
              </Button>
            }
          >
            Monte o primeiro: nome, formato e a lista de quem vai jogar. O resto a taverna calcula.
          </EmptyState>
        </Board>
      )}

      {creating && <NewTournament onClose={() => setCreating(false)} />}
    </div>
  );
}

function TournamentCard({ row }: { row: TournamentRow }) {
  const s = row.summary ?? {};
  return (
    <Link to={`/torneios/${row.id}`} className="group glass flex min-h-36 flex-col gap-3 p-5 transition-transform duration-500 ease-spring hover:-translate-y-1 active:scale-[0.98] active:duration-100">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 font-display text-title-3 font-semibold text-mist group-hover:text-arcane-100">{row.name}</h3>
        <Tag tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Tag>
      </div>
      <p className="text-footnote text-mist-faint">{[row.event_date ? dateLabel(row.event_date) : null, s.format, `${row.player_count} ${row.player_count === 1 ? "jogador" : "jogadores"}`].filter(Boolean).join(" · ")}</p>
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-subhead font-medium text-mist-dim">{progressLine({ ...s, status: row.status })}</span>
        <span className="flex shrink-0 items-center gap-1 text-footnote text-mist-faint">
          {relativeDay(row.updated_at)}
          <ChevronRight className="size-4 group-hover:text-arcane-300" />
        </span>
      </div>
    </Link>
  );
}

function NewTournament({ onClose }: { onClose: () => void }) {
  const games = useResource(() => api.games(), []);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso());
  const [format, setFormat] = useState("");
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const formats = useMemo(() => (games.data?.find((g) => g.id === "mtg")?.formats ?? []).filter((f) => f.id !== "collection").map((f) => f.name), [games.data]);

  async function create() {
    setBusy(true);
    try {
      const doc = createTournament({ id: "novo", name, date, gameFormat: format, seed: randomSeed(), at: new Date().toISOString() });
      const rec = await api.createTournament(doc, serverSummary(doc));
      navigate(`/torneios/${rec.id}`);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo torneio"
      description="O resto (estrutura, rodadas, corte) você decide na próxima tela."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={create}>
            Criar e configurar
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void create();
        }}
      >
        <Field label="Nome">{(id) => <Input id={id} autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Liga de quinta" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} />}</Field>
          <Field label="Formato do jogo" hint="opcional">
            {(id) => (
              <>
                <Input id={id} list={listId} value={format} maxLength={60} onChange={(e) => setFormat(e.target.value)} placeholder="Ex.: Pauper" />
                <datalist id={listId}>
                  {formats.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
