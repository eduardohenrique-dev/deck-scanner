"""Status, configuração pública, jogos/formatos e mídia servida localmente."""
from __future__ import annotations

import mimetypes

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from .. import config, db
from ..auth import User, current_user
from ..games import registry
from ..pipeline import vlm
from ..storage import get_storage, verify_signature
from ..vision.hashindex import get_index
from .common import json_response

router = APIRouter()


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/config")
def public_config():
    """O que o navegador precisa saber antes do login (nada secreto)."""
    return {
        "auth": config.AUTH_MODE,
        "supabase_url": config.SUPABASE_URL if config.AUTH_MODE == "supabase" else None,
        "supabase_publishable_key": config.SUPABASE_PUBLISHABLE_KEY if config.AUTH_MODE == "supabase" else None,
        "hosted": config.SERVERLESS or bool(config.DATABASE_URL),
        "vlm": vlm.enabled(),
        "spellbook": config.SPELLBOOK_ENABLED,
    }


@router.get("/status")
def status(user: User = Depends(current_user)):
    idx = get_index()
    return {
        "hash_index": {"entries": len(idx), "base": idx.count_base, "learned": idx.count_learned(user.id)},
        "catalog": {"prints": db.catalog_meta_get("mtg.default_cards.count"),
                    "updated": db.catalog_meta_get("mtg.hashes.updated_at")},
        "vlm": {"enabled": vlm.enabled(), "model": vlm.model_name() if vlm.enabled() else None,
                "provider": config.VLM_PROVIDER or None},
        "orb_verify": config.ORB_VERIFY_ENABLED,
        "storage": get_storage().backend,
        "database": db.DIALECT,
    }


@router.get("/games")
def games():
    return registry.list_games()


@router.get("/games/{game_id}/formats")
def formats(game_id: str):
    return json_response(list(registry.get(game_id).formats().values()))


@router.get("/media/{key:path}")
def media(key: str, e: int = Query(...), s: str = Query(...)):
    """Arquivos do storage local, com URL assinada (a tag <img> não envia o token de login)."""
    if not verify_signature(key, e, s):
        raise HTTPException(403, "link expirado")
    try:
        data = get_storage().get(key)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if data is None:
        raise HTTPException(404)
    mime = mimetypes.guess_type(key)[0] or "application/octet-stream"
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=3600"})
