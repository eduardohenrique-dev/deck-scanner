import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import DeckTome from "../components/deck/DeckTome";
import { Lens, Tome } from "../components/icons";
import { Board, Button, EmptyState, Field, Input, Modal, PageTitle, Select, Skeleton, Textarea } from "../components/ui";
import { api, type ImportResult } from "../lib/api";
import { useResource } from "../lib/hooks";
import { navigate, useLocation } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import type { FormatRule } from "../lib/types";

export default function Decks() {
  const { query } = useLocation();
  const decks = useResource(() => api.decks(), []);
  const [creating, setCreating] = useState(query.get("novo") === "1");
  const [filter, setFilter] = useState("");
  const list = (decks.data ?? []).filter((d) => !filter || d.format_id === filter);
  const formatsInUse = [...new Map((decks.data ?? []).map((d) => [d.format_id, d.format_name ?? d.format_id])).entries()];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle kicker="a estante" title="Seus decks">
          Cada deck guarda a lista, as cartas físicas que estão nele e o histórico de versões.
        </PageTitle>
        <div className="flex gap-2">
          <Button icon={<Lens size={18} />} onClick={() => navigate("/escanear")}>
            escanear
          </Button>
          <Button variant="brass" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            novo deck
          </Button>
        </div>
      </div>

      {formatsInUse.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por formato">
          {[["", "todos"], ...formatsInUse].map(([id, name]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={
                filter === id
                  ? "h-9 rounded-full border border-brass-400 bg-brass-400/15 px-3.5 text-[14px] text-brass-200"
                  : "h-9 rounded-full border border-oak-600 px-3.5 text-[14px] text-cream-dim hover:text-cream"
              }
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {decks.loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-[4/3.6]" />
          ))}
        </div>
      ) : list.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((d) => (
            <DeckTome key={d.id} deck={d} />
          ))}
        </div>
      ) : (
        <Board>
          <EmptyState
            art={<Tome size={48} />}
            title="A estante está vazia"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="brass" icon={<Lens size={18} />} onClick={() => navigate("/escanear")}>
                  escanear um deck
                </Button>
                <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  importar lista
                </Button>
              </div>
            }
          >
            Escaneie um baralho e salve como deck, ou cole uma lista exportada do Moxfield, LigaMagic ou Arena.
          </EmptyState>
        </Board>
      )}

      {creating && <NewDeckDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewDeckDialog({ onClose }: { onClose: () => void }) {
  const games = useResource(() => api.games(), []);
  const [name, setName] = useState("");
  const [formatId, setFormatId] = useState("commander");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ deckId: string; report: ImportResult } | null>(null);
  const formats = useMemo(() => (games.data?.find((g) => g.id === "mtg")?.formats ?? []).filter((f) => f.id !== "collection"), [games.data]);
  const groups = useMemo(() => {
    const out = new Map<string, FormatRule[]>();
    for (const f of formats) out.set(f.group ?? "Outros", [...(out.get(f.group ?? "Outros") ?? []), f]);
    return [...out.entries()];
  }, [formats]);
  const lines = text.split("\n").filter((l) => l.trim()).length;

  useEffect(() => {
    // lista colada com "Commander"/"Comandante" sugere o formato
    if (/^\s*(commander|comandante)\b/im.test(text) && formatId !== "commander") setFormatId("commander");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  async function create() {
    setBusy(true);
    try {
      const res = await api.createDeck({ name: name.trim(), format_id: formatId, text: text.trim() || undefined });
      const report = res.import;
      if (report && (report.unresolved.length || report.print_warnings.length)) {
        setResult({ deckId: res.deck_id, report });
        setBusy(false);
        return;
      }
      toast(report ? `Deck criado com ${report.imported} cartas` : "Deck criado");
      navigate(`/decks/${res.deck_id}`);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }

  if (result)
    return (
      <Modal
        open
        onClose={() => navigate(`/decks/${result.deckId}`)}
        title="Lista importada, com ressalvas"
        footer={
          <Button variant="brass" onClick={() => navigate(`/decks/${result.deckId}`)}>
            abrir o deck
          </Button>
        }
      >
        <div className="space-y-4 text-[15px]">
          <p className="text-cream-dim">
            {result.report.imported} cartas entraram. {result.report.unresolved.length > 0 && `${result.report.unresolved.length} linhas não foram reconhecidas.`}
          </p>
          {result.report.unresolved.length > 0 && (
            <ul className="board-sunken max-h-48 space-y-1 overflow-y-auto px-3 py-2 font-mono text-[13px] text-wine-300">
              {result.report.unresolved.map((u) => (
                <li key={u.line}>
                  linha {u.line}: {u.text}
                </li>
              ))}
            </ul>
          )}
          {result.report.print_warnings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-cream-dim">Impressões que não existem no registro (a carta entrou na impressão mais comum):</p>
              <ul className="space-y-1 text-[14px] text-amber-300">
                {result.report.print_warnings.map((w) => (
                  <li key={w.line}>
                    linha {w.line}: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    );

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo deck"
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            cancelar
          </Button>
          <Button variant="brass" busy={busy} disabled={!name.trim()} onClick={create}>
            {lines ? `criar com ${lines} linhas` : "criar vazio"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="nome">
            {(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Kaalia dos anjos" maxLength={80} />}
          </Field>
          <Field label="formato">
            {(id) => (
              <Select id={id} value={formatId} onChange={(e) => setFormatId(e.target.value)}>
                {groups.map(([group, list]) => (
                  <optgroup key={group} label={group}>
                    {list.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="lista" hint="opcional · Moxfield, LigaMagic, Arena, Archidekt">
          {(id) => (
            <Textarea
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              className="font-mono text-[13px]"
              placeholder={"1 Sol Ring\n1 Arcane Signet (CMM) 381\n1 Anel Solar\n\nCommander\n1 Kaalia of the Vast"}
            />
          )}
        </Field>
        <p className="text-[13px] text-cream-faint">Nomes em português ou inglês. Edição e número entre parênteses fixam a impressão; *F* marca foil.</p>
      </div>
    </Modal>
  );
}
