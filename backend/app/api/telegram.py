"""Conta do jogador, robô do Telegram, link público do torneio e avisos de rodada.

- /me: perfil e as ligações com o Telegram (conta e grupo do organizador);
- /telegram/webhook: o que o robô recebe (`/start <código>` no privado, `/conectar <código>` no grupo);
- /tournaments/{id}/share | accounts | announce: do organizador;
- /public/t/{token}: a página que qualquer um abre pelo link (relógio e mesas) e onde o jogador se inscreve.
"""
from __future__ import annotations

import asyncio
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import db, telegram, tournaments
from ..auth import User, current_user
from .common import json_response

router = APIRouter()


def _origin(request: Request) -> str:
    host = request.headers.get("x-forwarded-host") or request.url.netloc
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return f"{proto}://{host}"


def optional_user(request: Request) -> User | None:
    """Quem está vendo a página pública, se tiver entrado (sem login a página abre do mesmo jeito)."""
    try:
        return current_user(request)
    except HTTPException:
        return None


def _profile_name(user: User) -> str | None:
    row = db.app_db().execute("SELECT name FROM users WHERE id=?", (user.id,)).fetchone()
    return (row["name"] if row else None) or user.name


# ---------------------------------------------------------------------- conta
class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


@router.get("/me")
async def me(request: Request, user: User = Depends(current_user)):
    bot = None
    problem = None
    if telegram.enabled():
        try:
            await telegram.ensure_webhook(_origin(request))
            bot = await telegram.bot_username()
        except Exception as exc:  # noqa: BLE001 — o perfil abre mesmo com o Telegram fora do ar
            problem = f"{type(exc).__name__}: {exc}"[:200]
            print(f"[telegram] /me: {problem}", flush=True)
    link = telegram.user_link(user.id)
    group = telegram.group_link(user.id)
    return json_response({
        "id": user.id,
        "name": _profile_name(user),
        "email": user.email,
        "telegram": {
            "enabled": telegram.enabled() and bot is not None,
            "bot": bot,
            "connected": link is not None,
            "username": link["username"] if link else None,
            "group": {"title": group["title"]} if group else None,
            "problem": problem,
        },
    })


@router.patch("/me")
def update_me(body: ProfileIn, user: User = Depends(current_user)):
    db.app_db().execute(
        "INSERT INTO users (id, name, email, created_at) VALUES (?,?,?,?) ON CONFLICT (id) DO UPDATE SET name=excluded.name",
        (user.id, body.name.strip(), user.email, db.now_iso()))
    return json_response({"name": body.name.strip()})


def _need_bot() -> None:
    if not telegram.enabled():
        raise HTTPException(503, "o robô do Telegram ainda não foi configurado neste servidor")


@router.post("/me/telegram/link")
async def telegram_link(request: Request, user: User = Depends(current_user)):
    _need_bot()
    await telegram.ensure_webhook(_origin(request))
    bot = await telegram.bot_username()
    code = telegram.new_code(user.id, "user")
    return json_response({"url": f"https://t.me/{bot}?start={code}", "bot": bot})


@router.delete("/me/telegram")
def telegram_unlink(user: User = Depends(current_user)):
    telegram.unlink_user(user.id)
    return json_response({"ok": True})


@router.post("/me/telegram/group")
async def telegram_group_code(request: Request, user: User = Depends(current_user)):
    _need_bot()
    await telegram.ensure_webhook(_origin(request))
    bot = await telegram.bot_username()
    code = telegram.new_code(user.id, "group")
    return json_response({"command": f"/conectar {code}", "bot": bot, "add_url": f"https://t.me/{bot}?startgroup=deckscanner"})


@router.delete("/me/telegram/group")
def telegram_group_unlink(user: User = Depends(current_user)):
    telegram.unlink_group(user.id)
    return json_response({"ok": True})


# ---------------------------------------------------------------------- robô
def _command(text: str, bot: str | None) -> tuple[str, str]:
    """"/conectar@robo abc" → ("conectar", "abc")."""
    head, _, rest = text.strip().partition(" ")
    name, _, target = head[1:].partition("@")
    if target and bot and target.lower() != bot.lower():
        return "", ""
    return name.lower(), rest.strip()


