"""Leitura de imagens enviadas (respeita a orientação EXIF de fotos de celular; aceita HEIC)."""
from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image, ImageOps

try:  # fotos de iPhone
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:  # noqa: BLE001
    pass

MAX_SIDE = 4200


def _from_pil(im: Image.Image) -> np.ndarray:
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")
    w, h = im.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1:
        im = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)


def load_image(path: str) -> np.ndarray:
    with Image.open(path) as im:
        return _from_pil(im)


def load_image_bytes(data: bytes) -> np.ndarray:
    """Decodifica foto enviada (JPEG/PNG/WebP/HEIC) já com a orientação EXIF aplicada."""
    with Image.open(io.BytesIO(data)) as im:
        return _from_pil(im)


def encode_jpeg(img: np.ndarray, quality: int = 90) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("falha ao codificar JPEG")
    return buf.tobytes()


def decode_jpeg(data: bytes) -> np.ndarray | None:
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
