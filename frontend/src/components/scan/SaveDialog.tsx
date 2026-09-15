import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { cardName, LOCATION_LABEL } from "../../lib/format";
import { useResource } from "../../lib/hooks";
import { navigate } from "../../lib/router";
import { toast, toastError } from "../../lib/toast";
import type { Location, SavePreview, SessionState } from "../../lib/types";
import { Chest, Tome } from "../icons";
import { Button, cx, Field, Input, Modal, Segmented, Select, Skeleton } from "../ui";

type Target = "new_deck" | "existing_deck" | "collection";

/** Salvar o scan: vira deck (novo ou atualização) ou vai para a coleção — com a prévia das cartas que você já tem. */
export default function SaveDialog({ state, open, onClose, onSaved }: { state: SessionState; open: boolean; onClose: () => void; onSaved: (s: SessionState) => void }) {
  const { session } = state;
  const collectionFirst = session.settings?.intent === "collection" || session.format_id === "collection";
  const [target, setTarget] = useState<Target>(collectionFirst ? "collection" : "new_deck");
  const [deckName, setDeckName] = useState(session.name ?? "");
  const [deckId, setDeckId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [newLocation, setNewLocation] = useState<{ type: "binder" | "box"; name: string } | null>(null);
  const [register, setRegister] = useState(true);
  const [moves, setMoves] = useState<Record<string, boolean>>({});
  const [unscanned, setUnscanned] = useState<"keep" | "loose">("keep");
  const [preview, setPreview] = useState<SavePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const decks = useResource(() => (open ? api.decks() : Promise.resolve([])), [open]);
  const locations = useResource(() => (open ? api.locations() : Promise.resolve([] as Location[])), [open]);
  const storage = (locations.data ?? []).filter((l) => l.type !== "deck");

  const commanders = state.entries.filter((e) => e.is_commander).map((e) => cardName(e.card));
  useEffect(() => {
    if (open && !deckName) setDeckName(session.name || commanders.join(" & ") || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!deckId && decks.data?.length) setDeckId(decks.data[0].id);
  }, [decks.data, deckId]);
  useEffect(() => {
    if (!locationId && storage.length) setLocationId(storage.find((l) => l.type === "loose")?.id ?? storage[0].id);
  }, [storage, locationId]);

  const previewKey = target === "existing_deck" ? `deck:${deckId}` : target === "collection" ? `loc:${locationId}` : "new";
  useEffect(() => {
    if (!open) return;
    if (target === "existing_deck" && !deckId) return;
    let cancelled = false;
    setPreview(null);
    api
      .savePreview(session.id, target === "existing_deck" ? { target_deck_id: deckId } : target === "collection" && locationId ? { location_id: locationId } : {})
      .then((p) => !cancelled && setPreview(p))
      .catch((e) => !cancelled && toastError(e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewKey]);

  // "é a mesma carta física que estava em outro lugar": liga cada leitura a uma cópia, preferindo a mesma impressão
  const moveMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const item of preview?.elsewhere ?? []) {
      if (!moves[item.oracle_id]) continue;
      const copies = [...item.copies].sort((a, b) => Number(b.same_print) - Number(a.same_print));
      item.detection_ids.forEach((det, i) => {
        if (copies[i]) out[det] = copies[i].id;
      });
    }
    return out;
  }, [preview, moves]);

  async function save() {
    setBusy(true);
    try {
      let location = locationId;
      if (target === "collection" && newLocation) {
        if (!newLocation.name.trim()) throw new Error("Dê um nome para a nova pasta ou caixa");
        location = (await api.createLocation(newLocation.type, newLocation.name.trim())).id;
      }
      const res = await api.saveSession(session.id, {
        target,
        deck_name: target === "new_deck" ? deckName.trim() || undefined : undefined,
        deck_id: target === "existing_deck" ? deckId : undefined,
        location_id: target === "collection" ? location : undefined,
        add_to_collection: target === "collection" ? true : register,
        moves: moveMap,
        unscanned_action: unscanned,
      });
      onSaved(res.state);
      const r = res.result;
      const parts = [r.created && `${r.created} novas`, r.moved && `${r.moved} movidas`, r.matched && `${r.matched} já estavam lá`].filter(Boolean).join(" · ");
      toast(target === "collection" ? `Guardado na coleção${parts ? ` (${parts})` : ""}` : `Deck salvo${parts ? ` (${parts})` : ""}`);
      onClose();
      if (r.deck_id) navigate(`/decks/${r.deck_id}`);
      else navigate(`/colecao${location ? `?local=${location}` : ""}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const count = state.entries.reduce((n, e) => n + e.quantity, 0);
  const canSave = count > 0 && (target !== "existing_deck" || !!deckId) && (target !== "new_deck" || deckName.trim().length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title="Guardar este scan"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            cancelar
          </Button>
          <Button variant="brass" busy={busy} disabled={!canSave} onClick={save}>
            {target === "collection" ? "guardar na coleção" : target === "existing_deck" ? "atualizar deck" : "salvar deck"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Segmented<Target>
          value={target}
          onChange={setTarget}
          options={[
            { value: "new_deck", label: "novo deck" },
            { value: "existing_deck", label: "deck existente", hint: "substitui a lista (a anterior fica no histórico)" },
            { value: "collection", label: "coleção" },
          ]}
        />

        {target === "new_deck" && (
          <Field label="nome do deck">
            {(id) => <Input id={id} value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="Ex.: Atraxa superfriends" maxLength={80} autoFocus />}
          </Field>
        )}

        {target === "existing_deck" &&
          (decks.loading ? (
            <Skeleton className="h-11" />
          ) : decks.data?.length ? (
            <Field label="deck" hint="a lista atual vai para o histórico">
              {(id) => (
                <Select id={id} value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                  {decks.data!.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.card_count} cartas
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <p className="text-[15px] text-cream-faint">Nenhum deck salvo ainda.</p>
          ))}

        {target === "collection" && (
          <div className="space-y-3">
            <Field label="onde guardar">
              {(id) => (
                <Select
                  id={id}
                  value={newLocation ? `new:${newLocation.type}` : locationId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.startsWith("new:")) setNewLocation({ type: v.slice(4) as "binder" | "box", name: "" });
                    else {
                      setNewLocation(null);
                      setLocationId(v);
                    }
                  }}
                >
                  {storage.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.type === "loose" ? "Solto (sem lugar definido)" : `${LOCATION_LABEL[l.type]}: ${l.name}`} · {l.card_count}
                    </option>
                  ))}
                  <option value="new:binder">+ nova pasta…</option>
                  <option value="new:box">+ nova caixa…</option>
                </Select>
              )}
            </Field>
            {newLocation && (
              <Field label={newLocation.type === "binder" ? "nome da pasta" : "nome da caixa"}>
                {(id) => <Input id={id} autoFocus value={newLocation.name} onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })} placeholder={newLocation.type === "binder" ? "Ex.: pasta das raras" : "Ex.: caixa de trocas"} />}
              </Field>
            )}
          </div>
        )}

        {target !== "collection" && (
          <label className="flex items-start gap-3 text-[15px] text-cream-dim">
            <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} className="mt-1 size-4 accent-[var(--color-brass-400)]" />
            <span>
              Registrar as cartas físicas neste deck
              <span className="block text-[13px] text-cream-faint">Assim o app sabe onde cada cópia está e avisa quando a mesma carta for usada em outro deck.</span>
            </span>
          </label>
        )}

        <div className="brass-rule opacity-40" />

        {!preview ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-[15px] text-cream">
              {target === "collection" ? <Chest size={18} className="text-brass-400" /> : <Tome size={18} className="text-brass-400" />}
              {preview.physical_cards} {preview.physical_cards === 1 ? "carta física lida" : "cartas físicas lidas"}
            </p>

            {preview.already_here.length > 0 && (
              <p className="text-[14px] text-cream-faint">
                {preview.already_here.length === 1 ? "1 carta já está registrada" : `${preview.already_here.length} cartas já estão registradas`} no destino e não serão duplicadas.
              </p>
            )}

            {(target === "collection" || register) && preview.elsewhere.length > 0 && (
              <div className="space-y-2">
                <p className="text-[15px] text-cream-dim">Você já tem estas cartas em outro lugar. É a mesma carta física que mudou de lugar, ou outra cópia?</p>
                <ul className="board-sunken divide-y divide-oak-700">
                  {preview.elsewhere.map((item) => (
                    <li key={item.oracle_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-serif text-[16px] text-cream">{item.name}</p>
                        <p className="truncate text-[13px] text-cream-faint">
                          em {[...new Set(item.copies.map((c) => (c.location_type === "loose" ? "Solto" : c.location_name)))].join(", ")}
                        </p>
                      </div>
                      <Segmented
                        size="sm"
                        value={moves[item.oracle_id] ? "move" : "new"}
                        onChange={(v) => setMoves((m) => ({ ...m, [item.oracle_id]: v === "move" }))}
                        options={[
                          { value: "new", label: "outra cópia" },
                          { value: "move", label: "é a mesma" },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-cream-faint">Na dúvida fica “outra cópia”: contar a mais é fácil de corrigir; sumir com uma carta, não.</p>
              </div>
            )}

            {target === "existing_deck" && register && preview.not_scanned_in_target.length > 0 && (
              <div className={cx("space-y-2 rounded-[5px] border border-amber-600/50 bg-amber-600/8 px-3 py-3")}>
                <p className="text-[15px] text-cream-dim">
                  {preview.not_scanned_in_target.length === 1 ? "1 carta registrada no deck não apareceu" : `${preview.not_scanned_in_target.length} cartas registradas no deck não apareceram`} neste scan.
                </p>
                <Segmented
                  size="sm"
                  value={unscanned}
                  onChange={setUnscanned}
                  options={[
                    { value: "keep", label: "manter no deck" },
                    { value: "loose", label: "mover para solto" },
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
