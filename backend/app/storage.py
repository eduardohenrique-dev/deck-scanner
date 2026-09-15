"""Arquivos do app (fotos enviadas, recortes das cartas, índice de hashes) atrás de uma interface única.

- local: diretório `data/storage`, servido pela própria API em /api/media com URL assinada (HMAC);
- supabase: bucket privado do Supabase Storage; o navegador recebe URLs assinadas pelo próprio Storage.

As chaves têm só letras, números, `-`, `_`, `.` e `/` (ex.: sessions/<id>/crops/<det>.jpg).
"""
from __future__ import annotations

import hashlib
import hmac
import re
import threading
import time
from pathlib import Path
from urllib.parse import quote

import httpx

from . import config

KEY_RE = re.compile(r"^[A-Za-z0-9_\-./]+$")


def _check_key(key: str) -> str:
    if not KEY_RE.match(key) or ".." in key or key.startswith("/"):
        raise ValueError(f"chave de storage inválida: {key!r}")
    return key


def sign(key: str, expires: int) -> str:
    msg = f"{key}:{expires}".encode()
    return hmac.new(config.MEDIA_SIGNING_SECRET.encode(), msg, hashlib.sha256).hexdigest()[:32]


def verify_signature(key: str, expires: int, signature: str) -> bool:
    return expires >= time.time() and hmac.compare_digest(sign(key, expires), signature)


class LocalStorage:
    backend = "local"

    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str) -> Path:
        return self.root / _check_key(key)

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(path)

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.exists() else None

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete_prefix(self, prefix: str) -> None:
        base = self._path(prefix.rstrip("/"))
        if base.is_dir():
            import shutil
            shutil.rmtree(base, ignore_errors=True)
        elif base.exists():
            base.unlink(missing_ok=True)

    def urls(self, keys: list[str], ttl: int = config.MEDIA_URL_TTL) -> dict[str, str]:
        # expiração arredondada para a hora: a mesma URL se repete e o navegador aproveita o cache
        expires = (int(time.time()) // 3600 + 2) * 3600
        return {k: f"/api/media/{quote(k)}?e={expires}&s={sign(k, expires)}" for k in keys if k}


class SupabaseStorage:
    backend = "supabase"

    def __init__(self, url: str, secret_key: str, bucket: str):
        self.base = f"{url}/storage/v1"
        self.bucket = bucket
        self._headers = {"apikey": secret_key, "Authorization": f"Bearer {secret_key}"} \
            if not secret_key.startswith("sb_") else {"apikey": secret_key}
        self._client = httpx.Client(timeout=30, headers=self._headers)
        self._bucket_checked = False
        self._lock = threading.Lock()

    def _ensure_bucket(self) -> None:
        if self._bucket_checked:
            return
        with self._lock:
            if self._bucket_checked:
                return
            r = self._client.get(f"{self.base}/bucket/{self.bucket}")
            if r.status_code in (400, 404):
                self._client.post(f"{self.base}/bucket", json={"id": self.bucket, "name": self.bucket, "public": False})
            self._bucket_checked = True

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self._ensure_bucket()
        r = self._client.post(f"{self.base}/object/{self.bucket}/{quote(_check_key(key))}", content=data,
                              headers={"Content-Type": content_type, "x-upsert": "true", "cache-control": "3600"})
        r.raise_for_status()

    def get(self, key: str) -> bytes | None:
        r = self._client.get(f"{self.base}/object/authenticated/{self.bucket}/{quote(_check_key(key))}")
        if r.status_code in (400, 404):
            return None
        r.raise_for_status()
        return r.content

    def exists(self, key: str) -> bool:
        r = self._client.head(f"{self.base}/object/authenticated/{self.bucket}/{quote(_check_key(key))}")
        return r.status_code == 200

    def delete_prefix(self, prefix: str) -> None:
        prefix = _check_key(prefix.rstrip("/"))
        paths: list[str] = []
        stack = [prefix]
        while stack:
            folder = stack.pop()
            offset = 0
            while True:
                r = self._client.post(f"{self.base}/object/list/{self.bucket}",
                                      json={"prefix": folder + "/", "limit": 1000, "offset": offset})
                if r.status_code != 200:
                    break
                items = r.json()
                for it in items:
                    full = f"{folder}/{it['name']}"
                    (paths if it.get("id") else stack).append(full)
                if len(items) < 1000:
                    break
                offset += 1000
        for i in range(0, len(paths), 500):
            self._client.request("DELETE", f"{self.base}/object/{self.bucket}", json={"prefixes": paths[i:i + 500]})

    def urls(self, keys: list[str], ttl: int = config.MEDIA_URL_TTL) -> dict[str, str]:
        keys = [k for k in dict.fromkeys(keys) if k]
        out: dict[str, str] = {}
        for i in range(0, len(keys), 500):
            part = keys[i:i + 500]
            r = self._client.post(f"{self.base}/object/sign/{self.bucket}", json={"expiresIn": ttl, "paths": part})
            if r.status_code != 200:
                continue
            for item in r.json():
                if item.get("signedURL"):
                    out[item["path"]] = f"{self.base}{item['signedURL']}"
        return out


_storage = None
_storage_lock = threading.Lock()


def get_storage():
    global _storage
    if _storage is None:
        with _storage_lock:
            if _storage is None:
                if config.STORAGE_BACKEND == "supabase":
                    _storage = SupabaseStorage(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, config.STORAGE_BUCKET)
                else:
                    _storage = LocalStorage(config.STORAGE_DIR)
    return _storage


# ---------------------------------------------------------------- chaves padronizadas
def crop_key(session_id: str, detection_id: str) -> str:
    return f"sessions/{session_id}/crops/{detection_id}.jpg"


def capture_key(session_id: str, capture_id: str, ext: str = ".jpg") -> str:
    return f"sessions/{session_id}/captures/{capture_id}{ext}"


def session_prefix(session_id: str) -> str:
    return f"sessions/{session_id}"
