import { FileInput, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import CardSearch from "../components/cards/CardSearch";
import AllocationPanel from "../components/deck/AllocationPanel";
import HistoryPanel from "../components/deck/HistoryPanel";
import ShoppingPanel from "../components/deck/ShoppingPanel";
import { Lens, Scales, Tome } from "../components/icons";
import { IdentityPips } from "../components/mtg";
import BracketPanel from "../components/review/BracketPanel";
import EntryList from "../components/review/EntryList";
import ExportPanel from "../components/review/ExportPanel";
import NoticeBoard from "../components/review/NoticeBoard";
import ValueBox from "../components/review/ValueBox";
import { Board, Button, Confirm, Count, EmptyState, InlineEdit, Menu, Modal, Segmented, Select, Skeleton, Tabs, Textarea } from "../components/ui";
import { api, type ImportResult } from "../lib/api";
import { artCrop, cardName, relativeDay } from "../lib/format";
import { useMediaQuery, useResource } from "../lib/hooks";
import { navigate } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import type { DeckState } from "../lib/types";

type Tab = "list" | "physical" | "shopping" | "history" | "export";

export default function DeckPage({ id }: { id: string }) {
  const res = useResource(() => api.deck(id), [id]);
  const games = useResource(() => api.games(), []);
  const state = res.data;
  const apply = res.setData as (s: DeckState) => void;
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [tab, setTab] = useState<Tab>("list");
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const formats = (games.data?.find((g) => g.id === "mtg")?.formats ?? []).filter((f) => f.id !== "collection");

  const cards = useMemo(() => new Map((state?.entries ?? []).map((e) => [e.card_ref_id, e.card])), [state?.entries]);
  const listKey = useMemo(() => (state?.entries ?? []).map((e) => `${e.card_ref_id}:${e.quantity}:${e.is_commander ? 1 : 0}`).join("|"), [state?.entries]);

  if (res.loading && !state)
    return (
      <div className="space-y-6">
        <Skeleton className="h-44 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  if (!state)
    return (
      <Board>
        <EmptyState art={<Tome size={44} />} title="Deck não encontrado" action={<Button onClick={() => navigate("/decks")}>Ver os decks</Button>}>
          {res.error ?? "Ele pode ter sido apagado."}
        </EmptyState>
      </Board>
    );

  const { deck, format, entries, validation, allocation } = state;
  const commanders = entries.filter((e) => e.is_commander);
  const cover = commanders[0]?.card ?? entries.find((e) => e.card_ref_id === deck.cover_card_ref_id)?.card ?? entries[0]?.card;
  const art = artCrop(cover);
  const identity = validation.commander?.identity ?? [];

  async function startCheck() {
    setChecking(true);
    try {
      const session = await api.createSession({ game_id: deck.game_id, format_id: deck.format_id, mode: "video", purpose: "check", target_deck_id: deck.id, name: `Conferência · ${deck.name}` });
      navigate(`/s/${session.id}`);
    } catch (e) {
      toastError(e);
      setChecking(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const r = await api.deleteDeck(deck.id);
      toast(r.moved_to_loose ? `Deck apagado · ${r.moved_to_loose} cartas foram para Solto` : "Deck apagado");
      navigate("/decks");
    } catch (e) {
      toastError(e);
      setDeleting(false);
    }
  }

  const tabs = [
    { value: "list" as const, label: "Lista", badge: <Count>{deck.card_count}</Count> },
    {
      value: "physical" as const,
      label: "Cartas físicas",
      badge: allocation.totals.conflict + allocation.totals.move > 0 ? <span className="size-2 rounded-full bg-ember-400" aria-label="há cartas para organizar" /> : null,
    },
    { value: "shopping" as const, label: "Compras", badge: allocation.totals.buy ? <Count>{allocation.totals.buy}</Count> : null },
    { value: "history" as const, label: "Histórico" },
    ...(desktop ? [] : [{ value: "export" as const, label: "Exportar" }]),
  ];

  const aside = (
    <div className="space-y-6">
      <NoticeBoard
        validation={validation}
        format={format}
        entries={entries}
        onJump={(entryId) => {
          setTab("list");
          window.setTimeout(() => document.getElementById(`entry-${entryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
        }}
        applySuggestion={async (type) => {
          const next = await api.applyDeckSuggestion(deck.id, type);
          apply(next);
          return next;
        }}
      />
      {state.print_issues.length > 0 && (
        <ul className="space-y-2">
          {state.print_issues.map((p) => (
            <li key={p.entry_id} className="parchment border-l-4 border-l-ember-600 px-4 py-3 text-subhead">
              {p.message}
            </li>
          ))}
        </ul>
      )}
      <ValueBox value={state.value} valuable={(state.value.top ?? []).filter((i) => i.unit_brl >= 20)} cards={cards} />
      {state.brackets_apply && deck.card_count > 0 && <BracketPanel load={() => api.bracket(deck.id)} refreshKey={listKey} />}
      {desktop && deck.card_count > 0 && <ExportPanel kind="decks" id={deck.id} exporters={state.game.exporters} name={deck.name} />}
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="glass relative overflow-hidden">
        {art && <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover object-[center_30%] opacity-40" />}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(22_16_12/0.96)_18%,rgb(22_16_12/0.8)_55%,rgb(22_16_12/0.45))]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 pt-12 pb-5 sm:px-8 sm:pt-20 sm:pb-6">
          <div className="min-w-0 flex-1 space-y-2 max-sm:basis-full">
            <p className="eyebrow">Deck · atualizado {relativeDay(deck.updated_at ?? deck.created_at)}</p>
            <h1 className="font-display text-title-1 font-semibold text-cream sm:text-display">
              <InlineEdit label="Nome do deck" value={deck.name} placeholder="Deck sem nome" onSave={async (name) => name && apply(await api.patchDeck(deck.id, { name }))} className="font-display" />
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-subhead text-cream-dim">
              {identity.length > 0 && <IdentityPips colors={identity} size={18} />}
              {commanders.length > 0 && <span className="font-serif text-cream">{commanders.map((e) => cardName(e.card)).join(" & ")}</span>}
              <span className="inline-block w-56">
                <Select
                  aria-label="Formato do deck"
                  value={deck.format_id}
                  className="h-10 text-subhead"
                  onChange={async (e) => {
                    try {
                      apply(await api.patchDeck(deck.id, { format_id: e.target.value }));
                      toast("Formato trocado — a lista foi revalidada");
                    } catch (err) {
                      toastError(err);
                    }
                  }}
                >
                  {(formats.length ? formats : [format]).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </span>
              <span className="tabular">{deck.card_count} cartas</span>
            </div>
          </div>
          <div className="flex items-center gap-2 max-sm:w-full">
            <Button variant="primary" icon={<Scales size={18} />} busy={checking} disabled={!deck.card_count} onClick={startCheck} className="max-sm:flex-1" title="Escanear o baralho físico e comparar com esta lista">
              Conferir
            </Button>
            <Button icon={<FileInput className="size-4" />} onClick={() => setImporting(true)} className="max-sm:flex-1">
              Importar
            </Button>
            <Menu
              items={[
                { label: "Escanear outro deck", icon: <Lens size={18} />, onSelect: () => navigate("/escanear") },
                { label: "Apagar deck", icon: <Trash2 className="size-[18px]" />, tone: "danger", onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </div>
        </div>
      </header>

      <div className={desktop ? "grid grid-cols-[minmax(0,1fr)_350px] gap-8" : "space-y-6"}>
        <div className="min-w-0 space-y-5">
          <Tabs value={tab} onChange={setTab} tabs={tabs} className={desktop ? undefined : "bar-glass sticky top-16 z-20 -mx-4 px-4"} />
          {tab === "list" && (
            <div className="space-y-4">
              {adding ? (
                <div className="glass space-y-3 p-4">
                  <CardSearch
                    autoFocus
                    placeholder="Adicionar carta pelo nome…"
                    onPick={async (c) => {
                      try {
                        apply(await api.addDeckEntry(deck.id, { card_ref_id: c.id }));
                        toast(`${cardName(c)} entrou no deck`);
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  />
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                    Fechar
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="tertiary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                  Adicionar carta
                </Button>
              )}
              <EntryList
                entries={entries}
                format={format}
                game={state.game}
                onState={(s) => apply(s as DeckState)}
                fxRate={state.value.fx?.rate}
                empty={{ title: "Deck vazio", text: "Importe uma lista, adicione cartas pelo nome ou salve um scan neste deck." }}
              />
            </div>
          )}
          {tab === "physical" && <AllocationPanel state={state} onState={apply} onShop={() => setTab("shopping")} />}
          {tab === "shopping" && <ShoppingPanel deckId={deck.id} refreshKey={`${listKey}|${allocation.totals.buy}`} />}
          {tab === "history" && <HistoryPanel state={state} onSnapshot={() => void res.reload()} />}
          {tab === "export" && <ExportPanel kind="decks" id={deck.id} exporters={state.game.exporters} name={deck.name} />}
          {!desktop && tab === "list" && aside}
        </div>
        {desktop && <aside>{aside}</aside>}
      </div>

      {importing && <ImportDialog deck={state} onClose={() => setImporting(false)} onDone={apply} />}
      <Confirm open={confirmDelete} title={`Apagar ${deck.name}?`} confirmLabel="Apagar deck" danger busy={deleting} onConfirm={remove} onClose={() => setConfirmDelete(false)}>
        <p>A lista e o histórico somem. As cartas físicas registradas neste deck não são apagadas: vão para “Solto” na coleção.</p>
      </Confirm>
    </div>
  );
}

function ImportDialog({ deck, onClose, onDone }: { deck: DeckState; onClose: () => void; onDone: (s: DeckState) => void }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"replace" | "add">(deck.entries.length ? "add" : "replace");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await api.importDeck(deck.deck.id, { text, replace: mode === "replace" });
      onDone(res.state);
      if (res.import.unresolved.length || res.import.print_warnings.length) setReport(res.import);
      else {
        toast(`${res.import.imported} cartas importadas`);
        onClose();
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={report ? "Importado, com ressalvas" : "Importar lista"}
      width="lg"
      footer={
        report ? (
          <Button variant="primary" onClick={onClose}>
            Entendi
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={run}>
              {mode === "replace" ? "Substituir lista" : "Adicionar cartas"}
            </Button>
          </>
        )
      }
    >
      {report ? (
        <div className="space-y-3 text-subhead">
          <p className="text-cream-dim">{report.imported} cartas entraram.</p>
          {report.unresolved.length > 0 && (
            <ul className="well max-h-48 space-y-1 overflow-y-auto px-4 py-3 font-mono text-footnote text-wine-300">
              {report.unresolved.map((u) => (
                <li key={u.line}>
                  linha {u.line}: {u.text}
                </li>
              ))}
            </ul>
          )}
          {report.print_warnings.map((w) => (
            <p key={w.line} className="text-subhead text-ember-300">
              linha {w.line}: {w.message}
            </p>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "add", label: "Adicionar à lista" },
              { value: "replace", label: "Substituir a lista", hint: "a lista atual vai para o histórico" },
            ]}
          />
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} autoFocus className="font-mono text-body" placeholder={"1 Sol Ring\n4 Raio (M11) 149\n\nSideboard\n2 Pyroblast"} aria-label="Lista para importar" />
          <p className="text-footnote text-cream-faint">Aceita listas do Moxfield, LigaMagic, Arena e Archidekt, com nomes em português ou inglês.</p>
        </div>
      )}
    </Modal>
  );
}
