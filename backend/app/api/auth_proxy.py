"""Login pelo NOSSO domínio.

O Neon Auth guarda a sessão num cookie do domínio dele (`*.neon.tech`). Safari no iPhone, Brave e as abas
anônimas bloqueiam cookies de outro site: a sessão não gruda, e a volta do login com Google falha com
`SESSION_CHALLENGE_COOKIE_NOT_FOUND` porque o desafio também é um cookie de lá.

Aqui o navegador só conversa com o nosso domínio:

  1. entrar/criar conta → o servidor fala com o Neon Auth e guarda o cookie de sessão DELE dentro de um
     cookie nosso (`ds_session`, HttpOnly, SameSite=Lax) — primeira parte, nunca bloqueado;
  2. `GET /api/auth/session` devolve o usuário e um JWT de 15 min, que o app usa nas chamadas da API
     (o resto do servidor continua validando só o JWT, como antes);
  3. Google: o desafio que o Neon devolve fica num cookie nosso de 10 minutos e é reapresentado na volta,
     no lugar de depender do navegador guardar o cookie do domínio deles.
"""
from __future__ import annotations

from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from .. import config
from ..auth import verify_token
from .common import json_response

router = APIRouter()

SESSION_COOKIE = "ds_session"
OAUTH_COOKIE = "ds_oauth"
SESSION_MAX_AGE = 7 * 24 * 3600
OAUTH_MAX_AGE = 600
TIMEOUT = httpx.Timeout(20.0, connect=10.0)
# cookies que o Neon Auth usa; o valor completo (com assinatura) vai inteiro para dentro do nosso cookie
NEON_SESSION_COOKIE = "__Secure-neon-auth.session_token"
CHALLENGE_PREFIX = "__Secure-neon-auth.session_chal"


class Credentials(BaseModel):
    email: str
    password: str
    name: str | None = None


def _base() -> str:
    if config.AUTH_MODE != "neon" or not config.NEON_AUTH_BASE_URL:
        raise HTTPException(404, "login não está ativo neste servidor")
    return config.NEON_AUTH_BASE_URL.rstrip("/")


def _origin(request: Request) -> str:
    return f"{request.url.scheme}://{request.url.netloc}"


def _set_cookie(response: Response, name: str, value: str, max_age: int, secure: bool) -> None:
    response.set_cookie(name, value, max_age=max_age, httponly=True, secure=secure, samesite="lax", path="/")


def _cookies_from(reply: httpx.Response, prefix: str) -> str:
    """Os cookies que o Neon Auth mandou, no formato de um cabeçalho Cookie para reapresentar depois."""
    parts = []
    for raw in reply.headers.get_list("set-cookie"):
        pair = raw.split(";", 1)[0].strip()
        if pair.startswith(prefix) and "=" in pair:
            parts.append(pair)
    return "; ".join(parts)


async def _call(client: httpx.AsyncClient, method: str, path: str, *, origin: str, cookie: str = "",
                json: dict | None = None) -> httpx.Response:
    headers = {"Origin": origin}
    if cookie:
        headers["Cookie"] = cookie
    return await client.request(method, f"{_base()}{path}", headers=headers, json=json)


def _message(reply: httpx.Response) -> str:
    try:
        body = reply.json()
    except ValueError:
        return "não deu certo, tente de novo"
    return str(body.get("message") or body.get("error") or "não deu certo, tente de novo")


async def _finish_login(reply: httpx.Response, request: Request) -> Response:
    """Guarda o cookie de sessão do Neon dentro do nosso e devolve o usuário."""
    session_cookie = _cookies_from(reply, NEON_SESSION_COOKIE)
    if not session_cookie:
        raise HTTPException(502, "o serviço de login não devolveu a sessão")
    user = (reply.json() or {}).get("user")
    response = json_response({"user": user})
    _set_cookie(response, SESSION_COOKIE, session_cookie, SESSION_MAX_AGE, request.url.scheme == "https")
    return response


