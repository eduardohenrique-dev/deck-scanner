"""Verificação geométrica local (ORB + RANSAC) do top-k do pHash contra a imagem oficial.

Ainda é etapa local e sem custo de modelo: só baixa (e guarda em cache) a imagem 'normal'
dos poucos candidatos ambíguos. Resolve casos em que o hash ficou perto mas sem margem.
"""
from __future__ import annotations

import threading

import cv2
import httpx
import numpy as np

from .. import config, db

_client_lock = threading.Lock()
_client: httpx.Client | None = None
REF_W, REF_H = 366, 510


def _http() -> httpx.Client:
    global _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(headers={"User-Agent": config.USER_AGENT}, timeout=20, follow_redirects=True)
        return _client


def reference_image(card_ref_id: str, face: int = 0) -> np.ndarray | None:
    if card_ref_id.startswith("__"):
        return None
    cache_dir = config.CACHE_DIR / "normal"
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{card_ref_id}_{face}.jpg"
    if path.exists():
        return cv2.imread(str(path), cv2.IMREAD_COLOR)
    row = db.catalog_db().execute("SELECT image_normal, faces FROM card_refs WHERE id=?", (card_ref_id,)).fetchone()
    if row is None:
        return None
    url = row["image_normal"]
    faces = db.loads(row["faces"], None) or []
    if face < len(faces) and faces[face].get("image_normal"):
        url = faces[face]["image_normal"]
    if not url:
        return None
    try:
        resp = _http().get(url)
        resp.raise_for_status()
    except httpx.HTTPError:
        return None
    path.write_bytes(resp.content)
    return cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)


def orb_match(query_bgr: np.ndarray, ref_bgr: np.ndarray) -> dict:
    q = cv2.cvtColor(cv2.resize(query_bgr, (REF_W, REF_H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    r = cv2.cvtColor(cv2.resize(ref_bgr, (REF_W, REF_H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(nfeatures=1500, fastThreshold=12)
    kq, dq = orb.detectAndCompute(q, None)
    kr, dr = orb.detectAndCompute(r, None)
    if dq is None or dr is None or len(kq) < 12 or len(kr) < 12:
        return {"inliers": 0, "good": 0, "orientation": None}
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(dq, dr, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.8 * p[1].distance]
    if len(good) < 10:
        return {"inliers": 0, "good": len(good), "orientation": None}
    src = np.float32([kq[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kr[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
    if H is None or mask is None:
        return {"inliers": 0, "good": len(good), "orientation": None}
    inliers = int(mask.sum())
    corners = np.float32([[0, 0], [REF_W, 0], [REF_W, REF_H], [0, REF_H]]).reshape(-1, 1, 2)
    mapped = cv2.perspectiveTransform(corners, H).reshape(4, 2)
    base = corners.reshape(4, 2)
    d0 = float(np.linalg.norm(mapped - base, axis=1).mean())
    d180 = float(np.linalg.norm(mapped - base[[2, 3, 0, 1]], axis=1).mean())
    diag = float(np.hypot(REF_W, REF_H))
    orientation = 0 if d0 <= d180 else 180
    if min(d0, d180) > 0.18 * diag:  # homografia absurda: casamento espúrio
        inliers //= 4
    return {"inliers": inliers, "good": len(good), "orientation": orientation}


def verify_candidate(query_bgr: np.ndarray, card_ref_id: str, face: int = 0) -> dict:
    ref = reference_image(card_ref_id, face)
    if ref is None:
        return {"inliers": 0, "good": 0, "orientation": None, "available": False}
    out = orb_match(query_bgr, ref)
    out["available"] = True
    return out
