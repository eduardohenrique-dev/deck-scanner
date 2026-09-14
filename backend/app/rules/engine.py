"""Motor de regras declarativo e genérico.

Recebe a regra do formato (JSON), as entradas do deck e os campos canônicos das cartas
(fornecidos pelo GameAdapter). Não existe nenhum `if formato == ...` aqui: limite de cópias,
exceções, lista restrita, tamanho, zonas, legalidade, comandante, identidade e sugestões
são todos dirigidos pelos dados.

Semântica de quantidade:
  quantity_detected = cartas físicas encontradas
  quantity          = quantas entram no deck após as regras (ou o ajuste manual do usuário)
A diferença gera avisos — o excesso nunca some em silêncio.
"""
from __future__ import annotations

import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable

from . import predicates


@dataclass
class EngineEntry:
    id: str
    card_ref_id: str
    key: str                     # chave de normalização (MTG: oracle_id)
    zone: str
    quantity_detected: int
    quantity_override: int | None = None
    is_commander: bool = False
    position: int = 0
    manual: bool = False


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().casefold().strip()


def parse_count(value: str, number_words: dict[str, int]) -> int | None:
    v = (value or "").strip().casefold()
    if v.isdigit():
        return int(v)
    return number_words.get(v)


class _Messages:
    def __init__(self, templates: dict[str, str]):
        self.templates = templates

    def render(self, code: str, data: dict) -> str:
        template = self.templates.get(code, code)
        try:
            return template.format(**data)
        except (KeyError, IndexError, ValueError):
            return template


def copy_limit_for(rule: dict, card: dict, number_words: dict[str, int]) -> tuple[int | None, dict | None]:
    """Limite de cópias da carta no formato: (limite ou None = ilimitado, exceção aplicada)."""
    limit = rule.get("copy_limit")
    for exc in rule.get("copy_limit_exceptions") or []:
        ok, caps = predicates.evaluate(exc, card)
        if not ok:
            continue
        exc_limit = exc.get("limit")
        if exc_limit == "from_text":
            group = exc.get("capture", "n")
            exc_limit = parse_count(caps[group], number_words) if caps.get(group) else None
        return exc_limit, {"reason": exc.get("reason", exc.get("match")), "limit": exc_limit}
    restricted = rule.get("restricted_list")
    if restricted and rule.get("restricted_list_limit") is not None:
        ok, _ = predicates.evaluate(restricted, card)
        if ok:
            return rule["restricted_list_limit"], {"reason": restricted.get("reason", "lista restrita"),
                                                   "limit": rule["restricted_list_limit"], "restricted": True}
    return limit, None


