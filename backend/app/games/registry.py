"""Registro de jogos a partir do manifesto rules/games.json.

Adicionar um jogo = escrever um GameAdapter e apontar para ele no manifesto
("adapter": "pacote.modulo:Classe"), mais os JSON de formato. Nenhum código daqui muda.
"""
from __future__ import annotations

import importlib
import threading

import orjson

from .. import config
from .base import GameAdapter

_lock = threading.Lock()
_adapters: dict[str, GameAdapter] = {}
_manifest_mtime = 0.0
_manifest: dict = {}


def _load_manifest() -> dict:
    global _manifest_mtime, _manifest
    path = config.RULES_DIR / "games.json"
    mtime = path.stat().st_mtime
    if mtime != _manifest_mtime:
        _manifest = orjson.loads(path.read_bytes())
        _manifest_mtime = mtime
    return _manifest


def list_games() -> list[dict]:
    manifest = _load_manifest()
    out = []
    for g in manifest["games"]:
        if g.get("enabled") and g.get("adapter"):
            out.append(get(g["id"]).public_info())
        else:
            out.append({"id": g["id"], "name": g["name"], "enabled": False, "note": g.get("note")})
    return out


def get(game_id: str) -> GameAdapter:
    with _lock:
        if game_id in _adapters:
            return _adapters[game_id]
        manifest = _load_manifest()
        entry = next((g for g in manifest["games"] if g["id"] == game_id), None)
        if entry is None or not entry.get("enabled") or not entry.get("adapter"):
            raise KeyError(f"jogo não disponível: {game_id}")
        module_name, class_name = entry["adapter"].split(":")
        cls = getattr(importlib.import_module(module_name), class_name)
        adapter = cls(config.RULES_DIR, entry)
        _adapters[game_id] = adapter
        return adapter
