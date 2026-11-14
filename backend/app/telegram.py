"""Avisos de torneio pelo Telegram.

Um robô do Telegram (criado no @BotFather; o token fica em TELEGRAM_BOT_TOKEN) faz duas coisas:

- posta no grupo do organizador as mesas de cada rodada nova, com o link do relógio;
- manda no privado de cada jogador com conta a mesa e a posição dele.

O Telegram só deixa um robô escrever para quem já falou com ele. Por isso a ligação é feita por códigos de
uso único: a conta gera um código, o jogador abre `t.me/<robô>?start=<código>` e aperta "Iniciar"; o webhook
recebe o `/start <código>` e grava o chat daquela pessoa. O grupo é ligado igual, com `/conectar <código>`
mandado dentro do grupo.

As regras do torneio (mesas, classificação) moram no cliente; o organizador manda o anúncio pronto e o
servidor só confere se as mesas batem com o torneio salvo antes de enviar.
"""
from __future__ import annotations

import hashlib
import html
import secrets
import time
from dataclasses import dataclass

import httpx

from . import config, db

API = "https://api.telegram.org"
CODE_TTL = 24 * 3600
TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def enabled() -> bool:
    return bool(config.TELEGRAM_BOT_TOKEN)


def webhook_secret() -> str:
    """Segredo que o Telegram repete em cada chamada do webhook (derivado do token: nada a mais para configurar)."""
    return hashlib.sha256(f"deck-scanner:{config.TELEGRAM_BOT_TOKEN}".encode()).hexdigest()[:48]


async def call(method: str, payload: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        reply = await client.post(f"{API}/bot{config.TELEGRAM_BOT_TOKEN}/{method}", json=payload or {})
    body = reply.json() if reply.headers.get("content-type", "").startswith("application/json") else {}
    if not body.get("ok"):
        raise TelegramError(str(body.get("description") or f"Telegram respondeu {reply.status_code}"))
    return body.get("result") or {}


class TelegramError(RuntimeError):
    pass


async def bot_username() -> str | None:
    """Nome do robô (para montar o link t.me); guardado no banco depois da primeira consulta."""
    if not enabled():
        return None
    key = f"telegram.bot:{webhook_secret()[:8]}"
    cached = db.meta_get(key)
    if cached:
        return cached
    me = await call("getMe")
    name = me.get("username")
    if name:
        db.meta_set(key, name)
    return name


async def ensure_webhook(origin: str) -> None:
    """Aponta o robô para o webhook deste site (uma vez por endereço)."""
    if not enabled() or not origin.startswith("https://"):
        return
    url = f"{origin}/api/telegram/webhook"
    key = f"telegram.webhook:{webhook_secret()[:8]}"
    if db.meta_get(key) == url:
        return
    await call("setWebhook", {"url": url, "secret_token": webhook_secret(), "allowed_updates": ["message", "my_chat_member"]})
    await call("setMyCommands", {"commands": [{"command": "start", "description": "Conectar a sua conta do Deck Scanner"},
                                              {"command": "conectar", "description": "Ligar este grupo aos torneios"}]})
    db.meta_set(key, url)


# ---------------------------------------------------------------------- ligações
def new_code(user_id: str, kind: str) -> str:
    """Código de uso único para ligar a conta ("user") ou um grupo ("group")."""
    code = secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")
    database = db.app_db()
    database.execute("DELETE FROM telegram_codes WHERE created_at < ?", (_ago(CODE_TTL),))
    database.execute("INSERT INTO telegram_codes (code, kind, user_id, created_at) VALUES (?,?,?,?)", (code, kind, user_id, db.now_iso()))
    return code


def _ago(seconds: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - seconds))


def take_code(code: str, kind: str) -> str | None:
    """Gasta o código e devolve o dono, ou None se não existe, venceu ou é de outro tipo."""
    database = db.app_db()
    row = database.execute("SELECT user_id, created_at FROM telegram_codes WHERE code=? AND kind=?", (code, kind)).fetchone()
    if row is None:
        return None
    database.execute("DELETE FROM telegram_codes WHERE code=?", (code,))
    return row["user_id"] if row["created_at"] >= _ago(CODE_TTL) else None


def link_user(user_id: str, chat_id: str, username: str | None) -> None:
    db.app_db().execute(
        "INSERT INTO telegram_links (user_id, chat_id, username, linked_at) VALUES (?,?,?,?) "
        "ON CONFLICT (user_id) DO UPDATE SET chat_id=excluded.chat_id, username=excluded.username, linked_at=excluded.linked_at",
        (user_id, chat_id, username, db.now_iso()))


