"""Leitura de listas em texto (Moxfield, Archidekt, MTG Arena, LigaMagic, lista corrida em PT ou EN)."""
from __future__ import annotations

import re
from dataclasses import dataclass

SECTION_ALIASES = {
    "commander": "commander", "commanders": "commander", "comandante": "commander", "comandantes": "commander",
    "deck": "deck", "main": "deck", "maindeck": "deck", "mainboard": "deck", "companion": "sideboard",
    "sideboard": "sideboard", "side": "sideboard", "maybeboard": "maybeboard", "maybe": "maybeboard",
    "talvez": "maybeboard", "considering": "maybeboard",
}
LINE_RE = re.compile(
    r"^\s*(?:(?P<qty>\d+)\s*x?\s+)?(?P<name>.+?)"
    r"(?:\s+[\(\[](?P<set>[A-Za-z0-9]{2,6})[\)\]](?:\s+(?P<number>[A-Za-z0-9★\-]+))?)?"
    r"(?P<flags>(?:\s+\*[A-Za-z]\*|\s+\[[^\]]*\]|\s+\^[^^]*\^)*)\s*$")


@dataclass
class ParsedLine:
    line_no: int
    raw: str
    quantity: int
    name: str
    set_code: str | None
    collector_number: str | None
    finish: str
    zone: str
    is_commander: bool


def parse(text: str) -> list[ParsedLine]:
    zone = "deck"
    out: list[ParsedLine] = []
    for i, raw in enumerate((text or "").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith(("#", "//")) and not SECTION_ALIASES.get(line.strip("/# :").lower()):
            continue
        header = line.strip("/# :").lower()
        if header in SECTION_ALIASES and not re.match(r"^\d", line):
            zone = SECTION_ALIASES[header]
            continue
        if header in ("about", "name") or line.lower().startswith("name "):
            continue
        m = LINE_RE.match(line)
        if not m or not m.group("name"):
            continue
        flags = m.group("flags") or ""
        finish = "etched" if "*E*" in flags else "foil" if "*F*" in flags else "nonfoil"
        is_commander = "[commander" in flags.lower() or zone == "commander"
        out.append(ParsedLine(
            line_no=i, raw=raw, quantity=int(m.group("qty") or 1), name=m.group("name").strip(),
            set_code=(m.group("set") or "").lower() or None, collector_number=m.group("number"), finish=finish,
            zone="commander" if is_commander else zone, is_commander=is_commander))
    return out
