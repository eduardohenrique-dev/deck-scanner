"""API HTTP do Deck Scanner (todas as rotas sob /api)."""
from __future__ import annotations

from fastapi import APIRouter

from . import cards, collection, decks, entries, sessions, system

router = APIRouter(prefix="/api")
for module in (system, sessions, entries, cards, decks, collection):
    router.include_router(module.router)
