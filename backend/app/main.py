"""Aplicação FastAPI do Deck Scanner.

Local:     uvicorn app.main:app --port 8420  (frontend Vite em :5190 com proxy /api)
Produção:  serviço "api" da Vercel (vercel.json, entrypoint app.main:app); o frontend é o serviço "web".
"""
from __future__ import annotations

import os
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


MISCONFIGURED = config.SERVERLESS and (not config.DATABASE_URL or config.AUTH_MODE != "neon" or config.STORAGE_BACKEND != "s3")

# Rotas que não dependem do banco: a tela de login precisa abrir mesmo com o Postgres dormindo
# (/wake acorda o banco por conta própria e trata o erro; /client-error só escreve no log).
NO_DB_PATHS = {"/api/health", "/api/config", "/api/wake", "/api/client-error",
               "/api/auth/password/sign-in", "/api/auth/password/sign-up", "/api/auth/session",
               "/api/auth/sign-out", "/api/auth/google/start", "/api/auth/google/callback"}


@app.middleware("http")
async def _ready_middleware(request: Request, call_next):
    # hospedado sem banco/login configurados: nunca abre a API sem autenticação num domínio público
    if MISCONFIGURED and request.url.path.startswith("/api") and request.url.path != "/api/health":
        return JSONResponse({"detail": "servidor ainda não configurado (DATABASE_URL, NEON_AUTH_* e S3_*)"}, status_code=503)
    oidc = request.headers.get("x-vercel-oidc-token")
    if oidc:  # token da função para o AI Gateway; usado também pelas threads de identificação
        os.environ["VERCEL_OIDC_TOKEN"] = oidc
    if request.url.path.startswith("/api") and request.url.path not in NO_DB_PATHS and not _ready.is_set():
        try:
            ensure_ready()
        except Exception as exc:  # noqa: BLE001 — banco fora do ar: resposta clara em vez de 500 genérico
            return JSONResponse({"detail": f"o banco está acordando ({type(exc).__name__}) — tente de novo em alguns segundos"},
                                status_code=503)
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
