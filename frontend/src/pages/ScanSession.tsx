import { ArrowRight, BookmarkCheck, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Chest, Lens, Scales } from "../components/icons";
import AttentionList from "../components/review/AttentionList";
import BracketPanel from "../components/review/BracketPanel";
import EntryList from "../components/review/EntryList";
import ExportPanel from "../components/review/ExportPanel";
import NoticeBoard from "../components/review/NoticeBoard";
import PhotoViewer from "../components/review/PhotoViewer";
import ValueBox from "../components/review/ValueBox";
import AddCardSheet from "../components/scan/AddCardSheet";
import CapturePanel from "../components/scan/CapturePanel";
import CheckPanel from "../components/scan/CheckPanel";
import SaveDialog from "../components/scan/SaveDialog";
import { Board, Button, Confirm, Count, cx, EmptyState, InlineEdit, Menu, Select, Skeleton, Tabs, Tag, type Tone } from "../components/ui";
import { api } from "../lib/api";
import { relativeDay } from "../lib/format";
import { useMediaQuery, useResource } from "../lib/hooks";
import { Link, navigate } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import type { Capture, SessionState } from "../lib/types";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  capturing: { label: "Capturando", tone: "info" },
  processing: { label: "Lendo cartas", tone: "info" },
  review: { label: "Para revisar", tone: "warn" },
  saved: { label: "Guardado", tone: "ok" },
  error: { label: "Com erro", tone: "bad" },
};

type MobileTab = "capture" | "list" | "summary";