def evaluate(rule: dict, entries: list[EngineEntry], cards: dict[str, dict], *, game_meta: dict,
             messages: dict[str, str], suggestion_providers: dict[str, Callable[..., dict]] | None = None) -> dict:
    msg = _Messages(messages)
    fmt_name = rule.get("name", rule["id"])
    number_words = game_meta.get("number_words", {})
    zone_names = {z["id"]: z.get("name", z["id"]) for z in game_meta.get("zones", [])}
    zone_names.update(rule.get("zone_labels") or {})
    issues: list[dict] = []

    def add(severity: str, code: str, data: dict, entry_ids: list[str] | None = None) -> None:
        issues.append({"severity": severity, "code": code, "message": msg.render(code, {"format": fmt_name, **data}),
                       "entry_ids": entry_ids or [], "data": data})

    def card_of(e: EngineEntry) -> dict:
        return cards.get(e.card_ref_id) or {}

    def name_of(e: EngineEntry) -> str:
        c = card_of(e)
        return c.get("display_name") or c.get("name") or e.key

    per_entry: dict[str, dict] = {
        e.id: {"quantity": 0, "quantity_auto": 0, "limit": None, "exception": None, "warnings": []} for e in entries
    }

    # 1) limite de cópias por carta normalizada (mesma carta em qualquer idioma/coleção)
    copy_zones = set(rule.get("copy_limit_zones") or rule.get("zones") or [])
    groups: dict[str, list[EngineEntry]] = defaultdict(list)
    for e in entries:
        groups[e.key].append(e)
    for key, group in groups.items():
        card = card_of(group[0])
        limit, exception = copy_limit_for(rule, card, number_words)
        remaining = limit
        for e in sorted(group, key=lambda x: (not x.is_commander, x.position)):
            info = per_entry[e.id]
            info["limit"], info["exception"] = limit, exception
            if limit is None or e.zone not in copy_zones:
                auto = e.quantity_detected
            else:
                auto = min(e.quantity_detected, max(remaining or 0, 0))
                remaining = (remaining or 0) - auto
            info["quantity_auto"] = auto
            info["quantity"] = e.quantity_override if e.quantity_override is not None else auto
        in_scope = [e for e in group if e.zone in copy_zones]
        detected_total = sum(e.quantity_detected for e in in_scope)
        effective_total = sum(per_entry[e.id]["quantity"] for e in in_scope)
        ids = [e.id for e in group]
        data = {"name": name_of(group[0]), "detected": detected_total, "quantity": effective_total,
                "limit": limit if limit is not None else "∞"}
        if limit is not None and detected_total > limit:
            add("warning", "copy_limit_exceeded", data, ids)
            for e in group:
                per_entry[e.id]["warnings"].append(msg.render("copy_limit_exceeded", {"format": fmt_name, **data}))
        if limit is not None and effective_total > limit:
            add("error", "copy_limit_violation", data, ids)
        base = rule.get("copy_limit")
        if exception and base is not None and detected_total > base and not exception.get("restricted"):
            add("info", "exception_applied", {**data, "reason": exception["reason"]}, ids)

    # 2) zonas e tamanho do deck
    by_zone: dict[str, int] = defaultdict(int)
    for e in entries:
        by_zone[e.zone] += per_entry[e.id]["quantity"]
    allowed = set(rule.get("zones") or [])
    for e in entries:
        if allowed and e.zone not in allowed and per_entry[e.id]["quantity"] > 0:
            add("warning", "zone_not_allowed", {"name": name_of(e), "zone": zone_names.get(e.zone, e.zone)}, [e.id])
    size = rule.get("deck_size") or {}
    size_zones = set(size.get("zones") or ["deck"])
    count = sum(v for z, v in by_zone.items() if z in size_zones)
    totals: dict = {"count": count, "by_zone": dict(by_zone), "size": size or None, "missing": 0, "excess": 0}
    if "exact" in size:
        target = size["exact"]
        if count < target:
            totals["missing"] = target - count
            add("error", "deck_size_missing", {"missing": target - count, "count": count, "target": target})
        elif count > target:
            totals["excess"] = count - target
            add("error", "deck_size_excess", {"excess": count - target, "count": count, "target": target})
    if "min" in size and count < size["min"]:
        totals["missing"] = size["min"] - count
        add("error", "deck_size_min_missing", {"missing": size["min"] - count, "count": count, "target": size["min"]})
    if "max" in size and count > size["max"]:
        totals["excess"] = count - size["max"]
        add("error", "deck_size_max_excess", {"excess": count - size["max"], "count": count, "target": size["max"]})
    for zone, lim in (rule.get("zone_limits") or {}).items():
        zc = by_zone.get(zone, 0)
        if "max" in lim and zc > lim["max"]:
            add("error", "zone_max_excess", {"zone": zone_names.get(zone, zone), "count": zc, "max": lim["max"]})

    # 3) legalidade (dado da fonte: banida / não legal)
    legality_key = rule.get("legality_key")
    legality_field = rule.get("legality_field", "legalities")
    if legality_key:
        for e in entries:
            if per_entry[e.id]["quantity"] <= 0:
                continue
            status = predicates.get_field(card_of(e), f"{legality_field}.{legality_key}")
            code = {"banned": "banned", "not_legal": "not_legal"}.get(status or "")
            if code:
                add("error", code, {"name": name_of(e)}, [e.id])
                per_entry[e.id]["warnings"].append(msg.render(code, {"format": fmt_name, "name": name_of(e)}))

    # 4) comandante
    commander_info = None
    reference_identity: set | None = None
    cmd_rule = rule.get("commander")
    if cmd_rule:
        commanders = [e for e in entries if e.is_commander and per_entry[e.id]["quantity"] > 0]
        commander_info = {"entry_ids": [e.id for e in commanders], "valid": True, "pairing": None, "identity": []}
        if not commanders and rule.get("requires_commander"):
            add("error", "commander_missing", {})
            commander_info["valid"] = False
        if len(commanders) > cmd_rule.get("max", 1):
            add("error", "commander_too_many", {"max": cmd_rule.get("max", 1)}, [e.id for e in commanders])
            commander_info["valid"] = False
        granted: set[str] = set()
        if len(commanders) == 2:
            ok, pair_name, granted = _check_pairing(cmd_rule.get("pairing") or [], commanders, card_of)
            commander_info["pairing"] = pair_name
            if not ok:
                add("error", "commander_pairing_invalid", {"names": " + ".join(name_of(e) for e in commanders)},
                    [e.id for e in commanders])
                commander_info["valid"] = False
        for e in commanders:
            ok, _ = predicates.evaluate(cmd_rule.get("eligibility"), card_of(e))
            if not ok and e.id not in granted:
                add("error", "commander_ineligible", {"name": name_of(e)}, [e.id])
                commander_info["valid"] = False
            if per_entry[e.id]["quantity"] > 1:
                add("error", "commander_quantity", {"name": name_of(e)}, [e.id])
        ident = rule.get("identity") if rule.get("enforces_color_identity") else None
        if ident and commanders:
            field = ident["field"]
            reference_identity = set()
            for e in commanders:
                reference_identity |= set(predicates.get_field(card_of(e), field) or [])
            order = ident.get("order") or sorted(reference_identity)
            commander_info["identity"] = [v for v in order if v in reference_identity]
            ident_zones = set(ident.get("zones") or size_zones)
            for e in entries:
                if e.is_commander or e.zone not in ident_zones or per_entry[e.id]["quantity"] <= 0:
                    continue
                vals = set(predicates.get_field(card_of(e), field) or [])
                if not vals <= reference_identity:
                    data = {"name": name_of(e), "card_identity": "".join(v for v in order if v in vals) or "∅",
                            "identity": "".join(commander_info["identity"]) or "incolor"}
                    add("error", "identity_violation", data, [e.id])
                    per_entry[e.id]["warnings"].append(msg.render("identity_violation", {"format": fmt_name, **data}))

    # 5) sugestões (providers do adapter, parametrizados pelo JSON)
    suggestions: dict[str, dict] = {}
    for spec in rule.get("suggestions") or []:
        provider = (suggestion_providers or {}).get(spec["type"])
        if provider is None:
            continue
        suggestions[spec["type"]] = provider(rule=rule, params=spec, entries=entries, per_entry=per_entry,
                                             cards=cards, totals=totals, commander_identity=reference_identity)

    severity_rank = {"error": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda i: severity_rank.get(i["severity"], 9))
    return {
        "format_id": rule["id"],
        "format_name": fmt_name,
        "valid": not any(i["severity"] == "error" for i in issues),
        "totals": totals,
        "entries": per_entry,
        "issues": issues,
        "commander": commander_info,
        "suggestions": suggestions,
    }


def _check_pairing(pairing: list[dict], commanders: list[EngineEntry],
                   card_of: Callable[[EngineEntry], dict]) -> tuple[bool, str | None, set[str]]:
    a, b = commanders
    for rule in pairing:
        if "both" in rule:
            if predicates.evaluate(rule["both"], card_of(a))[0] and predicates.evaluate(rule["both"], card_of(b))[0]:
                return True, rule.get("name"), set()
            continue
        for x, y in ((a, b), (b, a)):
            ok_x, caps = predicates.evaluate(rule.get("a"), card_of(x))
            if not ok_x:
                continue
            ok_y = predicates.evaluate(rule["b"], card_of(y))[0] if rule.get("b") else True
            capture = rule.get("b_name_equals_capture")
            if ok_y and capture:
                expected = _norm(caps.get(capture, ""))
                names = {_norm(card_of(y).get("name", ""))} | {_norm(n) for n in card_of(y).get("face_names") or []}
                ok_y = expected in names
            if ok_y:
                return True, rule.get("name"), ({y.id} if rule.get("grants_eligibility_to_b") else set())
    return False, None, set()
