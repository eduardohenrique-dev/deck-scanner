"""Onde as cartas físicas ficam: dentro de um deck, numa pasta, numa caixa ou soltas."""
from __future__ import annotations

from .. import db

TYPES = {"deck": "Deck", "binder": "Pasta", "box": "Caixa", "loose": "Solto"}
USER_TYPES = ("binder", "box")


def _row(r) -> dict | None:
    return db.row_to_dict(r) if r else None


def get(location_id: str) -> dict | None:
    return _row(db.app_db().execute("SELECT * FROM locations WHERE id=?", (location_id,)).fetchone())


def ensure_loose(user_id: str, game_id: str = "mtg") -> dict:
    conn = db.app_db()
    row = conn.execute("SELECT * FROM locations WHERE user_id=? AND game_id=? AND type='loose'", (user_id, game_id)).fetchone()
    if row:
        return db.row_to_dict(row)
    lid = f"loose-{user_id}-{game_id}"  # id determinístico: duas instâncias não criam dois "Solto"
    conn.execute("INSERT INTO locations (id, user_id, game_id, type, name, sort, created_at) VALUES (?,?,?,?,?,?,?) "
                 "ON CONFLICT (id) DO NOTHING", (lid, user_id, game_id, "loose", "Solto", 999, db.now_iso()))
    return get(lid)


def for_deck(deck: dict) -> dict:
    conn = db.app_db()
    row = conn.execute("SELECT * FROM locations WHERE deck_id=?", (deck["id"],)).fetchone()
    if row:
        return db.row_to_dict(row)
    lid = f"deck-{deck['id']}"
    conn.execute("INSERT INTO locations (id, user_id, game_id, type, name, deck_id, sort, created_at) "
                 "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING",
                 (lid, deck["user_id"], deck["game_id"], "deck", deck.get("name") or "Deck", deck["id"], 0, db.now_iso()))
    return get(lid)


def of_deck(deck_id: str) -> dict | None:
    return _row(db.app_db().execute("SELECT * FROM locations WHERE deck_id=?", (deck_id,)).fetchone())


def list_for_user(user_id: str, game_id: str = "mtg") -> list[dict]:
    ensure_loose(user_id, game_id)
    rows = db.app_db().execute(
        "SELECT l.id, l.user_id, l.game_id, l.type, l.name, l.deck_id, l.sort, l.created_at, d.name AS deck_name, "
        "d.format_id AS deck_format, (SELECT COUNT(*) FROM physical_cards p WHERE p.location_id = l.id) AS card_count "
        "FROM locations l LEFT JOIN decks d ON d.id = l.deck_id WHERE l.user_id=? AND l.game_id=? "
        "ORDER BY CASE l.type WHEN 'deck' THEN 0 WHEN 'binder' THEN 1 WHEN 'box' THEN 2 ELSE 3 END, l.sort, l.name",
        (user_id, game_id)).fetchall()
    out = []
    for r in rows:
        d = db.row_to_dict(r)
        if d["type"] == "deck" and d.get("deck_name"):
            d["name"] = d["deck_name"]
        d["type_label"] = TYPES.get(d["type"], d["type"])
        out.append(d)
    return out


def create(user_id: str, game_id: str, type_: str, name: str) -> dict:
    if type_ not in USER_TYPES:
        raise ValueError("tipo de local inválido")
    lid = db.new_id()
    db.app_db().execute("INSERT INTO locations (id, user_id, game_id, type, name, sort, created_at) VALUES (?,?,?,?,?,?,?)",
                        (lid, user_id, game_id, type_, name.strip()[:80] or TYPES[type_], 100, db.now_iso()))
    return get(lid)


def rename(location_id: str, name: str) -> None:
    db.app_db().execute("UPDATE locations SET name=? WHERE id=? AND type IN ('binder','box')", (name.strip()[:80], location_id))


def delete(location: dict) -> int:
    """Apaga pasta/caixa; as cartas dela vão para 'Solto' (nunca somem)."""
    if location["type"] not in USER_TYPES:
        raise ValueError("esse local não pode ser apagado")
    loose = ensure_loose(location["user_id"], location["game_id"])
    conn = db.app_db()
    with db.tx(conn):
        moved = conn.execute("UPDATE physical_cards SET location_id=?, updated_at=? WHERE location_id=?",
                             (loose["id"], db.now_iso(), location["id"])).rowcount
        conn.execute("DELETE FROM locations WHERE id=?", (location["id"],))
    return moved
