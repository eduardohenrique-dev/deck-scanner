"""Decks salvos: lista, alocação de cartas físicas, histórico/diff, lista de compras, bracket e exportação."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import User, current_user
from ..collection import allocation, brackets, decks as saved, prices, prints
from ..games import registry
from ..pipeline import deck as deck_pipeline
from ..pipeline import store
from ..pipeline.serialize import Context, entry_public
from .common import game_info, json_response, own_deck
from .sessions import EntryCreate, add_entry_to_deck, export_response

router = APIRouter()


def _entry_value_items(rows: list[dict]) -> list[dict]:
    return [{"card_ref_id": e["card_ref_id"], "finish": e["finish"], "quantity": e["quantity"]}
            for e in rows if e["quantity"] > 0 and e["zone"] != "maybeboard"]


def deck_state(deck_id: str) -> dict:
    d = store.get_deck(deck_id)
    if d is None:
        raise HTTPException(404, "deck não encontrado")
    adapter = registry.get(d["game_id"])
    report = deck_pipeline.validate_deck(d)
    rows = store.entries(deck_id)
    ctx = Context.build(adapter, entries=rows)
    print_issues = []
    for e in rows:
        pc = prints.check_card_ref(d["game_id"], e["card_ref_id"], None, e["finish"],
                                   ctx.summaries.get(e["card_ref_id"]))
        if pc:
            print_issues.append({**pc, "entry_id": e["id"]})
    sessions = [s for s in store.list_sessions(d["user_id"], limit=200)
                if s.get("saved_deck_id") == deck_id or s.get("target_deck_id") == deck_id]
    return {
        "deck": {**d, "card_count": sum(e["quantity"] for e in rows if e["zone"] != "maybeboard")},
        "format": adapter.format(d["format_id"]),
        "game": game_info(adapter),
        "entries": [entry_public(e, adapter, report, {}, ctx) for e in rows],
        "validation": {k: v for k, v in report.items() if k != "entries"},
        "allocation": allocation.deck_report(d),
        "value": prices.valuation(d["game_id"], _entry_value_items(rows)),
        "print_issues": print_issues,
        "snapshots": saved.list_snapshots(deck_id),
        "sessions": [{"id": s["id"], "name": s.get("name"), "purpose": s["purpose"], "mode": s["mode"],
                      "status": s["status"], "created_at": s["created_at"], "card_count": s.get("card_count")}
                     for s in sessions],
        "brackets_apply": brackets.applies_to(d["game_id"], d["format_id"]),
    }


class DeckCreate(BaseModel):
    name: str
    format_id: str
    game_id: str = "mtg"
    description: str | None = None
    text: str | None = None


class DeckPatch(BaseModel):
    name: str | None = None
    format_id: str | None = None
    description: str | None = None


class ImportBody(BaseModel):
    text: str
    replace: bool = False
    default_language: str = "en"


class AllocateBody(BaseModel):
    physical_card_id: str
    force: bool = False


class SnapshotBody(BaseModel):
    note: str | None = None


@router.get("/decks")
def list_decks(user: User = Depends(current_user)):
    rows = saved.list_for_user(user.id)
    out = []
    for d in rows:
        adapter = registry.get(d["game_id"])
        entries = store.entries(d["id"])
        commanders = [e for e in entries if e["is_commander"]]
        summaries = adapter.card_summaries([e["card_ref_id"] for e in commanders[:2]] or
                                           [e["card_ref_id"] for e in entries[:1]])
        identity: set[str] = set()
        for f in adapter.card_fields_many([e["card_ref_id"] for e in (commanders or entries)]).values():
            identity |= set(f.get("color_identity") or [])
        cover = summaries.get(d.get("cover_card_ref_id") or "") or next(iter(summaries.values()), None)
        fmt = adapter.formats().get(d["format_id"], {})
        out.append({**d, "format_name": fmt.get("name"), "identity": [c for c in "WUBRG" if c in identity],
                    "commanders": [summaries[e["card_ref_id"]]["name_en"] for e in commanders if e["card_ref_id"] in summaries],
                    "cover": {"image_normal": cover.get("image_normal"), "name": cover.get("name_en")} if cover else None})
    return json_response(out)


@router.post("/decks")
def create_deck(body: DeckCreate, user: User = Depends(current_user)):
    try:
        d = saved.create(user.id, body.game_id, body.format_id, body.name, body.description)
    except KeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    result = None
    if body.text:
        result = saved.import_text(d, body.text, replace=True)
        saved.snapshot(store.get_deck(d["id"]), "import")
    return json_response({"deck_id": d["id"], "import": result, "state": deck_state(d["id"])})


@router.get("/decks/{deck_id}")
def get_deck(deck_id: str, user: User = Depends(current_user)):
    own_deck(deck_id, user)
    return json_response(deck_state(deck_id))


@router.patch("/decks/{deck_id}")
def patch_deck(deck_id: str, body: DeckPatch, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    if body.format_id:
        try:
            registry.get(d["game_id"]).format(body.format_id)
        except KeyError as exc:
            raise HTTPException(400, str(exc)) from exc
    saved.update(deck_id, **body.model_dump(exclude_none=True))
    return json_response(deck_state(deck_id))


@router.delete("/decks/{deck_id}")
def delete_deck(deck_id: str, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    return saved.delete(d)


@router.post("/decks/{deck_id}/entries")
def add_deck_entry(deck_id: str, body: EntryCreate, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    if d["kind"] != "deck":
        raise HTTPException(400, "use a sessão para editar a lista do scan")
    add_entry_to_deck(d, body)
    saved.touch(deck_id)
    return json_response(deck_state(deck_id))


@router.post("/decks/{deck_id}/import")
def import_deck_text(deck_id: str, body: ImportBody, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    result = saved.import_text(d, body.text, replace=body.replace, default_language=body.default_language)
    saved.snapshot(store.get_deck(deck_id), "import")
    return json_response({"import": result, "state": deck_state(deck_id)})


@router.get("/decks/{deck_id}/export")
def export_deck(deck_id: str, format: str = "moxfield", group: bool = False, lang: str = "en", download: bool = False,
                user: User = Depends(current_user)):
    return export_response(own_deck(deck_id, user), format, group, lang, download)


@router.get("/decks/{deck_id}/bracket")
def deck_bracket(deck_id: str, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    if not brackets.applies_to(d["game_id"], d["format_id"]):
        return json_response({"applies": False})
    result = brackets.classify(d["game_id"], store.entries(deck_id))
    return json_response({"applies": True, **(result or {})})


@router.get("/decks/{deck_id}/shopping-list")
def deck_shopping_list(deck_id: str, refresh: bool = False, user: User = Depends(current_user)):
    return json_response(prices.shopping_list(own_deck(deck_id, user), refresh=refresh))


@router.post("/decks/{deck_id}/allocate")
def allocate_card(deck_id: str, body: AllocateBody, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    try:
        result = allocation.allocate(d, body.physical_card_id, force=body.force)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except allocation.AllocationConflict as conflict:
        return json_response({"detail": conflict.message, "conflict": {
            "physical_card_id": conflict.card["id"],
            "other_deck": {"id": conflict.other_deck["id"], "name": conflict.other_deck["name"]} if conflict.other_deck else None,
        }}, status_code=409)
    return json_response({"result": result, "state": deck_state(deck_id)})


@router.post("/decks/{deck_id}/allocate/auto")
def auto_allocate(deck_id: str, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    return json_response({"result": allocation.auto_allocate(d), "state": deck_state(deck_id)})


@router.post("/decks/{deck_id}/release-extra")
def release_extra(deck_id: str, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    return json_response({"result": allocation.release_extra(d), "state": deck_state(deck_id)})


@router.get("/decks/{deck_id}/snapshots")
def deck_snapshots(deck_id: str, user: User = Depends(current_user)):
    own_deck(deck_id, user)
    return json_response(saved.list_snapshots(deck_id))


@router.post("/decks/{deck_id}/snapshots")
def save_snapshot(deck_id: str, body: SnapshotBody, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    return json_response(saved.snapshot(d, "manual", note=body.note))


@router.get("/decks/{deck_id}/diff")
def deck_diff(deck_id: str, from_id: str, to_id: str = "current", user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    old = saved.get_snapshot(from_id)
    if old is None or old["deck_id"] != deck_id:
        raise HTTPException(404, "versão não encontrada")
    if to_id == "current":
        new_entries, new_meta = saved.snapshot_entries(deck_id, d["game_id"]), {"id": "current", "created_at": None}
    else:
        new = saved.get_snapshot(to_id)
        if new is None or new["deck_id"] != deck_id:
            raise HTTPException(404, "versão não encontrada")
        new_entries, new_meta = new["entries"], {"id": new["id"], "created_at": new["created_at"]}
    return json_response({"from": {"id": old["id"], "created_at": old["created_at"], "source": old["source"]},
                          "to": new_meta, "diff": saved.diff(old["entries"], new_entries)})


@router.post("/decks/{deck_id}/suggestions/{suggestion_type}/apply")
def apply_deck_suggestion(deck_id: str, suggestion_type: str, user: User = Depends(current_user)):
    d = own_deck(deck_id, user)
    adapter = registry.get(d["game_id"])
    report = deck_pipeline.validate_deck(d)
    additions = adapter.suggestion_additions(suggestion_type, (report.get("suggestions") or {}).get(suggestion_type) or {})
    if not additions:
        raise HTTPException(400, "nenhuma sugestão aplicável")
    for card_ref_id, qty in additions:
        add_entry_to_deck(d, EntryCreate(card_ref_id=card_ref_id, quantity=qty))
    saved.touch(deck_id)
    return json_response(deck_state(deck_id))
