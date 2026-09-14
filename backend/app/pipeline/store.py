"""Persistência de sessões, capturas, detecções e entradas de deck (app.db)."""
from __future__ import annotations

import shutil
import threading
from pathlib import Path

import cv2
import numpy as np

from .. import config, db

DET_JSON = ("bbox", "candidates", "neighbors", "quality", "notes", "dup_candidates")
SESSION_JSON = ("settings", "stats")
CAPTURE_JSON = ("quality",)
ENTRY_JSON = ("rule_warnings", "allocated_physical_ids")


# ---------------------------------------------------------------- sessões
def create_session(game_id: str, format_id: str, mode: str, name: str | None, settings: dict | None) -> dict:
    conn = db.app_db()
    sid, deck_id, now = db.new_id(), db.new_id(), db.now_iso()
    settings = {"default_language": "en", **(settings or {})}
    with db.tx(conn):
        conn.execute(
            "INSERT INTO decks (id, user_id, game_id, format_id, name, session_id, created_at) VALUES (?,?,?,?,?,?,?)",
            (deck_id, config.DEFAULT_USER_ID, game_id, format_id, name, sid, now))
        conn.execute(
            "INSERT INTO scan_sessions (id, user_id, game_id, format_id, mode, name, status, settings, stats, deck_id, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, config.DEFAULT_USER_ID, game_id, format_id, mode, name, "capturing", db.dumps(settings),
             db.dumps({}), deck_id, now, now))
    return get_session(sid)


def get_session(session_id: str) -> dict | None:
    row = db.app_db().execute("SELECT * FROM scan_sessions WHERE id=?", (session_id,)).fetchone()
    return db.row_to_dict(row, SESSION_JSON)


def list_sessions(limit: int = 50) -> list[dict]:
    rows = db.app_db().execute(
        "SELECT s.*, (SELECT COALESCE(SUM(quantity),0) FROM deck_entries e WHERE e.deck_id = s.deck_id) AS card_count, "
        "(SELECT COUNT(*) FROM capture_items c WHERE c.session_id = s.id) AS capture_count "
        "FROM scan_sessions s ORDER BY s.updated_at DESC LIMIT ?", (limit,)).fetchall()
    return [db.row_to_dict(r, SESSION_JSON) for r in rows]


def update_session(session_id: str, **fields) -> None:
    if not fields:
        return
    for k in SESSION_JSON:
        if k in fields and not isinstance(fields[k], str):
            fields[k] = db.dumps(fields[k])
    fields["updated_at"] = db.now_iso()
    cols = ", ".join(f"{k}=?" for k in fields)
    db.app_db().execute(f"UPDATE scan_sessions SET {cols} WHERE id=?", (*fields.values(), session_id))
    if "format_id" in fields:
        db.app_db().execute("UPDATE decks SET format_id=? WHERE session_id=?", (fields["format_id"], session_id))
    if "name" in fields:
        db.app_db().execute("UPDATE decks SET name=? WHERE session_id=?", (fields["name"], session_id))


def touch_session(session_id: str) -> None:
    db.app_db().execute("UPDATE scan_sessions SET updated_at=? WHERE id=?", (db.now_iso(), session_id))


def delete_session(session_id: str) -> None:
    conn = db.app_db()
    s = get_session(session_id)
    if not s:
        return
    with db.tx(conn):
        conn.execute("DELETE FROM deck_entries WHERE deck_id=?", (s["deck_id"],))
        conn.execute("DELETE FROM decks WHERE id=?", (s["deck_id"],))
        conn.execute("DELETE FROM detections WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM capture_items WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM physical_cards WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM scan_sessions WHERE id=?", (session_id,))
    shutil.rmtree(config.UPLOAD_DIR / session_id, ignore_errors=True)
    shutil.rmtree(config.CROP_DIR / session_id, ignore_errors=True)


# ---------------------------------------------------------------- capturas
def upload_dir(session_id: str) -> Path:
    d = config.UPLOAD_DIR / session_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def add_capture(session_id: str, type_: str, file_path: str, original_name: str | None) -> dict:
    conn = db.app_db()
    idx = conn.execute("SELECT COALESCE(MAX(idx), 0) + 1 FROM capture_items WHERE session_id=?", (session_id,)).fetchone()[0]
    cid = db.new_id()
    conn.execute(
        "INSERT INTO capture_items (id, session_id, type, idx, file_path, original_name, status, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)", (cid, session_id, type_, idx, file_path, original_name, "queued", db.now_iso()))
    return get_capture(cid)


def get_capture(capture_id: str) -> dict | None:
    return db.row_to_dict(db.app_db().execute("SELECT * FROM capture_items WHERE id=?", (capture_id,)).fetchone(),
                          CAPTURE_JSON)


