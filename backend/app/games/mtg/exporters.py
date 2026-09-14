"""Exportadores de lista para MTG.

Cada entrada de exportação é um dict com: quantity, zone, is_commander, name_en, front_name_en,
name_pt, set_code, collector_number, language, finish, front_type_line, layout, price_usd,
condition, games, card_ref_id.
"""
from __future__ import annotations

import csv
import io
import time

EXPORTERS = [
    {"id": "ligamagic", "name": "LigaMagic / genérico", "extension": "txt", "supports_grouping": True,
     "example": "1 Anel Solar", "options": {"lang": ["en", "pt"]}},
    {"id": "moxfield", "name": "Moxfield", "extension": "txt", "supports_grouping": True,
     "example": "1 Sol Ring (C21) 263"},
    {"id": "archidekt", "name": "Archidekt", "extension": "txt", "supports_grouping": True,
     "example": "1x Sol Ring (c21) 263 [Commander{top}]"},
    {"id": "arena", "name": "MTG Arena", "extension": "txt", "supports_grouping": True,
     "example": "Deck\n1 Sol Ring (C21) 263"},
    {"id": "csv", "name": "CSV de coleção", "extension": "csv", "supports_grouping": False,
     "example": "nome,set,número,idioma,foil,condição,quantidade,preço estimado"},
]

TYPE_GROUPS = [
    ("Land", "Terrenos"), ("Creature", "Criaturas"), ("Planeswalker", "Planeswalkers"), ("Battle", "Batalhas"),
    ("Instant", "Mágicas instantâneas"), ("Sorcery", "Feitiços"), ("Artifact", "Artefatos"),
    ("Enchantment", "Encantamentos"),
]
TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"]
FRONT_FACE_LAYOUTS = {"transform", "modal_dfc", "flip", "adventure", "meld", "reversible_card", "prepare", "double_faced_token"}


def type_group(front_type_line: str) -> str:
    t = front_type_line or ""
    for key, _ in TYPE_GROUPS:  # "Land" primeiro: Artifact Land conta como terreno
        if key == "Land" and "Land" in t:
            return "Land"
        if key != "Land" and key in t:
            return key
    return "Other"


def display_name(e: dict, lang: str = "en") -> str:
    if lang == "pt" and e.get("name_pt"):
        return e["name_pt"]
    if e.get("layout") in FRONT_FACE_LAYOUTS and e.get("front_name_en"):
        return e["front_name_en"]
    return e["name_en"]


def _sorted(entries: list[dict], group: bool) -> list[dict]:
    if group:
        return sorted(entries, key=lambda e: (TYPE_ORDER.index(type_group(e.get("front_type_line", ""))),
                                              e["name_en"]))
    return sorted(entries, key=lambda e: e.get("position", 0))


