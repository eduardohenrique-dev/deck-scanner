"""Arquivos do app (fotos enviadas, recortes das cartas, índice de hashes) atrás de uma interface única.

- local: diretório `data/storage`, servido pela própria API em /api/media com URL assinada (HMAC);
- s3: bucket privado compatível com S3 (Cloudflare R2, por exemplo). As requisições são assinadas com
  AWS Signature V4 aqui mesmo (sem boto3, que pesaria no pacote da função) e o navegador recebe URLs
  pré-assinadas que expiram.

As chaves têm só letras, números, `-`, `_`, `.` e `/` (ex.: sessions/<id>/crops/<det>.jpg).
"""
from __future__ import annotations

import hashlib
import hmac
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse
from xml.etree import ElementTree

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


# ---------------------------------------------------------------- AWS Signature V4
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()


def _uri_encode(value: str, safe: str = "") -> str:
    return quote(value, safe="-_.~" + safe)


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


class SigV4:
    """Assinatura AWS V4 para o serviço S3 (cabeçalho Authorization e URL pré-assinada)."""

    def __init__(self, access_key: str, secret_key: str, region: str, service: str = "s3"):
        self.access_key = access_key
        self.secret_key = secret_key
        self.region = region
        self.service = service

    def _scope(self, date: str) -> str:
        return f"{date}/{self.region}/{self.service}/aws4_request"

    def _signature(self, amz_date: str, canonical_request: str) -> str:
        date = amz_date[:8]
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, self._scope(date),
                             hashlib.sha256(canonical_request.encode()).hexdigest()])
        key = _hmac(_hmac(_hmac(_hmac(f"AWS4{self.secret_key}".encode(), date), self.region), self.service),
                    "aws4_request")
        return hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def _canonical_query(params: dict[str, str]) -> str:
        return "&".join(f"{_uri_encode(k)}={_uri_encode(v)}" for k, v in sorted(params.items()))

    def headers(self, method: str, host: str, path: str, query: dict[str, str] | None = None,
                headers: dict[str, str] | None = None, payload_hash: str = EMPTY_SHA256,
                now: datetime | None = None) -> dict[str, str]:
        amz_date = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
        all_headers = {k.lower(): str(v).strip() for k, v in (headers or {}).items()}
        all_headers.update({"host": host, "x-amz-date": amz_date, "x-amz-content-sha256": payload_hash})
        names = sorted(all_headers)
        canonical = "\n".join([
            method, _uri_encode(path, safe="/"), self._canonical_query(query or {}),
            "".join(f"{n}:{all_headers[n]}\n" for n in names), ";".join(names), payload_hash,
        ])
        credential = f"{self.access_key}/{self._scope(amz_date[:8])}"
        auth = (f"AWS4-HMAC-SHA256 Credential={credential}, SignedHeaders={';'.join(names)}, "
                f"Signature={self._signature(amz_date, canonical)}")
        out = {k: v for k, v in all_headers.items() if k != "host"}
        out["authorization"] = auth
        return out

    def presign(self, method: str, host: str, path: str, expires: int, now: datetime | None = None) -> str:
        amz_date = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
        query = {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": f"{self.access_key}/{self._scope(amz_date[:8])}",
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": str(expires),
            "X-Amz-SignedHeaders": "host",
        }
        canonical = "\n".join([method, _uri_encode(path, safe="/"), self._canonical_query(query),
                               f"host:{host}\n", "host", "UNSIGNED-PAYLOAD"])
        query["X-Amz-Signature"] = self._signature(amz_date, canonical)
        return self._canonical_query(query)


class S3Storage:
    backend = "s3"

    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str, region: str = "auto"):
        parts = urlparse(endpoint)
        self.scheme = parts.scheme or "https"
        self.host = parts.netloc
        self.bucket = bucket
        self.signer = SigV4(access_key, secret_key, region)
        self._client = httpx.Client(timeout=httpx.Timeout(60, connect=10))

    def _path(self, key: str = "") -> str:
        return f"/{self.bucket}/{_check_key(key)}" if key else f"/{self.bucket}"

    def _request(self, method: str, key: str = "", *, query: dict[str, str] | None = None, content: bytes = b"",
                 headers: dict[str, str] | None = None) -> httpx.Response:
        path = self._path(key)
        payload = hashlib.sha256(content).hexdigest() if content else EMPTY_SHA256
        signed = self.signer.headers(method, self.host, path, query, headers, payload)
        # a query vai exatamente como foi assinada (o httpx codificaria diferente e a assinatura não bateria)
        url = f"{self.scheme}://{self.host}{_uri_encode(path, safe='/')}"
        if query:
            url += "?" + SigV4._canonical_query(query)
        for attempt in range(3):
            r = self._client.request(method, url, content=content or None, headers=signed)
            if r.status_code not in (429, 500, 502, 503, 504) or attempt == 2:
                return r
            time.sleep(0.4 * (attempt + 1))
            signed = self.signer.headers(method, self.host, path, query, headers, payload)
        return r

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        r = self._request("PUT", key, content=data, headers={"content-type": content_type})
        r.raise_for_status()

    def get(self, key: str) -> bytes | None:
        r = self._request("GET", key)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.content

    def exists(self, key: str) -> bool:
        return self._request("HEAD", key).status_code == 200

    def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        token = None
        while True:
            query = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
            if token:
                query["continuation-token"] = token
            r = self._request("GET", query=query)
            r.raise_for_status()
            truncated, token = False, None
            for el in ElementTree.fromstring(r.content):
                tag = el.tag.rsplit("}", 1)[-1]  # ignora o namespace do XML do S3
                if tag == "Contents":
                    keys += [c.text for c in el if c.tag.rsplit("}", 1)[-1] == "Key" and c.text]
                elif tag == "IsTruncated":
                    truncated = el.text == "true"
                elif tag == "NextContinuationToken":
                    token = el.text
            if not truncated or not token:
                return keys

    def delete_prefix(self, prefix: str) -> None:
        keys = self.list_keys(_check_key(prefix.rstrip("/")) + "/")
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda k: self._request("DELETE", k), keys))

    def urls(self, keys: list[str], ttl: int = config.MEDIA_URL_TTL) -> dict[str, str]:
        # assinatura fixa por hora: a mesma URL se repete entre recargas e o navegador usa o cache
        hour = datetime.fromtimestamp(int(time.time()) // 3600 * 3600, timezone.utc)
        out = {}
        for k in dict.fromkeys(keys):
            if not k:
                continue
            path = self._path(k)
            query = self.signer.presign("GET", self.host, path, ttl + 3600, now=hour)
            out[k] = f"{self.scheme}://{self.host}{_uri_encode(path, safe='/')}?{query}"
        return out


_storage = None
_storage_lock = threading.Lock()


def get_storage():
    global _storage
    if _storage is None:
        with _storage_lock:
            if _storage is None:
                if config.STORAGE_BACKEND == "s3":
                    _storage = S3Storage(config.S3_ENDPOINT, config.S3_BUCKET, config.S3_ACCESS_KEY_ID,
                                         config.S3_SECRET_ACCESS_KEY, config.S3_REGION)
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
