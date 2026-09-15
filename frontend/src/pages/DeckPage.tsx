import { FileInput, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Board, Button, Confirm, EmptyState, IconButton, InlineEdit, Modal, Segmented, Select, Skeleton, Tabs, Textarea } from "../components/ui";
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
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const formats = (games.data?.find((g) => g.id === "mtg")?.formats ?? []).filter((f) => f.id !== "collection");

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const cards = useMemo(() => new Map((state?.entries ?? []).map((e) => [e.card_ref_id, e.card])), [state?.entries]);
  const listKey = useMemo(() => (state?.entries ?? []).map((e) => `${e.card_ref_id}:${e.quantity}:${e.is_commander ? 1 : 0}`).join("|"), [state?.entries]);

  if (res.loading && !state)
    return (
      <div className="space-y-6">
        <Skeleton className="h-44" />
        <Skeleton className="h-96" />
      </div>
    );
  if (!state)
    return (
      <Board>
        <EmptyState art={<Tome size={46} />} title="Deck não encontrado" action={<Button onClick={() => navigate("/decks")}>ver a estante</Button>}>
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
    { value: "list" as const, label: "lista", badge: <span className="tabular text-[13px] text-cream-faint">{deck.card_count}</span> },
    {
      value: "physical" as const,
      label: "cartas físicas",
      badge: allocation.totals.conflict + allocation.totals.move > 0 ? <span className="size-2 rounded-full bg-amber-400" aria-label="há cartas para organizar" /> : null,
    },
    { value: "shopping" as const, label: "compras", badge: allocation.totals.buy ? <span className="tabular text-[13px] text-cream-faint">{allocation.totals.buy}</span> : null },
    { value: "history" as const, label: "histórico" },
    ...(desktop ? [] : [{ value: "export" as const, label: "exportar" }]),
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
            <li key={p.entry_id} className="parchment border-l-4 border-l-amber-600 px-3 py-2 text-[14px]">
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
      <header className="board relative overflow-hidden">
        {art && <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover object-[center_30%] opacity-35" />}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-oak-900)_15%,rgb(22_16_12/0.82)_55%,rgb(22_16_12/0.55))]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 pt-10 pb-5 sm:px-6 sm:pt-16">
          <div className="min-w-0 flex-1 space-y-1.5 max-sm:basis-full">
            <p className="kicker text-[13px] text-brass-400">
              deck · atualizado {relativeDay(deck.updated_at ?? deck.created_at)}
            </p>
            <h1 className="font-display text-[34px] leading-[1.05] font-semibold text-cream sm:text-[46px]">
              <InlineEdit label="Nome do deck" value={deck.name} placeholder="Deck sem nome" onSave={async (name) => name && apply(await api.patchDeck(deck.id, { name }))} className="font-display" />
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-cream-dim">
              {identity.length > 0 && <IdentityPips colors={identity} size={18} />}
              {commanders.length > 0 && <span className="font-serif text-cream">{commanders.map((e) => cardName(e.card)).join(" & ")}</span>}
              <span className="inline-block w-52">
                <Select
                  aria-label="Formato do deck"
                  value={deck.format_id}
                  className="h-8 py-0 pr-8 text-[14px]"
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
            <Button variant="brass" icon={<Scales size={18} />} busy={checking} disabled={!deck.card_count} onClick={startCheck} className="whitespace-nowrap max-sm:flex-1" title="Escanear o baralho físico e comparar com esta lista">
              conferir
            </Button>
            <Button icon={<FileInput className="size-4" />} onClick={() => setImporting(true)} className="max-sm:flex-1">
              importar
            </Button>
            <div className="relative" ref={menuRef}>
              <IconButton label="Mais ações" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
                <MoreHorizontal className="size-5" />
              </IconButton>
              {menu && (
                <div className="board animate-rise absolute right-0 z-30 mt-1 w-56 p-1" role="menu">
                  <button role="menuitem" onClick={() => navigate("/escanear")} className="flex w-full items-center gap-2 rounded-[4px] px-3 py-2 text-left text-[15px] text-cream-dim hover:bg-oak-700/60">
                    <Lens size={16} /> escanear outro deck
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setConfirmDelete(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-[4px] px-3 py-2 text-left text-[15px] text-wine-300 hover:bg-wine-600/15"
                  >
                    <Trash2 className="size-4" /> apagar deck
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className={desktop ? "grid grid-cols-[minmax(0,1fr)_350px] gap-8" : "space-y-6"}>
        <div className="min-w-0 space-y-5">
          <Tabs value={tab} onChange={setTab} tabs={tabs} className={desktop ? undefined : "sticky top-16 z-20 -mx-4 bg-oak-900/95 px-4"} />
          {tab === "list" && (
            <div className="space-y-4">
              {adding ? (
                <div className="board space-y-2 p-3">
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
                  <Button size="xs" variant="ghost" onClick={() => setAdding(false)}>
                    fechar
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                  adicionar carta
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
      <Confirm open={confirmDelete} title={`Apagar ${deck.name}?`} confirmLabel="apagar deck" danger busy={deleting} onConfirm={remove} onClose={() => setConfirmDelete(false)}>
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
          <Button variant="brass" onClick={onClose}>
            entendi
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              cancelar
            </Button>
            <Button variant="brass" busy={busy} disabled={!text.trim()} onClick={run}>
              {mode === "replace" ? "substituir lista" : "adicionar cartas"}
            </Button>
          </>
        )
      }
    >
      {report ? (
        <div className="space-y-3 text-[15px]">
          <p className="text-cream-dim">{report.imported} cartas entraram.</p>
          {report.unresolved.length > 0 && (
            <ul className="board-sunken max-h-48 space-y-1 overflow-y-auto px-3 py-2 font-mono text-[13px] text-wine-300">
              {report.unresolved.map((u) => (
                <li key={u.line}>
                  linha {u.line}: {u.text}
                </li>
              ))}
            </ul>
          )}
          {report.print_warnings.map((w) => (
            <p key={w.line} className="text-[14px] text-amber-300">
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
              { value: "add", label: "adicionar à lista" },
              { value: "replace", label: "substituir a lista", hint: "a lista atual vai para o histórico" },
            ]}
          />
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} autoFocus className="font-mono text-[13px]" placeholder={"1 Sol Ring\n4 Raio (M11) 149\n\nSideboard\n2 Pyroblast"} aria-label="Lista para importar" />
          <p className="text-[13px] text-cream-faint">Aceita listas do Moxfield, LigaMagic, Arena e Archidekt, com nomes em português ou inglês.</p>
        </div>
      )}
    </Modal>
  );
}