@router.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    if not telegram.enabled():
        raise HTTPException(404)
    secret = request.headers.get("x-telegram-bot-api-secret-token", "")
    if not hmac.compare_digest(secret, telegram.webhook_secret()):
        raise HTTPException(403)
    update = await request.json()
    bot = await telegram.bot_username()

    joined = update.get("my_chat_member")
    if joined and joined.get("chat", {}).get("type") in ("group", "supergroup"):
        if joined.get("new_chat_member", {}).get("status") in ("member", "administrator"):
            await telegram.send(str(joined["chat"]["id"]),
                                "Olá! Para este grupo receber as mesas dos torneios, gere o código no Deck Scanner "
                                "(Conta → Grupo do Telegram) e mande aqui: /conectar CÓDIGO")
        return Response(status_code=200)

    message = update.get("message") or {}
    text = message.get("text") or ""
    chat = message.get("chat") or {}
    if not text.startswith("/") or not chat:
        return Response(status_code=200)
    cmd, arg = _command(text, bot)
    chat_id = str(chat.get("id"))

    if cmd == "start" and chat.get("type") == "private":
        owner = telegram.take_code(arg, "user") if arg else None
        if owner:
            sender = message.get("from") or {}
            telegram.link_user(owner, chat_id, sender.get("username"))
            await telegram.send(chat_id, "✅ Conta do Deck Scanner conectada. Quando sair uma rodada dos seus torneios, "
                                         "eu aviso aqui a sua mesa, a sua posição e o link do relógio.")
        else:
            await telegram.send(chat_id, "Para receber os avisos dos torneios, abra o Deck Scanner, vá em Conta e toque em "
                                         "\"Conectar Telegram\". O link de lá traz o código que liga a sua conta.")
    elif cmd == "conectar" and chat.get("type") in ("group", "supergroup"):
        owner = telegram.take_code(arg, "group") if arg else None
        if owner:
            telegram.link_group(owner, chat_id, chat.get("title"))
            await telegram.send(chat_id, "✅ Grupo conectado. A cada rodada nova eu posto aqui as mesas e o link do relógio.")
        else:
            await telegram.send(chat_id, "Código inválido ou vencido. Gere outro no Deck Scanner, em Conta → Grupo do Telegram.")
    return Response(status_code=200)


# ---------------------------------------------------------------------- organizador
def _own(tournament_id: str, user: User) -> dict:
    row = tournaments.get(tournament_id)
    if row is None or row["user_id"] != user.id:
        raise HTTPException(404, "torneio não encontrado")
    return row


@router.post("/tournaments/{tournament_id}/share")
def share(tournament_id: str, user: User = Depends(current_user)):
    _own(tournament_id, user)
    return json_response({"token": tournaments.share_token(tournament_id)})


@router.get("/tournaments/{tournament_id}/accounts")
def accounts(tournament_id: str, user: User = Depends(current_user)):
    """Quem da lista tem conta e quem recebe aviso no privado (o organizador vê só sim/não, nunca o contato)."""
    row = _own(tournament_id, user)
    players = row["doc"].get("players") or []
    chats = telegram.linked_chats([p["userId"] for p in players if p.get("userId")])
    group = telegram.group_link(user.id)
    return json_response({
        "enabled": telegram.enabled(),
        "group": {"title": group["title"]} if group else None,
        "players": {p["id"]: {"account": bool(p.get("userId")), "telegram": p.get("userId") in chats} for p in players},
    })


class Standing(BaseModel):
    rank: int | None = None
    points: float | None = None


class AnnounceIn(BaseModel):
    notice: str = Field(pattern=r"^(r\d{1,2}|t\d{1,2}|final)$")
    heading: str = Field(max_length=60)
    detail: str = Field(default="", max_length=80)
    standings: dict[str, Standing] = {}
    force: bool = False


def _tables(doc: dict, notice: str) -> tuple[list[tuple[int | None, list[str]]], bool]:
    """Mesas do aviso tiradas do torneio salvo (o cliente só manda posição e pontos)."""
    if notice == "final":
        final = doc.get("tiebreak")
        if not final:
            raise HTTPException(409, "a mesa final ainda não foi montada")
        return [(1, list(final.get("players") or []))], True
    number = int(notice[1:])
    rnd = next((r for r in doc.get("rounds") or [] if r.get("number") == number), None)
    if rnd is None:
        raise HTTPException(409, "essa rodada ainda não foi salva")
    tables: list[tuple[int | None, list[str]]] = []
    for pod in rnd.get("pods") or []:
        tables.append((pod.get("table"), list(pod.get("players") or [])))
    for m in rnd.get("matches") or []:
        tables.append((m.get("table") if m.get("b") else None, [m["a"]] + ([m["b"]] if m.get("b") else [])))
    tables.sort(key=lambda t: (t[0] is None, t[0] or 0))
    return tables, False


