"""Modo vídeo / câmera ao vivo, lado do servidor.

O navegador analisa os frames (detecção, rastreio, agrupamento temporal) e envia, por grupo temporal,
os melhores recortes da carta em alta resolução — uma "leitura" (sighting). Aqui:

  1. identifica o grupo (tenta os melhores frames pelo hash; o multimodal só se nenhum resolver);
  2. grava a detecção com os metadados do grupo (duração, transição anterior, ângulos);
  3. consolida a sequência de grupos (uma carta física por grupo, com as regras abaixo) lendo tudo do
     banco — qualquer instância pode receber a próxima leitura.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .. import db
from ..events import bus
from ..games import registry
from . import deck, identify, store, vlm
from .photo import _store_result
from .serialize import detection_public

NOTE_COPY = "mesma carta do grupo anterior — contada como outra cópia"
NOTE_LONG = "exibição longa: podem ser 2 cópias seguidas — confira a quantidade"
NOTE_SPLIT = "segunda cópia inferida: a pose da carta mudou no meio de uma exibição longa — confira"
NOTE_BRIEF_NOISE = "aparição muito breve (1 frame) — provavelmente não era uma carta"
NOTE_BRIEF = "carta vista por muito pouco tempo — confira"
NOTE_DOUBTFUL_NOISE = "sem a estrutura de uma carta e sem arte reconhecida — provavelmente não era uma carta"


@dataclass
class Frame:
    card: np.ndarray                 # carta retificada 488x680
    context: np.ndarray | None       # quadrilátero ampliado 12% (620x864)
    jpeg: bytes | None = None        # recorte original enviado (evita recodificar)


@dataclass
class GroupMeta:
    group: int                       # número do grupo temporal dentro da captura (1, 2, 3...)
    frame_count: int
    t_start: float
    t_end: float
    gap_before: dict = field(default_factory=dict)   # {"event": None|"unstable"|"fast"|"empty", "frames": n}
    angles: list[float] = field(default_factory=list)
    quality: dict = field(default_factory=dict)      # nitidez, reflexo, frontalidade do melhor frame
    quad: list | None = None                         # quadrilátero normalizado no frame
    frame_w: int | None = None
    frame_h: int | None = None
    # ao vivo, "cara de carta" baixa (arte completa ou lixo): quem decide é a arte; sem ela, vira ruído
    doubtful: bool = False


def record_sighting(session_id: str, capture_id: str, frames: list[Frame], meta: GroupMeta,
                    allow_vlm: bool = True) -> dict:
    session = store.get_session(session_id)
    adapter = registry.get(session["game_id"])
    lang = (session.get("settings") or {}).get("default_language", "en")
    sets = store.preferred_sets(session)
    user_id = session["user_id"]

    existing = db.app_db().execute(
        "SELECT id FROM detections WHERE capture_id=? AND temporal_group=? AND (raw_name IS NULL OR raw_name NOT LIKE 'clone:%')",
        (capture_id, meta.group)).fetchone()
    if existing:  # reenvio do mesmo grupo (rede instável): idempotente
        return store.get_detection(existing[0])

    tries: list[tuple[identify.IdentifyResult, Frame]] = []
    chosen = None
    for fr in frames:
        r = identify.identify(fr.card, adapter=adapter, context_bgr=fr.context, default_language=lang,
                              session_id=session_id, allow_vlm=False, user_id=user_id, preferred_sets=sets)
        tries.append((r, fr))
        if r.status == "back" or (r.status in ("identified", "token") and r.confidence >= identify.HASH_ACCEPT):
            chosen = (r, fr)
            break
    if chosen is None:
        ranked = sorted(tries, key=lambda x: (x[0].status in ("identified", "token", "back"), x[0].confidence),
                        reverse=True)
        chosen = ranked[0]
        # leitura duvidosa não gasta IA: na maioria das vezes é mesa ou mão
        if chosen[0].status == "unidentified" and allow_vlm and not meta.doubtful and vlm.enabled():
            fr = frames[0]
            chosen = (identify.identify(fr.card, adapter=adapter, context_bgr=fr.context, default_language=lang,
                                        session_id=session_id, allow_orb=False, user_id=user_id,
                                        preferred_sets=sets), fr)
    result, fr = chosen
    if meta.frame_count <= 1 and result.status == "unidentified":
        result.status = "noise"
        result.notes.append(NOTE_BRIEF_NOISE)
    elif meta.doubtful and result.status == "unidentified":
        result.status = "noise"
        result.notes.append(NOTE_DOUBTFUL_NOISE)
    elif meta.frame_count < 3 and result.status == "identified":
        result.notes.append(NOTE_BRIEF)

    det_id = db.new_id()
    crop_key = store.save_crop_bytes(session_id, det_id, fr.jpeg) if fr.jpeg else store.save_crop(session_id, det_id, fr.card)
    bbox = None
    if meta.quad:
        xs, ys = [p[0] for p in meta.quad], [p[1] for p in meta.quad]
        bbox = {"quad": meta.quad, "rect": [min(xs), min(ys), max(xs), max(ys)]}
    store.insert_detection_seq(
        session_id, capture_id, id=det_id, bbox=bbox, crop_path=crop_key, status="pending", confidence=0.0,
        source="none", temporal_group=meta.group, frame_count=meta.frame_count, t_start=round(meta.t_start, 3),
        t_end=round(meta.t_end, 3), notes=[],
        quality={**meta.quality, "kind": "full", "gap_before": meta.gap_before, "frames": meta.frame_count,
                 "angles": [round(float(a), 2) for a in meta.angles[:240]]})
    _store_result(session_id, det_id, result, fr.card)
    with db.lease_lock(f"consolidate:{capture_id}"):
        consolidate(session_id, capture_id, final=False)
    deck.rebuild(session_id)
    det = store.get_detection(det_id)
    bus.publish(session_id, {"type": "detection", "detection": detection_public(det, adapter)})
    return det


def finish_capture(session_id: str, capture_id: str) -> None:
    cap = store.get_capture(capture_id)
    with db.lease_lock(f"consolidate:{capture_id}"):
        consolidate(session_id, capture_id, final=True)
        # ao vivo cada carta só vira outra leitura depois de sair do quadro: segurar a carta por muito
        # tempo (ou girá-la na mão) não é sinal de uma segunda cópia escondida, como no vídeo
        if not cap or cap.get("type") != "live":
            infer_hidden_copies(session_id, capture_id)
    store.update_capture(capture_id, status="done", progress=1)
    deck.rebuild(session_id)


def _groups(session_id: str, capture_id: str) -> list[dict]:
    rows = db.app_db().execute(
        "SELECT * FROM detections WHERE capture_id=? AND temporal_group IS NOT NULL ORDER BY temporal_group, seq",
        (capture_id,)).fetchall()
    out = []
    for r in rows:
        d = db.row_to_dict(r, store.DET_JSON)
        if (d.get("raw_name") or "").startswith("clone:"):
            continue
        out.append(d)
    return out


def consolidate(session_id: str, capture_id: str, final: bool) -> None:
    """Consolida a sequência de grupos (uma carta física por grupo) de forma idempotente.

    - fragmento ruim (não identificado/ruído) sem transição forte = frames ruins da carta anterior;
    - mesma identidade em grupos seguidos: funde se não houve carta saindo/movimento de troca, ou se
      um dos lados é um fragmento curto; senão são cópias diferentes (com aviso);
    - exibição muito mais longa que as demais recebe aviso de possível cópia dupla.
    Sem `final`, para no primeiro grupo que ainda não chegou (leituras fora de ordem).
    """
    dets = _groups(session_id, capture_id)
    items: list[dict] = []
    expected = 1  # grupos são numerados a partir de 1 em cada captura
    for d in dets:
        g = d["temporal_group"]
        if d["status"] == "pending":
            if not final:
                break
            continue
        if g > expected and not final:
            break
        expected = g + 1
        items.append({"d": d, "frames": d.get("frame_count") or 1, "gap": (d.get("quality") or {}).get("gap_before") or {}})
    if not items:
        return
    durations = [it["d"]["t_end"] - it["d"]["t_start"] for it in items
                 if it["d"]["status"] == "identified" and it["frames"] >= 4]
    median_dur = float(np.median(durations)) if len(durations) >= 5 else None
    decisions: dict[str, tuple[str | None, list[str]]] = {}
    prev_real: dict | None = None
    for it in items:
        d = it["d"]
        gap = it["gap"]
        event = gap.get("event")
        parent, reasons = None, []
        if prev_real is not None:
            pd = prev_real["d"]
            same = d["status"] == pd["status"] and d["status"] in ("identified", "token", "back") \
                and d.get("oracle_id") == pd.get("oracle_id")
            if d["status"] in ("unidentified", "noise") and event in (None, "unstable"):
                parent, reasons = prev_real, ["frames ruins da mesma carta (sem transição)"]
            elif same and event in (None, "unstable"):
                parent, reasons = prev_real, ["mesma carta sem sair do quadro (tremida ou reposicionada)"]
            elif same and min(it["frames"], prev_real["frames"]) < 4 and gap.get("frames", 0) <= 3:
                parent, reasons = prev_real, ["fragmento curto da mesma carta"]
            elif same and median_dur and (d["t_end"] - pd["t_start"]) <= 1.6 * median_dur:
                # duas cópias reais somariam ~2 exibições + a troca; isto cabe em uma só
                parent, reasons = prev_real, ["mesma carta: interrupção curta dentro de uma exibição normal"]
        if parent is not None:
            decisions[d["id"]] = (parent["d"]["id"], reasons)
            parent["frames"] += it["frames"]  # acumulador local: a carta fundida soma a exibição
        else:
            decisions[d["id"]] = (None, [])
            if d["status"] != "noise":
                prev_real = it
    lengths = [it["frames"] for it in items if decisions[it["d"]["id"]][0] is None and it["d"]["status"] == "identified"]
    median_len = float(np.median(lengths)) if lengths else 0.0
    plain = [it["d"] for it in items]
    for it in items:
        d = it["d"]
        if d.get("dup_status") in ("user_same", "user_different"):
            continue  # decisão da revisão prevalece
        root, reasons = decisions[d["id"]]
        notes = [n for n in (d.get("notes") or []) if n not in (NOTE_COPY, NOTE_LONG)]
        if root is None:
            fields = {}
            if d.get("dup_status") == "auto":
                fields.update(dup_of=None, dup_status=None)
            if d["status"] == "identified" and median_len and it["frames"] >= max(16, 1.8 * median_len):
                notes.append(NOTE_LONG)
            prev = _previous_kept(plain, decisions, d["id"])
            if prev is not None and prev["status"] == d["status"] == "identified" and prev.get("oracle_id") == d.get("oracle_id"):
                notes.append(NOTE_COPY)
            if notes != (d.get("notes") or []):
                fields["notes"] = notes
            if fields:
                store.update_detection(d["id"], **fields)
        elif d.get("dup_of") != root or d.get("dup_status") != "auto" or notes != (d.get("notes") or []):
            store.update_detection(d["id"], dup_of=root, dup_status="auto", notes=notes,
                                   dup_candidates={"merged_reasons": reasons})


def _previous_kept(items: list[dict], decisions: dict, det_id: str) -> dict | None:
    prev = None
    for d in items:
        if d["id"] == det_id:
            return prev
        if decisions[d["id"]][0] is None and d["status"] != "noise":
            prev = d
    return None


def infer_hidden_copies(session_id: str, capture_id: str) -> None:
    """Cópias idênticas trocadas sem evento visível (ex.: básicos seguidos) viram uma exibição longa só.

    Duas cartas físicas nunca ficam na mesma pose: se uma exibição longa (≥ 1,6× a mediana) tem uma mudança
    sustentada de ângulo no meio, registra uma segunda cópia — sempre com aviso para conferir.
    """
    dets = {d["id"]: d for d in _groups(session_id, capture_id)}
    roots: dict[str, list[dict]] = {}
    for d in sorted(dets.values(), key=lambda x: x["temporal_group"]):
        root = d.get("dup_of") if d.get("dup_status") == "auto" and d.get("dup_of") in dets else d["id"]
        roots.setdefault(root, []).append(d)
    spans = []
    for root, parts in roots.items():
        if dets[root]["status"] != "identified":
            continue
        t0 = min(p["t_start"] for p in parts)
        t1 = max(p["t_end"] for p in parts)
        spans.append((root, parts, t1 - t0))
    if len(spans) < 5:
        return
    median = float(np.median([s for _, _, s in spans]))
    for root, parts, span in spans:
        if span < 1.6 * median:
            continue
        angles = [a for p in parts for a in (p.get("quality") or {}).get("angles", [])]
        if len(angles) < 10:
            continue
        best_delta, best_k = 0.0, None
        for k in range(5, len(angles) - 4):
            delta = abs(float(np.median(angles[:k])) - float(np.median(angles[k:])))
            delta = min(delta, 180.0 - delta)
            if delta > best_delta:
                best_delta, best_k = delta, k
        if best_k is None or best_delta < 1.8:
            continue
        clone_key = f"clone:{root}"
        if db.app_db().execute("SELECT id FROM detections WHERE session_id=? AND raw_name=?",
                               (session_id, clone_key)).fetchone():
            continue
        base = dets[root]
        clone = {k: base[k] for k in ("bbox", "crop_path", "card_ref_id", "oracle_id", "face", "language", "finish",
                                      "candidates", "quality", "temporal_group", "frame_count", "t_start", "t_end",
                                      "art_phash", "full_phash")}
        clone.update(status="identified", confidence=round(min(base["confidence"], 0.75), 3), source=base["source"],
                     notes=[NOTE_SPLIT], raw_name=clone_key)
        store.insert_detection_seq(session_id, capture_id, id=db.new_id(), **clone)
        notes = [n for n in (base.get("notes") or []) if n != NOTE_LONG] + [NOTE_SPLIT]
        store.update_detection(root, notes=notes)
