"""Formas públicas (JSON para o frontend) de capturas, detecções e entradas.

Resumos de carta e URLs de mídia são carregados em lote (`Context`) — com banco remoto, uma consulta
por carta tornaria a tela de revisão lenta.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..games.base import GameAdapter
from ..storage import get_storage


@dataclass
class Context:
    summaries: dict[str, dict] = field(default_factory=dict)
    urls: dict[str, str] = field(default_factory=dict)

    @classmethod
    def build(cls, adapter: GameAdapter, *, captures=(), detections=(), entries=(), extra_card_ids=()) -> "Context":
        ids: list[str] = list(extra_card_ids)
        for d in detections:
            if d.get("card_ref_id"):
                ids.append(d["card_ref_id"])
            ids += [c.get("card_ref_id") for c in (d.get("candidates") or [])[:6] if c.get("card_ref_id")]
        ids += [e["card_ref_id"] for e in entries]
        keys = [d["crop_path"] for d in detections if d.get("crop_path")]
        keys += [c["file_path"] for c in captures if c.get("type") == "image" and c.get("file_path")]
        urls = {}
        if keys:
            try:
                urls = get_storage().urls(keys)
            except Exception:  # noqa: BLE001 — sem URL a UI mostra só a imagem oficial
                urls = {}
        return cls(summaries=adapter.card_summaries(ids), urls=urls)

    def card(self, adapter: GameAdapter, card_ref_id: str | None) -> dict | None:
        if not card_ref_id:
            return None
        hit = self.summaries.get(card_ref_id)
        if hit is None:
            hit = adapter.card_summary(card_ref_id)
            if hit is not None:
                self.summaries[card_ref_id] = hit
        return hit

    def url(self, key: str | None) -> str | None:
        if not key:
            return None
        hit = self.urls.get(key)
        if hit is None:
            try:
                hit = get_storage().urls([key]).get(key)
            except Exception:  # noqa: BLE001
                hit = None
            if hit:
                self.urls[key] = hit
        return hit


def capture_public(c: dict, ctx: Context | None = None) -> dict:
    ctx = ctx or Context()
    return {
        "id": c["id"], "type": c["type"], "idx": c["idx"], "status": c["status"], "progress": c.get("progress"),
        "w": c.get("w"), "h": c.get("h"), "quality": c.get("quality"), "error": c.get("error"),
        "original_name": c.get("original_name"),
        "image_url": ctx.url(c.get("file_path")) if c["type"] == "image" else None,
    }


def detection_public(d: dict, adapter: GameAdapter, ctx: Context | None = None) -> dict:
    ctx = ctx or Context()
    candidates = []
    for c in (d.get("candidates") or [])[:6]:
        s = ctx.card(adapter, c.get("card_ref_id"))
        if s:
            candidates.append({**c, "card": s})
    quality = dict(d.get("quality") or {})
    quality.pop("angles", None)  # usado só na consolidação
    return {
        "id": d["id"], "capture_id": d["capture_id"], "seq": d["seq"], "status": d["status"],
        "confidence": d.get("confidence") or 0.0, "source": d.get("source"), "card_ref_id": d.get("card_ref_id"),
        "oracle_id": d.get("oracle_id"), "face": d.get("face") or 0, "language": d.get("language"),
        "finish": d.get("finish"), "bbox": d.get("bbox"), "crop_url": ctx.url(d.get("crop_path")),
        "card": ctx.card(adapter, d.get("card_ref_id")), "candidates": candidates, "notes": d.get("notes") or [],
        "quality": quality, "dup_of": d.get("dup_of"), "dup_status": d.get("dup_status"),
        "dup_candidates": d.get("dup_candidates"), "temporal_group": d.get("temporal_group"),
        "frame_count": d.get("frame_count"), "t_start": d.get("t_start"), "t_end": d.get("t_end"),
        "physical_card_id": d.get("physical_card_id"), "user_corrected": bool(d.get("user_corrected")),
        "condition": d.get("condition"), "print_check": d.get("print_check"),
        "raw": {"name": d.get("raw_name") if not (d.get("raw_name") or "").startswith("clone:") else None,
                "set": d.get("raw_set"), "number": d.get("raw_number"),
                "language": d.get("raw_language"), "finish": d.get("raw_finish")},
    }


def entry_public(e: dict, adapter: GameAdapter, validation: dict | None, dets_by_id: dict[str, dict],
                 ctx: Context | None = None) -> dict:
    ctx = ctx or Context()
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
        "confidence": min(confidences) if confidences else None, "card": ctx.card(adapter, e["card_ref_id"]),
        "condition": e.get("condition"),
    }