def _zones(entries: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    active = [e for e in entries if e["quantity"] > 0 and e["zone"] != "maybeboard"]
    commanders = [e for e in active if e["is_commander"] or e["zone"] == "commander"]
    side = [e for e in active if e["zone"] == "sideboard" and e not in commanders]
    main = [e for e in active if e not in commanders and e not in side]
    return commanders, main, side


def _finish_marker(e: dict) -> str:
    return {"foil": " *F*", "etched": " *E*"}.get(e.get("finish") or "", "")


def _set_number(e: dict, arena_codes: dict | None = None) -> str:
    code = (e.get("set_code") or "").lower()
    if arena_codes:
        code = arena_codes.get(code, code)
    return f"({code.upper()}) {e.get('collector_number')}"


def export_ligamagic(entries: list[dict], options: dict) -> str:
    lang = options.get("lang", "en")
    commanders, main, side = _zones(entries)
    lines: list[str] = [f"{e['quantity']} {display_name(e, lang)}" for e in commanders]
    if commanders:
        lines.append("")
    last_group = None
    for e in _sorted(main, options.get("group", False)):
        g = type_group(e.get("front_type_line", ""))
        if options.get("group") and last_group is not None and g != last_group:
            lines.append("")
        last_group = g
        lines.append(f"{e['quantity']} {display_name(e, lang)}")
    if side:
        lines += ["", "Sideboard"] + [f"{e['quantity']} {display_name(e, lang)}" for e in _sorted(side, options.get("group", False))]
    return "\n".join(lines).strip() + "\n"


def export_moxfield(entries: list[dict], options: dict) -> str:
    commanders, main, side = _zones(entries)

    def line(e: dict) -> str:
        return f"{e['quantity']} {display_name(e)} {_set_number(e)}{_finish_marker(e)}"

    blocks = []
    if commanders:
        blocks.append("Commander\n" + "\n".join(line(e) for e in commanders))
    blocks.append("Deck\n" + "\n".join(line(e) for e in _sorted(main, options.get("group", False))))
    if side:
        blocks.append("Sideboard\n" + "\n".join(line(e) for e in _sorted(side, options.get("group", False))))
    return "\n\n".join(blocks) + "\n"


def export_archidekt(entries: list[dict], options: dict) -> str:
    commanders, main, side = _zones(entries)
    group_names = dict(TYPE_GROUPS)

    def line(e: dict, category: str | None) -> str:
        cat = f" [{category}]" if category else ""
        return (f"{e['quantity']}x {display_name(e)} ({(e.get('set_code') or '').lower()}) "
                f"{e.get('collector_number')}{_finish_marker(e)}{cat}")

    lines = [line(e, "Commander{top}") for e in commanders]
    for e in _sorted(main, options.get("group", False)):
        category = group_names.get(type_group(e.get("front_type_line", ""))) if options.get("group") else None
        lines.append(line(e, category))
    lines += [line(e, "Sideboard") for e in _sorted(side, options.get("group", False))]
    return "\n".join(lines) + "\n"


def export_arena(entries: list[dict], options: dict) -> str:
    arena_codes = options.get("arena_set_codes") or {}
    commanders, main, side = _zones(entries)

    def line(e: dict) -> str:
        if "arena" in (e.get("games") or []):
            return f"{e['quantity']} {display_name(e)} {_set_number(e, arena_codes)}"
        return f"{e['quantity']} {display_name(e)}"

    blocks = []
    if commanders:
        blocks.append("Commander\n" + "\n".join(line(e) for e in commanders))
    blocks.append("Deck\n" + "\n".join(line(e) for e in _sorted(main, options.get("group", False))))
    if side:
        blocks.append("Sideboard\n" + "\n".join(line(e) for e in _sorted(side, options.get("group", False))))
    return "\n\n".join(blocks) + "\n"


def export_csv(entries: list[dict], options: dict) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["nome", "set", "número", "idioma", "foil", "condição", "quantidade", "preço estimado (USD)",
                     "nome_pt", "zona", "scryfall_id"])
    for e in sorted(entries, key=lambda x: x.get("position", 0)):
        if e["quantity"] <= 0:
            continue
        price = e.get("price_usd")
        writer.writerow([
            display_name(e), (e.get("set_code") or "").upper(), e.get("collector_number"), e.get("language") or "en",
            {"foil": "foil", "etched": "etched"}.get(e.get("finish") or "", ""), e.get("condition") or "",
            e["quantity"], f"{price:.2f}" if isinstance(price, (int, float)) else "", e.get("name_pt") or "",
            e.get("zone"), e.get("card_ref_id"),
        ])
    return buf.getvalue()


FUNCS = {
    "ligamagic": export_ligamagic,
    "moxfield": export_moxfield,
    "archidekt": export_archidekt,
    "arena": export_arena,
    "csv": export_csv,
}


def export(export_id: str, entries: list[dict], options: dict, deck_name: str = "deck") -> tuple[str, str, str]:
    if export_id not in FUNCS:
        raise KeyError(f"exportador desconhecido: {export_id}")
    text = FUNCS[export_id](entries, options)
    meta = next(x for x in EXPORTERS if x["id"] == export_id)
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in deck_name).strip("-") or "deck"
    filename = f"{safe}-{export_id}-{time.strftime('%Y%m%d')}.{meta['extension']}"
    mime = "text/csv" if meta["extension"] == "csv" else "text/plain"
    return text, filename, mime