def captures(session_id: str) -> list[dict]:
    rows = db.app_db().execute("SELECT * FROM capture_items WHERE session_id=? ORDER BY idx", (session_id,)).fetchall()
    return [db.row_to_dict(r, CAPTURE_JSON) for r in rows]


def update_capture(capture_id: str, **fields) -> None:
    if "quality" in fields and not isinstance(fields["quality"], str):
        fields["quality"] = db.dumps(fields["quality"])
    cols = ", ".join(f"{k}=?" for k in fields)
    db.app_db().execute(f"UPDATE capture_items SET {cols} WHERE id=?", (*fields.values(), capture_id))


# ---------------------------------------------------------------- detecções
def next_seq(session_id: str) -> int:
    return db.app_db().execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM detections WHERE session_id=?",
                               (session_id,)).fetchone()[0]


_seq_lock = threading.Lock()


def insert_detection_seq(session_id: str, capture_id: str, **fields) -> dict:
    """Insere alocando o próximo `seq` da sessão de forma atômica (várias threads identificam em paralelo)."""
    with _seq_lock:
        return insert_detection(session_id, capture_id, seq=next_seq(session_id), **fields)


def insert_detection(session_id: str, capture_id: str, **fields) -> dict:
    did = fields.pop("id", None) or db.new_id()
    data = {"id": did, "session_id": session_id, "capture_id": capture_id, "created_at": db.now_iso(), **fields}
    for k in DET_JSON:
        if k in data and data[k] is not None and not isinstance(data[k], str):
            data[k] = db.dumps(data[k])
    cols = ", ".join(data)
    db.app_db().execute(f"INSERT INTO detections ({cols}) VALUES ({', '.join('?' for _ in data)})", tuple(data.values()))
    return get_detection(did)


def update_detection(detection_id: str, **fields) -> None:
    if not fields:
        return
    for k in DET_JSON:
        if k in fields and fields[k] is not None and not isinstance(fields[k], str):
            fields[k] = db.dumps(fields[k])
    cols = ", ".join(f"{k}=?" for k in fields)
    db.app_db().execute(f"UPDATE detections SET {cols} WHERE id=?", (*fields.values(), detection_id))


def get_detection(detection_id: str) -> dict | None:
    return db.row_to_dict(db.app_db().execute("SELECT * FROM detections WHERE id=?", (detection_id,)).fetchone(), DET_JSON)


def detections(session_id: str) -> list[dict]:
    rows = db.app_db().execute("SELECT * FROM detections WHERE session_id=? ORDER BY seq", (session_id,)).fetchall()
    return [db.row_to_dict(r, DET_JSON) for r in rows]


def crop_path(session_id: str, detection_id: str, suffix: str = "") -> Path:
    d = config.CROP_DIR / session_id
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{detection_id}{suffix}.jpg"


def save_crop(session_id: str, detection_id: str, img: np.ndarray, suffix: str = "") -> str:
    path = crop_path(session_id, detection_id, suffix)
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return str(path)


# ---------------------------------------------------------------- entradas do deck
def entries(deck_id: str) -> list[dict]:
    rows = db.app_db().execute("SELECT * FROM deck_entries WHERE deck_id=? ORDER BY position, id", (deck_id,)).fetchall()
    return [db.row_to_dict(r, ENTRY_JSON) for r in rows]


def get_entry(entry_id: str) -> dict | None:
    return db.row_to_dict(db.app_db().execute("SELECT * FROM deck_entries WHERE id=?", (entry_id,)).fetchone(), ENTRY_JSON)


def insert_entry(deck_id: str, **fields) -> str:
    eid = db.new_id()
    data = {"id": eid, "deck_id": deck_id, **fields}
    for k in ENTRY_JSON:
        if k in data and not isinstance(data[k], str):
            data[k] = db.dumps(data[k])
    db.app_db().execute(f"INSERT INTO deck_entries ({', '.join(data)}) VALUES ({', '.join('?' for _ in data)})",
                        tuple(data.values()))
    return eid


def update_entry(entry_id: str, **fields) -> None:
    if not fields:
        return
    for k in ENTRY_JSON:
        if k in fields and not isinstance(fields[k], str):
            fields[k] = db.dumps(fields[k])
    cols = ", ".join(f"{k}=?" for k in fields)
    db.app_db().execute(f"UPDATE deck_entries SET {cols} WHERE id=?", (*fields.values(), entry_id))


def delete_entry(entry_id: str) -> None:
    db.app_db().execute("DELETE FROM deck_entries WHERE id=?", (entry_id,))
