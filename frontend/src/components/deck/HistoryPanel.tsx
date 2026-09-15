import { History, Minus, Plus, Repeat } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { dateLabel, FINISH_NAME, LANGUAGE_NAME } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import type { DeckDiff, DeckState, PrintRef, Snapshot } from "../../lib/types";
import { Button, cx, EmptyState, Input, Skeleton } from "../ui";

const SOURCE: Record<Snapshot["source"], string> = { scan: "salvo de um scan", check: "atualizado na conferência", manual: "versão guardada", import: "lista importada" };

const printLabel = (p: PrintRef) =>
  [p.set_code?.toUpperCase(), p.collector_number && `#${p.collector_number}`, LANGUAGE_NAME[p.language] ?? p.language, p.finish !== "nonfoil" ? FINISH_NAME[p.finish] : null].filter(Boolean).join(" ");

/** Versões do deck e o que mudou entre elas (escaneamentos, conferências e importações). */
export default function HistoryPanel({ state, onSnapshot }: { state: DeckState; onSnapshot: () => void }) {
  const deckId = state.deck.id;
  const snapshots = state.snapshots;
  const [selected, setSelected] = useState<string | null>(snapshots[0]?.id ?? null);
  const [diff, setDiff] = useState<{ id: string; data: DeckDiff } | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function compare(id: string) {
    setSelected(id);
    setLoading(true);
    try {
      const res = await api.diff(deckId, id, "current");
      setDiff({ id, data: res.diff });
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api.saveSnapshot(deckId, note.trim() || undefined);
      setNote("");
      toast("Versão guardada no histórico");
      onSnapshot();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="board space-y-2 p-3">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (ex.: antes do torneio)" className="h-10" maxLength={120} />
          <Button size="sm" className="w-full" busy={saving} onClick={save}>
            guardar versão atual
          </Button>
        </div>
        {snapshots.length === 0 ? (
          <p className="px-1 text-[14px] text-cream-faint">Nenhuma versão ainda. Salvar um scan ou importar uma lista cria a primeira.</p>
        ) : (
          <ol className="board divide-y divide-oak-700/70 overflow-hidden" aria-label="Versões">
            {snapshots.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => compare(s.id)}
                  aria-current={selected === s.id && diff?.id === s.id ? "true" : undefined}
                  className={cx("block w-full px-3 py-2.5 text-left transition-colors", diff?.id === s.id ? "bg-brass-400/10" : "hover:bg-oak-750/60")}
                >
                  <span className="block font-serif text-[16px] text-cream">{dateLabel(s.created_at, true)}</span>
                  <span className="block text-[13px] text-cream-faint">
                    {SOURCE[s.source]} · {s.card_count} cartas
                  </span>
                  {s.note && <span className="block truncate text-[13px] text-cream-dim italic">“{s.note}”</span>}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        {loading ? (
          <Skeleton className="h-64" />
        ) : diff ? (
          <DiffView diff={diff.data} when={snapshots.find((s) => s.id === diff.id)?.created_at ?? null} />
        ) : (
          <div className="board">
            <EmptyState art={<History className="size-10" />} title="Compare versões">
              Escolha uma versão ao lado para ver o que entrou, saiu ou mudou de edição até a lista de hoje.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function DiffView({ diff, when }: { diff: DeckDiff; when: string | null }) {
  const name = (i: { name: string | null; name_pt: string | null }) => i.name_pt || i.name || "—";
  const nothing = !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.reprinted.length;
  return (
    <div className="board space-y-4 p-4">
      <p className="text-[15px] text-cream-dim">
        De {dateLabel(when, true)} ({diff.count_before} cartas) para hoje ({diff.count_after} cartas) · {diff.unchanged} sem mudança
      </p>
      {nothing && <p className="parchment px-3 py-2.5 font-serif text-[16px]">Nenhuma diferença: a lista é a mesma.</p>}
      {diff.added.length > 0 && (
        <DiffGroup title="entraram" tone="text-moss-300" icon={<Plus className="size-4" />}>
          {diff.added.map((i) => (
            <li key={i.oracle_id}>
              <span className="tabular text-moss-300">+{i.quantity}</span> {name(i)}
            </li>
          ))}
        </DiffGroup>
      )}
      {diff.removed.length > 0 && (
        <DiffGroup title="saíram" tone="text-wine-300" icon={<Minus className="size-4" />}>
          {diff.removed.map((i) => (
            <li key={i.oracle_id}>
              <span className="tabular text-wine-300">−{i.quantity}</span> {name(i)}
            </li>
          ))}
        </DiffGroup>
      )}
      {diff.changed.length > 0 && (
        <DiffGroup title="mudou a quantidade" tone="text-amber-300" icon={<Repeat className="size-4" />}>
          {diff.changed.map((i) => (
            <li key={i.oracle_id}>
              {name(i)}{" "}
              <span className="tabular text-cream-faint">
                {i.before} → {i.after}
              </span>
            </li>
          ))}
        </DiffGroup>
      )}
      {diff.reprinted.length > 0 && (
        <DiffGroup title="trocou de edição, idioma ou acabamento" tone="text-steel-300" icon={<Repeat className="size-4" />}>
          {diff.reprinted.map((i) => (
            <li key={i.oracle_id}>
              {name(i)}
              <span className="block text-[13px] text-cream-faint">
                {i.before.map(printLabel).join(", ")} → {i.after.map(printLabel).join(", ")}
              </span>
            </li>
          ))}
        </DiffGroup>
      )}
    </div>
  );
}

function DiffGroup({ title, tone, icon, children }: { title: string; tone: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className={cx("mb-1.5 flex items-center gap-1.5 font-caps text-[15px] font-bold lowercase tracking-[0.04em]", tone)}>
        {icon} {title}
      </p>
      <ul className="space-y-1 pl-6 text-[15px] text-cream">{children}</ul>
    </div>
  );
}
