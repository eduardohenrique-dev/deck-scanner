"""Métricas de qualidade: nitidez (variância do laplaciano), reflexo e frontalidade."""
from __future__ import annotations

import math

import cv2
import numpy as np


def sharpness(card_bgr: np.ndarray) -> float:
    gray = cv2.cvtColor(card_bgr, cv2.COLOR_BGR2GRAY) if card_bgr.ndim == 3 else card_bgr
    g = cv2.resize(gray, (244, 340), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(g, cv2.CV_32F).var())


def glare_ratio(card_bgr: np.ndarray) -> float:
    hsv = cv2.cvtColor(cv2.resize(card_bgr, (244, 340), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2HSV)
    mask = (hsv[:, :, 2] >= 240) & (hsv[:, :, 1] <= 50)
    return float(mask.mean())


def frontalness(pts: np.ndarray) -> float:
    p = np.asarray(pts, dtype=np.float32)
    s = [float(np.linalg.norm(p[i] - p[(i + 1) % 4])) for i in range(4)]
    r1 = min(s[0], s[2]) / max(s[0], s[2], 1e-6)
    r2 = min(s[1], s[3]) / max(s[1], s[3], 1e-6)
    ratio = ((s[1] + s[3]) / 2) / max((s[0] + s[2]) / 2, 1e-6)
    ratio_fit = max(0.0, 1 - abs(ratio - 88 / 63) / 0.35)
    return float(0.35 * r1 + 0.35 * r2 + 0.3 * ratio_fit)


def sharp_norm(value: float) -> float:
    return float(np.clip((math.log10(max(value, 1.0)) - 1.3) / (3.2 - 1.3), 0.0, 1.0))


def frame_quality(card_bgr: np.ndarray, pts: np.ndarray, frame_shape: tuple) -> dict:
    sharp = sharpness(card_bgr)
    glare = glare_ratio(card_bgr)
    front = frontalness(pts)
    area = float(cv2.contourArea(np.asarray(pts, np.float32)))
    size = area / float(frame_shape[0] * frame_shape[1])
    score = 0.55 * sharp_norm(sharp) + 0.25 * (1 - min(1.0, glare * 8)) + 0.2 * front
    return {"sharpness": round(sharp, 1), "glare": round(glare, 4), "frontal": round(front, 3),
            "size": round(size, 4), "score": round(score, 4)}


def image_quality(img: np.ndarray) -> dict:
    """Qualidade da foto inteira (mesmos critérios do overlay ao vivo no dispositivo)."""
    h, w = img.shape[:2]
    scale = 1024.0 / max(h, w)
    small = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else img
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    lap = float(cv2.Laplacian(gray, cv2.CV_32F).var())
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    # reflexo = pixels estourados (quase 255) — molduras e caixas de texto brancas não contam
    glare = float(((hsv[:, :, 2] >= 252) & (hsv[:, :, 1] <= 20)).mean())
    brightness = float(gray.mean())
    warnings = []
    if lap < 60:
        warnings.append("blur")
    if glare > 0.04:
        warnings.append("glare")
    if brightness < 50:
        warnings.append("dark")
    return {"sharpness": round(lap, 1), "glare": round(glare, 4), "brightness": round(brightness, 1),
            "warnings": warnings, "score": round(sharp_norm(lap) * (1 - min(1.0, glare * 10)), 3)}
