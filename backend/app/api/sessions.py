"""Sessões de scan: criação, captura (fotos em streaming, leituras do vídeo), revisão e exportação."""
from __future__ import annotations

import asyncio

import cv2
import orjson
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from .. import db
from ..auth import User, current_user
from ..events import bus
from ..games import registry
from ..games.base import RawCard
from ..pipeline import dedup, deck, photo, sightings, store
from ..pipeline.imageio import decode_jpeg, encode_jpeg, load_image_bytes
from ..pipeline.serialize import Context, capture_public, detection_public
from ..vision import detect, hashing
from ..vision.hashindex import get_index
from .common import json_response, own_detection, own_session, session_state

router = APIRouter()
MAX_PHOTOS = 30
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_SIGHTING_FRAMES = 3


class SessionCreate(BaseModel):
    game_id: str = "mtg"
    format_id: str
    mode: str = "video"
    name: str | None = None
    settings: dict | None = None
    purpose: str = "build"
    target_deck_id: str | None = None


class SessionPatch(BaseModel):
    format_id: str | None = None
    name: str | None = None
    settings: dict | None = None


@router.post("/sessions")
def create_session(body: SessionCreate, user: User = Depends(current_user)):
    adapter = registry.get(body.game_id)
    try:
        adapter.format(body.format_id)  # formato é obrigatório e precisa existir
    except KeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    if body.mode not in ("video", "photo"):
        raise HTTPException(400, "modo inválido")
    if body.purpose not in ("build", "check"):
        raise HTTPException(400, "finalidade inválida")
    if body.purpose == "check":
        target = store.get_deck(body.target_deck_id or "")
        if target is None or target["user_id"] != user.id or target["kind"] != "deck":
            raise HTTPException(400, "escolha o deck salvo que será conferido")
    return store.create_session(user.id, body.game_id, body.format_id, body.mode, body.name, body.settings,
                                purpose=body.purpose, target_deck_id=body.target_deck_id)


@router.get("/sessions")
def list_sessions(purpose: str | None = None, user: User = Depends(current_user)):
    return json_response(store.list_sessions(user.id, purpose=purpose))


@router.get("/sessions/{session_id}")
def get_session(session_id: str, user: User = Depends(current_user)):
    own_session(session_id, user)
    return json_response(session_state(session_id))


@router.patch("/sessions/{session_id}")
def patch_session(session_id: str, body: SessionPatch, user: User = Depends(current_user)):
    s = own_session(session_id, user)
    fields: dict = {}
    if body.format_id:
        try:
            registry.get(s["game_id"]).format(body.format_id)
        except KeyError as exc:
            raise HTTPException(400, str(exc)) from exc
        fields["format_id"] = body.format_id
    if body.name is not None:
        fields["name"] = body.name
    if body.settings is not None:
        fields["settings"] = {**(s.get("settings") or {}), **body.settings}
    store.update_session(session_id, **fields)
    deck.rebuild(session_id)
    return json_response(session_state(session_id))


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, user: User = Depends(current_user)):
    own_session(session_id, user)
    store.delete_session(session_id)
    return {"ok": True}


# ------------------------------------------------------------------ fotos (resposta em streaming)
def _ndjson(event: dict) -> bytes:
    return orjson.dumps(event, option=orjson.OPT_SERIALIZE_NUMPY) + b"\n"


