"""Etapa 3 da cascata: modelo multimodal (Claude) só nos recortes que o hash local não resolveu.

Envia o RECORTE da carta (nunca a foto inteira) e exige JSON estruturado via output_config.format.
Provedores: API da Anthropic (ANTHROPIC_API_KEY) ou Vercel AI Gateway (AI_GATEWAY_API_KEY ou o token
OIDC da própria função na Vercel). Sem nenhum dos dois a etapa fica desligada e o recorte vai direto
para revisão humana.
"""
from __future__ import annotations

import base64
import json
import os
import threading
import time

import cv2
import numpy as np

from .. import config, db

SCHEMA = {
    "type": "object",
    "properties": {
        "is_card": {"type": "boolean"},
        "is_card_back": {"type": "boolean"},
        "is_token": {"type": "boolean"},
        "name_en": {"type": "string"},
        "printed_name": {"type": "string"},
        "set_code": {"type": "string"},
        "collector_number": {"type": "string"},
        "language": {"type": "string"},
        "finish": {"type": "string", "enum": ["nonfoil", "foil", "etched", "unknown"]},
        "treatment": {"type": "string"},
        "confidence": {"type": "number"},
        "bbox": {"type": "array", "items": {"type": "number"}},
        "neighbors": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "string"},
    },
    "required": ["is_card", "is_card_back", "is_token", "name_en", "printed_name", "set_code", "collector_number",
                 "language", "finish", "treatment", "confidence", "bbox", "neighbors", "notes"],
    "additionalProperties": False,
}

PROMPT = """Esta imagem é o recorte de uma carta de Magic: The Gathering fotografada numa mesa (pode estar em sleeve, com reflexo, torta ou parcialmente coberta). A carta de interesse ocupa o centro; as bordas podem mostrar pedaços de cartas vizinhas.

Identifique a carta central e responda no esquema JSON:
- name_en: nome oficial em inglês (Oracle). Se a carta estiver impressa em outro idioma, traduza para o nome oficial em inglês.
- printed_name: o nome exatamente como impresso na carta.
- set_code e collector_number: leia a linha de informações no canto inferior esquerdo (ex.: "240/281 M SNC • EN" → collector_number "240", set_code "SNC", language "en"). Deixe vazio o que não estiver legível — não invente.
- language: código de idioma (en, pt, es, ja, de, fr, it, ko, ru, zhs, zht).
- finish: nonfoil, foil, etched ou unknown.
- treatment: borderless, extended art, showcase, full art, promo ou vazio.
- is_card_back: true se for o verso da carta; is_token: true para token, emblema ou carta de arte.
- is_card: false se não houver carta reconhecível.
- confidence: 0 a 1, o quanto você tem certeza do nome.
- bbox: [x0, y0, x1, y1] normalizados (0–1) da carta central dentro da imagem.
- neighbors: nomes de cartas vizinhas parcialmente visíveis, se houver.
- notes: observações curtas (ex.: "número de coletor ilegível por reflexo")."""

_client = None
_client_lock = threading.Lock()
_sem = threading.Semaphore(config.VLM_MAX_CONCURRENCY)


def enabled() -> bool:
    return config.VLM_ENABLED


GATEWAY_URL = "https://ai-gateway.vercel.sh"


def _get_client():
    global _client
    import anthropic

    if config.VLM_PROVIDER == "gateway":
        # o token OIDC da Vercel expira: com ele o cliente é recriado a cada chamada (é barato)
        key = config.AI_GATEWAY_API_KEY or os.environ.get("VERCEL_OIDC_TOKEN", "")
        if not config.AI_GATEWAY_API_KEY:
            return anthropic.Anthropic(api_key=key, base_url=GATEWAY_URL, max_retries=2, timeout=90.0)
    with _client_lock:
        if _client is None:
            if config.VLM_PROVIDER == "gateway":
                _client = anthropic.Anthropic(api_key=config.AI_GATEWAY_API_KEY, base_url=GATEWAY_URL,
                                              max_retries=2, timeout=90.0)
            else:
                _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, max_retries=2, timeout=90.0)
        return _client


def model_name() -> str:
    if config.VLM_PROVIDER == "gateway" and "/" not in config.VLM_MODEL:
        return f"anthropic/{config.VLM_MODEL}"
    return config.VLM_MODEL


def read_card(image_bgr: np.ndarray, hints: list[str] | None = None, *, session_id: str | None = None,
              detection_id: str | None = None) -> dict | None:
    if not enabled():
        return None
    import anthropic

    h, w = image_bgr.shape[:2]
    scale = min(1.0, 1100.0 / max(h, w))
    if scale < 1:
        image_bgr = cv2.resize(image_bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        return None
    text = PROMPT
    if hints:
        text += "\n\nCandidatos sugeridos pelo hash visual local (podem estar errados): " + "; ".join(hints[:5])
    params = {
        "model": model_name(),
        "max_tokens": 4096,
        "output_config": {"format": {"type": "json_schema", "schema": SCHEMA}, "effort": config.VLM_EFFORT},
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                             "data": base64.standard_b64encode(buf.tobytes()).decode("ascii")}},
                {"type": "text", "text": text},
            ],
        }],
    }
    client = _get_client()
    started = time.time()
    response = None
    try:
        with _sem:
            if config.VLM_PROVIDER == "anthropic" and config.VLM_MODEL in ("claude-opus-5", "claude-fable-5-1"):
                # recusa de classificador → reexecuta no modelo de fallback recomendado, no mesmo request
                response = client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params)
            else:
                response = client.messages.create(**params)
    except anthropic.RateLimitError:
        _log_call(session_id, detection_id, None, started, False)
        return None
    except anthropic.APIStatusError:
        _log_call(session_id, detection_id, None, started, False)
        return None
    except anthropic.APIConnectionError:
        _log_call(session_id, detection_id, None, started, False)
        return None

    if response.stop_reason == "refusal":
        _log_call(session_id, detection_id, response, started, False)
        return None
    raw = next((b.text for b in response.content if b.type == "text"), None)
    _log_call(session_id, detection_id, response, started, raw is not None)
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    data["_model"] = getattr(response, "model", config.VLM_MODEL)
    return data


def _log_call(session_id, detection_id, response, started: float, ok: bool) -> None:
    usage = getattr(response, "usage", None)
    db.app_db().execute(
        "INSERT INTO vlm_calls (id, session_id, detection_id, model, input_tokens, output_tokens, ms, ok, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (db.new_id(), session_id, detection_id, getattr(response, "model", config.VLM_MODEL),
         getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None),
         int((time.time() - started) * 1000), int(ok), db.now_iso()),
    )
