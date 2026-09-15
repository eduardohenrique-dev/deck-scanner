"""Assinatura AWS V4 do storage S3 contra os exemplos oficiais da documentação da AWS (bucket examplebucket)."""
from __future__ import annotations

from datetime import datetime, timezone

from app.storage import EMPTY_SHA256, SigV4

SIGNER = SigV4("AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1")
WHEN = datetime(2013, 5, 24, tzinfo=timezone.utc)
HOST = "examplebucket.s3.amazonaws.com"


def _signature(headers: dict[str, str]) -> str:
    return headers["authorization"].rsplit("Signature=", 1)[1]


def test_get_object_header_signature():
    h = SIGNER.headers("GET", HOST, "/test.txt", headers={"Range": "bytes=0-9"}, payload_hash=EMPTY_SHA256, now=WHEN)
    assert "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date" in h["authorization"]
    assert _signature(h) == "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"


def test_list_objects_query_signature():
    h = SIGNER.headers("GET", HOST, "/", query={"max-keys": "2", "prefix": "J"}, now=WHEN)
    assert _signature(h) == "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"


def test_presigned_url():
    query = SIGNER.presign("GET", HOST, "/test.txt", 86400, now=WHEN)
    assert "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404" in query
    assert "X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" in query
