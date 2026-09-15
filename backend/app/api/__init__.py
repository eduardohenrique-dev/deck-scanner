"""API HTTP do Deck Scanner (todas as rotas sob /api)."""
from __future__ import annotations

from fastapi import APIRouter

from . import cards, entries, sessions, system

router = APIRouter(prefix="/api")
for module in (system, sessions, entries, cards):
    router.include_router(module.router)

try:  # Fase 2: decks salvos, coleção e conferência
    from . import collection, decks

    router.include_router(decks.router)
    router.include_router(collection.router)
except ImportError:  # durante a migração os módulos podem ainda não existir
    pass
