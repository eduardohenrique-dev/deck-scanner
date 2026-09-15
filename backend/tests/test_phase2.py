"""Fase 2: alocação entre decks, conferência reversa, histórico, impressão impossível, brackets, preços e condição."""
from __future__ import annotations

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config, db
from app.collection import brackets, condition, prices, prints, spellbook
from app.games.mtg import importers
from app.main import app
from app.pipeline import deck as deck_pipeline
from app.pipeline import store
from tests.helpers import ref_for


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def cleanup(client):
    created = {"decks": [], "sessions": [], "locations": [], "cards": []}
    yield created
    for sid in created["sessions"]:
        client.delete(f"/api/sessions/{sid}")
    for did in created["decks"]:
        client.delete(f"/api/decks/{did}")
    if created["cards"]:
        client.post("/api/physical-cards/delete", json={"ids": created["cards"]})
    for lid in created["locations"]:
        client.delete(f"/api/locations/{lid}")


def _deck(client, cleanup, name: str, text: str, format_id: str = "commander") -> dict:
    res = client.post("/api/decks", json={"name": name, "format_id": format_id, "text": text}).json()
    cleanup["decks"].append(res["deck_id"])
    return res


def _fake_scan(session_id: str, cards: list[tuple[str, str | None]]) -> None:
    """Detecções identificadas como se tivessem vindo do vídeo: (nome, idioma)."""
    cap = store.add_capture(session_id, "live", None, "teste", status="done")
    for name, lang in cards:
        ref, oracle = ref_for(name)
        store.insert_detection_seq(session_id, cap["id"], status="identified", card_ref_id=ref, oracle_id=oracle,
                                   language=lang or "en", finish="nonfoil", confidence=0.97, source="phash",
                                   notes=[], quality={"kind": "full"})
    deck_pipeline.rebuild(session_id)


# ---------------------------------------------------------------- critério 10
def test_allocation_conflict_between_decks(client, cleanup):
    a = _deck(client, cleanup, "Atraxa (teste)", "Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring")
    b = _deck(client, cleanup, "Kaalia (teste)", "Commander\n1 Kaalia of the Vast\nDeck\n1 Sol Ring")
    sol, _ = ref_for("Sol Ring")
    ids = client.post("/api/physical-cards", json={"card_ref_id": sol}).json()["ids"]
    cleanup["cards"] += ids

    r = client.post(f"/api/decks/{a['deck_id']}/allocate", json={"physical_card_id": ids[0]})
    assert r.status_code == 200
    item_a = next(i for i in r.json()["state"]["allocation"]["items"] if i["name_en"] == "Sol Ring")
    assert item_a["status"] == "ok"

    # usar o mesmo Sol Ring no deck B: conflito explícito, nada muda sem confirmação
    r = client.post(f"/api/decks/{b['deck_id']}/allocate", json={"physical_card_id": ids[0]})
    assert r.status_code == 409
    assert "já está alocado no deck Atraxa (teste)" in r.json()["detail"]
    state_b = client.get(f"/api/decks/{b['deck_id']}").json()
    item_b = next(i for i in state_b["allocation"]["items"] if i["name_en"] == "Sol Ring")
    assert item_b["status"] == "conflict" and item_b["conflict"] == 1 and item_b["buy"] == 0
    assert any("Atraxa (teste)" in w for w in item_b["warnings"])
    shopping = client.get(f"/api/decks/{b['deck_id']}/shopping-list").json()
    assert any(d["decks"] == ["Atraxa (teste)"] for d in shopping["decide"])  # decisão, não compra
    assert all(x["name"] != "Sol Ring" for x in shopping["buy"])

    # com confirmação a carta muda de deck, e agora é o deck A que fica em conflito
    r = client.post(f"/api/decks/{b['deck_id']}/allocate", json={"physical_card_id": ids[0], "force": True})
    assert r.status_code == 200
    state_a = client.get(f"/api/decks/{a['deck_id']}").json()
    item_a = next(i for i in state_a["allocation"]["items"] if i["name_en"] == "Sol Ring")
    assert item_a["status"] == "conflict"