@router.post("/tournaments/{tournament_id}/announce")
async def announce(tournament_id: str, body: AnnounceIn, request: Request, user: User = Depends(current_user)):
    row = _own(tournament_id, user)
    if not telegram.enabled():
        return json_response({"enabled": False})
    if not body.force and telegram.already_sent(tournament_id, body.notice):
        return json_response({"enabled": True, "skipped": True})
    doc = row["doc"]
    link = f"{_origin(request)}/t/{tournaments.share_token(tournament_id)}"
    title = str(doc.get("name") or "Torneio")
    if body.notice.startswith("t"):
        return json_response(await _announce_start(tournament_id, doc, body, user, link, title))
    raw, final = _tables(doc, body.notice)
    people = {p["id"]: p for p in doc.get("players") or []}

    def seat(pid: str) -> telegram.Seat:
        p = people.get(pid, {})
        s = body.standings.get(pid) or Standing()
        return telegram.Seat(pid, str(p.get("name") or "?"), p.get("userId"), s.rank, s.points)

    tables = [telegram.Table(n, [seat(pid) for pid in ids]) for n, ids in raw]

    jobs: list = []
    group = telegram.group_link(user.id)
    if group:
        jobs.append(telegram.send(group["chat_id"], telegram.group_text(title, body.heading, tables, link, final), ("⏱ Ver mesas e relógio", link)))
    chats = telegram.linked_chats([s.user_id for t in tables for s in t.seats if s.user_id])
    direct = 0
    for t in tables:
        for s in t.seats:
            if s.user_id and s.user_id in chats:
                mine = f"{link}?j={s.player_id}"
                jobs.append(telegram.send(chats[s.user_id], telegram.player_text(title, body.heading, t, s, mine, final), ("⏱ Minha mesa e o relógio", mine)))
                direct += 1
    results = await asyncio.gather(*jobs) if jobs else []
    ok_group = bool(results[0]) if group else None
    sent = sum(1 for r in (results[1:] if group else results) if r)
    telegram.mark_sent(tournament_id, body.notice)
    seats = [s for t in tables for s in t.seats]
    return json_response({
        "enabled": True,
        "group": ok_group,
        "players": sent,
        "failed": direct - sent,
        "no_telegram": sum(1 for s in seats if s.user_id and s.user_id not in chats),
        "no_account": sum(1 for s in seats if not s.user_id),
    })


async def _announce_start(tournament_id: str, doc: dict, body: AnnounceIn, user: User, link: str, title: str) -> dict:
    """Relógio da rodada iniciado: um aviso só, no grupo e no privado de quem está na rodada."""
    number = int(body.notice[1:])
    rnd = next((r for r in doc.get("rounds") or [] if r.get("number") == number), None)
    if rnd is None or not (rnd.get("timer") or {}).get("startedAt"):
        raise HTTPException(409, "o relógio dessa rodada ainda não começou no torneio salvo")
    ids = [pid for pod in rnd.get("pods") or [] for pid in pod.get("players") or []]
    ids += [pid for m in rnd.get("matches") or [] for pid in (m.get("a"), m.get("b")) if pid]
    people = {p["id"]: p for p in doc.get("players") or []}
    users = [people[pid]["userId"] for pid in ids if people.get(pid, {}).get("userId")]
    text = telegram.start_text(title, body.heading, body.detail)
    jobs = []
    group = telegram.group_link(user.id)
    if group:
        jobs.append(telegram.send(group["chat_id"], text, ("⏱ Ver o relógio", link)))
    chats = telegram.linked_chats(users)
    for uid in users:
        if uid in chats:
            jobs.append(telegram.send(chats[uid], text, ("⏱ Ver o relógio", link)))
    results = await asyncio.gather(*jobs) if jobs else []
    telegram.mark_sent(tournament_id, body.notice)
    sent = sum(1 for r in (results[1:] if group else results) if r)
    return {"enabled": True, "group": bool(results[0]) if group else None, "players": sent,
            "failed": (len(results) - (1 if group else 0)) - sent, "no_telegram": len([u for u in users if u not in chats]),
            "no_account": len(ids) - len(users)}


# ---------------------------------------------------------------------- página pública
def _public(row: dict, viewer: User | None) -> dict:
    doc = row["doc"]
    me = None
    players = []
    for p in doc.get("players") or []:
        if viewer and p.get("userId") == viewer.id:
            me = p["id"]
        players.append({k: v for k, v in p.items() if k != "userId"})
    return {"id": row["id"], "version": row["version"], "doc": {**doc, "players": players}, "me": me}


def _by_token(token: str) -> dict:
    row = tournaments.by_token(token)
    if row is None:
        raise HTTPException(404, "torneio não encontrado")
    return row


@router.get("/public/t/{token}")
def public_tournament(token: str, request: Request, since: int | None = None):
    row = _by_token(token)
    if since is not None and row["version"] == since:
        return Response(status_code=204)
    return json_response(_public(row, optional_user(request)))


class JoinIn(BaseModel):
    name: str | None = Field(default=None, max_length=60)


@router.post("/public/t/{token}/join")
def public_join(token: str, body: JoinIn, user: User = Depends(current_user)):
    for _ in range(3):
        row = _by_token(token)
        try:
            pid = tournaments.join(row, user.id, body.name or _profile_name(user) or (user.email or "Jogador").split("@")[0])
            return json_response({"player": pid})
        except tournaments.Closed as e:
            raise HTTPException(409, str(e)) from e
        except tournaments.Conflict:
            continue  # o organizador gravou no mesmo instante: tenta de novo sobre a versão nova
    raise HTTPException(409, "o torneio está sendo alterado agora; tente de novo")


@router.post("/public/t/{token}/leave")
def public_leave(token: str, user: User = Depends(current_user)):
    for _ in range(3):
        row = _by_token(token)
        try:
            return json_response({"left": tournaments.leave(row, user.id)})
        except tournaments.Closed as e:
            raise HTTPException(409, str(e)) from e
        except tournaments.Conflict:
            continue
    raise HTTPException(409, "o torneio está sendo alterado agora; tente de novo")
