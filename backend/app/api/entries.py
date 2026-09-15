"""Entradas de lista — valem para o rascunho de uma sessão de scan e para decks salvos."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import User, current_user
from ..collection import prints
from ..games import registry
from ..pipeline import deck, store
from .common import json_response, own_entry, session_state
from .sessions import learn_from_correction

router = APIRouter()


class EntryPatch(BaseModel):
    quantity_override: int | None = None
    reset_quantity: bool = False
    zone: str | None = None
    is_commander: bool | None = None
    card_ref_id: str | None = None
    language: str | None = None
    finish: str | None = None
    condition: str | None = None


def state_for_deck(deck_row: dict) -> dict:
    if deck_row["kind"] == "draft" and deck_row.get("session_id"):
        return session_state(deck_row["session_id"])
    from .decks import deck_state  # decks salvos (Fase 2)

    return deck_state(deck_row["id"])


def refresh(deck_row: dict) -> None:
    if deck_row["kind"] == "draft" and deck_row.get("session_id"):
        deck.rebuild(deck_row["session_id"])
    else:
        deck.validate_deck(deck_row)
        from ..collection import decks as saved

        saved.touch(deck_row["id"])


@router.patch("/entries/{entry_id}")
def patch_entry(entry_id: str, body: EntryPatch, user: User = Depends(current_user)):
    e, deck_row = own_entry(entry_id, user)
    adapter = registry.get(deck_row["game_id"])
    fields: dict = {}
    if body.reset_quantity:
        fields["quantity_override"] = None
    elif body.quantity_override is not None:
        fields["quantity_override"] = max(0, body.quantity_override)
    if body.zone is not None:
        fields["zone"] = body.zone
    if body.is_commander is not None:
        fields["is_commander"] = int(body.is_commander)
        zones = adapter.format(deck_row["format_id"]).get("zones") or []
        if body.is_commander and "commander" in zones:
            fields["zone"] = "commander"
        elif not body.is_commander and e["zone"] == "commander":
            fields["zone"] = "deck"
    if body.condition is not None:
        fields["condition"] = body.condition
    det_fields: dict = {}
    if body.card_ref_id and body.card_ref_id != e["card_ref_id"]:
        cf = adapter.card_fields(body.card_ref_id)
        if cf is None:
            raise HTTPException(404, "carta não encontrada")
        fields.update(card_ref_id=body.card_ref_id, oracle_id=cf["key"])
        det_fields.update(card_ref_id=body.card_ref_id, oracle_id=cf["key"], source="user", confidence=1.0,
                          user_corrected=1)
    if body.language:
        fields["language"] = det_fields["language"] = body.language
    if body.finish:
        fields["finish"] = det_fields["finish"] = body.finish
    store.update_entry(entry_id, **fields)
    if det_fields and deck_row["kind"] == "draft" and deck_row.get("session_id"):
        # a identidade vem das detecções; editar a entrada propaga para as cópias físicas dela
        session = store.get_session(deck_row["session_id"])
        phys = set(e.get("allocated_physical_ids") or [])
        for d in store.detections(session["id"]):
            if d["id"] in phys or d.get("dup_of") in phys:
                if "card_ref_id" in det_fields and d["id"] in phys:
                    learn_from_correction(d, session, det_fields["card_ref_id"], det_fields["oracle_id"])
                store.update_detection(d["id"], **det_fields)
    refresh(deck_row)
    state = state_for_deck(deck_row)
    if body.language or body.finish or body.card_ref_id:
        updated = store.get_entry(entry_id) or e
        # escolha explícita da pessoa: aqui o idioma também é conferido contra o registro oficial
        state["print_warning"] = prints.check_card_ref(deck_row["game_id"], updated["card_ref_id"],
                                                       updated["language"], updated["finish"])
    return json_response(state)


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: str, user: User = Depends(current_user)):
    e, deck_row = own_entry(entry_id, user)
    if deck_row["kind"] != "draft" or (e["manual"] and not e["quantity_detected"]):
        store.delete_entry(entry_id)
    else:
        store.update_entry(entry_id, quantity_override=0)  # cópias detectadas não somem: ficam fora do deck
    refresh(deck_row)
    return json_response(state_for_deck(deck_row))