def test_auto_allocate_takes_from_binder_never_from_other_deck(client, cleanup):
    a = _deck(client, cleanup, "Deck A (teste)", "1 Lightning Bolt\n1 Counterspell", "legacy")
    b = _deck(client, cleanup, "Deck B (teste)", "1 Lightning Bolt\n1 Counterspell", "legacy")
    binder = client.post("/api/locations", json={"type": "binder", "name": "Pasta azul (teste)"}).json()
    cleanup["locations"].append(binder["id"])
    bolt, _ = ref_for("Lightning Bolt")
    counter, _ = ref_for("Counterspell")
    bolt_ids = client.post("/api/physical-cards", json={"card_ref_id": bolt, "location_id": binder["id"]}).json()["ids"]
    counter_ids = client.post("/api/physical-cards", json={"card_ref_id": counter}).json()["ids"]
    cleanup["cards"] += bolt_ids + counter_ids
    client.post(f"/api/decks/{a['deck_id']}/allocate", json={"physical_card_id": counter_ids[0]})
    res = client.post(f"/api/decks/{b['deck_id']}/allocate/auto").json()
    assert res["result"]["moved"] == 1  # só o Bolt da pasta; o Counterspell está no deck A
    items = {i["name_en"]: i for i in res["state"]["allocation"]["items"]}
    assert items["Lightning Bolt"]["status"] == "ok"
    assert items["Counterspell"]["status"] == "conflict"


# ---------------------------------------------------------------- critério 11
def test_reverse_check_finds_missing_extra_and_swapped(client, cleanup):
    listing = "\n".join(["1 Sol Ring", "1 Arcane Signet", "1 Swords to Plowshares", "1 Counterspell", "4 Island"])
    d = _deck(client, cleanup, "Conferência (teste)", listing, "legacy")
    s = client.post("/api/sessions", json={"format_id": "legacy", "mode": "video", "purpose": "check",
                                           "target_deck_id": d["deck_id"], "name": "conferir"}).json()
    cleanup["sessions"].append(s["id"])
    # faltou Counterspell e uma Island; sobrou Lightning Bolt; Sol Ring veio em português
    _fake_scan(s["id"], [("Sol Ring", "pt"), ("Arcane Signet", None), ("Swords to Plowshares", None),
                         ("Island", None), ("Island", None), ("Island", None), ("Lightning Bolt", None)])
    result = client.get(f"/api/sessions/{s['id']}/check").json()
    missing = {m["name"]: m["quantity"] for m in result["missing"]}
    extra = {x["name"]: x["quantity"] for x in result["extra"]}
    assert missing == {"Counterspell": 1, "Island": 1}
    assert extra == {"Lightning Bolt": 1}
    assert [x["name"] for x in result["swapped"]] == ["Sol Ring"]
    assert result["summary"]["expected"] == 8 and result["summary"]["scanned"] == 7 and not result["matches"]
    assert any(p["out"]["name"] == "Counterspell" and p["in"]["name"] == "Lightning Bolt" for p in result["likely_swaps"])

    # aplicar: a lista vira o que foi escaneado e o histórico mostra a diferença
    applied = client.post(f"/api/sessions/{s['id']}/check/apply").json()
    snaps = client.get(f"/api/decks/{d['deck_id']}/snapshots").json()
    first = snaps[-1]["id"]
    diff = client.get(f"/api/decks/{d['deck_id']}/diff", params={"from_id": first}).json()["diff"]
    assert {x["name"] for x in diff["added"]} == {"Lightning Bolt"}
    assert {x["name"] for x in diff["removed"]} == {"Counterspell"}
    assert any(c["name"] == "Island" and c["before"] == 4 and c["after"] == 3 for c in diff["changed"])
    assert any(r["name"] == "Sol Ring" for r in diff["reprinted"])
    assert applied["snapshot_id"]


# ---------------------------------------------------------------- critério 12
def test_impossible_print_detection(client, monkeypatch):
    assert prints.check("mtg", "dom", "999", "en")["code"] == "unknown_number"
    assert prints.check("mtg", "DOM", "279", "en") is None
    assert prints.check("mtg", "3ed", "229", "pt")["code"] == "language_never_printed"
    assert prints.check("mtg", "3ed", "229", "en", "foil")["code"] == "finish_never_printed"
    assert prints.check("mtg", "dom", "279", "en", None, "Sol Ring")["code"] == "name_mismatch"
    monkeypatch.setattr(prints.scryfall(), "get", lambda *a, **k: (404, None))
    assert prints.check("mtg", "zzq", "12", "en")["code"] == "unknown_set"
    body = client.post("/api/cards/check-print", json={"set_code": "dom", "collector_number": "999"}).json()
    assert not body["ok"] and "não existe no registro oficial" in body["warning"]["message"]


