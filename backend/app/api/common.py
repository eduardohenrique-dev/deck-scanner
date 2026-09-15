"""Utilidades compartilhadas pelos routers: respostas JSON, posse de recursos e estado da sessão."""
from __future__ import annotations

from collections import Counter

import orjson
from fastapi import HTTPException
from fastapi.responses import Response

from .. import db
from ..auth import User
from ..games import registry
from ..pipeline import deck, store
from ..pipeline.serialize import Context, capture_public, detection_public, entry_public


def json_response(data, status_code: int = 200) -> Response:
    return Response(orjson.dumps(data, option=orjson.OPT_SERIALIZE_NUMPY), media_type="application/json",
                    status_code=status_code)


def own_session(session_id: str, user: User) -> dict:
    s = store.get_session(session_id)
    if s is None or s["user_id"] != user.id:
        raise HTTPException(404, "sessão não encontrada")
    return s


def own_deck(deck_id: str, user: User) -> dict:
    d = store.get_deck(deck_id)
    if d is None or d["user_id"] != user.id:
        raise HTTPException(404, "deck não encontrado")
    return d


def own_detection(detection_id: str, user: User) -> tuple[dict, dict]:
    d = store.get_detection(detection_id)
    if d is None:
        raise HTTPException(404, "detecção não encontrada")
    return d, own_session(d["session_id"], user)


def own_entry(entry_id: str, user: User) -> tuple[dict, dict]:
    e = store.get_entry(entry_id)
    if e is None:
        raise HTTPException(404, "entrada não encontrada")
    return e, own_deck(e["deck_id"], user)


def game_info(adapter) -> dict:
    meta = adapter.game_meta()
    return {"id": adapter.id, "zones": adapter.zones, "languages": meta.get("languages", []),
            "finishes": meta.get("finishes", []), "conditions": meta.get("conditions", []),
            "exporters": adapter.export_formats(), "identity": adapter.identity_rules()}


def session_stats(session_id: str, dets: list[dict]) -> dict:
    ids = {d["id"] for d in dets}
    reps = deck.representatives(dets)
    active = [d for d in dets if not (d.get("dup_of") and d["dup_of"] in ids)]
    return {
        "detections": len(dets),
        "physical_cards": len(reps),
        "pending": sum(1 for d in dets if d["status"] == "pending"),
        "unidentified": sum(1 for d in active if d["status"] == "unidentified"),
        "backs": sum(1 for d in active if d["status"] == "back"),
        "tokens": sum(1 for d in active if d["status"] == "token"),
        "noise": sum(1 for d in active if d["status"] == "noise"),
        "edge": sum(1 for d in active if d["status"] == "edge"),
        "merged_duplicates": sum(1 for d in dets if d.get("dup_of") and d["dup_of"] in ids),
        "possible_duplicates": sum(1 for d in active if d.get("dup_status") == "possible"),
        "by_source": dict(Counter(d.get("source") or "none" for d in reps)),
        "vlm_calls": db.app_db().execute("SELECT COUNT(*) FROM vlm_calls WHERE session_id=?", (session_id,)).fetchone()[0],
    }


def session_state(session_id: str) -> dict:
    from ..collection import allocation, check, prices, prints  # Fase 2 (import tardio evita ciclo)

    s = store.get_session(session_id)
    if s is None:
        raise HTTPException(404, "sessão não encontrada")
    adapter = registry.get(s["game_id"])
    report = deck.validate(session_id)
    dets = store.detections(session_id)
    caps = store.captures(session_id)
    rows = store.entries(s["deck_id"])
    ctx = Context.build(adapter, captures=caps, detections=dets, entries=rows)
    dets_by_id = {d["id"]: d for d in dets}
    validation = {k: v for k, v in report.items() if k != "entries"}

    # impressão impossível: leitura do modelo (set/número/idioma) ou idioma/acabamento escolhidos na revisão
    issues = list(validation.get("issues") or [])
    ids = {d["id"] for d in dets}
    for d in dets:
        if d.get("dup_of") and d["dup_of"] in ids:
            continue
        pc = d.get("print_check")
        if pc:
            issues.append({"severity": "warning", "code": "impossible_print", "message": pc["message"],
                           "entry_ids": [], "data": {**pc.get("data", {}), "detection_id": d["id"]}})
    for e in rows:
        # só o acabamento: o idioma da lista pode vir do padrão da sessão, não de uma leitura da carta
        pc = prints.check_card_ref(s["game_id"], e["card_ref_id"], None, e["finish"],
                                   ctx.summaries.get(e["card_ref_id"])) if e["quantity"] else None
        if pc:
            issues.append({"severity": "warning", "code": "impossible_print", "message": pc["message"],
                           "entry_ids": [e["id"]], "data": pc.get("data", {})})
    validation["issues"] = issues

    counted = [e for e in rows if e["quantity"] > 0]
    value_items = [{"card_ref_id": e["card_ref_id"], "finish": e["finish"], "quantity": e["quantity"]} for e in counted]
    value = prices.valuation(s["game_id"], value_items)
    extras = {
        "value": {k: value[k] for k in ("total_usd", "total_brl", "fx", "unpriced")},
        "valuable": [i for i in value["items"] if i["unit_brl"] >= prices.VALUABLE_BRL][:12],
        "owned_elsewhere": allocation.owned_elsewhere_warnings(
            s["user_id"], s["game_id"], s.get("target_deck_id") or s.get("saved_deck_id"),
            [e["oracle_id"] for e in counted]),
    }
    if s.get("purpose") == "check":
        extras["check"] = check.result(s)
    return {
        "session": s,
        "format": adapter.format(s["format_id"]),
        "game": game_info(adapter),
        "captures": [capture_public(c, ctx) for c in caps],
        "detections": [detection_public(d, adapter, ctx) for d in dets],
        "entries": [entry_public(e, adapter, report, dets_by_id, ctx) for e in rows],
        "validation": validation,
        "stats": session_stats(session_id, dets),
        **extras,
    }
