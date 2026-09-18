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


def test_sets_search_and_session_hint(client):
    """Seletor "estas cartas são da coleção X": busca de coleção e gravação na sessão."""
    found = client.get("/api/sets", params={"q": "duskmourn", "limit": 5}).json()
    assert found and found[0]["code"] == "dsk"  # a coleção principal vem antes de tokens e digitais
    assert all(s["card_count"] > 0 for s in found)

    s = client.post("/api/sessions", json={"game_id": "mtg", "format_id": "commander", "mode": "video"}).json()
    try:
        state = client.patch(f"/api/sessions/{s['id']}", json={"settings": {"set_codes": ["dsk"]}}).json()
        assert state["session"]["settings"]["set_codes"] == ["dsk"]
        from app.pipeline import store

        assert store.preferred_sets(store.get_session(s["id"])) == {"dsk"}
    finally:
        client.delete(f"/api/sessions/{s['id']}")


def test_auth_proxy_only_when_hosted(client):
    """No modo local não há login: as rotas do login pelo nosso domínio respondem 404."""
    r = client.post("/api/auth/password/sign-in", json={"email": "a@b.co", "password": "12345678"})
    assert r.status_code == 404
    assert client.get("/api/auth/session").status_code in (401, 404)
