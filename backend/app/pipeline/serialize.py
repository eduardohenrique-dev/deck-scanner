"""Formas públicas (JSON para o frontend) de capturas, detecções e entradas."""
from __future__ import annotations

from ..games.base import GameAdapter

_summary_cache: dict[str, dict] = {}


def card(adapter: GameAdapter, card_ref_id: str | None) -> dict | None:
    if not card_ref_id:
        return None
    hit = _summary_cache.get(card_ref_id)
    if hit is None:
        hit = adapter.card_summary(card_ref_id)
        if hit is not None:
            _summary_cache[card_ref_id] = hit
    return hit


def capture_public(c: dict) -> dict:
    return {
        "id": c["id"], "type": c["type"], "idx": c["idx"], "status": c["status"], "progress": c.get("progress"),
        "w": c.get("w"), "h": c.get("h"), "quality": c.get("quality"), "error": c.get("error"),
        "original_name": c.get("original_name"), "image_url": f"/api/captures/{c['id']}/image" if c["type"] == "image" else None,
    }


def detection_public(d: dict, adapter: GameAdapter) -> dict:
    candidates = []
    for c in (d.get("candidates") or [])[:6]:
        s = card(adapter, c.get("card_ref_id"))
        if s:
            candidates.append({**c, "card": s})
    return {
        "id": d["id"], "capture_id": d["capture_id"], "seq": d["seq"], "status": d["status"],
        "confidence": d.get("confidence") or 0.0, "source": d.get("source"), "card_ref_id": d.get("card_ref_id"),
        "oracle_id": d.get("oracle_id"), "face": d.get("face") or 0, "language": d.get("language"),
        "finish": d.get("finish"), "bbox": d.get("bbox"), "crop_url": f"/api/detections/{d['id']}/crop",
        "card": card(adapter, d.get("card_ref_id")), "candidates": candidates, "notes": d.get("notes") or [],
        "quality": d.get("quality"), "dup_of": d.get("dup_of"), "dup_status": d.get("dup_status"),
        "dup_candidates": d.get("dup_candidates"), "temporal_group": d.get("temporal_group"),
        "frame_count": d.get("frame_count"), "t_start": d.get("t_start"), "t_end": d.get("t_end"),
        "physical_card_id": d.get("physical_card_id"), "user_corrected": bool(d.get("user_corrected")),
        "raw": {"name": d.get("raw_name"), "set": d.get("raw_set"), "number": d.get("raw_number"),
                "language": d.get("raw_language"), "finish": d.get("raw_finish")},
    }


def entry_public(e: dict, adapter: GameAdapter, validation: dict | None, dets_by_id: dict[str, dict]) -> dict:
    info = (validation or {}).get("entries", {}).get(e["id"], {})
    det_ids = e.get("allocated_physical_ids") or []
    confidences = [dets_by_id[i]["confidence"] or 0 for i in det_ids if i in dets_by_id]
    return {
        "id": e["id"], "zone": e["zone"], "card_ref_id": e["card_ref_id"], "oracle_id": e["oracle_id"],
        "language": e["language"], "finish": e["finish"], "quantity": e["quantity"],
        "quantity_detected": e["quantity_detected"], "quantity_override": e["quantity_override"],
        "quantity_auto": info.get("quantity_auto"), "limit": info.get("limit"), "exception": info.get("exception"),
        "is_commander": bool(e["is_commander"]), "manual": bool(e["manual"]), "position": e["position"],
        "warnings": info.get("warnings", e.get("rule_warnings") or []), "detection_ids": det_ids,
        "confidence": min(confidences) if confidences else None, "card": card(adapter, e["card_ref_id"]),
        "condition": e.get("condition"),
    }
