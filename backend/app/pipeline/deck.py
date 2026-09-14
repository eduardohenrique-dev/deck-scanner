"""Consolida detecções em cartas físicas e entradas de deck, e roda o motor de regras."""
from __future__ import annotations

import threading
from collections import defaultdict

from .. import config, db
from ..events import bus
from ..games import registry
from ..rules import engine
from ..rules.messages import load_messages
from . import store


def representatives(dets: list[dict]) -> list[dict]:
    """Uma detecção identificada por carta física (as colapsadas apontam para o representante via dup_of)."""
    ids = {d["id"] for d in dets}
    return [d for d in dets if d["status"] == "identified" and not (d.get("dup_of") and d["dup_of"] in ids)]


_rebuild_locks: dict[str, threading.RLock] = defaultdict(threading.RLock)


def rebuild(session_id: str, publish: bool = True) -> dict:
    with _rebuild_locks[session_id]:
        return _rebuild(session_id, publish)


def _rebuild(session_id: str, publish: bool) -> dict:
    session = store.get_session(session_id)
    adapter = registry.get(session["game_id"])
    rule = adapter.format(session["format_id"])
    default_lang = (session.get("settings") or {}).get("default_language", "en")
    zones = rule.get("zones") or ["deck"]
    default_zone = "deck" if "deck" in zones else zones[0]
    dets = store.detections(session_id)
    reps = representatives(dets)

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for d in reps:
        groups[(d["card_ref_id"], d.get("finish") or "nonfoil", d.get("language") or default_lang)].append(d)

    conn = db.app_db()
    with db.tx(conn):
        existing = store.entries(session["deck_id"])
        by_key: dict[tuple, dict] = {}
        for e in existing:
            by_key.setdefault((e["card_ref_id"], e["finish"] or "nonfoil", e["language"] or default_lang), e)
        seen: set[str] = set()
        for key, members in groups.items():
            members.sort(key=lambda d: d["seq"])
            phys = [d["id"] for d in members]
            e = by_key.get(key)
            if e:
                seen.add(e["id"])
                store.update_entry(e["id"], quantity_detected=len(members), allocated_physical_ids=phys,
                                   position=min(e["position"], members[0]["seq"]) if e["manual"] else members[0]["seq"])
            else:
                fields = adapter.card_fields(key[0]) or {}
                store.insert_entry(session["deck_id"], zone=default_zone, card_ref_id=key[0], oracle_id=fields.get("key"),
                                   language=key[2], finish=key[1], quantity=len(members),
                                   quantity_detected=len(members), is_commander=0, manual=0, rule_warnings=[],
                                   allocated_physical_ids=phys, position=members[0]["seq"])
        for e in existing:
            if e["id"] in seen:
                continue
            if e["manual"] or e["quantity_override"] is not None:
                if e["quantity_detected"]:
                    store.update_entry(e["id"], quantity_detected=0, allocated_physical_ids=[])
            else:
                store.delete_entry(e["id"])

        conn.execute("DELETE FROM physical_cards WHERE session_id=?", (session_id,))
        rows = []
        for d in reps:
            s = db.catalog_db().execute("SELECT set_code, collector_number FROM card_refs WHERE id=?",
                                        (d["card_ref_id"],)).fetchone()
            rows.append((d["id"], config.DEFAULT_USER_ID, session["game_id"], session_id, d["card_ref_id"],
                         s["set_code"] if s else None, s["collector_number"] if s else None, d.get("language"),
                         d.get("finish"), None, "session", session_id, db.now_iso()))
        conn.executemany(
            "INSERT OR REPLACE INTO physical_cards (id, user_id, game_id, session_id, card_ref_id, set_code, "
            "collector_number, language, finish, condition, location_type, location_id, acquired_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        rep_ids = {d["id"] for d in reps}
        for d in dets:
            phys_id = d["id"] if d["id"] in rep_ids else (d.get("dup_of") if d["status"] == "identified" else None)
            if d.get("physical_card_id") != phys_id:
                conn.execute("UPDATE detections SET physical_card_id=? WHERE id=?", (phys_id, d["id"]))

    report = validate(session_id)
    store.touch_session(session_id)
    if publish:
        bus.publish(session_id, {"type": "deck_updated"})
    return report


def validate(session_id: str) -> dict:
    session = store.get_session(session_id)
    adapter = registry.get(session["game_id"])
    rule = adapter.format(session["format_id"])
    rows = store.entries(session["deck_id"])
    engine_entries, cards = [], {}
    for e in rows:
        fields = adapter.card_fields(e["card_ref_id"])
        if fields is None:
            continue
        cards[e["card_ref_id"]] = fields
        engine_entries.append(engine.EngineEntry(
            id=e["id"], card_ref_id=e["card_ref_id"], key=e["oracle_id"] or fields["key"], zone=e["zone"],
            quantity_detected=e["quantity_detected"], quantity_override=e["quantity_override"],
            is_commander=bool(e["is_commander"]), position=e["position"], manual=bool(e["manual"])))
    report = engine.evaluate(rule, engine_entries, cards, game_meta=adapter.game_meta(), messages=load_messages(),
                             suggestion_providers=adapter.suggestion_providers())
    conn = db.app_db()
    with db.tx(conn):
        for e in rows:
            info = report["entries"].get(e["id"])
            if info and (info["quantity"] != e["quantity"] or info["warnings"] != (e["rule_warnings"] or [])):
                conn.execute("UPDATE deck_entries SET quantity=?, rule_warnings=? WHERE id=?",
                             (info["quantity"], db.dumps(info["warnings"]), e["id"]))
    return report
