import { useState } from "react";
import { api } from "../../lib/api";
import { cardName } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import type { CardSummary, SessionState } from "../../lib/types";
import CardSearch from "../cards/CardSearch";
import { CardImage } from "../mtg";
import { Button, Field, Modal, Select, Stepper } from "../ui";

/**
 * A carta que a câmera não leu entra pelo nome: busca, quantidade, parte do deck e acabamento.
 * Fica aberta depois de adicionar, para lançar várias seguidas.
 */
export default function AddCardSheet({ state, onState, onClose }: { state: SessionState; onState: (s: SessionState) => void; onClose: () => void }) {
  const { format, game, session } = state;
  const zones = (format.zones ?? ["deck"]).filter((z) => z !== "commander");
  const zoneName = (z: string) => format.zone_labels?.[z] ?? game.zones.find((x) => x.id === z)?.name ?? z;
  const [card, setCard] = useState<CardSummary | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [zone, setZone] = useState(zones[0] ?? "deck");
  const [finish, setFinish] = useState("nonfoil");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!card) return;
    setBusy(true);
    try {
      onState(await api.addSessionEntry(session.id, { card_ref_id: card.id, quantity, zone, finish, language: card.lang }));
      toast(`${quantity}× ${cardName(card)} na lista`);
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
      title="Adicionar carta"
      description="Para a carta que a câmera não leu: ela entra na lista como as outras."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="primary" busy={busy} disabled={!card} onClick={add}>
            Adicionar à lista
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
                <p className="font-serif text-title-3 font-semibold text-mist">{cardName(card)}</p>
                <p className="text-footnote text-mist-faint">
                  {card.set_name} · #{card.collector_number} · {card.lang.toUpperCase()}
                </p>
                <button type="button" onClick={() => setCard(null)} className="min-h-11 text-footnote font-semibold text-arcane-300 hover:underline">
                  Trocar carta
                </button>
              </div>
              <Stepper value={quantity} min={1} max={99} label="Quantidade" onChange={setQuantity} />
            </div>
          </div>
        ) : (
          <CardSearch autoFocus onPick={setCard} placeholder="Nome da carta (português ou inglês)…" />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {zones.length > 1 && (
            <Field label="Onde entra">
              {(id) => (
                <Select id={id} value={zone} onChange={(e) => setZone(e.target.value)}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {zoneName(z)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Acabamento">
            {(id) => (
              <Select id={id} value={finish} onChange={(e) => setFinish(e.target.value)}>
                <option value="nonfoil">Normal</option>
                <option value="foil">Foil</option>
                <option value="etched">Etched</option>
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
