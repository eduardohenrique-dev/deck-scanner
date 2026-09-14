"""Cliente da API da Scryfall: rate limit (~10 req/s), User-Agent próprio e cache local em SQLite.

Usado só para o que o bulk local não resolve (carta nova, leitura do modelo com set/número
fora do catálogo). Toda carta obtida pela API é gravada no catálogo local.
"""
from __future__ import annotations

import threading
import time
from urllib.parse import quote, urlencode

import httpx

from ... import config, db
from . import scryfall_import


class ScryfallClient:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last = 0.0
        self._client = httpx.Client(headers=scryfall_import.HEADERS, timeout=20, follow_redirects=True)

    def _throttle(self) -> None:
        with self._lock:
            wait = self._last + config.SCRYFALL_MIN_INTERVAL - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()

    def get(self, path: str, params: dict | None = None, ttl: float = config.SCRYFALL_CACHE_TTL) -> tuple[int, dict | None]:
        key = path + ("?" + urlencode(sorted(params.items())) if params else "")
        conn = db.catalog_db()
        cached = conn.execute("SELECT status, body, fetched_at FROM api_cache WHERE key=?", (key,)).fetchone()
        if cached and time.time() - cached["fetched_at"] < ttl:
            return cached["status"], db.loads(cached["body"], None)
        body = None
        status = 0
        for attempt in range(3):
            self._throttle()
            try:
                resp = self._client.get(config.SCRYFALL_API + path, params=params)
            except httpx.HTTPError:
                if cached:
                    return cached["status"], db.loads(cached["body"], None)
                return 0, None
            status = resp.status_code
            if status == 429:
                time.sleep(1.0 + attempt)
                continue
            if "json" in resp.headers.get("content-type", ""):
                body = resp.json()
            break
        if status in (200, 404):
            conn.execute(
                "INSERT INTO api_cache(key, status, body, fetched_at) VALUES(?,?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET status=excluded.status, body=excluded.body, fetched_at=excluded.fetched_at",
                (key, status, db.dumps(body) if body is not None else None, time.time()),
            )
        return status, body

    def card_by_set_number(self, set_code: str, number: str, lang: str | None = None) -> dict | None:
        path = f"/cards/{quote(set_code.lower())}/{quote(str(number))}"
        if lang and lang != "en":
            path += f"/{quote(lang)}"
        status, body = self.get(path)
        return body if status == 200 and body and body.get("object") == "card" else None

    def named_fuzzy(self, name: str, set_code: str | None = None) -> dict | None:
        params = {"fuzzy": name}
        if set_code:
            params["set"] = set_code.lower()
        status, body = self.get("/cards/named", params, ttl=24 * 3600)
        return body if status == 200 and body and body.get("object") == "card" else None

    def card_by_id(self, card_id: str) -> dict | None:
        status, body = self.get(f"/cards/{quote(card_id)}")
        return body if status == 200 and body and body.get("object") == "card" else None


def upsert_card(card: dict) -> str:
    """Grava no catálogo local uma carta vinda da API (e o oracle correspondente, se faltar)."""
    conn = db.catalog_db()
    row = scryfall_import.card_row(card)
    conn.execute(scryfall_import.INSERT_CARD_SQL, row)
    values = dict(zip(scryfall_import.CARD_COLUMNS, row))
    oracle_id = values["oracle_id"]
    if oracle_id and conn.execute("SELECT 1 FROM oracle_cards WHERE oracle_id=?", (oracle_id,)).fetchone() is None:
        conn.execute(
            "INSERT INTO oracle_cards (oracle_id, game_id, name_en, default_ref_id, kind, layout, mana_cost, cmc, "
            "type_line, oracle_text, colors, color_identity, produced_mana, keywords, legalities, faces, game_changer) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (oracle_id, "mtg", card["name"], card["id"], values["kind"], values["layout"], values["mana_cost"],
             values["cmc"], values["type_line"], values["oracle_text"], values["colors"], values["color_identity"],
             values["produced_mana"], values["keywords"], values["legalities"], values["faces"],
             values["game_changer"]),
        )
        conn.execute("INSERT OR IGNORE INTO card_names (game_id, oracle_id, lang, name) VALUES (?,?,?,?)",
                     ("mtg", oracle_id, "en", card["name"]))
    return card["id"]


_client: ScryfallClient | None = None


def client() -> ScryfallClient:
    global _client
    if _client is None:
        _client = ScryfallClient()
    return _client
