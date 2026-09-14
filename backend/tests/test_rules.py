"""Motor de regras declarativo contra dados reais da Scryfall (critérios de aceite 3–6)."""
from __future__ import annotations

from app.games import registry
from tests.helpers import evaluate, ref_for


def qty(report, ids, key):
    return report["entries"][ids[key]]["quantity"]


def codes(report):
    return [i["code"] for i in report["issues"]]


def test_commander_singleton_but_basics_and_rats_unlimited():
    """Critério 4: básicos e Relentless Rats não são reduzidos; Sol Ring é."""
    report, ids = evaluate("commander", [
        ("Swamp", 12), ("Relentless Rats", 7), ("Sol Ring", 2), ("Snow-Covered Swamp", 3),
    ])
    assert qty(report, ids, "Swamp||deck") == 12
    assert qty(report, ids, "Relentless Rats||deck") == 7
    assert qty(report, ids, "Snow-Covered Swamp||deck") == 3
    assert qty(report, ids, "Sol Ring||deck") == 1
    warning = next(i for i in report["issues"] if i["code"] == "copy_limit_exceeded")
    assert warning["message"] == "2 cópias de Anel Solar — Commander (EDH) permite 1"


def test_limit_from_text_nazgul_and_seven_dwarves():
    report, ids = evaluate("commander", [("Nazgûl", 11), ("Seven Dwarves", 7)])
    assert qty(report, ids, "Nazgûl||deck") == 9
    assert qty(report, ids, "Seven Dwarves||deck") == 7
    assert any(i["code"] == "copy_limit_exceeded" and "9" in i["message"] for i in report["issues"])


def test_modern_keeps_four_and_warns_on_fifth():
    """Critério 5."""
    report, ids = evaluate("modern", [("Lightning Bolt", 5), ("Mountain", 20)])
    assert qty(report, ids, "Lightning Bolt||deck") == 4
    assert qty(report, ids, "Mountain||deck") == 20
    assert "copy_limit_exceeded" in codes(report)
    assert "copy_limit_violation" not in codes(report)


def test_modern_counts_deck_plus_sideboard():
    report, ids = evaluate("modern", [("Lightning Bolt", 3, "deck"), ("Lightning Bolt", 2, "sideboard")])
    total = qty(report, ids, "Lightning Bolt||deck") + qty(report, ids, "Lightning Bolt||sideboard")
    assert total == 4


def test_collection_reduces_nothing():
    """Critério 6."""
    report, ids = evaluate("collection", [("Sol Ring", 9), ("Lightning Bolt", 13), ("Relentless Rats", 30)])
    assert qty(report, ids, "Sol Ring||deck") == 9
    assert qty(report, ids, "Lightning Bolt||deck") == 13
    assert not [i for i in report["issues"] if i["severity"] in ("error", "warning")]


def test_portuguese_and_english_prints_share_the_singleton():
    """Critério 3 no nível das regras: Desertos Calcinados (PT) + Scoured Barrens (EN) violam o singleton."""
    pt_ref, pt_oracle = ref_for("Desertos Calcinados", lang="pt")
    en_ref, en_oracle = ref_for("Scoured Barrens", lang="en")
    assert pt_ref != en_ref and pt_oracle == en_oracle
    report, ids = evaluate("commander", [("Scoured Barrens", 1, "deck", False, "pt"),
                                         ("Scoured Barrens", 1, "deck", False, "en")])
    total = sum(e["quantity"] for e in report["entries"].values())
    assert total == 1
    assert any(i["code"] == "copy_limit_exceeded" and i["data"]["detected"] == 2 for i in report["issues"])


def test_override_above_limit_is_error_not_silent():
    report, ids = evaluate("commander", [("Sol Ring", 2, "deck", False, None, 2)])
    assert qty(report, ids, "Sol Ring||deck") == 2
    assert "copy_limit_violation" in codes(report)
    assert report["valid"] is False


