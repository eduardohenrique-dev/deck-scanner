"""Aplicação FastAPI do Deck Scanner.

Local:     uvicorn app.main:app --port 8420  (frontend Vite em :5190 com proxy /api)
Produção:  a Vercel importa `app` (api/index.py) e serve o build do frontend como estático.
"""
from __future__ import annotations

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from . import config, db
from .api import router
from .vision.hashindex import get_index

_ready = threading.Event()
_ready_lock = threading.Lock()


def ensure_ready() -> None:
    """Schema e índice sob demanda: em serverless o lifespan nem sempre roda antes da 1ª requisição."""
    if _ready.is_set():
        return
    with _ready_lock:
        if _ready.is_set():
            return
        db.init_all()
        _ready.set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_ready()
    if not config.SERVERLESS:
        threading.Thread(target=get_index, name="hashindex-warmup", daemon=True).start()
    yield


app = FastAPI(title="Deck Scanner", version="0.2.0", lifespan=lifespan)


@app.middleware("http")
async def _ready_middleware(request: Request, call_next):
    if request.url.path.startswith("/api") and not _ready.is_set():
        try:
            ensure_ready()
        except Exception as exc:  # noqa: BLE001 — banco fora do ar: resposta clara em vez de 500 genérico
            return JSONResponse({"detail": f"banco indisponível: {type(exc).__name__}"}, status_code=503)
    return await call_next(request)


app.include_router(router)

if config.FRONTEND_DIST.exists() and not config.SERVERLESS:
    from fastapi.staticfiles import StaticFiles

    assets = config.FRONTEND_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = config.FRONTEND_DIST / path
        if path and target.is_file():
            return FileResponse(target)
        return FileResponse(config.FRONTEND_DIST / "index.html")
