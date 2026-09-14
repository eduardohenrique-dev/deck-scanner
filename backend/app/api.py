"""API HTTP: sessões, upload de fotos/vídeo, eventos (SSE), câmera ao vivo (WebSocket), revisão e exportação."""
from __future__ import annotations

import asyncio
import struct
from collections import Counter
from pathlib import Path

import cv2
import orjson
from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile, WebSocket
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

from . import config, db, jobs
from .events import bus
from .games import registry
from .games.base import RawCard
from .pipeline import dedup, deck, photo, store, video, vlm
from .pipeline.imageio import load_image
from .pipeline.serialize import capture_public, detection_public, entry_public
from .vision import hashing
from .vision.hashindex import get_index

router = APIRouter(prefix="/api")
MAX_PHOTOS = 30
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".bmp"}
VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".3gp"}


def _session_or_404(session_id: str) -> dict:
    s = store.get_session(session_id)
    if s is None:
        raise HTTPException(404, "sessão não encontrada")
    return s


def _json(data) -> Response:
    return Response(orjson.dumps(data, option=orjson.OPT_SERIALIZE_NUMPY), media_type="application/json")


# ------------------------------------------------------------------ status / jogos
@router.get("/health")
def health():
    return {"ok": True}


@router.get("/status")
def status():
    idx = get_index()
    return {
        "hash_index": {"entries": len(idx), "base": idx.count_base, "learned": idx.count_learned},
        "catalog": {"prints": db.meta_get("mtg.default_cards.count"), "updated": db.meta_get("mtg.hashes.updated_at")},
        "vlm": {"enabled": vlm.enabled(), "model": config.VLM_MODEL if vlm.enabled() else None},
        "orb_verify": config.ORB_VERIFY_ENABLED,
    }


@router.get("/games")
def games():
    return registry.list_games()


@router.get("/games/{game_id}/formats")
def formats(game_id: str):
    return list(registry.get(game_id).formats().values())


# ------------------------------------------------------------------ sessões
class SessionCreate(BaseModel):
    game_id: str = "mtg"
    format_id: str
    mode: str = "video"
    name: str | None = None
    settings: dict | None = None


class SessionPatch(BaseModel):
    format_id: str | None = None
    name: str | None = None
    settings: dict | None = None


@router.post("/sessions")
def create_session(body: SessionCreate):
    adapter = registry.get(body.game_id)
    adapter.format(body.format_id)  # formato é obrigatório e precisa existir
    if body.mode not in ("video", "photo"):
        raise HTTPException(400, "modo inválido")
    s = store.create_session(body.game_id, body.format_id, body.mode, body.name, body.settings)
    return s


@router.get("/sessions")
def list_sessions():
    return store.list_sessions()


def session_state(session_id: str) -> dict:
    s = _session_or_404(session_id)
    adapter = registry.get(s["game_id"])
    report = deck.validate(session_id)
    dets = store.detections(session_id)
    dets_by_id = {d["id"]: d for d in dets}
    ids = set(dets_by_id)
    reps = deck.representatives(dets)
    active = [d for d in dets if not (d.get("dup_of") and d["dup_of"] in ids)]
    stats = {
        "detections": len(dets),
        "physical_cards": len(reps),
        "pending": sum(1 for d in dets if d["status"] == "pending"),
        "unidentified": sum(1 for d in active if d["status"] == "unidentified"),
        "backs": sum(1 for d in active if d["status"] == "back"),
        "tokens": sum(1 for d in active if d["status"] == "token"),
        "noise": sum(1 for d in active if d["status"] == "noise"),
        "merged_duplicates": sum(1 for d in dets if d.get("dup_of") and d["dup_of"] in ids),
        "possible_duplicates": sum(1 for d in active if d.get("dup_status") == "possible"),
        "by_source": dict(Counter(d.get("source") or "none" for d in reps)),
        "vlm_calls": db.app_db().execute("SELECT COUNT(*) FROM vlm_calls WHERE session_id=?", (session_id,)).fetchone()[0],
    }
    entries = [entry_public(e, adapter, report, dets_by_id) for e in store.entries(s["deck_id"])]
    validation = {k: v for k, v in report.items() if k != "entries"}
    return {
        "session": s,
        "format": adapter.format(s["format_id"]),
        "game": {"id": adapter.id, "zones": adapter.zones, "languages": adapter.game_meta().get("languages", []),
                 "finishes": adapter.game_meta().get("finishes", []), "exporters": adapter.export_formats(),
                 "identity": adapter.identity_rules()},
        "captures": [capture_public(c) for c in store.captures(session_id)],
        "detections": [detection_public(d, adapter) for d in dets],
        "entries": entries,
        "validation": validation,
        "stats": stats,
    }


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    return _json(session_state(session_id))


