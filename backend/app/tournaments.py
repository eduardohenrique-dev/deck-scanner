"""Torneios: o servidor guarda o documento inteiro (JSON) e o resumo para a lista.

As regras (emparelhamento, desempates, bracket) moram no cliente, num módulo puro e testado; aqui só se
guarda o que ele produz, com versão para que dois aparelhos não sobrescrevam um ao outro sem saber.
"""
from __future__ import annotations

import orjson

from . import db

MAX_DOC_BYTES = 2_000_000
STATUSES = {"draft", "running", "finished"}
SUMMARY_KEYS = {"status": str, "stage": str, "players": int, "round": int, "rounds": int, "champion": str, "leader": str,
                "format": str, "structure": str}
LIST_FIELDS = "id, user_id, name, status, event_date, player_count, summary, version, created_at, updated_at"


class TooLarge(ValueError):
    pass


def _clean_summary(summary: dict | None) -> dict:
    out: dict = {}
    for key, kind in SUMMARY_KEYS.items():
        value = (summary or {}).get(key)
        if value is None:
            continue
        if kind is int and isinstance(value, (int, float)) and not isinstance(value, bool):
            out[key] = int(value)
        elif kind is str and isinstance(value, str):
            out[key] = value[:120]
    return out


def _columns(doc: dict, summary: dict) -> dict:
    status = summary.get("status") if summary.get("status") in STATUSES else "draft"
    players = doc.get("players")
    return {
        "name": str(doc.get("name") or "Torneio")[:80],
        "status": status,
        "event_date": str(doc.get("date") or "")[:10] or None,
        "player_count": len(players) if isinstance(players, list) else 0,
        "summary": db.dumps(summary),
    }


def _encode(doc: dict) -> str:
    raw = orjson.dumps(doc)
    if len(raw) > MAX_DOC_BYTES:
        raise TooLarge("torneio grande demais para salvar")
    return raw.decode()


def list_for(user_id: str) -> list[dict]:
    rows = db.app_db().execute(f"SELECT {LIST_FIELDS} FROM tournaments WHERE user_id=? ORDER BY updated_at DESC", (user_id,))
    return [db.row_to_dict(r, ("summary",)) for r in rows]


def get(tournament_id: str) -> dict | None:
    row = db.app_db().execute("SELECT * FROM tournaments WHERE id=?", (tournament_id,)).fetchone()
    return db.row_to_dict(row, ("doc", "summary"))


def head(tournament_id: str) -> dict | None:
    """Só dono e versão, sem o documento: é o que o telão consulta a cada poucos segundos."""
    return db.row_to_dict(db.app_db().execute("SELECT user_id, version FROM tournaments WHERE id=?", (tournament_id,)).fetchone())


def create(user_id: str, doc: dict, summary: dict | None) -> dict:
    tid, now = db.new_id(), db.now_iso()
    doc = {**doc, "id": tid}
    clean = _clean_summary(summary)
    cols = _columns(doc, clean)
    db.app_db().execute(
        "INSERT INTO tournaments (id, user_id, name, status, event_date, player_count, summary, doc, version, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        (tid, user_id, cols["name"], cols["status"], cols["event_date"], cols["player_count"], cols["summary"], _encode(doc), now, now),
    )
    return get(tid)  # type: ignore[return-value]


def save(tournament_id: str, user_id: str, doc: dict, summary: dict | None, base_version: int) -> dict | None:
    """Grava só se ninguém gravou depois de `base_version`. Devolve a versão nova, ou None no conflito."""
    now = db.now_iso()
    doc = {**doc, "id": tournament_id}
    clean = _clean_summary(summary)
    cols = _columns(doc, clean)
    res = db.app_db().execute(
        "UPDATE tournaments SET name=?, status=?, event_date=?, player_count=?, summary=?, doc=?, version=version+1, updated_at=? "
        "WHERE id=? AND user_id=? AND version=?",
        (cols["name"], cols["status"], cols["event_date"], cols["player_count"], cols["summary"], _encode(doc), now,
         tournament_id, user_id, base_version),
    )
    if res.rowcount != 1:
        return None
    return {"version": base_version + 1, "updated_at": now}


def delete(tournament_id: str, user_id: str) -> bool:
    res = db.app_db().execute("DELETE FROM tournaments WHERE id=? AND user_id=?", (tournament_id, user_id))
    return res.rowcount == 1
