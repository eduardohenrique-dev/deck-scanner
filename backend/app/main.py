"""Aplicação FastAPI do Deck Scanner.

Dev:  uvicorn app.main:app --reload --port 8000   (frontend Vite em :5173 com proxy /api)
Prod: npm run build no frontend e só `uvicorn app.main:app --port 8000` (serve o build)
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .api import router
from .events import bus
from .vision.hashindex import get_index


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_app_db()
    db.init_catalog_db()
    bus.bind(asyncio.get_running_loop())
    await asyncio.to_thread(get_index)
    yield


app = FastAPI(title="Deck Scanner", version="0.1.0", lifespan=lifespan)
app.include_router(router)

if config.FRONTEND_DIST.exists():
    assets = config.FRONTEND_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = config.FRONTEND_DIST / path
        if path and target.is_file():
            return FileResponse(target)
        return FileResponse(config.FRONTEND_DIST / "index.html")
