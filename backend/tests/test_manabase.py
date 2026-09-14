"""Sugestão de terrenos: pips, déficit por cor e raciocínio exibido."""
from __future__ import annotations

from app.games.mtg import manabase
from app.rules.engine import EngineEntry


def test_count_pips_hybrid_and_phyrexian():
    assert manabase.count_pips("{2}{W}{W}") == {"W": 2, "U": 0, "B": 0, "R": 0, "G": 0}
    p = manabase.count_pips("{W/U}{B/P}{2/R}")
    assert p["W"] == 0.5 and p["U"] == 0.5 and p["B"] == 0.5 and p["R"] == 0.5


def test_largest_remainder_sums_exactly():
    alloc = manabase.largest_remainder({"W": 3.3, "B": 3.3, "R": 3.4}, 10)
    assert sum(alloc.values()) == 10


def _card(type_line, mana_cost="", cmc=0, produced=()):
    return {"type_line": type_line, "front_type_line": type_line, "mana_cost": mana_cost, "cmc": cmc,
            "produced_mana": list(produced), "layout": "normal"}


def test_duals_reduce_basics_for_the_served_color():
    rule = {"deck_size": {"exact": 40, "zones": ["deck"]}}
    cards = {
        "b1": _card("Creature", "{B}{B}", 2), "b2": _card("Instant", "{1}{B}", 2), "b3": _card("Sorcery", "{2}{B}{B}", 4),
        "r1": _card("Creature", "{1}{R}", 2), "r2": _card("Instant", "{R}", 1),
        "dual": _card("Land", produced=("B", "R")),
    }
    entries = [EngineEntry(id=k, card_ref_id=k, key=k, zone="deck", quantity_detected=q)
               for k, q in (("b1", 4), ("b2", 4), ("b3", 3), ("r1", 4), ("r2", 4), ("dual", 4))]
    per_entry = {e.id: {"quantity": e.quantity_detected} for e in entries}
    totals = {"count": sum(e.quantity_detected for e in entries)}
    params = {"land_count": 17, "min_sources_early": 9, "min_sources_any": 7}
    sug = manabase.suggest_basic_lands(rule=rule, params=params, entries=entries, per_entry=per_entry, cards=cards,
                                       totals=totals, commander_identity=None)
    assert sug["applicable"] and sug["basics_to_add"] == 13
    by = {c["color"]: c for c in sug["by_color"]}
    assert by["B"]["add"] + by["R"]["add"] == 13
    assert by["B"]["add"] > by["R"]["add"]          # mais pips pretos
    assert by["B"]["existing_sources"] == 4 and by["R"]["existing_sources"] == 4
    assert "fontes pretas" in sug["summary"] and sug["reasoning"]
