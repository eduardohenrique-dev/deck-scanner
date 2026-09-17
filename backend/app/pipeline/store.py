"""Persistência de sessões de scan, capturas, detecções e entradas de lista.

Arquivos (fotos, recortes) vão para o storage; o banco guarda só a chave.
Contadores de sequência são atômicos no banco: várias instâncias podem gravar na mesma sessão.
"""
from __future__ import annotations

import cv2
import numpy as np

from .. import db
from ..storage import capture_key, crop_key, get_storage, session_prefix

DET_JSON = ("bbox", "candidates", "neighbors", "quality", "notes", "dup_candidates", "condition", "print_check")
SESSION_JSON = ("settings", "stats")
CAPTURE_JSON = ("quality",)
ENTRY_JSON = ("rule_warnings", "allocated_physical_ids")


def _jsonify(fields: dict, json_fields: tuple[str, ...]) -> dict:
    for k in json_fields:
        if k in fields and fields[k] is not None and not isinstance(fields[k], str):
            fields[k] = db.dumps(fields[k])
    return fields


# ---------------------------------------------------------------- sessões
def create_session(user_id: str, game_id: str, format_id: str, mode: str, name: str | None, settings: dict | None,
                   purpose: str = "build", target_deck_id: str | None = None) -> dict:
    conn = db.app_db()
    sid, deck_id, now = db.new_id(), db.new_id(), db.now_iso()
    settings = {"default_language": "en", **(settings or {})}
    with db.tx(conn):
        conn.execute(
            "INSERT INTO decks (id, user_id, game_id, format_id, name, kind, session_id, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)", (deck_id, user_id, game_id, format_id, name, "draft", sid, now, now))
        conn.execute(
            "INSERT INTO scan_sessions (id, user_id, game_id, format_id, mode, purpose, target_deck_id, name, status, "
            "settings, stats, deck_id, seq_counter, capture_counter, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, user_id, game_id, format_id, mode, purpose, target_deck_id, name, "capturing", db.dumps(settings),
             db.dumps({}), deck_id, 0, 0, now, now))
    return get_session(sid)


def get_session(session_id: str) -> dict | None:
    row = db.app_db().execute("SELECT * FROM scan_sessions WHERE id=?", (session_id,)).fetchone()
    return db.row_to_dict(row, SESSION_JSON)


def list_sessions(user_id: str, limit: int = 50, purpose: str | None = None) -> list[dict]:
    sql = ("SELECT s.*, (SELECT COALESCE(SUM(quantity),0) FROM deck_entries e WHERE e.deck_id = s.deck_id) AS card_count, "
           "(SELECT COUNT(*) FROM capture_items c WHERE c.session_id = s.id) AS capture_count, "
           "d.name AS saved_deck_name, t.name AS target_deck_name "
           "FROM scan_sessions s LEFT JOIN decks d ON d.id = s.saved_deck_id LEFT JOIN decks t ON t.id = s.target_deck_id "
           "WHERE s.user_id = ?")
    params: list = [user_id]
    if purpose:
        sql += " AND s.purpose = ?"
        params.append(purpose)
    sql += " ORDER BY s.updated_at DESC LIMIT ?"
    params.append(limit)
    return [db.row_to_dict(r, SESSION_JSON) for r in db.app_db().execute(sql, params)]


def update_session(session_id: str, **fields) -> None:
    if not fields:
        return
    _jsonify(fields, SESSION_JSON)
    fields["updated_at"] = db.now_iso()
    cols = ", ".join(f"{k}=?" for k in fields)
    conn = db.app_db()
    conn.execute(f"UPDATE scan_sessions SET {cols} WHERE id=?", (*fields.values(), session_id))
    if "format_id" in fields:
        conn.execute("UPDATE decks SET format_id=? WHERE session_id=? AND kind='draft'", (fields["format_id"], session_id))
    if "name" in fields:
        conn.execute("UPDATE decks SET name=? WHERE session_id=? AND kind='draft'", (fields["name"], session_id))


def touch_session(session_id: str) -> None:
    db.app_db().execute("UPDATE scan_sessions SET updated_at=? WHERE id=?", (db.now_iso(), session_id))


def delete_session(session_id: str) -> None:
    conn = db.app_db()
    s = get_session(session_id)
    if not s:
        return
    with db.tx(conn):
        conn.execute("DELETE FROM deck_entries WHERE deck_id IN (SELECT id FROM decks WHERE session_id=? AND kind='draft')",
                     (session_id,))
        conn.execute("DELETE FROM decks WHERE session_id=? AND kind='draft'", (session_id,))
        conn.execute("DELETE FROM detections WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM capture_items WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM scan_sessions WHERE id=?", (session_id,))
    try:
        get_storage().delete_prefix(session_prefix(session_id))
    except Exception:  # noqa: BLE001 — arquivo órfão não impede apagar a sessão
        pass


def next_seq(session_id: str) -> int:
    row = db.app_db().execute(
        "UPDATE scan_sessions SET seq_counter = seq_counter + 1 WHERE id=? RETURNING seq_counter", (session_id,)).fetchone()
    return int(row[0])


def _next_capture_idx(session_id: str) -> int:
    row = db.app_db().execute(
        "UPDATE scan_sessions SET capture_counter = capture_counter + 1 WHERE id=? RETURNING capture_counter",
        (session_id,)).fetchone()
    return int(row[0])


