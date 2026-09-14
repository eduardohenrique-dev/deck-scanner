"""Templates de mensagens das regras (dados em rules/messages.<locale>.json, recarregados por mtime)."""
from __future__ import annotations

import orjson

from .. import config

_cache: dict[str, tuple[float, dict]] = {}


def load_messages(locale: str = "pt-BR") -> dict[str, str]:
    path = config.RULES_DIR / f"messages.{locale}.json"
    mtime = path.stat().st_mtime
    hit = _cache.get(locale)
    if hit and hit[0] == mtime:
        return hit[1]
    data = orjson.loads(path.read_bytes())
    _cache[locale] = (mtime, data)
    return data
