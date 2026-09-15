"""Busca de cartas (autocomplete em português e inglês) e detalhe com impressões."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..games import registry
from .common import json_response

router = APIRouter()


@router.get("/cards/search")
def cards_search(q: str = Query(..., min_length=1), game: str = "mtg", lang: str = "pt", limit: int = 12):
    return json_response(registry.get(game).search(q, lang=lang, limit=min(limit, 30)))


@router.get("/cards/{card_ref_id}")
def card_detail(card_ref_id: str, game: str = "mtg"):
    adapter = registry.get(game)
    s = adapter.card_summary(card_ref_id)
    if s is None:
        raise HTTPException(404)
    return json_response({**s, "prints": adapter.prints_of(s["oracle_id"]) if s.get("oracle_id") else []})