@router.post("/auth/password/sign-in")
async def sign_in(body: Credentials, request: Request):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        reply = await _call(client, "POST", "/sign-in/email", origin=_origin(request),
                            json={"email": body.email, "password": body.password})
    if reply.status_code >= 400:
        raise HTTPException(reply.status_code if reply.status_code < 500 else 502, _message(reply))
    return await _finish_login(reply, request)


@router.post("/auth/password/sign-up")
async def sign_up(body: Credentials, request: Request):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        reply = await _call(client, "POST", "/sign-up/email", origin=_origin(request),
                            json={"email": body.email, "password": body.password,
                                  "name": body.name or body.email.split("@")[0]})
    if reply.status_code >= 400:
        raise HTTPException(reply.status_code if reply.status_code < 500 else 502, _message(reply))
    return await _finish_login(reply, request)


@router.get("/auth/session")
async def session(request: Request):
    """Usuário atual e o JWT de 15 minutos usado nas demais chamadas da API."""
    cookie = request.cookies.get(SESSION_COOKIE)
    if not cookie:
        raise HTTPException(401, "sem sessão")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        reply = await _call(client, "GET", "/get-session", origin=_origin(request), cookie=cookie)
    data = reply.json() if reply.status_code < 400 else None
    if not data or not data.get("user"):
        response = json_response({"detail": "sessão expirada"}, status_code=401)
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response
    token = reply.headers.get("set-auth-jwt")
    if not token:
        raise HTTPException(502, "o serviço de login não devolveu o token da sessão")
    claims = verify_token(token)
    return json_response({"user": data["user"], "token": token, "expires_at": claims.get("exp")})


@router.post("/auth/sign-out")
async def sign_out(request: Request):
    cookie = request.cookies.get(SESSION_COOKIE)
    if cookie:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            try:
                await _call(client, "POST", "/sign-out", origin=_origin(request), cookie=cookie)
            except httpx.HTTPError:
                pass  # a sessão local sai de qualquer forma
    response = json_response({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.get("/auth/google/start")
async def google_start(request: Request, next: str = "/"):
    """Começa o login com Google guardando o desafio do Neon num cookie nosso."""
    origin = _origin(request)
    callback = f"{origin}/api/auth/google/callback?{urlencode({'next': next})}"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        reply = await _call(client, "POST", "/sign-in/social", origin=origin,
                            json={"provider": "google", "callbackURL": callback})
    url = (reply.json() or {}).get("url") if reply.status_code < 400 else None
    if not url:
        raise HTTPException(502, _message(reply))
    challenge = _cookies_from(reply, CHALLENGE_PREFIX)
    response = RedirectResponse(url, status_code=302)
    if challenge:
        _set_cookie(response, OAUTH_COOKIE, challenge, OAUTH_MAX_AGE, request.url.scheme == "https")
    return response


@router.get("/auth/google/callback")
async def google_callback(request: Request, next: str = "/"):
    """Volta do Google: troca o código pela sessão usando o desafio guardado aqui."""
    verifier = request.query_params.get("neon_auth_session_verifier")
    challenge = request.cookies.get(OAUTH_COOKIE, "")
    target = next if next.startswith("/") else "/"
    if not verifier or not challenge:
        return RedirectResponse(f"{target}?login=falhou", status_code=302)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        reply = await _call(client, "GET", f"/get-session?neon_auth_session_verifier={verifier}",
                            origin=_origin(request), cookie=challenge)
    session_cookie = _cookies_from(reply, NEON_SESSION_COOKIE)
    data = reply.json() if reply.status_code < 400 else None
    response = RedirectResponse(target if session_cookie and data else f"{target}?login=falhou", status_code=302)
    response.delete_cookie(OAUTH_COOKIE, path="/")
    if session_cookie:
        _set_cookie(response, SESSION_COOKIE, session_cookie, SESSION_MAX_AGE, request.url.scheme == "https")
    return response


def auth_origin_host() -> str:
    return urlparse(config.NEON_AUTH_BASE_URL or "").netloc