@router.patch("/sessions/{session_id}")
def patch_session(session_id: str, body: SessionPatch):
    s = _session_or_404(session_id)
    fields: dict = {}
    if body.format_id:
        registry.get(s["game_id"]).format(body.format_id)
        fields["format_id"] = body.format_id
    if body.name is not None:
        fields["name"] = body.name
    if body.settings is not None:
        fields["settings"] = {**(s.get("settings") or {}), **body.settings}
    store.update_session(session_id, **fields)
    deck.rebuild(session_id)
    return _json(session_state(session_id))


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    store.delete_session(session_id)
    return {"ok": True}


# ------------------------------------------------------------------ captura
async def _save_upload(session_id: str, f: UploadFile, allowed: set[str]) -> Path:
    ext = Path(f.filename or "").suffix.lower()
    if not ext:
        ext = {"image/jpeg": ".jpg", "image/png": ".png", "video/webm": ".webm", "video/mp4": ".mp4",
               "video/quicktime": ".mov"}.get(f.content_type or "", "")
    if ext not in allowed:
        raise HTTPException(400, f"tipo de arquivo não suportado: {f.filename}")
    path = store.upload_dir(session_id) / f"{db.new_id()}{ext}"
    with open(path, "wb") as out:
        while chunk := await f.read(1 << 20):
            out.write(chunk)
    return path


@router.post("/sessions/{session_id}/photos")
async def upload_photos(session_id: str, files: list[UploadFile] = File(...)):
    _session_or_404(session_id)
    existing = sum(1 for c in store.captures(session_id) if c["type"] == "image")
    if existing + len(files) > MAX_PHOTOS:
        raise HTTPException(400, f"máximo de {MAX_PHOTOS} fotos por sessão")
    created = []
    for f in files:
        path = await _save_upload(session_id, f, IMAGE_EXT)
        created.append(store.add_capture(session_id, "image", str(path), f.filename))
    store.update_session(session_id, status="processing")
    for cap in created:
        jobs.submit_capture(session_id, photo.process_photo, session_id, cap["id"])
    return [capture_public(c) for c in created]


@router.post("/sessions/{session_id}/video")
async def upload_video(session_id: str, file: UploadFile = File(...)):
    _session_or_404(session_id)
    path = await _save_upload(session_id, file, VIDEO_EXT)
    cap = store.add_capture(session_id, "video", str(path), file.filename)
    store.update_session(session_id, status="processing")
    jobs.submit_capture(session_id, video.process_video_file, session_id, cap["id"])
    return capture_public(cap)


