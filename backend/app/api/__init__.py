"""API HTTP do Deck Scanner (todas as rotas sob /api)."""
from __future__ import annotations

from fastapi import APIRouter

from . import auth_proxy, cards, collection, decks, entries, sessions, system, tournaments

router = APIRouter(prefix="/api")
for module in (system, auth_proxy, sessions, entries, cards, decks, collection, tournaments):
    router.include_router(module.router)
