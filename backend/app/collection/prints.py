"""Detecção de impressão impossível.

Combinação de coleção + número que não existe, carta que nunca saiu naquele idioma ou naquele acabamento:
sinal de falsificação ou de leitura errada. Validação cruzada com o registro oficial (catálogo da Scryfall,
e a API para coleções recentes ou idiomas fora do catálogo). O aviso é investigativo, nunca acusação.
"""
from __future__ import annotations

import datetime as dt
import re

from .. import db
from ..games import registry
from ..games.mtg.adapter import normalize_collector_number, normalize_name
from ..games.mtg.scryfall_api import client as scryfall

RECENT_SET_DAYS = 75           # catálogo pode não ter coleções lançadas depois da importação
CATALOG_FULL_LANGS = ("en", "pt")


def _languages(game_id: str) -> dict[str, str]:
    return {l["id"]: l["name"].lower() for l in registry.get(game_id).game_meta().get("languages", [])}


def _finish_label(finish: str) -> str:
    return {"foil": "foil", "etched": "etched (foil gravado)", "nonfoil": "versão normal (sem foil)"}.get(finish, finish)


def _set_row(code: str):
    return db.catalog_db().execute("SELECT code, name, released_at, printed_size, card_count FROM sets WHERE code=?",
                                   (code,)).fetchone()


def _catalog_is_stale_for(set_row) -> bool:
    if set_row is None or not set_row["released_at"]:
        return True
    updated = db.catalog_meta_get("mtg.hashes.updated_at") or db.catalog_meta_get("mtg.default_cards.file") or ""
    try:
        catalog_date = dt.date.fromisoformat(updated[:10])
    except ValueError:
        return True
    try:
        released = dt.date.fromisoformat(set_row["released_at"][:10])
    except ValueError:
        return True
    return (catalog_date - released).days < RECENT_SET_DAYS


def check(game_id: str, set_code: str | None, collector_number: str | None, language: str | None = None,
          finish: str | None = None, name: str | None = None, online: bool = True) -> dict | None:
    """None = combinação plausível. Senão {code, message, data}."""
    if not set_code or not collector_number:
        return None
    code = set_code.strip().lower()
    number = normalize_collector_number(collector_number) or ""
    lang = (language or "en").lower()
    conn = db.catalog_db()
    set_row = _set_row(code)
    if set_row is None and conn.execute("SELECT 1 FROM sets LIMIT 1").fetchone() is not None:
        status, _ = scryfall().get(f"/sets/{code}", ttl=7 * 24 * 3600) if online else (0, None)
        if status == 404:
            return {"code": "unknown_set", "data": {"set_code": code.upper()},
                    "message": f"a coleção “{code.upper()}” não existe no registro oficial — confira a carta"}
    rows = conn.execute("SELECT id, lang, name_en, finishes FROM card_refs WHERE set_code=? AND collector_number=?",
                        (code, number)).fetchall()
    if not rows:
        exists = False
        if _catalog_is_stale_for(set_row):
            if not online:
                return None  # coleção nova demais para o catálogo e sem consulta à API
            status, _ = scryfall().get(f"/cards/{code}/{number}")
            exists = status == 200
        if not exists:
            data = {"set_code": code.upper(), "collector_number": number}
            size = set_row["printed_size"] if set_row else None
            if size and re.fullmatch(r"\d+", number) and int(number) > int(size):
                data["printed_size"] = size
            return {"code": "unknown_number", "data": data,
                    "message": "esta combinação de coleção e número não existe no registro oficial — confira a carta"}
        return None
    card_name = rows[0]["name_en"]
    if name and normalize_name(name) not in (normalize_name(card_name), *[normalize_name(p) for p in card_name.split(" // ")]):
        oracle = registry.get(game_id)._oracle_by_name(name)
        ref_oracle = conn.execute("SELECT oracle_id FROM card_refs WHERE id=?", (rows[0]["id"],)).fetchone()
        if oracle and ref_oracle and oracle != ref_oracle["oracle_id"]:
            return {"code": "name_mismatch", "data": {"read": name, "expected": card_name},
                    "message": f"o nome lido não corresponde à carta {code.upper()} {number} ({card_name}) — confira a carta"}
    langs = {r["lang"] for r in rows}
    if lang not in langs:
        authoritative = lang in CATALOG_FULL_LANGS and not _catalog_is_stale_for(set_row)
        if not authoritative and not online:
            return None  # idioma fora do catálogo e sem consulta à API: não dá para afirmar nada
        exists = False
        if not authoritative:
            status, _ = scryfall().get(f"/cards/{code}/{number}/{lang}")
            exists = status == 200
        if not exists:
            label = _languages(game_id).get(lang, lang)
            return {"code": "language_never_printed", "data": {"language": lang, "set_code": code.upper(),
                                                                "collector_number": number},
                    "message": f"esta impressão nunca saiu em {label} — confira a carta"}
    if finish and finish in ("foil", "etched", "nonfoil"):
        finishes = set()
        for r in rows:
            if r["lang"] == lang or lang not in langs:
                finishes |= set(db.loads(r["finishes"], []) or [])
        if finishes and finish not in finishes:
            return {"code": "finish_never_printed", "data": {"finish": finish, "available": sorted(finishes)},
                    "message": f"esta impressão não existe em {_finish_label(finish)} — confira a carta"}
    return None


def check_card_ref(game_id: str, card_ref_id: str, language: str | None, finish: str | None,
                   summary: dict | None = None) -> dict | None:
    """Mesmo teste para uma carta já escolhida (idioma/acabamento editados na revisão)."""
    summary = summary or registry.get(game_id).card_summary(card_ref_id)
    if summary is None:
        return None
    lang = (language or summary.get("lang") or "en").lower()
    finishes = summary.get("finishes") or []
    if lang == summary.get("lang") and (not finish or not finishes or finish in finishes):
        return None  # caminho rápido: é exatamente a impressão escolhida (sem consulta ao banco)
    return check(game_id, summary.get("set_code"), summary.get("collector_number"), lang, finish, online=False)
