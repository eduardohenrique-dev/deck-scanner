"""Consolida detecções em cartas físicas e entradas de lista, e roda o motor de regras."""
from __future__ import annotations

from collections import defaultdict

from .. import db
from ..events import bus
from ..games import registry
from ..rules import engine
from ..rules.messages import load_messages
from . import store


def representatives(dets: list[dict]) -> list[dict]:
    """Uma detecção identificada por carta física (as colapsadas apontam para o representante via dup_of)."""
    ids = {d["id"] for d in dets}
    return [d for d in dets if d["status"] == "identified" and not (d.get("dup_of") and d["dup_of"] in ids)]


def rebuild(session_id: str, publish: bool = True) -> dict:
    with db.lease_lock(f"rebuild:{session_id}"):
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
    fields_by_ref = adapter.card_fields_many([k[0] for k in groups])
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
                position = min(e["position"], members[0]["seq"]) if e["manual"] else members[0]["seq"]
                if e["quantity_detected"] != len(members) or (e.get("allocated_physical_ids") or []) != phys \
                        or e["position"] != position:
                    store.update_entry(e["id"], quantity_detected=len(members), allocated_physical_ids=phys,
                                       position=position)
            else:
                fields = fields_by_ref.get(key[0]) or {}
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
    return validate_deck(store.get_deck(session["deck_id"]))


def validate_deck(deck: dict, persist: bool = True) -> dict:
    adapter = registry.get(deck["game_id"])
    rule = adapter.format(deck["format_id"])
    rows = store.entries(deck["id"])
    cards = adapter.card_fields_many([e["card_ref_id"] for e in rows])
    engine_entries = []
    for e in rows:
        fields = cards.get(e["card_ref_id"])
        if fields is None:
            continue
        engine_entries.append(engine.EngineEntry(
            id=e["id"], card_ref_id=e["card_ref_id"], key=e["oracle_id"] or fields["key"], zone=e["zone"],
            quantity_detected=e["quantity_detected"], quantity_override=e["quantity_override"],
            is_commander=bool(e["is_commander"]), position=e["position"], manual=bool(e["manual"])))
    report = engine.evaluate(rule, engine_entries, cards, game_meta=adapter.game_meta(), messages=load_messages(),
                             suggestion_providers=adapter.suggestion_providers())
    if persist:
        changes = []
        for e in rows:
            info = report["entries"].get(e["id"])
            if info and (info["quantity"] != e["quantity"] or info["warnings"] != (e["rule_warnings"] or [])):
                changes.append((info["quantity"], db.dumps(info["warnings"]), e["id"]))
        if changes:
            conn = db.app_db()
            with db.tx(conn):
                conn.executemany("UPDATE deck_entries SET quantity=?, rule_warnings=? WHERE id=?", changes)
    return report