@router.get("/sessions/{session_id}/events")
async def events(session_id: str, request: Request):
    _session_or_404(session_id)
    q = bus.subscribe(session_id)

    async def stream():
        try:
            yield "event: hello\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"data: {orjson.dumps(ev, option=orjson.OPT_SERIALIZE_NUMPY).decode()}\n\n"
        finally:
            bus.unsubscribe(session_id, q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.websocket("/sessions/{session_id}/live")
async def live(ws: WebSocket, session_id: str):
    await ws.accept()
    if store.get_session(session_id) is None:
        await ws.close(code=4404)
        return
    loop = asyncio.get_running_loop()
    closed = False

    def send(state: dict) -> None:
        if not closed:
            asyncio.run_coroutine_threadsafe(_safe_send(ws, state), loop)

    runner = await asyncio.to_thread(video.LiveRunner, session_id, send)
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            data = msg.get("bytes")
            if data and len(data) > 8:
                runner.submit(struct.unpack("<d", data[:8])[0] / 1000.0, data[8:])
            elif msg.get("text") == "stop":
                break
    finally:
        await asyncio.to_thread(runner.stop)
        closed = True
        try:
            await ws.send_text(orjson.dumps({"type": "stopped"}).decode())
            await ws.close()
        except Exception:  # noqa: BLE001 — cliente já saiu
            pass


async def _safe_send(ws: WebSocket, state: dict) -> None:
    try:
        await ws.send_text(orjson.dumps(state).decode())
    except Exception:  # noqa: BLE001
        pass


@router.get("/captures/{capture_id}/image")
def capture_image(capture_id: str):
    cap = store.get_capture(capture_id)
    if cap is None or cap["type"] != "image":
        raise HTTPException(404)
    # entrega JPEG já com a orientação EXIF aplicada (as coordenadas das detecções usam essa orientação)
    cached = Path(cap["file_path"]).with_suffix(".view.jpg")
    if not cached.exists():
        img = load_image(cap["file_path"])
        h, w = img.shape[:2]
        scale = min(1.0, 2000 / max(h, w))
        if scale < 1:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(cached), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return FileResponse(cached, media_type="image/jpeg")


@router.get("/detections/{detection_id}/crop")
def detection_crop(detection_id: str):
    d = store.get_detection(detection_id)
    if d is None or not d.get("crop_path") or not Path(d["crop_path"]).exists():
        raise HTTPException(404)
    return FileResponse(d["crop_path"], media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


# ------------------------------------------------------------------ revisão
class IdentifyBody(BaseModel):
    card_ref_id: str
    language: str | None = None
    finish: str | None = None


class StatusBody(BaseModel):
    status: str


class DuplicateBody(BaseModel):
    other_id: str
    same: bool


def _learn(d: dict, session: dict, card_ref_id: str, oracle_id: str | None) -> None:
    """Aprendizado por correção: o pHash do recorte passa a apontar para a carta certa."""
    img = cv2.imread(d["crop_path"]) if d.get("crop_path") else None
    if img is None:
        return
    h = hashing.compute_hashes(img)
    db.catalog_db().execute(
        "INSERT INTO learned_hashes (id, user_id, card_ref_id, face, art, full, color, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (db.new_id(), session["user_id"], card_ref_id, 0, h.art.tobytes(), h.full.tobytes(), h.color.tobytes(),
         db.now_iso()))
    get_index().add_learned(card_ref_id, 0, oracle_id, h)
    db.app_db().execute(
        "INSERT INTO correction_log (id, user_id, game_id, detection_id, art_phash, full_phash, wrong_card_ref, "
        "correct_card_ref, face, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (db.new_id(), session["user_id"], session["game_id"], d["id"], h.art_hex(), h.full_hex(), d.get("card_ref_id"),
         card_ref_id, 0, db.now_iso()))


def _after_detection_change(session_id: str) -> None:
    caps = store.captures(session_id)
    if sum(1 for c in caps if c["type"] == "image" and c["status"] == "done") >= 2:
        dedup.run(session_id)
    deck.rebuild(session_id)


@router.post("/detections/{detection_id}/identify")
def identify_detection(detection_id: str, body: IdentifyBody):
    d = store.get_detection(detection_id)
    if d is None:
        raise HTTPException(404)
    s = _session_or_404(d["session_id"])
    adapter = registry.get(s["game_id"])
    fields = adapter.card_fields(body.card_ref_id)
    if fields is None:  # carta fora do catálogo local: busca na fonte do jogo
        resolved = adapter.resolve_card(RawCard(card_ref_id=body.card_ref_id))
        fields = adapter.card_fields(resolved.card_ref_id) if resolved else None
    if fields is None:
        raise HTTPException(404, "carta não encontrada")
    summary = adapter.card_summary(body.card_ref_id) or {}
    finishes = summary.get("finishes") or []
    default_finish = "foil" if finishes == ["foil"] else "etched" if finishes == ["etched"] else "nonfoil"
    if d.get("card_ref_id") != body.card_ref_id:
        _learn(d, s, body.card_ref_id, fields["key"])
    notes = [n for n in (d.get("notes") or []) if "multimodal desativado" not in n]
    store.update_detection(
        detection_id, status="identified", card_ref_id=body.card_ref_id, oracle_id=fields["key"], source="user",
        confidence=1.0, user_corrected=1, notes=notes,
        language=body.language or d.get("language") or (s.get("settings") or {}).get("default_language", "en"),
        finish=body.finish or (d.get("finish") if d.get("card_ref_id") == body.card_ref_id else None) or default_finish)
    _after_detection_change(s["id"])
    bus.publish(s["id"], {"type": "detection", "detection": detection_public(store.get_detection(detection_id), adapter)})
    return _json(session_state(s["id"]))