def link_group(user_id: str, chat_id: str, title: str | None) -> None:
    db.app_db().execute(
        "INSERT INTO telegram_groups (user_id, chat_id, title, linked_at) VALUES (?,?,?,?) "
        "ON CONFLICT (user_id) DO UPDATE SET chat_id=excluded.chat_id, title=excluded.title, linked_at=excluded.linked_at",
        (user_id, chat_id, title, db.now_iso()))


def unlink_user(user_id: str) -> None:
    db.app_db().execute("DELETE FROM telegram_links WHERE user_id=?", (user_id,))


def unlink_group(user_id: str) -> None:
    db.app_db().execute("DELETE FROM telegram_groups WHERE user_id=?", (user_id,))


def user_link(user_id: str) -> dict | None:
    return db.row_to_dict(db.app_db().execute("SELECT chat_id, username, linked_at FROM telegram_links WHERE user_id=?", (user_id,)).fetchone())


def group_link(user_id: str) -> dict | None:
    return db.row_to_dict(db.app_db().execute("SELECT chat_id, title, linked_at FROM telegram_groups WHERE user_id=?", (user_id,)).fetchone())


def linked_chats(user_ids: list[str]) -> dict[str, str]:
    """chat do Telegram de cada conta ligada (contas sem Telegram ficam de fora)."""
    if not user_ids:
        return {}
    rows = db.app_db().execute(f"SELECT user_id, chat_id FROM telegram_links WHERE user_id IN ({db.placeholders(len(user_ids))})",
                               tuple(user_ids))
    return {r["user_id"]: r["chat_id"] for r in rows}


# ---------------------------------------------------------------------- avisos
@dataclass
class Seat:
    player_id: str
    name: str
    user_id: str | None
    rank: int | None
    points: float | None


@dataclass
class Table:
    number: int | None  # None = folga
    seats: list[Seat]


def _place(rank: int | None) -> str:
    return f"{rank}º" if rank else ""


def _pts(points: float | None) -> str:
    if points is None:
        return ""
    value = int(points) if float(points).is_integer() else points
    return f"{value} pt" if value == 1 else f"{value} pts"


def group_text(title: str, heading: str, tables: list[Table], link: str, final: bool) -> str:
    lines = [f"🏆 <b>{html.escape(title)}</b>", f"<b>{html.escape(heading)}</b>", ""]
    for t in tables:
        label = "Folga" if t.number is None else ("Mesa final" if final else f"Mesa {t.number}")
        people = ", ".join(html.escape(s.name) for s in t.seats)
        lines.append(f"<b>{label}</b>: {people}")
    if final:
        lines += ["", "Sem tempo limite. Começa quem está em primeiro na lista."]
    lines += ["", f"⏱ Relógio e mesas: {link}"]
    return "\n".join(lines)


def player_text(title: str, heading: str, table: Table, seat: Seat, link: str, final: bool) -> str:
    others = [html.escape(s.name) for s in table.seats if s.player_id != seat.player_id]
    lines = [f"🏆 <b>{html.escape(title)}</b> · {html.escape(heading)}", ""]
    if table.number is None:
        lines.append("Você está de <b>folga</b> nesta rodada.")
    else:
        where = "na <b>mesa final</b>" if final else f"na <b>Mesa {table.number}</b>"
        lines.append(f"Você joga {where}" + (f" com {_list(others)}." if others else "."))
        order = [s.player_id for s in table.seats].index(seat.player_id) + 1
        if len(table.seats) > 2:
            lines.append(f"Ordem de jogo: você é o {order}º a jogar.")
    if seat.rank:
        lines.append(f"Classificação: {_place(seat.rank)}" + (f", com {_pts(seat.points)}." if seat.points is not None else "."))
    lines += ["", f"⏱ Acompanhe o relógio: {link}"]
    return "\n".join(lines)


def _list(items: list[str]) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} e {items[-1]}"


async def send(chat_id: str, text: str) -> bool:
    try:
        await call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True})
        return True
    except (TelegramError, httpx.HTTPError):
        return False


def already_sent(tournament_id: str, notice: str) -> bool:
    row = db.app_db().execute("SELECT 1 FROM tournament_notices WHERE tournament_id=? AND notice=?", (tournament_id, notice)).fetchone()
    return row is not None


def mark_sent(tournament_id: str, notice: str) -> None:
    db.app_db().execute(
        "INSERT INTO tournament_notices (tournament_id, notice, sent_at) VALUES (?,?,?) "
        "ON CONFLICT (tournament_id, notice) DO UPDATE SET sent_at=excluded.sent_at",
        (tournament_id, notice, db.now_iso()))
