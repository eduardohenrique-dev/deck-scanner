"""API: sessão, entrada manual, validação, exportação e correção (sem processar imagens)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import ref_for


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_games_and_formats(client):
    games = client.get("/api/games").json()
    mtg = next(g for g in games if g["id"] == "mtg")
    assert mtg["enabled"] and any(f["id"] == "commander" for f in mtg["formats"])
    assert any(not g["enabled"] for g in games)  # outros jogos listados como "em breve"


def test_manual_deck_validation_and_export(client):
    s = client.post("/api/sessions", json={"game_id": "mtg", "format_id": "commander", "mode": "photo", "name": "teste api"}).json()
    try:
        kaalia, _ = ref_for("Kaalia of the Vast")
        sol, _ = ref_for("Sol Ring")
        state = client.post(f"/api/sessions/{s['id']}/entries", json={"card_ref_id": kaalia, "quantity": 1}).json()
        entry = state["entries"][0]
        state = client.patch(f"/api/entries/{entry['id']}", json={"is_commander": True}).json()
        assert state["entries"][0]["zone"] == "commander"
        state = client.post(f"/api/sessions/{s['id']}/entries", json={"card_ref_id": sol, "quantity": 2}).json()
        codes = [i["code"] for i in state["validation"]["issues"]]
        assert "copy_limit_violation" in codes and "deck_size_missing" in codes
        assert state["validation"]["commander"]["identity"] == ["W", "B", "R"]
        text = client.get(f"/api/sessions/{s['id']}/export", params={"format": "moxfield"}).text
        assert text.startswith("Commander\n1 Kaalia of the Vast (")
        land = state["validation"]["suggestions"]["mtg_basic_lands"]
        assert "applicable" in land
        # troca de formato revalida sem perder a lista
        state = client.patch(f"/api/sessions/{s['id']}", json={"format_id": "collection"}).json()
        assert state["validation"]["valid"] and sum(e["quantity"] for e in state["entries"]) == 3
    finally:
        client.delete(f"/api/sessions/{s['id']}")


def test_search_portuguese_name(client):
    results = client.get("/api/cards/search", params={"q": "desertos calc"}).json()
    assert results and results[0]["name_en"] == "Scoured Barrens"