@router.post("/detections/{detection_id}/status")
def detection_status(detection_id: str, body: StatusBody):
    if body.status not in ("identified", "unidentified", "back", "token", "noise", "ignored"):
        raise HTTPException(400, "status inválido")
    d = store.get_detection(detection_id)
    if d is None:
        raise HTTPException(404)
    if body.status == "identified" and not d.get("card_ref_id"):
        raise HTTPException(400, "escolha a carta primeiro")
    store.update_detection(detection_id, status=body.status)
    _after_detection_change(d["session_id"])
    return _json(session_state(d["session_id"]))


@router.post("/detections/{detection_id}/duplicate")
def detection_duplicate(detection_id: str, body: DuplicateBody):
    d = store.get_detection(detection_id)
    if d is None or store.get_detection(body.other_id) is None:
        raise HTTPException(404)
    dedup.decide(d["session_id"], detection_id, body.other_id, body.same)
    deck.rebuild(d["session_id"])
    return _json(session_state(d["session_id"]))


# ------------------------------------------------------------------ cartas
@router.get("/cards/search")
def cards_search(q: str = Query(..., min_length=1), game: str = "mtg", lang: str = "pt", limit: int = 12):
    return _json(registry.get(game).search(q, lang=lang, limit=min(limit, 30)))


@router.get("/cards/{card_ref_id}")
def card_detail(card_ref_id: str, game: str = "mtg"):
    adapter = registry.get(game)
    s = adapter.card_summary(card_ref_id)
    if s is None:
        raise HTTPException(404)
    return _json({**s, "prints": adapter.prints_of(s["oracle_id"]) if s.get("oracle_id") else []})


# ------------------------------------------------------------------ entradas do deck
class EntryCreate(BaseModel):
    card_ref_id: str
    quantity: int = 1
    zone: str | None = None
    language: str | None = None
    finish: str | None = None


class EntryPatch(BaseModel):
    quantity_override: int | None = None
    reset_quantity: bool = False
    zone: str | None = None
    is_commander: bool | None = None
    card_ref_id: str | None = None
    language: str | None = None
    finish: str | None = None
    condition: str | None = None


@router.post("/sessions/{session_id}/entries")
def add_entry(session_id: str, body: EntryCreate):
    s = _session_or_404(session_id)
    adapter = registry.get(s["game_id"])
    fields = adapter.card_fields(body.card_ref_id)
    if fields is None:
        raise HTTPException(404, "carta não encontrada")
    rule = adapter.format(s["format_id"])
    zones = rule.get("zones") or ["deck"]
    zone = body.zone if body.zone in zones else ("deck" if "deck" in zones else zones[0])
    lang = body.language or (s.get("settings") or {}).get("default_language", "en")
    finish = body.finish or "nonfoil"
    rows = store.entries(s["deck_id"])
    same = next((e for e in rows if e["card_ref_id"] == body.card_ref_id and e["zone"] == zone
                 and (e["language"] or lang) == lang and (e["finish"] or "nonfoil") == finish), None)
    if same:
        store.update_entry(same["id"], quantity_override=max(0, same["quantity"] + body.quantity))
    else:
        store.insert_entry(s["deck_id"], zone=zone, card_ref_id=body.card_ref_id, oracle_id=fields["key"], language=lang,
                           finish=finish, quantity=body.quantity, quantity_detected=0, quantity_override=body.quantity,
                           is_commander=0, manual=1, rule_warnings=[], allocated_physical_ids=[],
                           position=max([e["position"] for e in rows], default=0) + 1)
    deck.rebuild(session_id)
    return _json(session_state(session_id))


