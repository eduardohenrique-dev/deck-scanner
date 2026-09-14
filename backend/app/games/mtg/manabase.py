"""Sugestão de terrenos básicos (provider 'mtg_basic_lands', parametrizado pelo JSON do formato).

1. Conta pips coloridos das cartas não-terreno (híbrido/phyrexiano valem meio).
2. Conta fontes já existentes por cor: terrenos (inclusive básicos já no deck) e artefatos de mana.
3. Define a meta de fontes por cor = max(piso, fatia de pips × total de fontes após os básicos).
   Piso maior para cores usadas em custos de turno 1–2.
4. Distribui os básicos pelo DÉFICIT (meta − fontes existentes), não pela proporção bruta de pips:
   cores já bem servidas por duais recebem menos básicos.
5. Devolve o raciocínio por cor, não só o número.
"""
from __future__ import annotations

import math
import re

COLORS = ["W", "U", "B", "R", "G"]
BASIC_BY_COLOR = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest", "C": "Wastes"}
COLOR_WORDS = {
    "W": ("branca", "brancas"), "U": ("azul", "azuis"), "B": ("preta", "pretas"),
    "R": ("vermelha", "vermelhas"), "G": ("verde", "verdes"), "C": ("incolor", "incolores"),
}
BASIC_RX = re.compile(r"\bBasic\b.*\bLand\b")
SYMBOL_RX = re.compile(r"\{([^}]+)\}")


def count_pips(mana_cost: str) -> dict[str, float]:
    out = {c: 0.0 for c in COLORS}
    for sym in SYMBOL_RX.findall(mana_cost or ""):
        parts = sym.upper().split("/")
        colored = [p for p in parts if p in COLORS]
        if not colored:
            continue
        if "P" in parts or any(p.isdigit() for p in parts):
            weight = 0.5
        else:
            weight = 1.0 / len(colored)
        for c in colored:
            out[c] += weight
    return out


def largest_remainder(weights: dict[str, float], total: int) -> dict[str, int]:
    keys = list(weights)
    s = sum(max(w, 0.0) for w in weights.values())
    if total <= 0 or not keys:
        return {k: 0 for k in keys}
    if s <= 0:
        weights = {k: 1.0 for k in keys}
        s = float(len(keys))
    raw = {k: total * max(weights[k], 0.0) / s for k in keys}
    base = {k: int(math.floor(v)) for k, v in raw.items()}
    for k in sorted(keys, key=lambda k: raw[k] - base[k], reverse=True)[: total - sum(base.values())]:
        base[k] += 1
    return base


def suggest_basic_lands(*, rule: dict, params: dict, entries: list, per_entry: dict, cards: dict, totals: dict,
                        commander_identity: set | None, **_) -> dict:
    size = rule.get("deck_size") or {}
    target = size.get("exact") or size.get("min")
    if not target:
        return {"applicable": False, "reason": "formato sem tamanho de deck"}
    zones = set(size.get("zones") or ["deck"])
    deficit = target - totals["count"]
    if deficit <= 0:
        return {"applicable": False, "reason": "o deck já tem o número de cartas do formato"}

    pips = {c: 0.0 for c in COLORS}
    early = {c: False for c in COLORS}
    existing = {c: 0.0 for c in COLORS}
    lands = 0
    art_weight = float(params.get("artifact_source_weight", 1.0))
    creature_weight = float(params.get("creature_source_weight", 0.0))
    for e in entries:
        qty = per_entry[e.id]["quantity"]
        if qty <= 0 or e.zone not in zones:
            continue
        card = cards.get(e.card_ref_id) or {}
        front = card.get("front_type_line") or card.get("type_line") or ""
        produced = [c for c in card.get("produced_mana") or [] if c in COLORS]
        if "Land" in front:
            lands += qty
            for c in produced:
                existing[c] += qty
            continue
        p = count_pips(card.get("mana_cost") or "")
        for c in COLORS:
            if p[c] > 0:
                pips[c] += p[c] * qty
                if (card.get("cmc") or 0) <= 2:
                    early[c] = True
        weight = art_weight if "Artifact" in front and "Creature" not in front else (
            creature_weight if "Creature" in front else 0.0)
        for c in produced:
            existing[c] += qty * weight

    colors = [c for c in COLORS if pips[c] > 0]
    if commander_identity is not None:
        colors = [c for c in colors if c in commander_identity]
    land_target = int(params.get("land_count", 0))
    to_add = min(deficit, max(0, land_target - lands))
    if to_add <= 0:
        return {"applicable": False, "reason": f"já há {lands} terrenos (meta {land_target}); "
                                               f"faltam {deficit} cartas não-terreno"}
    if not colors:
        if commander_identity is not None and not commander_identity:
            return {"applicable": True, "deficit": deficit, "basics_to_add": to_add, "remaining_nonland": deficit - to_add,
                    "land_target": land_target, "lands_now": lands,
                    "by_color": [{"color": "C", "basic": "Wastes", "add": to_add, "pips": 0, "share": 1,
                                  "existing_sources": 0, "target_sources": to_add, "final_sources": to_add,
                                  "early": False}],
                    "summary": f"{to_add} fontes incolores", "reasoning": ["Comandante incolor: Wastes."]}
        return {"applicable": False, "reason": "ainda não há custos coloridos para calcular a distribuição"}

    total_pips = sum(pips[c] for c in colors)
    share = {c: pips[c] / total_pips for c in colors}
    sources_after = sum(existing[c] for c in colors) + to_add
    floors = {c: float(params.get("min_sources_early" if early[c] else "min_sources_any", 0)) for c in colors}
    target_sources = {c: max(floors[c], share[c] * sources_after) for c in colors}
    need = {c: max(0.0, target_sources[c] - existing[c]) for c in colors}
    alloc = largest_remainder(need if sum(need.values()) > 0 else share, to_add)
    final = {c: existing[c] + alloc[c] for c in colors}

    by_color = []
    reasoning = []
    for c in sorted(colors, key=lambda k: -final[k]):
        by_color.append({
            "color": c, "basic": BASIC_BY_COLOR[c], "add": alloc[c], "pips": round(pips[c], 1),
            "share": round(share[c], 3), "existing_sources": round(existing[c], 1),
            "target_sources": round(target_sources[c], 1), "final_sources": round(final[c], 1), "early": early[c],
        })
        reasoning.append(
            f"{COLOR_WORDS[c][0].capitalize()}: {pips[c]:.0f} pips ({share[c]:.0%})"
            f"{', custo de turno 1–2' if early[c] else ''} · {existing[c]:.0f} fontes já no deck"
            f" · meta {target_sources[c]:.0f} → +{alloc[c]} {BASIC_BY_COLOR[c]}"
        )
    summary = " / ".join(f"{final[c]:.0f} fontes {COLOR_WORDS[c][1]}" for c in sorted(colors, key=lambda k: -final[k]))
    if deficit > to_add:
        reasoning.append(f"Depois dos {to_add} básicos ainda faltam {deficit - to_add} cartas não-terreno "
                         f"(meta de {land_target} terrenos).")
    return {
        "applicable": True, "deficit": deficit, "basics_to_add": to_add, "remaining_nonland": deficit - to_add,
        "land_target": land_target, "lands_now": lands, "by_color": by_color, "summary": summary,
        "reasoning": reasoning,
    }