@router.post("/sessions/{session_id}/photos")
async def upload_photo(session_id: str, file: UploadFile = File(...), user: User = Depends(current_user)):
    """Uma foto por requisição; a resposta traz, linha a linha, as cartas conforme são identificadas."""
    own_session(session_id, user)
    if sum(1 for c in store.captures(session_id) if c["type"] == "image") >= MAX_PHOTOS:
        raise HTTPException(400, f"máximo de {MAX_PHOTOS} fotos por sessão")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "foto grande demais")
    try:
        img = await asyncio.to_thread(load_image_bytes, data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"não consegui abrir {file.filename or 'a imagem'} como foto") from exc
    capture_id = db.new_id()
    jpeg = await asyncio.to_thread(encode_jpeg, img, 90)
    key = await asyncio.to_thread(store.store_capture_file, session_id, capture_id, jpeg, ".jpg", "image/jpeg")
    h, w = img.shape[:2]
    store.add_capture(session_id, "image", key, file.filename, capture_id=capture_id)
    store.update_capture(capture_id, w=w, h=h)
    store.update_session(session_id, status="processing")
    sub = bus.subscribe(session_id)

    async def stream():
        _, queue = sub
        try:
            yield _ndjson({"type": "capture", "capture": capture_public(store.get_capture(capture_id))})
            task = asyncio.ensure_future(asyncio.to_thread(photo.process_photo, session_id, capture_id, img))
            while True:
                if task.done() and queue.empty():
                    break
                try:
                    ev = await asyncio.wait_for(queue.get(), timeout=8)
                except asyncio.TimeoutError:
                    yield _ndjson({"type": "ping"})
                    continue
                yield _ndjson(ev)
            if task.exception() is not None:
                exc = task.exception()
                store.update_capture(capture_id, status="error", error=f"{type(exc).__name__}: {exc}")
                photo.finish_if_idle(session_id)
                yield _ndjson({"type": "error", "message": "falha ao processar a foto"})
            yield _ndjson({"type": "done", "capture": capture_public(store.get_capture(capture_id))})
        finally:
            bus.unsubscribe(session_id, sub)

    return StreamingResponse(stream(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ vídeo / câmera ao vivo (análise no navegador)
class CaptureCreate(BaseModel):
    type: str = "live"          # live | video
    original_name: str | None = None


@router.post("/sessions/{session_id}/captures")
def create_capture(session_id: str, body: CaptureCreate, user: User = Depends(current_user)):
    own_session(session_id, user)
    if body.type not in ("live", "video"):
        raise HTTPException(400, "tipo de captura inválido")
    cap = store.add_capture(session_id, body.type, None, body.original_name or ("câmera ao vivo" if body.type == "live"
                                                                                 else "vídeo"), status="processing")
    store.update_session(session_id, status="capturing")
    return capture_public(cap)


@router.post("/sessions/{session_id}/sightings")
async def post_sighting(session_id: str, meta: str = Form(...), cards: list[UploadFile] = File(...),
                        contexts: list[UploadFile] = File(default=[]), user: User = Depends(current_user)):
    """Uma carta lida pelo navegador: até 3 melhores frames (recorte retificado + contexto ampliado)."""
    s = own_session(session_id, user)
    try:
        m = orjson.loads(meta)
        capture_id = str(m["capture_id"])
        group = sightings.GroupMeta(
            group=int(m["group"]), frame_count=int(m.get("frame_count") or 1), t_start=float(m.get("t_start") or 0),
            t_end=float(m.get("t_end") or 0), gap_before=m.get("gap_before") or {},
            angles=[float(a) for a in (m.get("angles") or [])][:240], quality=m.get("quality") or {},
            quad=m.get("quad"), frame_w=m.get("frame_w"), frame_h=m.get("frame_h"),
            doubtful=bool(m.get("doubtful")))
    except (KeyError, TypeError, ValueError, orjson.JSONDecodeError) as exc:
        raise HTTPException(400, "metadados da leitura inválidos") from exc
    cap = store.get_capture(capture_id)
    if cap is None or cap["session_id"] != session_id:
        raise HTTPException(404, "captura não encontrada")
    frames: list[sightings.Frame] = []
    for i, up in enumerate(cards[:MAX_SIGHTING_FRAMES]):
        raw = await up.read()
        card = decode_jpeg(raw) if len(raw) <= 3 * 1024 * 1024 else None
        if card is None:
            raise HTTPException(400, "recorte inválido")
        if card.shape[:2] != (detect.WARP_H, detect.WARP_W):
            card = cv2.resize(card, (detect.WARP_W, detect.WARP_H), interpolation=cv2.INTER_AREA)
        ctx = None
        if i < len(contexts):
            ctx_raw = await contexts[i].read()
            ctx = decode_jpeg(ctx_raw) if len(ctx_raw) <= 3 * 1024 * 1024 else None
        frames.append(sightings.Frame(card=card, context=ctx, jpeg=raw))
    det = await asyncio.to_thread(sightings.record_sighting, session_id, capture_id, frames, group)
    adapter = registry.get(s["game_id"])
    dets = store.detections(session_id)
    ids = {d["id"] for d in dets}
    counted = sum(1 for d in deck.representatives(dets))
    return json_response({
        "detection": detection_public(det, adapter, Context.build(adapter, detections=[det])),
        "physical_cards": counted,
        "merged": bool(det.get("dup_of") and det["dup_of"] in ids),
    })


@router.post("/sessions/{session_id}/captures/{capture_id}/finish")
def finish_capture(session_id: str, capture_id: str, user: User = Depends(current_user)):
    own_session(session_id, user)
    cap = store.get_capture(capture_id)
    if cap is None or cap["session_id"] != session_id:
        raise HTTPException(404, "captura não encontrada")
    sightings.finish_capture(session_id, capture_id)
    if not any(c["status"] in ("queued", "processing") for c in store.captures(session_id)):
        store.update_session(session_id, status="review")
    return json_response(session_state(session_id))


# ------------------------------------------------------------------ revisão das detecções
class IdentifyBody(BaseModel):
    card_ref_id: str
    language: str | None = None
    finish: str | None = None


class StatusBody(BaseModel):
    status: str


class DuplicateBody(BaseModel):
    other_id: str
    same: bool


def learn_from_correction(d: dict, session: dict, card_ref_id: str, oracle_id: str | None) -> None:
    """Aprendizado por correção: o pHash do recorte passa a apontar para a carta certa (só para este usuário)."""
    img = store.load_image_key(d.get("crop_path"))
    if img is None:
        return
    art = hashing.art_region(cv2.cvtColor(hashing.normalize_card(img), cv2.COLOR_BGR2GRAY))
    if float(art.std()) < 12.0:
        return  # recorte sem conteúdo visível (reflexo total, borrão): nada confiável para aprender
    h = hashing.compute_hashes(img)
    conn = db.app_db()
    conn.execute(
        "INSERT INTO learned_hashes (id, user_id, card_ref_id, face, oracle_id, art, full_hash, color, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (db.new_id(), session["user_id"], card_ref_id, 0, oracle_id, h.art.tobytes(), h.full.tobytes(),
         h.color.tobytes(), db.now_iso()))
    get_index().add_learned(session["user_id"], card_ref_id, 0, oracle_id, h)
    conn.execute(
        "INSERT INTO correction_log (id, user_id, game_id, detection_id, art_phash, full_phash, wrong_card_ref, "
        "correct_card_ref, face, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (db.new_id(), session["user_id"], session["game_id"], d["id"], h.art_hex(), h.full_hex(), d.get("card_ref_id"),
         card_ref_id, 0, db.now_iso()))


