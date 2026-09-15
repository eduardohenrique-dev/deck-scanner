"""Processamento do modo foto: detecção → recorte → cascata → deduplicação entre fotos → deck.

Em duas fases por foto:
  1. hash rápido (local) em todos os quadriláteros — as cartas confirmadas viram referência de
     tamanho e orientação da mesa;
  2. o que sobrou passa por hipóteses geométricas (bloco de cartas encostadas, carta coberta ou
     cortada, caixa de arte sem contorno) e só então pela cascata completa (ORB, modelo multimodal).
"""
from __future__ import annotations

import cv2
import numpy as np

from .. import db
from ..events import bus
from ..games import registry
from ..jobs import identify_pool
from ..vision import detect, hashing, quality
from . import dedup, deck, identify, store
from .serialize import capture_public, detection_public

HYPOTHESIS_NOTES = {
    "split": "cartas encostadas separadas",
    "parent_art": "contorno reconstruído a partir da caixa de arte",
    "parent_text": "contorno reconstruído a partir da caixa de texto",
}


def _norm_quad(pts: np.ndarray, w: int, h: int) -> dict:
    q = (np.asarray(pts, np.float32) / np.array([w, h], dtype=np.float32)).round(5).tolist()
    xs, ys = [p[0] for p in q], [p[1] for p in q]
    return {"quad": q, "rect": [min(xs), min(ys), max(xs), max(ys)]}


def _accepted(r: identify.IdentifyResult) -> bool:
    return r.status == "back" or (r.status in ("identified", "token") and r.confidence >= identify.HASH_ACCEPT)


