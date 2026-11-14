"""Torneios: o servidor guarda o documento inteiro (JSON) e o resumo para a lista.

As regras (emparelhamento, desempates, bracket) moram no cliente, num módulo puro e testado; aqui só se
guarda o que ele produz, com versão para que dois aparelhos não sobrescrevam um ao outro sem saber.
"""
from __future__ import annotations

import random
import secrets
import time

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


# ---------------------------------------------------------------------- link público e inscrição pelo jogador
class Closed(ValueError):
    pass


def share_token(tournament_id: str) -> str:
    """Token do link público (relógio, mesas e inscrição); criado na primeira vez que o organizador pede."""
    database = db.app_db()
    row = database.execute("SELECT public_token FROM tournaments WHERE id=?", (tournament_id,)).fetchone()
    if row is not None and row["public_token"]:
        return row["public_token"]
    token = secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")
    database.execute("UPDATE tournaments SET public_token=? WHERE id=? AND public_token IS NULL", (token, tournament_id))
    again = database.execute("SELECT public_token FROM tournaments WHERE id=?", (tournament_id,)).fetchone()
    return again["public_token"]


def by_token(token: str) -> dict | None:
    row = db.app_db().execute("SELECT * FROM tournaments WHERE public_token=?", (token,)).fetchone()
    return db.row_to_dict(row, ("doc", "summary"))


def _rewrite_players(row: dict, players: list[dict]) -> dict:
    """Grava a lista nova de jogadores direto no documento (subindo a versão, como uma gravação do organizador)."""
    doc = {**row["doc"], "players": players, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}
    summary = {**(row.get("summary") or {}), "players": len(players)}
    now = db.now_iso()
    res = db.app_db().execute(
        "UPDATE tournaments SET doc=?, player_count=?, summary=?, version=version+1, updated_at=? WHERE id=? AND version=?",
        (_encode(doc), len(players), db.dumps(summary), now, row["id"], row["version"]))
    if res.rowcount != 1:
        raise Conflict()
    return doc


class Conflict(RuntimeError):
    pass


def join(row: dict, user_id: str, name: str) -> str:
    """Inscreve a conta no torneio (só antes de começar). Devolve o id do jogador; quem já está continua."""
    doc = row["doc"]
    players = list(doc.get("players") or [])
    for p in players:
        if p.get("userId") == user_id:
            return p["id"]
    if doc.get("startedAt"):
        raise Closed("as inscrições fecharam: o torneio já começou")
    base = (name or "Jogador").strip()[:60] or "Jogador"
    taken = {str(p.get("name", "")).casefold() for p in players}
    final, n = base, 2
    while final.casefold() in taken:
        final, n = f"{base} ({n})", n + 1
    pid = db.new_id()
    players.append({"id": pid, "name": final, "deck": None, "droppedAfter": None, "lot": random.random(), "userId": user_id})
    _rewrite_players(row, players)
    return pid


def leave(row: dict, user_id: str) -> bool:
    doc = row["doc"]
    if doc.get("startedAt"):
        raise Closed("o torneio já começou: fale com o organizador para sair")
    players = [p for p in (doc.get("players") or []) if p.get("userId") != user_id]
    if len(players) == len(doc.get("players") or []):
        return False
    _rewrite_players(row, players)
    return True