def after_detection_change(session_id: str) -> None:
    caps = store.captures(session_id)
    if sum(1 for c in caps if c["type"] == "image" and c["status"] == "done") >= 2:
        with db.lease_lock(f"dedup:{session_id}", ttl=120):
            dedup.run(session_id)
    deck.rebuild(session_id)


@router.post("/detections/{detection_id}/identify")
def identify_detection(detection_id: str, body: IdentifyBody, user: User = Depends(current_user)):
    d, s = own_detection(detection_id, user)
    adapter = registry.get(s["game_id"])
    fields = adapter.card_fields(body.card_ref_id)
    if fields is None:  # carta fora do catálogo: busca na fonte do jogo
        resolved = adapter.resolve_card(RawCard(card_ref_id=body.card_ref_id))
        fields = adapter.card_fields(resolved.card_ref_id) if resolved else None
    if fields is None:
        raise HTTPException(404, "carta não encontrada")
    summary = adapter.card_summary(body.card_ref_id) or {}
    finishes = summary.get("finishes") or []
    default_finish = "foil" if finishes == ["foil"] else "etched" if finishes == ["etched"] else "nonfoil"
    if d.get("card_ref_id") != body.card_ref_id:
        learn_from_correction(d, s, body.card_ref_id, fields["key"])
    notes = [n for n in (d.get("notes") or []) if "multimodal desativado" not in n]
    store.update_detection(
        detection_id, status="identified", card_ref_id=body.card_ref_id, oracle_id=fields["key"], source="user",
        confidence=1.0, user_corrected=1, notes=notes,
        language=body.language or d.get("language") or (s.get("settings") or {}).get("default_language", "en"),
        finish=body.finish or (d.get("finish") if d.get("card_ref_id") == body.card_ref_id else None) or default_finish)
    after_detection_change(s["id"])
    return json_response(session_state(s["id"]))


@router.post("/detections/{detection_id}/status")
def detection_status(detection_id: str, body: StatusBody, user: User = Depends(current_user)):
    if body.status not in ("identified", "unidentified", "back", "token", "noise", "ignored"):
        raise HTTPException(400, "status inválido")
    d, s = own_detection(detection_id, user)
    if body.status == "identified" and not d.get("card_ref_id"):
        raise HTTPException(400, "escolha a carta primeiro")
    store.update_detection(detection_id, status=body.status)
    after_detection_change(s["id"])
    return json_response(session_state(s["id"]))


@router.post("/detections/{detection_id}/duplicate")
def detection_duplicate(detection_id: str, body: DuplicateBody, user: User = Depends(current_user)):
    d, s = own_detection(detection_id, user)
    other = store.get_detection(body.other_id)
    if other is None or other["session_id"] != s["id"]:
        raise HTTPException(404)
    with db.lease_lock(f"dedup:{s['id']}", ttl=120):
        dedup.decide(s["id"], detection_id, body.other_id, body.same)
    deck.rebuild(s["id"])
    return json_response(session_state(s["id"]))


# ------------------------------------------------------------------ lista da sessão
class EntryCreate(BaseModel):
    card_ref_id: str
    quantity: int = 1
    zone: str | None = None
    language: str | None = None
    finish: str | None = None