def _warps(img: np.ndarray, pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return (detect.warp_card(img, pts),
            detect.warp_card(img, pts, out_w=620, out_h=864, expand=hashing.CONTEXT_EXPAND))


def process_photo(session_id: str, capture_id: str, img: np.ndarray | None = None) -> None:
    session = store.get_session(session_id)
    cap = store.get_capture(capture_id)
    if session is None or cap is None:
        return
    adapter = registry.get(session["game_id"])
    lang = (session.get("settings") or {}).get("default_language", "en")
    store.update_capture(capture_id, status="processing", progress=0)
    store.update_session(session_id, status="processing")
    bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})

    if img is None:
        img = store.load_image_key(cap["file_path"])
    if img is None:
        store.update_capture(capture_id, status="error", error="imagem não encontrada")
        return
    user_id = session["user_id"]
    H, W = img.shape[:2]
    iq = quality.image_quality(img)
    quads = detect.detect_cards(img, include_partial=True)
    iq["detected"] = sum(1 for q in quads if q.kind == "full")
    iq["partial"] = sum(1 for q in quads if q.kind != "full")
    store.update_capture(capture_id, w=W, h=H, quality=iq, quality_score=iq["score"])
    bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})

    def outside(pts: np.ndarray) -> bool:
        return bool((pts[:, 0] < 0).any() or (pts[:, 0] > W - 1).any() or (pts[:, 1] < 0).any() or (pts[:, 1] > H - 1).any())

    def quick_identify(pts: np.ndarray):
        w_, c_ = _warps(img, pts)
        return w_, identify.identify(w_, adapter=adapter, context_bgr=c_, default_language=lang,
                                     session_id=session_id, allow_orb=False, allow_vlm=False, user_id=user_id)

    pending: list[tuple[str, detect.CardQuad]] = []
    for q in quads:
        warped = detect.warp_card(img, q.pts)
        det_id = db.new_id()
        det = store.insert_detection_seq(
            session_id, capture_id, id=det_id, bbox=_norm_quad(q.pts, W, H),
            crop_path=store.save_crop(session_id, det_id, warped), status="pending", confidence=0.0, source="none",
            quality={**quality.frame_quality(warped, q.pts, img.shape), "kind": q.kind, "detector_score": round(q.score, 3)},
            notes=[])
        bus.publish(session_id, {"type": "detection", "detection": detection_public(det, adapter)})
        pending.append((det_id, q))

    # ---------------- fase 1: hash rápido em tudo
    quick = dict(zip([d for d, _ in pending],
                     identify_pool.map(lambda item: quick_identify(item[1].pts), pending)))
    confirmed = [q for det_id, q in pending if _accepted(quick[det_id][1]) and quick[det_id][1].status != "back"]
    for det_id, q in pending:
        warped, r = quick[det_id]
        if _accepted(r) and q.kind == "full":
            _store_result(session_id, det_id, r, warped)
            _publish(session_id, det_id, adapter)

    if confirmed:
        ref_area = float(np.median([q.area for q in confirmed if q.kind == "full"] or [q.area for q in confirmed]))
        dom_angle = detect.dominant_angle(confirmed, min_count=1)
    else:
        full_areas = [q.area for q in quads if q.kind == "full"]
        ref_area = float(np.percentile(full_areas, 75)) if len(full_areas) >= 3 else None
        dom_angle = detect.dominant_angle(quads)

    # ---------------- fase 2: hipóteses e cascata completa para o resto
    def resolve(item: tuple[str, detect.CardQuad]) -> None:
        det_id, q = item
        warped, first = quick[det_id]
        if _accepted(first) and q.kind == "full":
            return
        for label, parts in detect.hypotheses(q, ref_area, dom_angle):
            tries = [(pts, *quick_identify(pts)) for pts in parts]
            ok = [t for t in tries if _accepted(t[2])]
            if label == "split" and not ok:
                continue
            if label != "split" and len(ok) != len(tries):
                continue
            if _accepted(first) and min(t[2].confidence for t in ok) <= first.confidence:
                continue
            for i, (pts, w_, r) in enumerate(tries):
                target = det_id if i == 0 else db.new_id()
                kind = "edge" if (q.kind == "edge" or outside(pts)) else "full"
                if not _accepted(r):
                    if kind == "edge":
                        r.status = "edge"
                        r.notes.append("carta cortada pela borda da foto — deve aparecer inteira em outra foto")
                    else:
                        ctx = _warps(img, pts)[1]
                        r = identify.identify(w_, adapter=adapter, context_bgr=ctx, default_language=lang,
                                              session_id=session_id, user_id=user_id)
                r.notes.append(HYPOTHESIS_NOTES.get(label, "carta parcialmente coberta"))
                fields = {"bbox": _norm_quad(pts, W, H), "quality": {
                    **quality.frame_quality(w_, pts, img.shape), "kind": kind, "hypothesis": label}}
                if i == 0:
                    store.update_detection(det_id, crop_path=store.save_crop(session_id, det_id, w_), **fields)
                else:
                    store.insert_detection_seq(session_id, capture_id, id=target, status="pending",
                                               crop_path=store.save_crop(session_id, target, w_), confidence=0.0,
                                               source="none", notes=[], **fields)
                _store_result(session_id, target, r, w_)
                _publish(session_id, target, adapter)
            return
        if _accepted(first):  # carta de borda que o hash resolveu sem precisar de hipótese
            _store_result(session_id, det_id, first, warped)
        elif q.kind == "edge":
            first.status = "edge"
            first.notes.append("carta cortada pela borda da foto — deve aparecer inteira em outra foto")
            _store_result(session_id, det_id, first, warped)
        elif detect.is_inner_element(q, ref_area, dom_angle):
            first.status = "noise"
            first.notes.append("provável caixa de arte/texto de uma carta sem contorno visível")
            _store_result(session_id, det_id, first, warped)
        else:
            result = identify.identify(warped, adapter=adapter, context_bgr=_warps(img, q.pts)[1],
                                       default_language=lang, session_id=session_id, user_id=user_id)
            if q.kind == "partial":
                result.notes.append("carta parcialmente visível")
                if result.status == "identified":
                    result.confidence = round(result.confidence * 0.85, 3)
            _store_result(session_id, det_id, result, warped)
        _publish(session_id, det_id, adapter)

    list(identify_pool.map(resolve, pending))

    _update_neighbors(session_id, capture_id)
    store.update_capture(capture_id, status="done", progress=1)
    bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})
    finish_if_idle(session_id)


def _publish(session_id: str, det_id: str, adapter) -> None:
    bus.publish(session_id, {"type": "detection", "detection": detection_public(store.get_detection(det_id), adapter)})


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


def _update_neighbors(session_id: str, capture_id: str) -> None:
    dets = [d for d in store.detections(session_id) if d["capture_id"] == capture_id and d.get("bbox")
            and d["status"] in ("identified", "unidentified")]
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
        with db.lease_lock(f"dedup:{session_id}", ttl=120):
            dedup.run(session_id)
    deck.rebuild(session_id)
    if not any(c["status"] in ("queued", "processing") for c in caps):
        store.update_session(session_id, status="review")
        bus.publish(session_id, {"type": "session", "status": "review"})