def test_vintage_restricted_list_from_legalities():
    report, ids = evaluate("vintage", [("Sol Ring", 2), ("Lightning Bolt", 4)])
    assert qty(report, ids, "Sol Ring||deck") == 1
    assert qty(report, ids, "Lightning Bolt||deck") == 4


def test_banned_card_flagged():
    report, _ = evaluate("modern", [("Black Lotus", 1)])
    assert "not_legal" in codes(report) or "banned" in codes(report)


def test_commander_identity_and_eligibility():
    report, ids = evaluate("commander", [
        ("Kaalia of the Vast", 1, "commander", True),
        ("Lightning Bolt", 1), ("Counterspell", 1), ("Sol Ring", 1),
    ])
    violations = [i for i in report["issues"] if i["code"] == "identity_violation"]
    assert len(violations) == 1
    assert "Counterspell" in violations[0]["message"] or "Contramágica" in violations[0]["message"]
    assert report["commander"]["identity"] == ["W", "B", "R"]
    report2, _ = evaluate("commander", [("Sol Ring", 1, "commander", True)])
    assert "commander_ineligible" in codes(report2)


def test_partner_background_and_grist():
    ok_bg, _ = evaluate("commander", [("Wilson, Refined Grizzly", 1, "commander", True),
                                      ("Raised by Giants", 1, "commander", True)])
    assert "commander_ineligible" not in codes(ok_bg) and "commander_pairing_invalid" not in codes(ok_bg)
    grist, _ = evaluate("commander", [("Grist, the Hunger Tide", 1, "commander", True)])
    assert "commander_ineligible" not in codes(grist)
    bad_pair, _ = evaluate("commander", [("Kaalia of the Vast", 1, "commander", True),
                                         ("Atraxa, Praetors' Voice", 1, "commander", True)])
    assert "commander_pairing_invalid" in codes(bad_pair)
    partner_with, _ = evaluate("commander", [("Pir, Imaginative Rascal", 1, "commander", True),
                                             ("Toothy, Imaginary Friend", 1, "commander", True)])
    assert "commander_pairing_invalid" not in codes(partner_with)


def test_deck_size_missing_and_basic_land_suggestion_uses_deficit():
    spec = [("Kaalia of the Vast", 1, "commander", True)]
    spells = ["Lightning Bolt", "Swords to Plowshares", "Doom Blade", "Terminate", "Lightning Helix",
              "Vindicate", "Anguished Unmaking", "Utter End", "Mortify", "Dark Ritual", "Path to Exile",
              "Thoughtseize", "Duress", "Lingering Souls", "Kolaghan's Command"]
    spec += [(s, 1) for s in spells]
    duals = ["Sacred Foundry", "Godless Shrine", "Blood Crypt", "Nomad Outpost", "Savai Triome",
             "Clifftop Retreat", "Isolated Chapel", "Dragonskull Summit", "Command Tower"]
    spec += [(d, 1) for d in duals]
    report, _ = evaluate("commander", spec)
    assert any(i["code"] == "deck_size_missing" for i in report["issues"])
    sug = report["suggestions"]["mtg_basic_lands"]
    assert sug["applicable"]
    assert sug["basics_to_add"] == 37 - len(duals)
    by = {c["color"]: c for c in sug["by_color"]}
    assert set(by) <= {"W", "B", "R"}
    assert sum(c["add"] for c in sug["by_color"]) == sug["basics_to_add"]
    assert "fontes" in sug["summary"]
    # cores servidas por duais recebem menos básicos que a proporção bruta de pips daria
    for c in by.values():
        assert c["final_sources"] >= c["existing_sources"]


def test_formats_are_data_driven():
    adapter = registry.get("mtg")
    formats = adapter.formats()
    assert {"commander", "brawl", "duel", "standard", "pioneer", "modern", "legacy", "pauper", "vintage",
            "limited", "collection"} <= set(formats)
