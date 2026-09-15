"""Quem está chamando a API.

- local: um único usuário ("local"), sem login — o app roda na máquina da pessoa;
- neon: JWT da sessão do Neon Auth (Authorization: Bearer), assinado com EdDSA e verificado pela chave pública
  do projeto (JWKS). Emissor e audiência são a origem do endereço do Neon Auth; o token vale 15 minutos.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from urllib.parse import urlparse

from fastapi import HTTPException, Request

from . import config, db


@dataclass(frozen=True)
class User:
    id: str
    email: str | None = None
    name: str | None = None


LOCAL_USER = User(id=config.DEFAULT_USER_ID, name="Local")

_jwks_client = None
_jwks_lock = threading.Lock()
_known_users: set[str] = set()


def _jwks():
    global _jwks_client
    with _jwks_lock:
        if _jwks_client is None:
            import jwt

            _jwks_client = jwt.PyJWKClient(config.NEON_AUTH_JWKS_URL, cache_keys=True, lifespan=3600, timeout=10)
        return _jwks_client


def _origin(url: str) -> str:
    parts = urlparse(url)
    return f"{parts.scheme}://{parts.netloc}"


def verify_token(token: str) -> dict:
    import jwt

    origin = _origin(config.NEON_AUTH_BASE_URL)
    try:
        key = _jwks().get_signing_key_from_jwt(token)
        return jwt.decode(token, key.key, algorithms=["EdDSA"], audience=origin, issuer=origin, leeway=30)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(401, "sessão expirada — entre de novo") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "token inválido") from exc


def _remember(user: User) -> None:
    if user.id in _known_users:
        return
    db.app_db().execute(
        "INSERT INTO users (id, name, email, created_at) VALUES (?,?,?,?) "
        "ON CONFLICT (id) DO UPDATE SET email = COALESCE(excluded.email, users.email), "
        "name = COALESCE(excluded.name, users.name)",
        (user.id, user.name, user.email, db.now_iso()))
    _known_users.add(user.id)


def current_user(request: Request) -> User:
    if config.AUTH_MODE != "neon":
        return LOCAL_USER
    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not token:
        raise HTTPException(401, "faça login para continuar")
    claims = verify_token(token)
    if claims.get("banned"):
        raise HTTPException(403, "acesso bloqueado")
    user = User(id=str(claims.get("sub") or claims["id"]), email=claims.get("email") or None, name=claims.get("name") or None)
    _remember(user)
    return user
