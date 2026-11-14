"""Telegram e link público: inscrição pelo jogador, ligação da conta e do grupo, avisos de rodada.

O robô é falso (as chamadas ao Telegram ficam numa lista); tudo o que o teste cria é apagado no fim, só pelo id.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import config, db, telegram
from app.main import app

TOKEN = "123456:TESTE-deck-scanner"


@pytest.fixture()
def bot(monkeypatch):
    sent: list[tuple[str, dict]] = []

    async def fake_call(method: str, payload: dict | None = None) -> dict:
        sent.append((method, payload or {}))
        return {"username": "torneios_teste_bot"} if method == "getMe" else {}

    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.setattr(telegram, "call", fake_call)
    yield sent
    database = db.app_db()
    database.execute("DELETE FROM meta WHERE key LIKE ?", (f"telegram.%:{telegram.webhook_secret()[:8]}",))


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _doc(name: str, players: list[dict], rounds: list[dict] | None = None, started: bool = False) -> dict:
    return {"schema": 1, "id": "", "name": name, "date": "2026-11-14", "gameFormat": "Commander (EDH)", "notes": "",
            "structure": {"kind": "pods", "rounds": 2},
            "settings": {"bestOf": 3, "playoffBestOf": 3, "points": {"win": 7, "draw": 1, "loss": 0}, "roundMinutes": 75, "seeding": "standings"},
            "seed": 1, "players": players, "rounds": rounds or [], "playoff": None, "tiebreak": None,
            "startedAt": "2026-11-14T20:00:00.000Z" if started else None, "finishedAt": None,
            "createdAt": "2026-11-14T19:00:00.000Z", "updatedAt": "2026-11-14T19:00:00.000Z"}


def _player(pid: str, name: str, user_id: str | None = None) -> dict:
    p = {"id": pid, "name": name, "deck": None, "droppedAfter": None, "lot": 0.5}
    if user_id:
        p["userId"] = user_id
    return p


def _webhook(client, payload: dict, secret: str | None = None):
    return client.post("/api/telegram/webhook", json=payload,
                       headers={"X-Telegram-Bot-Api-Secret-Token": secret if secret is not None else telegram.webhook_secret()})


def test_inscricao_pelo_link_publico(client, bot):
    t = client.post("/api/tournaments", json={"doc": _doc("Teste link (apagar)", [_player("p1", "Ana")]), "summary": {"status": "draft"}}).json()
    try:
        token = client.post(f"/api/tournaments/{t['id']}/share").json()["token"]
        assert client.post(f"/api/tournaments/{t['id']}/share").json()["token"] == token  # o link não muda

        pub = client.get(f"/api/public/t/{token}").json()
        assert pub["me"] is None and [p["name"] for p in pub["doc"]["players"]] == ["Ana"]
        assert client.get(f"/api/public/t/{token}", params={"since": pub["version"]}).status_code == 204

        joined = client.post(f"/api/public/t/{token}/join", json={"name": "Ana"}).json()["player"]
        again = client.post(f"/api/public/t/{token}/join", json={"name": "Outro nome"}).json()["player"]
        assert joined == again  # a mesma conta não entra duas vezes
        pub = client.get(f"/api/public/t/{token}").json()
        names = [p["name"] for p in pub["doc"]["players"]]
        assert names == ["Ana", "Ana (2)"]  # nome repetido ganha número
        assert pub["me"] == joined
        assert all("userId" not in p for p in pub["doc"]["players"])  # a página pública não mostra a conta
        # o organizador vê que o jogador tem conta, sem Telegram ainda
        acc = client.get(f"/api/tournaments/{t['id']}/accounts").json()
        assert acc["players"][joined] == {"account": True, "telegram": False}
        assert acc["players"]["p1"] == {"account": False, "telegram": False}

        assert client.post(f"/api/public/t/{token}/leave").json()["left"] is True
        assert len(client.get(f"/api/public/t/{token}").json()["doc"]["players"]) == 1
        assert client.get("/api/public/t/naoexiste").status_code == 404
    finally:
        client.delete(f"/api/tournaments/{t['id']}")


def test_torneio_comecado_fecha_inscricao(client, bot):
    t = client.post("/api/tournaments", json={"doc": _doc("Teste fechado (apagar)", [_player("p1", "Ana")], started=True),
                                              "summary": {"status": "running"}}).json()
    try:
        token = client.post(f"/api/tournaments/{t['id']}/share").json()["token"]
        res = client.post(f"/api/public/t/{token}/join", json={})
        assert res.status_code == 409 and "começou" in res.json()["detail"]
    finally:
        client.delete(f"/api/tournaments/{t['id']}")


def test_webhook_liga_conta_e_grupo(client, bot):
    user = config.DEFAULT_USER_ID
    try:
        assert _webhook(client, {"message": {"text": "/start x", "chat": {"id": 1, "type": "private"}}}, secret="errado").status_code == 403

        link = client.post("/api/me/telegram/link").json()
        assert link["url"].startswith("https://t.me/torneios_teste_bot?start=")
        code = link["url"].rsplit("=", 1)[1]
        _webhook(client, {"message": {"text": f"/start {code}", "chat": {"id": 777, "type": "private"}, "from": {"username": "dudu"}}})
        me = client.get("/api/me").json()["telegram"]
        assert me["connected"] and me["username"] == "dudu"
        # código gasto não liga de novo
        _webhook(client, {"message": {"text": f"/start {code}", "chat": {"id": 888, "type": "private"}}})
        assert telegram.user_link(user)["chat_id"] == "777"

        group = client.post("/api/me/telegram/group").json()
        cmd = group["command"]
        assert cmd.startswith("/conectar ")
        _webhook(client, {"message": {"text": cmd.replace("/conectar", "/conectar@torneios_teste_bot"), "chat": {"id": -100, "type": "supergroup", "title": "Torneios"}}})
        assert client.get("/api/me").json()["telegram"]["group"] == {"title": "Torneios"}
        replies = [p["text"] for m, p in bot if m == "sendMessage"]
        assert any("Conta do Deck Scanner conectada" in r for r in replies)
        assert any("Grupo conectado" in r for r in replies)
    finally:
        telegram.unlink_user(user)
        telegram.unlink_group(user)


def test_aviso_de_rodada_no_grupo_e_no_privado(client, bot):
    user = config.DEFAULT_USER_ID
    players = [_player("a", "Dudu", user), _player("b", "Leo"), _player("c", "Gui"), _player("d", "Olívio"), _player("e", "Pedro")]
    rounds = [{"number": 1, "matches": [], "pods": [{"id": "r1p1", "table": 1, "players": ["c", "a", "b", "d"], "result": None},
                                                    {"id": "r1p2", "table": 2, "players": ["e"], "result": None}],
               "timer": {"startedAt": None, "pausedAt": None, "pausedMs": 0}}]
    t = client.post("/api/tournaments", json={"doc": _doc("Friday (apagar)", players, rounds, started=True), "summary": {"status": "running"}}).json()
    try:
        telegram.link_user(user, "777", "dudu")
        telegram.link_group(user, "-100", "Torneios")
        body = {"notice": "r1", "heading": "Rodada 1 de 2", "standings": {"a": {"rank": 3, "points": 7}}}
        res = client.post(f"/api/tournaments/{t['id']}/announce", json=body).json()
        assert res == {"enabled": True, "group": True, "players": 1, "failed": 0, "no_telegram": 0, "no_account": 4}
        texts = {p["chat_id"]: p["text"] for m, p in bot if m == "sendMessage"}
        assert "<b>Mesa 1</b>: Gui, Dudu, Leo, Olívio" in texts["-100"]
        assert "/t/" in texts["-100"]
        dm = texts["777"]
        assert "Mesa 1" in dm and "Gui, Leo e Olívio" in dm and "2º a jogar" in dm and "3º, com 7 pts" in dm and "?j=a" in dm

        # o mesmo aviso não sai duas vezes, a não ser pedindo
        assert client.post(f"/api/tournaments/{t['id']}/announce", json=body).json() == {"enabled": True, "skipped": True}
        again = client.post(f"/api/tournaments/{t['id']}/announce", json={**body, "force": True}).json()
        assert again["players"] == 1
        # rodada que não existe no torneio salvo é recusada
        assert client.post(f"/api/tournaments/{t['id']}/announce", json={**body, "notice": "r2"}).status_code == 409
    finally:
        client.delete(f"/api/tournaments/{t['id']}")
        db.app_db().execute("DELETE FROM tournament_notices WHERE tournament_id=?", (t["id"],))
        telegram.unlink_user(user)
        telegram.unlink_group(user)


def test_sem_robo_os_avisos_ficam_desligados(client, monkeypatch):
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "")
    assert client.get("/api/me").json()["telegram"]["enabled"] is False
    assert client.post("/api/me/telegram/link").status_code == 503
