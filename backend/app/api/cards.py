"""Busca de cartas (autocomplete em português e inglês) e detalhe com impressões."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..games import registry
from .common import json_response

router = APIRouter()


@router.get("/cards/search")
def cards_search(q: str = Query(..., min_length=1), game: str = "mtg", lang: str = "pt", limit: int = 12):
    return json_response(registry.get(game).search(q, lang=lang, limit=min(limit, 30)))


@router.get("/sets")
def sets(game: str = "mtg", q: str | None = None, limit: int = 40):
    """Coleções para o seletor "estas cartas são da coleção X" (mais recentes primeiro)."""
    where = "game_id=?"
    params: list = [game]
    if q:
        where += " AND (name LIKE ? OR code LIKE ?)"
        params += [f"%{q}%", f"{q}%"]
    # a coleção "de verdade" primeiro: sigla exata, depois nome que começa pela busca, depois a maior
    order = "released_at DESC, name"
    if q:
        params = [*params, q, f"{q}%"]
        order = ("CASE WHEN LOWER(code)=LOWER(?) THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END, "
                 "CASE WHEN set_type IN ('expansion','core','commander','draft_innovation','masters') THEN 0 ELSE 1 END, "
                 "LENGTH(name), card_count DESC")
    rows = db.catalog_db().execute(
        f"SELECT code, name, released_at, card_count, icon_svg_uri FROM sets WHERE {where} "
        f"AND card_count > 0 ORDER BY {order} LIMIT ?", (*params, min(limit, 200))).fetchall()
    return json_response([dict(r) for r in rows])


@router.get("/cards/{card_ref_id}")
def card_detail(card_ref_id: str, game: str = "mtg"):
    adapter = registry.get(game)
    s = adapter.card_summary(card_ref_id)
    if s is None:
        raise HTTPException(404)
    return json_response({**s, "prints": adapter.prints_of(s["oracle_id"]) if s.get("oracle_id") else []})
