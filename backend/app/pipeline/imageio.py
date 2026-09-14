"""Leitura de imagens enviadas (respeita a orientação EXIF de fotos de celular; aceita HEIC)."""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image, ImageOps

try:  # fotos de iPhone
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:  # noqa: BLE001
    pass

MAX_SIDE = 4200


def load_image(path: str) -> np.ndarray:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, MAX_SIDE / max(w, h))
        if scale < 1:
            im = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        arr = np.asarray(im)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