@router.patch("/entries/{entry_id}")
def patch_entry(entry_id: str, body: EntryPatch):
    e = store.get_entry(entry_id)
    if e is None:
        raise HTTPException(404)
    s = store.get_session(db.app_db().execute("SELECT session_id FROM decks WHERE id=?", (e["deck_id"],)).fetchone()[0])
    adapter = registry.get(s["game_id"])
    fields: dict = {}
    if body.reset_quantity:
        fields["quantity_override"] = None
    elif body.quantity_override is not None:
        fields["quantity_override"] = max(0, body.quantity_override)
    if body.zone is not None:
        fields["zone"] = body.zone
    if body.is_commander is not None:
        fields["is_commander"] = int(body.is_commander)
        zones = adapter.format(s["format_id"]).get("zones") or []
        if body.is_commander and "commander" in zones:
            fields["zone"] = "commander"
        elif not body.is_commander and e["zone"] == "commander":
            fields["zone"] = "deck"
    if body.condition is not None:
        fields["condition"] = body.condition
    det_fields: dict = {}
    if body.card_ref_id and body.card_ref_id != e["card_ref_id"]:
        cf = adapter.card_fields(body.card_ref_id)
        if cf is None:
            raise HTTPException(404, "carta não encontrada")
        fields.update(card_ref_id=body.card_ref_id, oracle_id=cf["key"])
        det_fields.update(card_ref_id=body.card_ref_id, oracle_id=cf["key"], source="user", confidence=1.0,
                          user_corrected=1)
    if body.language:
        fields["language"] = det_fields["language"] = body.language
    if body.finish:
        fields["finish"] = det_fields["finish"] = body.finish
    store.update_entry(entry_id, **fields)
    if det_fields:
        # a identidade vem das detecções; editar a entrada propaga para as cópias físicas dela
        all_dets = store.detections(s["id"])
        phys = set(e.get("allocated_physical_ids") or [])
        for d in all_dets:
            if d["id"] in phys or d.get("dup_of") in phys:
                if "card_ref_id" in det_fields and d["id"] in phys:
                    _learn(d, s, det_fields["card_ref_id"], det_fields["oracle_id"])
                store.update_detection(d["id"], **det_fields)
    deck.rebuild(s["id"])
    return _json(session_state(s["id"]))


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: str):
    e = store.get_entry(entry_id)
    if e is None:
        raise HTTPException(404)
    session_id = db.app_db().execute("SELECT session_id FROM decks WHERE id=?", (e["deck_id"],)).fetchone()[0]
    if e["manual"] and not e["quantity_detected"]:
        store.delete_entry(entry_id)
    else:
        store.update_entry(entry_id, quantity_override=0)  # cópias detectadas não somem: ficam fora do deck
    deck.rebuild(session_id)
    return _json(session_state(session_id))


@router.post("/sessions/{session_id}/suggestions/{suggestion_type}/apply")
def apply_suggestion(session_id: str, suggestion_type: str):
    s = _session_or_404(session_id)
    adapter = registry.get(s["game_id"])
    report = deck.validate(session_id)
    suggestion = (report.get("suggestions") or {}).get(suggestion_type)
    additions = adapter.suggestion_additions(suggestion_type, suggestion or {})
    if not additions:
        raise HTTPException(400, "nenhuma sugestão aplicável")
    for card_ref_id, qty in additions:
        add_entry(session_id, EntryCreate(card_ref_id=card_ref_id, quantity=qty))
    return _json(session_state(session_id))


# ------------------------------------------------------------------ exportação
@router.get("/sessions/{session_id}/export")
def export(session_id: str, format: str = "moxfield", group: bool = False, lang: str = "en", download: bool = False):
    s = _session_or_404(session_id)
    adapter = registry.get(s["game_id"])
    deck.validate(session_id)
    items = []
    for e in store.entries(s["deck_id"]):
        c = adapter.card_summary(e["card_ref_id"])
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
    try:
        text, filename, mime = adapter.export(format, items, {"group": group, "lang": lang,
                                                              "deck_name": s.get("name") or "deck"})
    except KeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'} if download else {}
    return Response(text, media_type=f"{mime}; charset=utf-8", headers=headers)
