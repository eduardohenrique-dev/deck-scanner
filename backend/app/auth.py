"""Quem está chamando a API.

- local: um único usuário ("local"), sem login — o app roda na máquina da pessoa;
- supabase: token de acesso do Supabase Auth (Authorization: Bearer) verificado pela chave pública do
  projeto (JWKS, ES256/RS256) ou pelo segredo legado (HS256).
"""
from __future__ import annotations

import threading
from dataclasses import dataclass

from fastapi import HTTPException, Request

from . import config, db


@dataclass(frozen=True)
class User:
    id: str
    email: str | None = None
    name: str | None = None
    anonymous: bool = False


LOCAL_USER = User(id=config.DEFAULT_USER_ID, name="Local")

_jwks_client = None
_jwks_lock = threading.Lock()
_known_users: set[str] = set()


def _jwks():
    global _jwks_client
    with _jwks_lock:
        if _jwks_client is None:
            import jwt

            _jwks_client = jwt.PyJWKClient(f"{config.SUPABASE_URL}/auth/v1/.well-known/jwks.json",
                                           cache_keys=True, lifespan=600, timeout=10)
        return _jwks_client


def verify_token(token: str) -> dict:
    import jwt

    issuer = f"{config.SUPABASE_URL}/auth/v1"
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") == "HS256":
            if not config.SUPABASE_JWT_SECRET:
                raise HTTPException(401, "token não verificável (configure SUPABASE_JWT_SECRET)")
            return jwt.decode(token, config.SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated",
                              issuer=issuer)
        key = _jwks().get_signing_key_from_jwt(token)
        return jwt.decode(token, key.key, algorithms=["ES256", "RS256"], audience="authenticated", issuer=issuer)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(401, "sessão expirada — entre de novo") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "token inválido") from exc


def _remember(user: User) -> None:
    if user.id in _known_users:
        return
    db.app_db().execute(
        "INSERT INTO users (id, name, email, created_at) VALUES (?,?,?,?) "
        "ON CONFLICT (id) DO UPDATE SET email = COALESCE(excluded.email, users.email)",
        (user.id, user.name, user.email, db.now_iso()))
    _known_users.add(user.id)


def current_user(request: Request) -> User:
    if config.AUTH_MODE != "supabase":
        return LOCAL_USER
    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not token:
        raise HTTPException(401, "faça login para continuar")
    claims = verify_token(token)
    meta = claims.get("user_metadata") or {}
    user = User(id=claims["sub"], email=claims.get("email") or None,
                name=meta.get("full_name") or meta.get("name") or None,
                anonymous=bool(claims.get("is_anonymous")))
    _remember(user)
    return user