export default function ScanSession({ id }: { id: string }) {
  const res = useResource(() => api.session(id), [id]);
  const games = useResource(() => api.games(), []);
  const formats = (games.data?.find((g) => g.id === (res.data?.session.game_id ?? "mtg"))?.formats ?? []).filter((f) => f.id !== "collection");
  const state = res.data;
  const apply = res.setData as (s: SessionState) => void;
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [tab, setTab] = useState<MobileTab>("capture");
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ capture: Capture; detectionId?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const reload = res.reload;

  // outra aba/aparelho processando fotos desta sessão: acompanha até terminar
  const processing = state?.session.status === "processing";
  useEffect(() => {
    if (!processing || busy) return;
    const t = window.setInterval(() => void reload(), 4000);
    return () => window.clearInterval(t);
  }, [processing, busy, reload]);

  const onBusyChange = useCallback((b: boolean) => setBusy(b), []);
  const cards = useMemo(() => new Map((state?.entries ?? []).map((e) => [e.card_ref_id, e.card])), [state?.entries]);
  const listKey = useMemo(() => (state?.entries ?? []).map((e) => `${e.card_ref_id}:${e.quantity}:${e.is_commander ? 1 : 0}`).join("|"), [state?.entries]);

  if (res.loading && !state)
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-2/3 rounded-md" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  if (!state)
    return (
      <Board>
        <EmptyState art={<Lens size={44} />} title="Não encontrei esta mesa" action={<Button onClick={() => navigate("/")}>Voltar à taverna</Button>}>
          {res.error ?? "Ela pode ter sido apagada."}
        </EmptyState>
      </Board>
    );

  const { session, format, entries, validation } = state;
  const isCheck = session.purpose === "check";
  const isCollection = session.settings?.intent === "collection" || session.format_id === "collection";
  const status = STATUS[session.status] ?? STATUS.review;
  const count = entries.reduce((n, e) => n + e.quantity, 0);
  const game = state.game;
  const mtg = format;

  async function patchFormat(formatId: string) {
    try {
      apply(await api.patchSession(id, { format_id: formatId }));
      toast("Formato trocado — a lista foi revalidada");
    } catch (e) {
      toastError(e);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await api.deleteSession(id);
      toast("Scan apagado");
      navigate("/");
    } catch (e) {
      toastError(e);
      setDeleting(false);
    }
  }

  function jump(entryId: string) {
    setFocus(entryId);
    if (!desktop) setTab("list");
    window.setTimeout(() => document.getElementById(`entry-${entryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }

  const kicker = isCheck ? (
    <span className="inline-flex items-center gap-1.5">
      <Scales size={15} /> Conferindo deck
    </span>
  ) : isCollection ? (
    <span className="inline-flex items-center gap-1.5">
      <Chest size={15} /> Guardando na coleção
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5">
      <Lens size={15} /> Montando lista
    </span>
  );

  const primary = isCheck ? null : (
    <Button variant="primary" icon={isCollection ? <Chest size={18} /> : <BookmarkCheck className="size-[18px]" />} disabled={!count || busy} onClick={() => setSaveOpen(true)}>
      {session.status === "saved" ? "Guardar de novo" : isCollection ? "Guardar na coleção" : "Salvar deck"}
    </Button>
  );

  const capture = <CapturePanel state={state} onState={apply} onBusyChange={onBusyChange} />;
  const review = (
    <div className="space-y-6">
      {isCheck && <CheckPanel state={state} scanning={busy} />}
      <AttentionList state={state} apply={apply} onShowCapture={(c, detectionId) => setViewer({ capture: c, detectionId })} />
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-title-3 font-semibold text-cream">A lista</h2>
          <div className="flex items-center gap-3">
            <span className="tabular text-footnote text-cream-faint">{count === 1 ? "1 carta" : `${count} cartas`}</span>
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Adicionar carta
            </Button>
          </div>
        </div>
        <EntryList
          entries={entries}
          detections={state.detections}
          format={format}
          game={game}
          onState={(s) => apply(s as SessionState)}
          ownedElsewhere={state.owned_elsewhere}
          fxRate={state.value?.fx?.rate}
          focusId={focus}
          empty={{ title: "A mesa está vazia", text: "Use a câmera, fotos ou um vídeo acima, ou adicione pelo nome. Cada carta lida entra aqui na hora." }}
        />
      </section>
    </div>
  );
  const summary = (
    <div className="space-y-6">
      {session.status === "saved" && session.saved_deck_id && (
        <Link to={`/decks/${session.saved_deck_id}`} className="parchment flex min-h-12 items-center gap-3 px-4 py-3 font-serif text-body font-semibold text-ink-900 transition-[filter] hover:brightness-105">
          <BookmarkCheck className="size-5 text-moss-600" />
          <span className="min-w-0 flex-1 truncate">Guardado no deck {session.saved_deck_name ?? ""}</span>
          <ArrowRight className="size-4" />
        </Link>
      )}
      <NoticeBoard
        validation={validation}
        format={format}
        entries={entries}
        onJump={jump}
        applySuggestion={async (type) => {
          const next = await api.applySessionSuggestion(id, type);
          apply(next);
          return next;
        }}
      />
      {state.value && <ValueBox value={state.value} valuable={state.valuable ?? []} cards={cards} />}
      {mtg.requires_commander && count > 0 && <BracketPanel load={() => api.sessionBracket(id)} refreshKey={listKey} />}
      {count > 0 && game.exporters.length > 0 && <ExportPanel kind="sessions" id={id} exporters={game.exporters} name={session.name || "scan"} />}
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2 max-sm:basis-full">
          <p className="eyebrow">{kicker}</p>
          <h1 className="font-display text-title-1 font-semibold text-cream sm:text-display">
            <InlineEdit
              label="Nome do scan"
              value={session.name ?? ""}
              placeholder={isCheck ? `Conferência de ${session.target_deck_name ?? "deck"}` : "Scan sem nome"}
              onSave={async (name) => apply(await api.patchSession(id, { name }))}
              className="font-display"
            />
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-footnote text-cream-faint">
            <Tag tone={busy ? "live" : status.tone}>{busy ? "Capturando" : status.label}</Tag>
            {!isCheck && !isCollection ? (
              <span className="inline-block w-56">
                <Select aria-label="Formato" value={session.format_id} onChange={(e) => void patchFormat(e.target.value)} className="h-10 text-subhead" disabled={busy}>
                  {(formats.length ? formats : [format]).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </span>
            ) : (
              <span>{isCheck ? format.name : "Sem formato"}</span>
            )}
            <span>Criado {relativeDay(session.created_at)}</span>
            {session.target_deck_id && (
              <Link to={`/decks/${session.target_deck_id}`} className="text-brass-300 hover:underline">
                Deck {state.check?.available ? state.check.deck.name : (session.target_deck_name ?? "")}
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-between">
          {primary}
          <Menu items={[{ label: "Apagar este scan", icon: <Trash2 className="size-[18px]" />, tone: "danger", disabled: busy, onSelect: () => setConfirmDelete(true) }]} />
        </div>
      </header>

      {desktop ? (
        <div className="grid grid-cols-[minmax(0,1fr)_350px] gap-8">
          <div className="space-y-8">
            {capture}
            {review}
          </div>
          <aside className="space-y-6">{summary}</aside>
        </div>
      ) : (
        <>
          <Tabs<MobileTab>
            value={tab}
            onChange={setTab}
            className="bar-glass sticky top-16 z-20 -mx-4 px-4"
            tabs={[
              { value: "capture", label: "Capturar" },
              { value: "list", label: "Lista", badge: <Count>{count}</Count> },
              {
                value: "summary",
                label: "Resumo",
                badge: validation.issues.some((i) => i.severity === "error") ? <span className="size-2 rounded-full bg-wine-400" aria-label="há problemas" /> : null,
              },
            ]}
          />
          {/* a captura continua montada nas outras abas: trocar de aba não interrompe a câmera */}
          <div className={cx(tab !== "capture" && "hidden")}>{capture}</div>
          {tab === "capture" && entries.length > 0 && (
            <button type="button" onClick={() => setTab("list")} className="glass flex min-h-14 w-full items-center justify-between px-4 py-3 text-left transition-transform duration-500 ease-spring active:scale-[0.98] active:duration-100">
              <span className="text-headline font-semibold text-cream">{count === 1 ? "1 carta na lista" : `${count} cartas na lista`}</span>
              <span className="inline-flex items-center gap-1 text-subhead font-semibold text-brass-300">
                Revisar <ArrowRight className="size-4" />
              </span>
            </button>
          )}
          {tab === "list" && review}
          {tab === "summary" && summary}
        </>
      )}

      {saveOpen && <SaveDialog state={state} open={saveOpen} onClose={() => setSaveOpen(false)} onSaved={apply} />}
      {adding && <AddCardSheet state={state} onState={apply} onClose={() => setAdding(false)} />}
      <PhotoViewer capture={viewer?.capture ?? null} detections={state.detections} focusId={viewer?.detectionId} onClose={() => setViewer(null)} />
      <Confirm open={confirmDelete} title="Apagar este scan?" confirmLabel="Apagar" danger busy={deleting} onConfirm={remove} onClose={() => setConfirmDelete(false)}>
        <p>As leituras e fotos deste scan somem. Decks e cartas já guardadas na coleção continuam onde estão.</p>
      </Confirm>
    </div>
  );
}