# ---------------------------------------------------------------- capturas
def add_capture(session_id: str, type_: str, file_key: str | None, original_name: str | None,
                capture_id: str | None = None, status: str = "queued") -> dict:
    cid = capture_id or db.new_id()
    db.app_db().execute(
        "INSERT INTO capture_items (id, session_id, type, idx, file_path, original_name, status, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (cid, session_id, type_, _next_capture_idx(session_id), file_key, original_name, status, db.now_iso()))
    return get_capture(cid)


def store_capture_file(session_id: str, capture_id: str, data: bytes, ext: str, content_type: str) -> str:
    key = capture_key(session_id, capture_id, ext)
    get_storage().put(key, data, content_type)
    return key


def get_capture(capture_id: str) -> dict | None:
    return db.row_to_dict(db.app_db().execute("SELECT * FROM capture_items WHERE id=?", (capture_id,)).fetchone(),
                          CAPTURE_JSON)


def captures(session_id: str) -> list[dict]:
    rows = db.app_db().execute("SELECT * FROM capture_items WHERE session_id=? ORDER BY idx", (session_id,)).fetchall()
    return [db.row_to_dict(r, CAPTURE_JSON) for r in rows]


def update_capture(capture_id: str, **fields) -> None:
    if not fields:
        return
    _jsonify(fields, CAPTURE_JSON)
    cols = ", ".join(f"{k}=?" for k in fields)
    db.app_db().execute(f"UPDATE capture_items SET {cols} WHERE id=?", (*fields.values(), capture_id))


# ---------------------------------------------------------------- detecções
def insert_detection_seq(session_id: str, capture_id: str, **fields) -> dict:
    """Insere alocando o próximo `seq` da sessão de forma atômica (várias threads/instâncias identificam em paralelo)."""
    return insert_detection(session_id, capture_id, seq=next_seq(session_id), **fields)


def insert_detection(session_id: str, capture_id: str, **fields) -> dict:
    did = fields.pop("id", None) or db.new_id()
    data = _jsonify({"id": did, "session_id": session_id, "capture_id": capture_id, "created_at": db.now_iso(),
                     **fields}, DET_JSON)
    cols = ", ".join(data)
    db.app_db().execute(f"INSERT INTO detections ({cols}) VALUES ({db.placeholders(len(data))})", tuple(data.values()))
    return get_detection(did)


def update_detection(detection_id: str, **fields) -> None:
    if not fields:
        return
    _jsonify(fields, DET_JSON)
    cols = ", ".join(f"{k}=?" for k in fields)
    db.app_db().execute(f"UPDATE detections SET {cols} WHERE id=?", (*fields.values(), detection_id))


def get_detection(detection_id: str) -> dict | None:
    return db.row_to_dict(db.app_db().execute("SELECT * FROM detections WHERE id=?", (detection_id,)).fetchone(), DET_JSON)


def detections(session_id: str) -> list[dict]:
    rows = db.app_db().execute("SELECT * FROM detections WHERE session_id=? ORDER BY seq", (session_id,)).fetchall()
    return [db.row_to_dict(r, DET_JSON) for r in rows]


def save_crop(session_id: str, detection_id: str, img: np.ndarray, quality: int = 88) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("falha ao codificar recorte")
    key = crop_key(session_id, detection_id)
    get_storage().put(key, buf.tobytes(), "image/jpeg")
    return key


def save_crop_bytes(session_id: str, detection_id: str, jpeg: bytes) -> str:
    key = crop_key(session_id, detection_id)
    get_storage().put(key, jpeg, "image/jpeg")
    return key


def load_image_key(key: str | None, flags: int = cv2.IMREAD_COLOR) -> np.ndarray | None:
    if not key:
        return None
    data = get_storage().get(key)
    if not data:
        return None
    return cv2.imdecode(np.frombuffer(data, np.uint8), flags)


# ---------------------------------------------------------------- entradas de lista
def entries(deck_id: str) -> list[dict]:
    rows = db.app_db().execute("SELECT * FROM deck_entries WHERE deck_id=? ORDER BY position, id", (deck_id,)).fetchall()
    return [db.row_to_dict(r, ENTRY_JSON) for r in rows]


def get_entry(entry_id: str) -> dict | None:
    return db.row_to_dict(db.app_db().execute("SELECT * FROM deck_entries WHERE id=?", (entry_id,)).fetchone(), ENTRY_JSON)


def insert_entry(deck_id: str, **fields) -> str:
    eid = fields.pop("id", None) or db.new_id()
    data = _jsonify({"id": eid, "deck_id": deck_id, **fields}, ENTRY_JSON)
    db.app_db().execute(f"INSERT INTO deck_entries ({', '.join(data)}) VALUES ({db.placeholders(len(data))})",
                        tuple(data.values()))
    return eid


def update_entry(entry_id: str, **fields) -> None:
    if not fields:
        return
    _jsonify(fields, ENTRY_JSON)
    cols = ", ".join(f"{k}=?" for k in fields)
    db.app_db().execute(f"UPDATE deck_entries SET {cols} WHERE id=?", (*fields.values(), entry_id))


def delete_entry(entry_id: str) -> None:
    db.app_db().execute("DELETE FROM deck_entries WHERE id=?", (entry_id,))


def get_deck(deck_id: str) -> dict | None:
    return db.row_to_dict(db.app_db().execute("SELECT * FROM decks WHERE id=?", (deck_id,)).fetchone())


def preferred_sets(session: dict | None) -> set[str] | None:
    """Coleções que a pessoa definiu para a sessão ("estas cartas são da coleção X")."""
    raw = ((session or {}).get("settings") or {}).get("set_codes") or []
    codes = {str(c).strip().lower() for c in raw if str(c).strip()}
    return codes or None
