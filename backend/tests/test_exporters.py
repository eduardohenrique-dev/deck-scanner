"""Exportadores: formatos de linha aceitos por LigaMagic, Moxfield, Archidekt, MTG Arena e CSV."""
from __future__ import annotations

import csv
import io

from app.games.mtg import exporters


def entry(name, qty=1, zone="deck", commander=False, set_code="c21", number="263", finish="nonfoil",
          type_line="Artifact", name_pt=None, layout="normal", front=None, games=("paper", "arena"), lang="en"):
    return {"quantity": qty, "zone": zone, "is_commander": commander, "name_en": name, "front_name_en": front,
            "name_pt": name_pt, "set_code": set_code, "collector_number": number, "language": lang, "finish": finish,
            "front_type_line": type_line, "layout": layout, "price_usd": 1.5, "condition": None,
            "games": list(games), "card_ref_id": f"id-{name}", "position": 0}


DECK = [
    entry("Atraxa, Praetors' Voice", commander=True, set_code="2x2", number="190", type_line="Legendary Creature — Phyrexian Angel Horror"),
    entry("Sol Ring", name_pt="Anel Solar"),
    entry("Sol Ring", set_code="cmm", number="410", name_pt="Anel Solar", finish="foil"),
    entry("Forest", qty=10, set_code="blb", number="280", type_line="Basic Land — Forest", name_pt="Floresta"),
    entry("Delver of Secrets // Insectile Aberration", layout="transform", front="Delver of Secrets", set_code="isd",
          number="51", type_line="Creature — Human Wizard", games=("paper",)),
    entry("Fire // Ice", layout="split", set_code="mh2", number="290", type_line="Instant // Instant", zone="sideboard"),
]


def test_ligamagic_merges_prints_and_supports_portuguese():
    text = exporters.export_ligamagic(DECK, {"lang": "pt"})
    lines = text.strip().splitlines()
    assert lines[0] == "1 Atraxa, Praetors' Voice"
    assert "2 Anel Solar" in lines                       # duas impressões da mesma carta numa linha só
    assert "10 Floresta" in lines
    assert "1 Delver of Secrets" in lines                 # dupla face: nome da face frontal
    assert lines[-2:] == ["Sideboard", "1 Fire // Ice"]   # split mantém "A // B"
    en = exporters.export_ligamagic(DECK, {"lang": "en"})
    assert "2 Sol Ring" in en.splitlines()


def test_moxfield_lines_have_set_number_and_finish_markers():
    text = exporters.export_moxfield(DECK, {})
    blocks = text.strip().split("\n\n")
    assert blocks[0] == "Commander\n1 Atraxa, Praetors' Voice (2X2) 190"
    deck = blocks[1].splitlines()
    assert deck[0] == "Deck"
    assert "1 Sol Ring (C21) 263" in deck
    assert "1 Sol Ring (CMM) 410 *F*" in deck
    assert "10 Forest (BLB) 280" in deck
    assert blocks[2].splitlines() == ["Sideboard", "1 Fire // Ice (MH2) 290"]


def test_archidekt_categories():
    text = exporters.export_archidekt(DECK, {"group": True})
    assert "1x Atraxa, Praetors' Voice (2x2) 190 [Commander{top}]" in text
    assert "1x Fire // Ice (mh2) 290 [Sideboard]" in text
    assert "10x Forest (blb) 280 [Terrenos]" in text


def test_arena_sections_and_non_arena_cards():
    text = exporters.export_arena(DECK, {"arena_set_codes": {"dom": "DAR"}})
    assert text.startswith("Commander\n1 Atraxa, Praetors' Voice (2X2) 190\n\nDeck\n")
    assert "1 Delver of Secrets\n" in text or text.rstrip().endswith("1 Delver of Secrets") or "\n1 Delver of Secrets" in text
    arena_dom = exporters.export_arena([entry("Llanowar Elves", set_code="dom", number="168")], {"arena_set_codes": {"dom": "DAR"}})
    assert "1 Llanowar Elves (DAR) 168" in arena_dom


def test_csv_columns():
    text = exporters.export_csv(DECK, {})
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0][:8] == ["nome", "set", "número", "idioma", "foil", "condição", "quantidade", "preço estimado (USD)"]
    foil = next(r for r in rows[1:] if r[1] == "CMM")
    assert foil[4] == "foil" and foil[6] == "1" and foil[7] == "1.50"


def test_grouping_by_type_orders_creatures_before_lands():
    text = exporters.export_moxfield(DECK, {"group": True})
    deck = text.split("Deck\n")[1].split("\n\n")[0].splitlines()
    assert deck.index("1 Delver of Secrets (ISD) 51") < deck.index("10 Forest (BLB) 280")