def test_import_reports_impossible_print(client, cleanup):
    res = _deck(client, cleanup, "Import (teste)", "1 Sol Ring (C21) 263\n1 Llanowar Elves (DOM) 999", "legacy")
    warnings = res["import"]["print_warnings"]
    assert len(warnings) == 1 and warnings[0]["code"] == "unknown_number" and warnings[0]["line"] == 2


# ---------------------------------------------------------------- salvar scan, coleção e histórico
def test_save_scan_new_deck_then_rescan_does_not_duplicate(client, cleanup):
    s = client.post("/api/sessions", json={"format_id": "commander", "mode": "video", "name": "Scan salvar"}).json()
    cleanup["sessions"].append(s["id"])
    _fake_scan(s["id"], [("Kaalia of the Vast", None), ("Sol Ring", None), ("Swamp", None), ("Swamp", None)])
    res = client.post(f"/api/sessions/{s['id']}/save", json={"target": "new_deck", "deck_name": "Kaalia salvo (teste)"}).json()
    deck_id = res["result"]["deck_id"]
    cleanup["decks"].append(deck_id)
    assert res["result"]["created"] == 4 and res["state"]["session"]["status"] == "saved"
    state = client.get(f"/api/decks/{deck_id}").json()
    assert state["allocation"]["complete"] and state["deck"]["card_count"] == 4
    assert state["snapshots"][0]["source"] == "scan"

    # re-scan do mesmo deck: as cartas físicas já registradas são reconhecidas, não duplicadas
    s2 = client.post("/api/sessions", json={"format_id": "commander", "mode": "video", "name": "Re-scan"}).json()
    cleanup["sessions"].append(s2["id"])
    _fake_scan(s2["id"], [("Kaalia of the Vast", None), ("Sol Ring", None), ("Swamp", None)])
    preview = client.get(f"/api/sessions/{s2['id']}/save-preview", params={"target_deck_id": deck_id}).json()
    assert len(preview["not_scanned_in_target"]) == 1  # um Swamp não apareceu no novo scan
    res2 = client.post(f"/api/sessions/{s2['id']}/save", json={"target": "existing_deck", "deck_id": deck_id,
                                                               "unscanned_action": "loose"}).json()
    assert res2["result"]["matched"] == 3 and res2["result"]["created"] == 0 and res2["result"]["released"] == 1
    rows = db.app_db().execute("SELECT id FROM physical_cards WHERE source_session_id IN (?, ?)", (s["id"], s2["id"]))
    cleanup["cards"] += [r[0] for r in rows]


def test_save_scan_warns_about_copies_in_other_decks(client, cleanup):
    a = _deck(client, cleanup, "Dono do Anel (teste)", "Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring")
    sol, _ = ref_for("Sol Ring")
    ids = client.post("/api/physical-cards", json={"card_ref_id": sol}).json()["ids"]
    cleanup["cards"] += ids
    client.post(f"/api/decks/{a['deck_id']}/allocate", json={"physical_card_id": ids[0]})
    s = client.post("/api/sessions", json={"format_id": "commander", "mode": "video", "name": "Outro deck"}).json()
    cleanup["sessions"].append(s["id"])
    _fake_scan(s["id"], [("Sol Ring", None)])
    state = client.get(f"/api/sessions/{s['id']}").json()
    oracle = ref_for("Sol Ring")[1]
    assert state["owned_elsewhere"][oracle] == ["Dono do Anel (teste)"]
    preview = client.get(f"/api/sessions/{s['id']}/save-preview").json()
    assert preview["elsewhere"][0]["copies"][0]["location_name"] == "Dono do Anel (teste)"


def test_import_parser_formats():
    text = """Commander
1 Kaalia of the Vast (C19) 173
Deck
1x Sol Ring (C21) 263 *F*
4 Lightning Bolt [M10]
1 Anel Solar

Sideboard
2 Pyroblast"""
    parsed = importers.parse(text)
    assert [(p.quantity, p.name, p.zone) for p in parsed] == [
        (1, "Kaalia of the Vast", "commander"), (1, "Sol Ring", "deck"), (4, "Lightning Bolt", "deck"),
        (1, "Anel Solar", "deck"), (2, "Pyroblast", "sideboard")]
    assert parsed[1].set_code == "c21" and parsed[1].collector_number == "263" and parsed[1].finish == "foil"
    assert parsed[2].set_code == "m10"


