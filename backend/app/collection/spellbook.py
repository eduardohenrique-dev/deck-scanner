"""Cliente do Commander Spellbook (base comunitária de combos) — só nomes de cartas saem daqui.

Endpoint `estimate-bracket`: classifica os combos presentes no deck (2 cartas definitivo/discutível e a
etiqueta de potência de cada combo). Respostas ficam em cache por lista de cartas. Limite recomendado
pelo serviço: ~80 requisições/minuto; exige atribuição com link.
"""
from __future__ import annotations

import hashlib
import time

import httpx
import orjson

from .. import config, db

CACHE_TTL = 3 * 24 * 3600


def _key(commanders: list[str], main: list[tuple[str, int]]) -> str:
    payload = orjson.dumps({"c": sorted(commanders), "m": sorted(main)})
    return "spellbook:estimate:" + hashlib.sha1(payload).hexdigest()


def estimate_bracket(commanders: list[str], main: list[tuple[str, int]]) -> dict | None:
    if not config.SPELLBOOK_ENABLED or not (commanders or main):
        return None
    key = _key(commanders, main)
    conn = db.app_db()
    row = conn.execute("SELECT body, fetched_at FROM api_cache WHERE key=?", (key,)).fetchone()
    if row and time.time() - row["fetched_at"] < CACHE_TTL:
        return db.loads(row["body"], None)
    body = {"commanders": [{"card": n, "quantity": 1} for n in commanders][:12],
            "main": [{"card": n, "quantity": max(1, q)} for n, q in main][:600]}
    try:
        r = httpx.post(f"{config.SPELLBOOK_API}/estimate-bracket", json=body, timeout=25, follow_redirects=True,
                       headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"})
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return db.loads(row["body"], None) if row else None
    slim = {
        "bracketTag": data.get("bracketTag"),
        "combos": [{
            "id": (c.get("combo") or {}).get("id"),
            "cards": [u["card"]["name"] for u in (c.get("combo") or {}).get("uses", [])],
            "produces": [p["feature"]["name"] for p in (c.get("combo") or {}).get("produces", [])][:4],
            "tag": (c.get("combo") or {}).get("bracketTag"),
            "definitely_two_card": bool(c.get("definitelyTwoCard")),
            "arguably_two_card": bool(c.get("arguablyTwoCard")),
            "relevant": bool(c.get("relevant")),
            "mass_land_denial": bool(c.get("massLandDenial")),
            "extra_turn": bool(c.get("extraTurn")),
        } for c in data.get("combos", [])],
    }
    conn.execute("INSERT INTO api_cache (key, status, body, fetched_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE "
                 "SET status=excluded.status, body=excluded.body, fetched_at=excluded.fetched_at",
                 (key, 200, db.dumps(slim), time.time()))
    return slim
