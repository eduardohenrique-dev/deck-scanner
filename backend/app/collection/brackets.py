"""Classificação de bracket de Commander (1 a 5) a partir de regras em dados (rules/mtg/brackets.json).

Conta Game Changers (lista versionada), destruição de terrenos em massa, turnos extras e combos
infinitos de 2 cartas (Commander Spellbook) e escolhe o menor bracket cujos limites o deck respeita.
Brackets 1 e 5 dependem da intenção do deck (tema, metagame competitivo): o sistema aponta, não decide.
"""
from __future__ import annotations

import re
from functools import lru_cache

from ..games import registry
from ..games.mtg.adapter import normalize_name
from ..rules import predicates
from . import spellbook


def _names_of(fields: dict) -> set[str]:
    names = {normalize_name(fields.get("name") or "")}
    names |= {normalize_name(n) for n in fields.get("face_names") or []}
    return {n for n in names if n}


@lru_cache(maxsize=64)
def _compiled(patterns: tuple[str, ...]) -> tuple[re.Pattern, ...]:
    return tuple(re.compile(p) for p in patterns)


def _tagger(adapter, tag: dict):
    listed: set[str] = set()
    patterns: tuple[re.Pattern, ...] = ()
    if tag.get("list"):
        data = adapter.data_file(tag["list"]) or {}
        for n in data.get("cards", []):
            listed.add(normalize_name(n))
            listed |= {normalize_name(part) for part in n.split(" // ")}
        patterns = _compiled(tuple(data.get("patterns", [])))
    match = tag.get("match")

    def applies(fields: dict) -> bool:
        if listed and _names_of(fields) & listed:
            return True
        text = fields.get("oracle_text") or ""
        if any(p.search(text) for p in patterns):
            return True
        return bool(match) and predicates.evaluate(match, fields)[0]

    return applies


def classify(game_id: str, entries: list[dict], use_spellbook: bool = True) -> dict | None:
    """entries: {card_ref_id, quantity, zone, is_commander}."""
    adapter = registry.get(game_id)
    rules = adapter.rules_file("brackets.json")
    if not rules:
        return None
    rows = [e for e in entries if e.get("quantity", 0) > 0 and e.get("zone") != "maybeboard"]
    fields = adapter.card_fields_many([e["card_ref_id"] for e in rows])
    taggers = {tid: _tagger(adapter, t) for tid, t in rules["tags"].items()}
    tagged: dict[str, list[str]] = {tid: [] for tid in taggers}
    seen: set[str] = set()
    commanders, main = [], []
    for e in rows:
        f = fields.get(e["card_ref_id"])
        if not f:
            continue
        name = f["name"]
        if e.get("is_commander"):
            commanders.append(name)
        else:
            main.append((name, int(e["quantity"])))
        if f["key"] in seen:
            continue
        seen.add(f["key"])
        for tid, applies in taggers.items():
            if applies(f):
                tagged[tid].append(name)

    combos_cfg = rules.get("combos") or {}
    combos = {"checked": False, "two_card": [], "early_two_card": [], "attribution": combos_cfg.get("attribution"),
              "attribution_url": combos_cfg.get("attribution_url")}
    if use_spellbook and combos_cfg.get("source") == "commander_spellbook":
        est = spellbook.estimate_bracket(commanders, main)
        if est is not None:
            combos["checked"] = True
            early_tags = set(combos_cfg.get("early_game_tags") or [])
            for c in est["combos"]:
                two = c["definitely_two_card"] or (combos_cfg.get("count_arguable") and c["arguably_two_card"])
                if not (two and c["relevant"]):
                    continue
                item = {"cards": c["cards"], "produces": c["produces"], "tag": c["tag"],
                        "arguable": not c["definitely_two_card"]}
                combos["two_card"].append(item)
                if c["tag"] in early_tags:
                    combos["early_two_card"].append(item)

    counts = {tid: len(names) for tid, names in tagged.items()}
    counts["two_card_combo"] = len(combos["two_card"])
    counts["early_two_card_combo"] = len(combos["early_two_card"])

    def fails(bracket: dict) -> list[str]:
        out = []
        for key, limit in (bracket.get("limits") or {}).items():
            if key in ("two_card_combo", "early_two_card_combo") and not combos["checked"]:
                continue
            if counts.get(key, 0) > limit:
                label = rules["tags"].get(key, {}).get("label") or combos_cfg.get("label") or key
                out.append(f"{counts[key]} × {label.lower()} (limite {limit})")
        return out

    brackets = rules["brackets"]
    evaluated = [{"id": b["id"], "name": b["name"], "name_en": b["name_en"], "fails": fails(b),
                  "needs_intent": bool(b.get("needs_intent"))} for b in brackets]
    candidates = [b for b in evaluated if not b["fails"] and not b["needs_intent"]]
    chosen = min(candidates, key=lambda b: b["id"]) if candidates else max(evaluated, key=lambda b: b["id"])
    notes = []
    exhibition = next((b for b in evaluated if b["id"] == 1), None)
    if exhibition and not exhibition["fails"] and chosen["id"] == 2:
        notes.append("Também cabe no bracket 1 (Exibição) se o deck for temático e casual — depende da intenção.")
    if chosen["id"] == 4:
        notes.append("Bracket 5 (cEDH) depende da intenção competitiva, não só das cartas.")
    if not combos["checked"]:
        notes.append("Combos de 2 cartas não verificados (Commander Spellbook indisponível).")

    gc = counts.get("game_changer", 0)
    parts = [f"bracket {chosen['id']}", f"{gc} Game Changer{'s' if gc != 1 else ''}"]
    if combos["checked"]:
        n = counts["two_card_combo"]
        parts.append("sem combo infinito de 2 cartas" if n == 0 else f"{n} combo{'s' if n != 1 else ''} de 2 cartas")
    if counts.get("mass_land_denial"):
        parts.append(f"{counts['mass_land_denial']} destruição de terrenos em massa")
    if counts.get("extra_turn"):
        parts.append(f"{counts['extra_turn']} turno{'s' if counts['extra_turn'] != 1 else ''} extra{'s' if counts['extra_turn'] != 1 else ''}")
    below = [b for b in evaluated if b["id"] < chosen["id"] and not b["needs_intent"]]
    reasons = [f"Acima do bracket {b['id']} ({b['name']}): " + "; ".join(b["fails"]) for b in below if b["fails"]]
    return {
        "bracket": chosen["id"], "name": chosen["name"], "name_en": chosen["name_en"],
        "headline": ", ".join(parts), "counts": counts, "cards": tagged, "combos": combos,
        "reasons": reasons, "notes": notes, "brackets": evaluated,
        "source": {"rules": rules.get("version"), "game_changers": (adapter.data_file("game_changers.json") or {}).get("version")},
    }


def applies_to(game_id: str, format_id: str) -> bool:
    rules = registry.get(game_id).rules_file("brackets.json") or {}
    return format_id in (rules.get("formats") or [])
