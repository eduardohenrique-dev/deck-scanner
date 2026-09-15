import { FolderPlus, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import CardSearch from "../components/cards/CardSearch";
import { Chest, Tome } from "../components/icons";
import { ArtThumb, CardImage, FinishMark, LanguagePill, Money, SetSymbol } from "../components/mtg";
import { Board, Button, Confirm, cx, Drawer, EmptyState, Field, InlineEdit, Input, Modal, PageTitle, Select, Skeleton, Stepper } from "../components/ui";
import { api } from "../lib/api";
import { cardName, LOCATION_LABEL, plural } from "../lib/format";
import { useDebounced, usePersistentState, useResource } from "../lib/hooks";
import { Link, useLocation } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import type { CardSummary, CollectionGroup, Location, PhysicalCopy } from "../lib/types";

type Sort = "name" | "value" | "recent";

const locName = (l: Pick<Location, "type" | "name">) => (l.type === "loose" ? "Solto" : l.name);

export default function Collection() {
  const { query } = useLocation();
  const [locationId, setLocationId] = useState(query.get("local") ?? "");
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const [sort, setSort] = usePersistentState<Sort>("deckscanner:collection-sort", "name");
  const locations = useResource(() => api.locations(), []);
  const data = useResource(() => api.collection({ location_id: locationId || undefined, q: dq || undefined, sort }), [locationId, dq, sort]);
  const [open, setOpen] = useState<CollectionGroup | null>(null);
  const [creating, setCreating] = useState<"binder" | "box" | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const all = locations.data ?? [];
  const current = all.find((l) => l.id === locationId) ?? null;
  const groups = useMemo(
    () => [
      { label: "sem lugar", items: all.filter((l) => l.type === "loose") },
      { label: "pastas", items: all.filter((l) => l.type === "binder") },
      { label: "caixas", items: all.filter((l) => l.type === "box") },
      { label: "decks", items: all.filter((l) => l.type === "deck") },
    ],
    [all],
  );
  const refresh = () => {
    void data.reload();
    void locations.reload();
  };

  async function removeLocation() {
    if (!current) return;
    try {
      const r = await api.deleteLocation(current.id);
      toast(r.moved_to_loose ? `${current.name} apagada · ${plural(r.moved_to_loose, "carta foi", "cartas foram")} para Solto` : `${current.name} apagada`);
      setLocationId("");
      setConfirmDelete(false);
      void locations.reload();
    } catch (e) {
      toastError(e);
    }
  }

  const sidebar = (
    <nav aria-label="Lugares da coleção" className="space-y-4">
      <button
        onClick={() => setLocationId("")}
        aria-current={!locationId ? "page" : undefined}
        className={cx("flex w-full items-center justify-between rounded-[5px] px-3 py-2 text-left font-serif text-[17px]", !locationId ? "bg-brass-400/12 text-brass-200" : "text-cream hover:bg-oak-800")}
      >
        Tudo
        <span className="tabular text-[14px] text-cream-faint">{all.reduce((n, l) => n + l.card_count, 0)}</span>
      </button>
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.label}>
              <p className="kicker mb-1 px-3 text-[12px] text-cream-faint">{g.label}</p>
              <ul>
                {g.items.map((l) => (
                  <li key={l.id}>
                    <button
                      onClick={() => setLocationId(l.id)}
                      aria-current={locationId === l.id ? "page" : undefined}
                      className={cx("flex w-full items-center gap-2 rounded-[5px] px-3 py-1.5 text-left text-[15px]", locationId === l.id ? "bg-brass-400/12 text-brass-200" : "text-cream-dim hover:bg-oak-800 hover:text-cream")}
                    >
                      {l.type === "deck" ? <Tome size={15} className="shrink-0 text-cream-faint" /> : <Chest size={15} className="shrink-0 text-cream-faint" />}
                      <span className="min-w-0 flex-1 truncate">{locName(l)}</span>
                      <span className="tabular text-[13px] text-cream-faint">{l.card_count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
      <div className="flex flex-wrap gap-1.5 px-1">
        <Button size="xs" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => setCreating("binder")}>
          nova pasta
        </Button>
        <Button size="xs" variant="ghost" icon={<PackagePlus className="size-3.5" />} onClick={() => setCreating("box")}>
          nova caixa
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle kicker="o baú" title="Coleção">
          Cada carta física e onde ela está: solta, numa pasta, numa caixa ou dentro de um deck.
        </PageTitle>
        <Button variant="brass" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
          adicionar carta
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="max-lg:hidden">
          <Board className="sticky top-24 p-2">{locations.loading ? <Skeleton className="h-40" /> : sidebar}</Board>
        </aside>

        <div className="min-w-0 space-y-4">
          {/* no celular os lugares viram fichas roláveis */}
          <div className="scrollbar-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
            {[{ id: "", type: "loose" as const, name: "Tudo", card_count: all.reduce((n, l) => n + l.card_count, 0) }, ...all].map((l) => (
              <button
                key={l.id || "all"}
                onClick={() => setLocationId(l.id)}
                className={cx("h-9 shrink-0 rounded-full border px-3.5 text-[14px] whitespace-nowrap", locationId === l.id ? "border-brass-400 bg-brass-400/15 text-brass-200" : "border-oak-600 text-cream-dim")}
              >
                {l.id ? locName(l) : "Tudo"} <span className="text-cream-faint">{l.card_count}</span>
              </button>
            ))}
            <button onClick={() => setCreating("binder")} className="h-9 shrink-0 rounded-full border border-dashed border-oak-600 px-3.5 text-[14px] text-cream-faint">
              + pasta
            </button>
          </div>

          {current && current.type !== "loose" && (
            <Board className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="kicker text-[12px] text-cream-faint">{LOCATION_LABEL[current.type]}</p>
                {current.type === "deck" ? (
                  <Link to={`/decks/${current.deck_id}`} className="font-serif text-[21px] font-semibold text-cream hover:text-brass-200">
                    {current.name}
                  </Link>
                ) : (
                  <p className="font-serif text-[21px] font-semibold text-cream">
                    <InlineEdit
                      label="Nome do lugar"
                      value={current.name}
                      placeholder="Sem nome"
                      onSave={async (name) => {
                        if (!name) return;
                        await api.renameLocation(current.id, name);
                        void locations.reload();
                      }}
                    />
                  </p>
                )}
              </div>
              {current.type !== "deck" && (
                <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
                  apagar {current.type === "binder" ? "pasta" : "caixa"}
                </Button>
              )}
            </Board>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Stat label="cartas" value={data.data?.total_cards.toLocaleString("pt-BR")} />
            <Stat label="diferentes" value={data.data?.unique.toLocaleString("pt-BR")} />
            <Stat label="valor" value={data.data ? <Money brl={data.data.value.total_brl} /> : undefined} />
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-cream-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar carta (português ou inglês)" className="h-10 pl-9" aria-label="Buscar na coleção" />
            </div>
            <span className="inline-block w-44">
              <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-10" aria-label="Ordenar">
                <option value="name">por nome</option>
                <option value="value">mais valiosas</option>
                <option value="recent">mais recentes</option>
              </Select>
            </span>
          </div>

          {data.loading && !data.data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : data.data?.items.length ? (
            <ul className="board divide-y divide-oak-700/70 overflow-hidden">
              {data.data.items.map((g) => (
                <li key={g.oracle_id}>
                  <button onClick={() => setOpen(g)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-oak-750/60">
                    <span className="tabular grid h-9 w-9 shrink-0 place-items-center rounded-[4px] border border-oak-600 bg-oak-950/70 font-serif text-[18px] font-semibold text-cream">{g.count}</span>
                    <ArtThumb card={g.card} size={52} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-[17px] font-semibold text-cream">{cardName(g.card)}</span>
                      <span className="flex flex-wrap gap-x-2 text-[13px] text-cream-faint">
                        {g.locations.slice(0, 3).map((l) => (
                          <span key={`${l.id}`} className="truncate">
                            {l.type === "loose" ? "Solto" : l.name}
                            {g.locations.length > 1 || l.count > 1 ? ` ×${l.count}` : ""}
                          </span>
                        ))}
                        {g.locations.length > 3 && <span>+{g.locations.length - 3} lugares</span>}
                      </span>
                    </span>
                    <span className="hidden items-center gap-1.5 sm:flex">
                      <SetSymbol card={g.card} size={16} />
                      {g.prints.length > 1 && <span className="text-[12px] text-cream-faint">+{g.prints.length - 1}</span>}
                    </span>
                    <Money brl={g.value_brl || null} muted={!g.value_brl} className="w-24 text-right text-[15px]" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Board>
              <EmptyState
                art={<Chest size={48} />}
                title={dq ? "Nada encontrado" : current ? "Este lugar está vazio" : "O baú está vazio"}
                action={
                  !dq && (
                    <Link to="/escanear?finalidade=colecao" className="inline-flex h-11 items-center rounded-[5px] border border-brass-600/80 px-4 font-caps text-[15px] font-bold lowercase tracking-[0.03em] text-brass-300">
                      escanear cartas para guardar
                    </Link>
                  )
                }
              >
                {dq ? "Confira a grafia ou busque pelo nome em inglês." : "Guarde cartas escaneadas ou adicione pelo nome. Decks salvos também aparecem aqui."}
              </EmptyState>
            </Board>
          )}
        </div>
      </div>

      {open && <WhereIs group={open} locations={all} onClose={() => setOpen(null)} onChanged={refresh} />}
      {creating && (
        <NewLocation
          type={creating}
          onClose={() => setCreating(null)}
          onCreated={(l) => {
            setCreating(null);
            void locations.reload();
            setLocationId(l.id);
          }}
        />
      )}
      {adding && <AddCard locations={all} defaultLocation={current && current.type !== "deck" ? current.id : ""} onClose={() => setAdding(false)} onAdded={refresh} />}
      <Confirm open={confirmDelete} title={`Apagar ${current?.name ?? ""}?`} confirmLabel="apagar" danger onConfirm={removeLocation} onClose={() => setConfirmDelete(false)}>
        <p>O lugar some; as cartas que estavam nele vão para “Solto”. Nenhuma carta é apagada.</p>
      </Confirm>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode | undefined }) {
  return (
    <div className="board-sunken px-3 py-2">
      <div className="font-caps text-[12px] font-bold lowercase tracking-[0.05em] text-cream-faint">{label}</div>
      <div className="tabular truncate font-serif text-[21px] leading-tight font-semibold text-cream">{value ?? <Skeleton className="mt-1 h-5 w-12" />}</div>
    </div>
  );
}

/** Onde está cada cópia desta carta — e mover ou tirar da coleção. */
function WhereIs({ group, locations, onClose, onChanged }: { group: CollectionGroup; locations: Location[]; onClose: () => void; onChanged: () => void }) {
  const copies = useResource(() => api.whereIs(group.oracle_id), [group.oracle_id]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const list = copies.data ?? [];
  const byPlace = useMemo(() => {
    const out = new Map<string, PhysicalCopy[]>();
    for (const c of list) {
      const key = c.location_id ?? "";
      out.set(key, [...(out.get(key) ?? []), c]);
    }
    return [...out.entries()];
  }, [list]);
  const destinations = locations.filter((l) => l.type !== "deck");

  useEffect(() => {
    if (!target && destinations.length) setTarget(destinations[0].id);
  }, [destinations, target]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function move() {
    setBusy(true);
    try {
      const r = await api.movePhysical([...selected], target);
      toast(`${plural(r.moved, "carta movida", "cartas movidas")}`);
      setSelected(new Set());
      void copies.reload();
      onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await api.deletePhysical([...selected]);
      toast(`${plural(r.deleted, "carta tirada", "cartas tiradas")} da coleção`);
      setSelected(new Set());
      setConfirm(false);
      void copies.reload();
      onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={cardName(group.card)}>
      <div className="space-y-5">
        <div className="flex gap-4">
          <CardImage card={group.card} className="w-32 shrink-0" eager />
          <div className="space-y-1 text-[15px] text-cream-dim">
            <p>{plural(group.count, "cópia física", "cópias físicas")}</p>
            {group.value_brl > 0 && (
              <p>
                valor estimado <Money brl={group.value_brl} />
              </p>
            )}
            <p className="text-[13px] text-cream-faint">Marque as cópias para mover de lugar ou tirar da coleção.</p>
          </div>
        </div>

        {copies.loading && !copies.data ? (
          <Skeleton className="h-40" />
        ) : (
          byPlace.map(([placeId, items]) => {
            const place = items[0];
            return (
              <section key={placeId}>
                <p className="mb-1.5 flex items-center gap-2 font-caps text-[14px] font-bold lowercase tracking-[0.04em] text-brass-300">
                  {place.location_type === "deck" ? <Tome size={15} /> : <Chest size={15} />}
                  {place.location_type === "loose" ? "Solto" : `${LOCATION_LABEL[place.location_type ?? ""] ?? ""} ${place.location_name ?? ""}`}
                </p>
                <ul className="board-sunken divide-y divide-oak-700">
                  {items.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="size-4 accent-[var(--color-brass-400)]" />
                        <SetSymbol card={c.card} size={16} />
                        <span className="font-mono text-[12px] text-cream-faint uppercase">
                          {c.card?.set_code} {c.card?.collector_number}
                        </span>
                        <LanguagePill lang={c.language} />
                        <FinishMark finish={c.finish} />
                        {c.condition && <span className="text-[13px] text-cream-dim">{c.condition}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}

        {selected.size > 0 && (
          <div className="board sticky bottom-0 space-y-2 p-3">
            <p className="text-[14px] text-cream-dim">{plural(selected.size, "cópia marcada", "cópias marcadas")}</p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-block min-w-40 flex-1">
                <Select value={target} onChange={(e) => setTarget(e.target.value)} className="h-9" aria-label="Mover para">
                  {destinations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.type === "loose" ? "Solto" : `${LOCATION_LABEL[l.type]}: ${l.name}`}
                    </option>
                  ))}
                </Select>
              </span>
              <Button size="sm" variant="brass" busy={busy} onClick={move}>
                mover
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>
                tirar
              </Button>
            </div>
            <p className="text-[12px] text-cream-faint">Para colocar num deck, use a aba “cartas físicas” do deck: ela avisa se a carta já estiver em outro.</p>
          </div>
        )}
      </div>
      <Confirm open={confirm} title="Tirar da coleção?" confirmLabel="tirar" danger busy={busy} onConfirm={remove} onClose={() => setConfirm(false)}>
        <p>Use quando a carta foi vendida, trocada ou perdida. A lista dos decks não muda.</p>
      </Confirm>
    </Drawer>
  );
}

function NewLocation({ type, onClose, onCreated }: { type: "binder" | "box"; onClose: () => void; onCreated: (l: Location) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      onCreated(await api.createLocation(type, name.trim()));
      toast(type === "binder" ? "Pasta criada" : "Caixa criada");
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={type === "binder" ? "Nova pasta" : "Nova caixa"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            cancelar
          </Button>
          <Button variant="brass" busy={busy} disabled={!name.trim()} onClick={create}>
            criar
          </Button>
        </>
      }
    >
      <Field label="nome">
        {(id) => (
          <Input id={id} autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && void create()} placeholder={type === "binder" ? "Ex.: pasta das raras" : "Ex.: caixa de trocas"} />
        )}
      </Field>
    </Modal>
  );
}

function AddCard({ locations, defaultLocation, onClose, onAdded }: { locations: Location[]; defaultLocation: string; onClose: () => void; onAdded: () => void }) {
  const [card, setCard] = useState<CardSummary | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [locationId, setLocationId] = useState(defaultLocation);
  const [finish, setFinish] = useState("nonfoil");
  const [busy, setBusy] = useState(false);
  const places = locations.filter((l) => l.type !== "deck");

  async function add() {
    if (!card) return;
    setBusy(true);
    try {
      await api.addPhysical({ card_ref_id: card.id, quantity, location_id: locationId || undefined, finish, language: card.lang });
      toast(`${quantity}× ${cardName(card)} na coleção`);
      onAdded();
      setCard(null);
      setQuantity(1);
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
      title="Adicionar à coleção"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            fechar
          </Button>
          <Button variant="brass" busy={busy} disabled={!card} onClick={add}>
            adicionar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {card ? (
          <div className="flex gap-4">
            <CardImage card={card} className="w-28 shrink-0" eager />
            <div className="min-w-0 space-y-3">
              <div>
                <p className="font-serif text-[19px] font-semibold text-cream">{cardName(card)}</p>
                <p className="text-[13px] text-cream-faint">
                  {card.set_name} · #{card.collector_number} · {card.lang.toUpperCase()}
                </p>
                <button onClick={() => setCard(null)} className="text-[13px] text-brass-300 hover:underline">
                  trocar carta
                </button>
              </div>
              <Stepper value={quantity} min={1} max={99} onChange={setQuantity} />
            </div>
          </div>
        ) : (
          <CardSearch autoFocus onPick={setCard} placeholder="Nome da carta…" />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="onde">
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Solto</option>
                {places
                  .filter((l) => l.type !== "loose")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {LOCATION_LABEL[l.type]}: {l.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="acabamento">
            {(id) => (
              <Select id={id} value={finish} onChange={(e) => setFinish(e.target.value)}>
                <option value="nonfoil">normal</option>
                <option value="foil">foil</option>
                <option value="etched">etched</option>
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
