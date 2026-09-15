"""Coleção física: locais, cartas, "onde está", salvar scan na coleção/deck e conferência de deck."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import User, current_user
from ..collection import check, inventory, locations, prices, prints, save_scan
from ..games import registry
from ..games.mtg.adapter import normalize_name
from .common import json_response, own_session, session_state

router = APIRouter()
GAME = "mtg"


# ------------------------------------------------------------------ locais
class LocationCreate(BaseModel):
    type: str
    name: str
    game_id: str = GAME


class LocationPatch(BaseModel):
    name: str


def _own_location(location_id: str, user: User) -> dict:
    loc = locations.get(location_id)
    if loc is None or loc["user_id"] != user.id:
        raise HTTPException(404, "local não encontrado")
    return loc


@router.get("/locations")
def list_locations(game_id: str = GAME, user: User = Depends(current_user)):
    return json_response(locations.list_for_user(user.id, game_id))


@router.post("/locations")
def create_location(body: LocationCreate, user: User = Depends(current_user)):
    try:
        return json_response(locations.create(user.id, body.game_id, body.type, body.name))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.patch("/locations/{location_id}")
def rename_location(location_id: str, body: LocationPatch, user: User = Depends(current_user)):
    _own_location(location_id, user)
    locations.rename(location_id, body.name)
    return json_response(locations.get(location_id))


@router.delete("/locations/{location_id}")
def delete_location(location_id: str, user: User = Depends(current_user)):
    loc = _own_location(location_id, user)
    try:
        return {"moved_to_loose": locations.delete(loc)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


# ------------------------------------------------------------------ coleção
def _collection_rows(user: User, game_id: str, location_id: str | None, q: str | None) -> list[dict]:
    adapter = registry.get(game_id)
    cards = inventory.all_for_user(user.id, game_id)
    if location_id:
        cards = [c for c in cards if c.get("location_id") == location_id]
    groups = inventory.grouped(user.id, game_id, cards)
    summaries = adapter.card_summaries([g["card_ref_id"] for g in groups])
    norm_q = normalize_name(q or "")
    out = []
    for g in groups:
        s = summaries.get(g["card_ref_id"]) or {}
        if norm_q and norm_q not in normalize_name(s.get("name_en") or "") and norm_q not in normalize_name(s.get("name_pt") or ""):
            continue
        out.append({**g, "card": s})
    return out


@router.get("/collection")
def collection(location_id: str | None = None, q: str | None = None, sort: str = "name", game_id: str = GAME,
               user: User = Depends(current_user)):
    rows = _collection_rows(user, game_id, location_id, q)
    items = [{"card_ref_id": p["card_ref_id"], "finish": p["finish"], "quantity": p["count"]}
             for r in rows for p in r["prints"]]
    value = prices.valuation(game_id, items)
    unit = {(i["card_ref_id"], i["finish"]): i["unit_brl"] for i in value["items"]}
    for r in rows:
        r["value_brl"] = round(sum((unit.get((p["card_ref_id"], p["finish"])) or 0) * p["count"] for p in r["prints"]), 2)
    if sort == "value":
        rows.sort(key=lambda r: -r["value_brl"])
    elif sort == "recent":
        rows.sort(key=lambda r: r["latest"], reverse=True)
    else:
        rows.sort(key=lambda r: ((r["card"].get("name_pt") or r["card"].get("name_en") or "").casefold()))
    return json_response({"items": rows, "total_cards": sum(r["count"] for r in rows), "unique": len(rows),
                          "value": {k: value[k] for k in ("total_usd", "total_brl", "fx", "unpriced")},
                          "top": value["top"][:8]})


@router.get("/collection/summary")
def collection_summary(game_id: str = GAME, user: User = Depends(current_user)):
    cards = inventory.all_for_user(user.id, game_id)
    items = [{"card_ref_id": c["card_ref_id"], "finish": c["finish"], "quantity": 1} for c in cards]
    value = prices.valuation(game_id, items)
    return json_response({**inventory.summary_counts(user.id, game_id),
                          "value": {k: value[k] for k in ("total_usd", "total_brl", "fx", "unpriced")},
                          "top": value["top"][:6], "locations": locations.list_for_user(user.id, game_id)})


@router.get("/collection/cards/{oracle_id}")
def where_is(oracle_id: str, game_id: str = GAME, user: User = Depends(current_user)):
    """Onde está cada cópia física desta carta (para achar o que sumiu)."""
    copies = inventory.copies_by_oracle(user.id, game_id, [oracle_id]).get(oracle_id, [])
    summaries = registry.get(game_id).card_summaries([c["card_ref_id"] for c in copies])
    return json_response([{**c, "card": summaries.get(c["card_ref_id"])} for c in copies])


class PhysicalAdd(BaseModel):
    card_ref_id: str
    quantity: int = 1
    location_id: str | None = None
    language: str | None = None
    finish: str | None = None
    condition: str | None = None
    game_id: str = GAME


class PhysicalPatch(BaseModel):
    location_id: str | None = None
    condition: str | None = None
    finish: str | None = None
    language: str | None = None
    card_ref_id: str | None = None
    notes: str | None = None


class PhysicalMove(BaseModel):
    ids: list[str]
    location_id: str


class PhysicalDelete(BaseModel):
    ids: list[str]


@router.post("/physical-cards")
def add_physical(body: PhysicalAdd, user: User = Depends(current_user)):
    summary = registry.get(body.game_id).card_summary(body.card_ref_id)
    if summary is None:
        raise HTTPException(404, "carta não encontrada")
    loc = _own_location(body.location_id, user) if body.location_id else locations.ensure_loose(user.id, body.game_id)
    ids = inventory.add_cards(user.id, body.game_id, [{
        "card_ref_id": body.card_ref_id, "oracle_id": summary["oracle_id"], "language": body.language,
        "finish": body.finish, "condition": body.condition, "condition_source": "user" if body.condition else None,
    } for _ in range(max(1, min(body.quantity, 100)))], loc["id"])
    return {"ids": ids}


@router.patch("/physical-cards/{card_id}")
def patch_physical(card_id: str, body: PhysicalPatch, user: User = Depends(current_user)):
    card = inventory.get(card_id)
    if card is None or card["user_id"] != user.id:
        raise HTTPException(404, "carta não encontrada")
    fields = body.model_dump(exclude_none=True)
    if "location_id" in fields:
        _own_location(fields["location_id"], user)
    if "condition" in fields:
        fields["condition_source"] = "user"
    warning = None
    if any(k in fields for k in ("language", "finish", "card_ref_id")):
        warning = prints.check_card_ref(card["game_id"], fields.get("card_ref_id", card["card_ref_id"]),
                                        fields.get("language", card["language"]), fields.get("finish", card["finish"]))
    inventory.update(card_id, **fields)
    return json_response({"card": inventory.get(card_id), "print_warning": warning})


@router.post("/physical-cards/move")
def move_physical(body: PhysicalMove, user: User = Depends(current_user)):
    _own_location(body.location_id, user)
    return {"moved": inventory.move(user.id, body.ids, body.location_id)}


@router.post("/physical-cards/delete")
def delete_physical(body: PhysicalDelete, user: User = Depends(current_user)):
    return {"deleted": inventory.delete(user.id, body.ids)}


# ------------------------------------------------------------------ salvar resultado de scan
class SaveBody(BaseModel):
    target: str                      # new_deck | existing_deck | collection
    deck_name: str | None = None
    deck_id: str | None = None
    location_id: str | None = None
    add_to_collection: bool = True
    moves: dict[str, str] = {}       # detection_id → physical_card_id (é a mesma carta, mudou de lugar)
    unscanned_action: str = "keep"   # keep | loose


@router.get("/sessions/{session_id}/save-preview")
def save_preview(session_id: str, target_deck_id: str | None = None, location_id: str | None = None,
                 user: User = Depends(current_user)):
    s = own_session(session_id, user)
    return json_response(save_scan.preview(s, target_deck_id, location_id))


@router.post("/sessions/{session_id}/save")
def save_session(session_id: str, body: SaveBody, user: User = Depends(current_user)):
    s = own_session(session_id, user)
    try:
        result = save_scan.save(s, target=body.target, deck_name=body.deck_name, deck_id=body.deck_id,
                                location_id=body.location_id, add_to_collection=body.add_to_collection,
                                moves=body.moves, unscanned_action=body.unscanned_action)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return json_response({"result": result, "state": session_state(session_id)})


# ------------------------------------------------------------------ conferência de deck
@router.get("/sessions/{session_id}/check")
def check_result(session_id: str, user: User = Depends(current_user)):
    s = own_session(session_id, user)
    if s["purpose"] != "check":
        raise HTTPException(400, "esta sessão não é uma conferência")
    return json_response(check.result(s))


@router.post("/sessions/{session_id}/check/apply")
def apply_check(session_id: str, user: User = Depends(current_user)):
    s = own_session(session_id, user)
    if s["purpose"] != "check":
        raise HTTPException(400, "esta sessão não é uma conferência")
    return json_response(check.apply_scan_to_list(s))


# ------------------------------------------------------------------ impressão impossível e preços
class PrintCheckBody(BaseModel):
    set_code: str
    collector_number: str
    language: str | None = None
    finish: str | None = None
    name: str | None = None
    game_id: str = GAME


@router.post("/cards/check-print")
def check_print(body: PrintCheckBody):
    result = prints.check(body.game_id, body.set_code, body.collector_number, body.language, body.finish, body.name)
    return json_response({"ok": result is None, "warning": result})


@router.get("/prices/fx")
def fx():
    return prices.fx_usd_brl()
