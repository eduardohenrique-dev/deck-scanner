"""Cartas físicas do usuário (PhysicalCard): uma linha por carta de papel, sempre com um local."""
from __future__ import annotations

from collections import Counter, defaultdict

from .. import db
from ..games import registry
from . import locations

EDITABLE = ("card_ref_id", "language", "finish", "condition", "condition_source", "location_id", "notes")


def get(card_id: str) -> dict | None:
    row = db.app_db().execute("SELECT * FROM physical_cards WHERE id=?", (card_id,)).fetchone()
    return db.row_to_dict(row) if row else None


def add_cards(user_id: str, game_id: str, items: list[dict], location_id: str) -> list[str]:
    """items: {card_ref_id, oracle_id, language, finish, condition?, condition_source?, source_session_id?,
    source_detection_id?}"""
    adapter = registry.get(game_id)
    summaries = adapter.card_summaries([i["card_ref_id"] for i in items])
    now = db.now_iso()
    rows, ids = [], []
    for it in items:
        s = summaries.get(it["card_ref_id"]) or {}
        pid = db.new_id()
        ids.append(pid)
        rows.append((pid, user_id, game_id, it["card_ref_id"], it.get("oracle_id") or s.get("oracle_id"),
                     s.get("set_code"), s.get("collector_number"), it.get("language") or s.get("lang") or "en",
                     it.get("finish") or "nonfoil", it.get("condition"), it.get("condition_source"), location_id,
                     it.get("source_session_id"), it.get("source_detection_id"), now, now, now, it.get("notes")))
    if rows:
        db.app_db().executemany(
            "INSERT INTO physical_cards (id, user_id, game_id, card_ref_id, oracle_id, set_code, collector_number, "
            "language, finish, condition, condition_source, location_id, source_session_id, source_detection_id, "
            "acquired_at, created_at, updated_at, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    return ids


def move(user_id: str, card_ids: list[str], location_id: str) -> int:
    if not card_ids:
        return 0
    moved = 0
    conn = db.app_db()
    for part in db.chunks(list(card_ids), 500):
        moved += conn.execute(
            f"UPDATE physical_cards SET location_id=?, updated_at=? WHERE user_id=? AND id IN ({db.placeholders(len(part))})",
            (location_id, db.now_iso(), user_id, *part)).rowcount
    return moved


def update(card_id: str, **fields) -> None:
    fields = {k: v for k, v in fields.items() if k in EDITABLE}
    if not fields:
        return
    if "card_ref_id" in fields:
        card = get(card_id)
        summary = registry.get(card["game_id"]).card_summary(fields["card_ref_id"]) if card else None
        if summary:
            fields.update(oracle_id=summary["oracle_id"], set_code=summary["set_code"],
                          collector_number=summary["collector_number"])
    fields["updated_at"] = db.now_iso()
    cols = ", ".join(f"{k}=?" for k in fields)
    db.app_db().execute(f"UPDATE physical_cards SET {cols} WHERE id=?", (*fields.values(), card_id))


def delete(user_id: str, card_ids: list[str]) -> int:
    removed = 0
    for part in db.chunks(list(card_ids), 500):
        removed += db.app_db().execute(
            f"DELETE FROM physical_cards WHERE user_id=? AND id IN ({db.placeholders(len(part))})", (user_id, *part)).rowcount
    return removed


def copies_by_oracle(user_id: str, game_id: str, oracle_ids) -> dict[str, list[dict]]:
    """Todas as cópias físicas dessas cartas, com o local de cada uma."""
    oracle_ids = [o for o in dict.fromkeys(oracle_ids) if o]
    out: dict[str, list[dict]] = defaultdict(list)
    for part in db.chunks(oracle_ids, 500):
        rows = db.app_db().execute(
            "SELECT p.*, l.type AS location_type, l.name AS location_name, l.deck_id AS location_deck_id, "
            "d.name AS deck_name FROM physical_cards p LEFT JOIN locations l ON l.id = p.location_id "
            f"LEFT JOIN decks d ON d.id = l.deck_id WHERE p.user_id=? AND p.game_id=? AND p.oracle_id IN "
            f"({db.placeholders(len(part))}) ORDER BY p.created_at", (user_id, game_id, *part)).fetchall()
        for r in rows:
            d = db.row_to_dict(r)
            if d.get("location_type") == "deck" and d.get("deck_name"):
                d["location_name"] = d["deck_name"]
            out[d["oracle_id"]].append(d)
    return out


def in_location(location_id: str) -> list[dict]:
    rows = db.app_db().execute("SELECT * FROM physical_cards WHERE location_id=? ORDER BY created_at", (location_id,))
    return [db.row_to_dict(r) for r in rows]


def all_for_user(user_id: str, game_id: str) -> list[dict]:
    rows = db.app_db().execute(
        "SELECT p.*, l.type AS location_type, l.name AS location_name, l.deck_id AS location_deck_id, d.name AS deck_name "
        "FROM physical_cards p LEFT JOIN locations l ON l.id = p.location_id LEFT JOIN decks d ON d.id = l.deck_id "
        "WHERE p.user_id=? AND p.game_id=? ORDER BY p.created_at DESC", (user_id, game_id)).fetchall()
    out = []
    for r in rows:
        d = db.row_to_dict(r)
        if d.get("location_type") == "deck" and d.get("deck_name"):
            d["location_name"] = d["deck_name"]
        out.append(d)
    return out


def grouped(user_id: str, game_id: str, cards: list[dict] | None = None) -> list[dict]:
    """Coleção agrupada por carta (oracle): quantidade, impressões e em quais locais estão."""
    cards = all_for_user(user_id, game_id) if cards is None else cards
    groups: dict[str, dict] = {}
    for c in cards:
        key = c.get("oracle_id") or c["card_ref_id"]
        g = groups.setdefault(key, {"oracle_id": c.get("oracle_id"), "count": 0, "prints": Counter(),
                                    "locations": {}, "card_ids": [], "latest": c["created_at"]})
        g["count"] += 1
        g["card_ids"].append(c["id"])
        g["prints"][(c["card_ref_id"], c.get("language") or "en", c.get("finish") or "nonfoil")] += 1
        loc = g["locations"].setdefault(c.get("location_id"), {
            "id": c.get("location_id"), "name": c.get("location_name") or "Solto", "type": c.get("location_type") or "loose",
            "deck_id": c.get("location_deck_id"), "count": 0})
        loc["count"] += 1
        g["latest"] = max(g["latest"], c["created_at"])
    out = []
    for g in groups.values():
        prints = [{"card_ref_id": k[0], "language": k[1], "finish": k[2], "count": n} for k, n in g["prints"].most_common()]
        out.append({"oracle_id": g["oracle_id"], "count": g["count"], "prints": prints,
                    "locations": sorted(g["locations"].values(), key=lambda x: -x["count"]),
                    "card_ids": g["card_ids"], "latest": g["latest"], "card_ref_id": prints[0]["card_ref_id"]})
    return out


def summary_counts(user_id: str, game_id: str) -> dict:
    row = db.app_db().execute(
        "SELECT COUNT(*) AS total, COUNT(DISTINCT oracle_id) AS unique_cards FROM physical_cards WHERE user_id=? AND game_id=?",
        (user_id, game_id)).fetchone()
    return {"total": row["total"] or 0, "unique": row["unique_cards"] or 0,
            "locations": len(locations.list_for_user(user_id, game_id))}