# ---------------------------------------------------------------- brackets
def _entries(names: list[str], commander: str) -> list[dict]:
    out = [{"card_ref_id": ref_for(commander)[0], "quantity": 1, "zone": "commander", "is_commander": True}]
    out += [{"card_ref_id": ref_for(n)[0], "quantity": 1, "zone": "deck", "is_commander": False} for n in names]
    return out


def test_brackets_from_game_changers_and_combos(monkeypatch):
    no_combos = {"bracketTag": "C", "combos": []}
    monkeypatch.setattr(spellbook, "estimate_bracket", lambda c, m: no_combos)
    core = brackets.classify("mtg", _entries(["Sol Ring", "Arcane Signet"], "Kaalia of the Vast"))
    assert core["bracket"] == 2 and any("bracket 1" in n for n in core["notes"])
    upgraded = brackets.classify("mtg", _entries(["Rhystic Study", "Smothering Tithe", "Sol Ring"], "Kaalia of the Vast"))
    assert upgraded["bracket"] == 3
    assert upgraded["headline"] == "bracket 3, 2 Game Changers, sem combo infinito de 2 cartas"
    combo = {"bracketTag": "R", "combos": [{"cards": ["Thassa's Oracle", "Demonic Consultation"], "produces": ["Win the game"],
                                            "tag": "R", "definitely_two_card": True, "arguably_two_card": True,
                                            "relevant": True, "mass_land_denial": False, "extra_turn": False}]}
    monkeypatch.setattr(spellbook, "estimate_bracket", lambda c, m: combo)
    optimized = brackets.classify("mtg", _entries(["Thassa's Oracle", "Demonic Consultation"], "Kaalia of the Vast"))
    assert optimized["bracket"] == 4 and optimized["counts"]["early_two_card_combo"] == 1
    mld = brackets.classify("mtg", _entries(["Armageddon", "Time Warp"], "Kaalia of the Vast"), use_spellbook=False)
    assert mld["counts"]["mass_land_denial"] == 1 and mld["counts"]["extra_turn"] == 1 and mld["bracket"] == 4


# ---------------------------------------------------------------- preços e condição
def test_valuation_and_shopping_list_prices(monkeypatch):
    monkeypatch.setattr(prices, "fx_usd_brl", lambda: {"rate": 5.0, "quoted_at": "2026-09-14", "source": "teste"})
    ref, _ = ref_for("Sol Ring")
    v = prices.valuation("mtg", [{"card_ref_id": ref, "finish": "nonfoil", "quantity": 2}])
    if v["items"]:
        unit = v["items"][0]["unit_usd"]
        assert v["total_brl"] == pytest.approx(round(unit * 2 * 5.0, 2), abs=0.02)


def test_condition_estimate_detects_whitened_edges():
    refs = sorted((config.CACHE_DIR / "normal").glob("*.jpg"))
    base = next((cv2.imread(str(p)) for p in refs if cv2.imread(str(p)) is not None), None)
    if base is None:
        pytest.skip("sem imagens de referência no cache")
    card = cv2.resize(base, (condition.W, condition.H))
    card[:, :30] = 12  # garante borda preta nas laterais
    card[:, -30:] = 12
    card[:30, :] = 12
    card[-30:, :] = 12
    clean = condition.estimate(card, "black", {"sharpness": 400, "glare": 0})
    assert clean["grade"] == "NM" and clean["confidence"] >= 0.5
    worn = card.copy()
    rng = np.random.default_rng(3)
    for _ in range(900):
        side = rng.integers(4)
        t = int(rng.integers(40, (condition.H if side < 2 else condition.W) - 40))
        d = int(rng.integers(7, 19))
        x, y = [(d, t), (condition.W - 1 - d, t), (t, d), (t, condition.H - 1 - d)][side]
        if 0 <= x < condition.W and 0 <= y < condition.H:
            cv2.circle(worn, (int(x), int(y)), 1, (235, 235, 235), -1)
    graded = condition.estimate(worn, "black", {"sharpness": 400, "glare": 0})
    assert graded["grade"] in ("SP", "MP", "HP") and graded["score"] > clean["score"]
