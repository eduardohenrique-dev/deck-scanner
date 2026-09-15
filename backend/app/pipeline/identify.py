"""Cascata de identificação de UM recorte de carta já retificado.

  Etapa 2  pHash local contra ~112 mil impressões (ms, custo zero)
  Etapa 2b verificação geométrica ORB nos candidatos ambíguos (local)
  Etapa 3  modelo multimodal só no que sobrou (se configurado)
  Etapa 4  resolução canônica pelo adapter (catálogo local → API da Scryfall)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from .. import config
from ..games.base import GameAdapter, RawCard
from ..vision import hashing, verify
from ..vision.hashindex import Candidate, get_index
from . import printresolve, vlm

# Calibrados com cenas sintéticas (tools/calibrate.py). A margem para o melhor candidato de OUTRA
# carta separa acerto de erro muito melhor que a distância absoluta: nos erros ela fica ≤ ~6.
MARGIN_MID = 8.0           # margem com confiança 0.5
MARGIN_SLOPE = 2.2
SCORE_SOFT_LIMIT = 145.0   # acima disso a confiança decai (score = d_art + 0.5·d_full)
HASH_ACCEPT = 0.72         # ≈ margem ≥ 10: aceita direto pelo hash
HASH_VERIFY = 0.0          # ORB nos 3 melhores candidatos de qualquer recorte não aceito (local, barato)
BACK_MAX_SCORE = 110.0
ORB_ACCEPT_INLIERS = 20


@dataclass
class IdentifyResult:
    status: str = "unidentified"         # identified | unidentified | back | token
    card_ref_id: str | None = None
    oracle_id: str | None = None
    face: int = 0
    confidence: float = 0.0
    source: str = "none"                 # phash | phash+orb | learned | vlm | none
    orientation: int = 0
    language: str | None = None
    finish: str | None = None
    raw: dict = field(default_factory=dict)
    candidates: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    hashes: hashing.CardHashes | None = None
    metrics: dict = field(default_factory=dict)


def hash_confidence(cands: list[Candidate]) -> tuple[float, dict]:
    best = cands[0]
    second = next((c for c in cands[1:] if c.oracle_id != best.oracle_id), None)
    margin = (second.score - best.score) if second else 60.0
    by_margin = 1.0 / (1.0 + math.exp(-(margin - MARGIN_MID) / MARGIN_SLOPE))
    score_factor = 1.0 if best.score <= SCORE_SOFT_LIMIT else max(0.7, 1 - (best.score - SCORE_SOFT_LIMIT) / 150)
    conf = min(0.995, by_margin * score_factor)
    return conf, {"best_score": round(best.score, 1), "margin": round(margin, 1), "d_art": best.d_art,
                  "d_full": best.d_full}


def _distinct(cands: list[Candidate], limit: int) -> list[Candidate]:
    seen, out = set(), []
    for c in cands:
        if c.is_back or c.oracle_id in seen:
            continue
        seen.add(c.oracle_id)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def _finalize(result: IdentifyResult, adapter: GameAdapter, default_language: str) -> IdentifyResult:
    summary = adapter.card_summary(result.card_ref_id) if result.card_ref_id else None
    if summary is None:
        result.status = "unidentified"
        return result
    result.oracle_id = result.oracle_id or summary["oracle_id"]
    if summary["kind"] in ("token", "emblem", "art_series", "other"):
        result.status = "token"
        result.notes.append({"token": "token", "emblem": "emblema", "art_series": "carta de arte"}.get(
            summary["kind"], "não é carta de deck"))
        return result
    result.status = "identified"
    finishes = summary.get("finishes") or []
    if not result.finish:
        result.finish = "foil" if finishes == ["foil"] else "etched" if finishes == ["etched"] else "nonfoil"
    if not result.language:
        result.language = summary["lang"] if summary["lang"] != "en" else default_language
    return result


def _apply_print(result: IdentifyResult, card_bgr: np.ndarray, context_bgr: np.ndarray | None,
                 ordered: list[Candidate], adapter: GameAdapter, default_language: str) -> None:
    """Idioma e coleção exatos a partir da imagem (a arte já foi reconhecida)."""
    res = printresolve.resolve(card_bgr, context_bgr, ordered, adapter, default_language=default_language)
    result.card_ref_id = res.card_ref_id
    result.language = res.language
    result.notes += res.notes
    if res.alternatives:
        result.raw["alt_prints"] = res.alternatives[:6]
    result.raw["print_confident"] = res.print_confident
    result.raw["language_confident"] = res.language_confident
    if res.metrics:
        result.metrics["print"] = res.metrics


def identify(card_bgr: np.ndarray, *, adapter: GameAdapter, context_bgr: np.ndarray | None = None,
             default_language: str = "en", session_id: str | None = None, allow_vlm: bool = True,
             allow_orb: bool = True, user_id: str | None = None, resolve_print: bool = True) -> IdentifyResult:
    index = get_index()
    qh = hashing.compute_query_hashes(card_bgr, context_bgr)
    result = IdentifyResult(hashes=qh[0])
    cands = index.query(qh, k=16, user_id=user_id)

    if cands:
        best = cands[0]
        result.orientation = best.orientation
        result.hashes = qh[best.variant] if best.variant < len(qh) else qh[0]
        if best.is_back and best.score <= BACK_MAX_SCORE:
            result.status, result.source, result.confidence = "back", "phash", 0.95
            return result
        cands = [c for c in cands if not c.is_back]
    if cands:
        best = cands[0]
        conf, metrics = hash_confidence(cands)
        result.metrics = metrics
        result.candidates = [c.as_dict() for c in _distinct(cands, 6)]
        same_oracle = [c for c in cands if c.oracle_id == best.oracle_id and c.card_ref_id != best.card_ref_id
                       and c.score - best.score <= 10]
        if conf >= HASH_ACCEPT:
            result.card_ref_id, result.oracle_id, result.face = best.card_ref_id, best.oracle_id, best.face
            result.confidence = round(conf, 3)
            result.source = "learned" if best.learned else "phash"
            if resolve_print and not best.learned:
                _apply_print(result, card_bgr, context_bgr, cands, adapter, default_language)
            elif same_oracle:
                result.notes.append(printresolve.NOTE_PRINT)
                result.raw["alt_prints"] = [c.card_ref_id for c in same_oracle[:6]]
            return _finalize(result, adapter, default_language)

        if allow_orb and config.ORB_VERIFY_ENABLED and conf >= HASH_VERIFY:
            checks = []
            for c in _distinct(cands, 3):
                v = verify.verify_candidate(card_bgr, c.card_ref_id, c.face)
                checks.append((v["inliers"], c))
            checks.sort(key=lambda x: -x[0])
            result.metrics["orb"] = [{"card_ref_id": c.card_ref_id, "inliers": n} for n, c in checks]
            if checks and checks[0][0] >= ORB_ACCEPT_INLIERS and (
                    len(checks) == 1 or checks[0][0] >= 2 * max(checks[1][0], 5)):
                n, c = checks[0]
                result.card_ref_id, result.oracle_id, result.face = c.card_ref_id, c.oracle_id, c.face
                result.confidence = round(max(conf, min(0.95, 0.7 + n / 150)), 3)
                result.source = "phash+orb"
                if resolve_print:
                    _apply_print(result, card_bgr, context_bgr, [c] + [x for x in cands if x is not c], adapter,
                                 default_language)
                return _finalize(result, adapter, default_language)

    if allow_vlm and vlm.enabled():
        hints = []
        for c in result.candidates[:5]:
            s = adapter.card_summary(c["card_ref_id"])
            if s:
                hints.append(f"{s['name_en']} ({s['set_code'].upper()} {s['collector_number']})")
        oriented = context_bgr if context_bgr is not None else card_bgr
        if result.orientation == 180:
            oriented = cv2.rotate(oriented, cv2.ROTATE_180)
        data = vlm.read_card(oriented, hints, session_id=session_id)
        if data:
            result.raw = {k: data.get(k) for k in ("name_en", "printed_name", "set_code", "collector_number",
                                                   "language", "finish", "treatment", "confidence", "bbox",
                                                   "neighbors", "notes", "_model")}
            if data.get("is_card_back"):
                result.status, result.source, result.confidence = "back", "vlm", float(data.get("confidence") or 0.9)
                return result
            if data.get("is_card"):
                resolved = adapter.resolve_card(RawCard(
                    name=data.get("name_en") or None, printed_name=data.get("printed_name") or None,
                    set_code=data.get("set_code") or None, collector_number=data.get("collector_number") or None,
                    language=(data.get("language") or "").lower() or None))
                if resolved:
                    result.card_ref_id, result.oracle_id = resolved.card_ref_id, resolved.oracle_id
                    result.source = "vlm"
                    result.confidence = round(float(np.clip(data.get("confidence") or 0.5, 0, 1))
                                              * (1.0 if resolved.exact_print else 0.9), 3)
                    lang = (data.get("language") or "").lower()
                    result.language = lang or None
                    if data.get("finish") in ("foil", "etched", "nonfoil"):
                        result.finish = data["finish"]
                    result.notes += resolved.notes
                    if data.get("notes"):
                        result.notes.append(data["notes"])
                    finalized = _finalize(result, adapter, default_language)
                    if data.get("is_token") and finalized.status == "identified":
                        finalized.status = "token"
                    return finalized
            if data.get("notes"):
                result.notes.append(data["notes"])

    result.status = "unidentified"
    if not vlm.enabled():
        result.notes.append("não resolvida pelo hash local; modelo multimodal desativado")
    return result
