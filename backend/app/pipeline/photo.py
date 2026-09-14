"""Processamento do modo foto: detecção → recorte → cascata → deduplicação entre fotos → deck."""
from __future__ import annotations

import cv2
import numpy as np

from .. import db
from ..events import bus
from ..games import registry
from ..jobs import identify_pool
from ..vision import detect, quality
from . import dedup, deck, identify, store
from .imageio import load_image
from .serialize import detection_public, capture_public


def _norm_quad(pts: np.ndarray, w: int, h: int) -> dict:
    q = (pts / np.array([w, h], dtype=np.float32)).round(5).tolist()
    xs, ys = [p[0] for p in q], [p[1] for p in q]
    return {"quad": q, "rect": [min(xs), min(ys), max(xs), max(ys)]}


def process_photo(session_id: str, capture_id: str) -> None:
    session = store.get_session(session_id)
    cap = store.get_capture(capture_id)
    if session is None or cap is None:
        return
    adapter = registry.get(session["game_id"])
    default_lang = (session.get("settings") or {}).get("default_language", "en")
    store.update_capture(capture_id, status="processing", progress=0)
    store.update_session(session_id, status="processing")
    bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})

    img = load_image(cap["file_path"])
    H, W = img.shape[:2]
    iq = quality.image_quality(img)
    quads = detect.detect_cards(img, include_partial=True)
    iq["detected"] = sum(1 for q in quads if q.kind == "full")
    iq["partial"] = sum(1 for q in quads if q.kind == "partial")
    store.update_capture(capture_id, w=W, h=H, quality=iq, quality_score=iq["score"])
    bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})

    pending: list[tuple[str, detect.CardQuad, np.ndarray]] = []
    for q in quads:
        det_id = db.new_id()
        if q.kind == "full":
            warped = detect.warp_card(img, q.pts)
        else:
            ratio = q.height / max(q.width, 1)
            warped = detect.warp_card(img, q.pts, out_w=488, out_h=int(488 * ratio))
        crop = store.save_crop(session_id, det_id, warped)
        det = store.insert_detection(
            session_id, capture_id, id=det_id, seq=store.next_seq(session_id), bbox=_norm_quad(q.pts, W, H),
            crop_path=crop, status="pending", confidence=0.0, source="none",
            quality={**quality.frame_quality(warped, q.pts, img.shape), "kind": q.kind, "detector_score": round(q.score, 3)},
            notes=[])
        bus.publish(session_id, {"type": "detection", "detection": detection_public(det, adapter)})
        pending.append((det_id, q, warped))

    def work(item):
        det_id, q, warped = item
        if q.kind == "full":
            ctx = detect.warp_card(img, q.pts, out_w=620, out_h=864, expand=0.12)
            result = identify.identify(warped, adapter=adapter, context_bgr=ctx, default_language=default_lang,
                                       session_id=session_id)
        else:
            ctx = detect.warp_card(img, q.pts, out_w=int(warped.shape[1] * 1.2), out_h=int(warped.shape[0] * 1.2),
                                   expand=0.12)
            result = identify.identify(warped, adapter=adapter, context_bgr=ctx, default_language=default_lang,
                                       session_id=session_id, allow_orb=False)
            if result.status == "identified":
                result.confidence = round(result.confidence * 0.85, 3)
            result.notes.append("carta parcialmente visível")
        _store_result(session_id, det_id, result, warped)
        det = store.get_detection(det_id)
        bus.publish(session_id, {"type": "detection", "detection": detection_public(det, adapter)})
        return det_id

    for f in [identify_pool.submit(work, item) for item in pending]:
        f.result()

    _update_neighbors(session_id, capture_id, W)
    store.update_capture(capture_id, status="done", progress=1)
    bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})
    finish_if_idle(session_id)


def _store_result(session_id: str, det_id: str, result: identify.IdentifyResult, warped: np.ndarray) -> None:
    if result.orientation == 180:
        store.save_crop(session_id, det_id, cv2.rotate(warped, cv2.ROTATE_180))
    raw = result.raw or {}
    store.update_detection(
        det_id, status=result.status, card_ref_id=result.card_ref_id, oracle_id=result.oracle_id, face=result.face,
        confidence=result.confidence, source=result.source, language=result.language, finish=result.finish,
        candidates=result.candidates, notes=result.notes,
        art_phash=result.hashes.art_hex() if result.hashes is not None else None,
        full_phash=result.hashes.full_hex() if result.hashes is not None else None,
        raw_name=raw.get("name_en") or raw.get("printed_name"), raw_set=raw.get("set_code"),
        raw_number=raw.get("collector_number"), raw_language=raw.get("language"), raw_finish=raw.get("finish"))
    if result.metrics:
        det = store.get_detection(det_id)
        store.update_detection(det_id, quality={**(det.get("quality") or {}), "match": result.metrics})


def _update_neighbors(session_id: str, capture_id: str, width: int) -> None:
    dets = [d for d in store.detections(session_id) if d["capture_id"] == capture_id and d.get("bbox")]
    if len(dets) < 2:
        return
    centers = {d["id"]: np.mean(np.array(d["bbox"]["quad"]), axis=0) for d in dets}
    widths = [np.linalg.norm(np.array(d["bbox"]["quad"][0]) - np.array(d["bbox"]["quad"][1])) for d in dets]
    card_w = float(np.median(widths)) or 0.1
    for d in dets:
        c = centers[d["id"]]
        near = sorted(((float(np.linalg.norm(centers[o["id"]] - c)), o) for o in dets if o["id"] != d["id"]),
                      key=lambda x: x[0])
        neighbors = [{"id": o["id"], "oracle_id": o.get("oracle_id"),
                      "dx": round(float((centers[o["id"]][0] - c[0]) / card_w), 2),
                      "dy": round(float((centers[o["id"]][1] - c[1]) / card_w), 2)}
                     for dist, o in near[:4] if dist <= 2.6 * card_w]
        store.update_detection(d["id"], neighbors=neighbors)


def finish_if_idle(session_id: str) -> None:
    """Deduplica e reconstrói o deck a cada foto concluída (lista incremental sempre consistente)."""
    caps = store.captures(session_id)
    if sum(1 for c in caps if c["type"] == "image" and c["status"] == "done") >= 2:
        dedup.run(session_id)
    deck.rebuild(session_id)
    if not any(c["status"] in ("queued", "processing") for c in caps):
        store.update_session(session_id, status="review")
        bus.publish(session_id, {"type": "session", "status": "review"})