def add_entry_to_deck(deck_row: dict, body: EntryCreate, default_language: str = "en") -> None:
    adapter = registry.get(deck_row["game_id"])
    fields = adapter.card_fields(body.card_ref_id)
    if fields is None:
        raise HTTPException(404, "carta não encontrada")
    rule = adapter.format(deck_row["format_id"])
    zones = rule.get("zones") or ["deck"]
    zone = body.zone if body.zone in zones else ("deck" if "deck" in zones else zones[0])
    lang = body.language or default_language
    finish = body.finish or "nonfoil"
    rows = store.entries(deck_row["id"])
    same = next((e for e in rows if e["card_ref_id"] == body.card_ref_id and e["zone"] == zone
                 and (e["language"] or lang) == lang and (e["finish"] or "nonfoil") == finish), None)
    if same:
        store.update_entry(same["id"], quantity_override=max(0, same["quantity"] + body.quantity))
    else:
        store.insert_entry(deck_row["id"], zone=zone, card_ref_id=body.card_ref_id, oracle_id=fields["key"],
                           language=lang, finish=finish, quantity=body.quantity, quantity_detected=0,
                           quantity_override=body.quantity, is_commander=0, manual=1, rule_warnings=[],
                           allocated_physical_ids=[], position=max([e["position"] for e in rows], default=0) + 1)


@router.post("/sessions/{session_id}/entries")
def add_entry(session_id: str, body: EntryCreate, user: User = Depends(current_user)):
    s = own_session(session_id, user)
    add_entry_to_deck(store.get_deck(s["deck_id"]), body, (s.get("settings") or {}).get("default_language", "en"))
    deck.rebuild(session_id)
    return json_response(session_state(session_id))


@router.post("/sessions/{session_id}/suggestions/{suggestion_type}/apply")
def apply_suggestion(session_id: str, suggestion_type: str, user: User = Depends(current_user)):
    s = own_session(session_id, user)
    adapter = registry.get(s["game_id"])
    report = deck.validate(session_id)
    suggestion = (report.get("suggestions") or {}).get(suggestion_type)
    additions = adapter.suggestion_additions(suggestion_type, suggestion or {})
    if not additions:
        raise HTTPException(400, "nenhuma sugestão aplicável")
    deck_row = store.get_deck(s["deck_id"])
    for card_ref_id, qty in additions:
        add_entry_to_deck(deck_row, EntryCreate(card_ref_id=card_ref_id, quantity=qty))
    deck.rebuild(session_id)
    return json_response(session_state(session_id))


@router.get("/sessions/{session_id}/bracket")
def session_bracket(session_id: str, user: User = Depends(current_user)):
    from ..collection import brackets

    s = own_session(session_id, user)
    if not brackets.applies_to(s["game_id"], s["format_id"]):
        return json_response({"applies": False})
    result = brackets.classify(s["game_id"], store.entries(s["deck_id"]))
    return json_response({"applies": True, **(result or {})})


# ------------------------------------------------------------------ exportação
def export_items(adapter, rows: list[dict]) -> list[dict]:
    summaries = adapter.card_summaries([e["card_ref_id"] for e in rows])
    items = []
    for e in rows:
        c = summaries.get(e["card_ref_id"])
        if c is None:
            continue
        prices = c.get("prices") or {}
        price_key = {"foil": "usd_foil", "etched": "usd_etched"}.get(e["finish"] or "", "usd")
        price = prices.get(price_key) or prices.get("usd")
        items.append({
            "quantity": e["quantity"], "zone": e["zone"], "is_commander": bool(e["is_commander"]),
            "name_en": c["name_en"], "front_name_en": c.get("front_name_en"), "name_pt": c.get("name_pt"),
            "set_code": c["set_code"], "collector_number": c["collector_number"], "language": e["language"],
            "finish": e["finish"], "front_type_line": c.get("front_type_line"), "layout": c.get("layout"),
            "price_usd": float(price) if price else None, "condition": e.get("condition"), "games": c.get("games"),
            "card_ref_id": e["card_ref_id"], "position": e["position"],
        })
    return items


def export_response(deck_row: dict, format: str, group: bool, lang: str, download: bool) -> Response:
    adapter = registry.get(deck_row["game_id"])
    deck.validate_deck(deck_row)
    items = export_items(adapter, store.entries(deck_row["id"]))
    try:
        text, filename, mime = adapter.export(format, items, {"group": group, "lang": lang,
                                                              "deck_name": deck_row.get("name") or "deck"})
    except KeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'} if download else {}
    return Response(text, media_type=f"{mime}; charset=utf-8", headers=headers)


@router.get("/sessions/{session_id}/export")
def export(session_id: str, format: str = "moxfield", group: bool = False, lang: str = "en", download: bool = False,
           user: User = Depends(current_user)):
    s = own_session(session_id, user)
    return export_response(store.get_deck(s["deck_id"]), format, group, lang, download)
