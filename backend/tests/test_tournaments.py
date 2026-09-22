"""Torneios: o servidor guarda o documento com versão e não deixa um aparelho sobrescrever o outro sem saber."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import db, tournaments
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _doc(name="Liga de quinta", players=3):
    return {"schema": 1, "id": "novo", "name": name, "date": "2026-09-26", "players": [{"id": f"p{i}", "name": f"J{i}"} for i in range(players)]}


def test_create_list_save_and_conflict(client):
    created = client.post("/api/tournaments", json={"doc": _doc(), "summary": {"status": "draft", "stage": "setup", "players": 3, "hack": "x"}})
    assert created.status_code == 201
    t = created.json()
    tid = t["id"]
    try:
        assert t["version"] == 1
        assert t["doc"]["id"] == tid  # o servidor define o id do documento
        assert t["summary"] == {"status": "draft", "stage": "setup", "players": 3}  # chave estranha fica de fora
        assert "user_id" not in t

        listed = client.get("/api/tournaments").json()
        row = next(r for r in listed if r["id"] == tid)
        assert row["name"] == "Liga de quinta" and row["player_count"] == 3 and "doc" not in row

        # grava a partir da versão 1
        doc = {**t["doc"], "name": "Liga de sexta"}
        saved = client.put(f"/api/tournaments/{tid}", json={"doc": doc, "summary": {"status": "running"}, "base_version": 1})
        assert saved.status_code == 200 and saved.json()["version"] == 2

        # outro aparelho ainda na versão 1: conflito, com a versão atual para juntar
        stale = client.put(f"/api/tournaments/{tid}", json={"doc": _doc("velho"), "base_version": 1})
        assert stale.status_code == 409
        body = stale.json()
        assert body["current"]["version"] == 2 and body["current"]["doc"]["name"] == "Liga de sexta"

        # telão: nada mudou → 204 sem corpo; mudou → documento
        assert client.get(f"/api/tournaments/{tid}", params={"since": 2}).status_code == 204
        fresh = client.get(f"/api/tournaments/{tid}", params={"since": 1})
        assert fresh.status_code == 200 and fresh.json()["status"] == "running"
    finally:
        assert client.delete(f"/api/tournaments/{tid}").status_code == 200
    assert client.get(f"/api/tournaments/{tid}").status_code == 404


def test_other_users_tournament_is_invisible(client):
    other = tournaments.create("outra-pessoa", _doc("dos outros"), None)
    try:
        assert client.get(f"/api/tournaments/{other['id']}").status_code == 404
        assert client.put(f"/api/tournaments/{other['id']}", json={"doc": _doc(), "base_version": 1}).status_code == 404
        assert client.delete(f"/api/tournaments/{other['id']}").status_code == 404
        assert all(r["id"] != other["id"] for r in client.get("/api/tournaments").json())
    finally:
        db.app_db().execute("DELETE FROM tournaments WHERE id=?", (other["id"],))


def test_document_size_limit(client):
    big = {**_doc(), "notes": "x" * (tournaments.MAX_DOC_BYTES + 10)}
    assert client.post("/api/tournaments", json={"doc": big}).status_code == 413
