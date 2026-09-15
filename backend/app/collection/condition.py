"""Estimativa de condição (NM / SP / MP / HP) pelo desgaste visível no recorte.

Sinal principal: "branqueamento" — pontos claros na borda e nos cantos de cartas de borda preta, onde a
tinta gasta e aparece o papelão. Reflexo de sleeve é descartado (manchas grandes, não pontos na borda).
É uma estimativa: a confiança cai com reflexo, pouca nitidez ou borda que não é preta, e o usuário sempre
pode corrigir. Sem confiança suficiente, não sugere nada.
"""
from __future__ import annotations

import cv2
import numpy as np

W, H = 488, 680
GRADES = ("NM", "SP", "MP", "HP")
THRESHOLDS = (0.006, 0.025, 0.07)   # fração de pixels claros na borda: NM < 0,6% < SP < 2,5% < MP < 7% < HP


def _band_masks(inset: float = 0.012, band: float = 0.028, corner: float = 0.09) -> tuple[np.ndarray, np.ndarray]:
    """Máscaras da faixa da borda (sem os cantos) e dos cantos, ignorando o arredondamento externo."""
    edge = np.zeros((H, W), bool)
    corners = np.zeros((H, W), bool)
    ix, iy = int(inset * W), int(inset * W)
    bw = int(band * W)
    cw = int(corner * W)
    edge[iy:iy + bw, cw:W - cw] = True
    edge[H - iy - bw:H - iy, cw:W - cw] = True
    edge[cw:H - cw, ix:ix + bw] = True
    edge[cw:H - cw, W - ix - bw:W - ix] = True
    yy, xx = np.mgrid[0:H, 0:W]
    radius = 0.045 * W
    for cx, cy in ((ix, iy), (W - 1 - ix, iy), (ix, H - 1 - iy), (W - 1 - ix, H - 1 - iy)):
        dx, dy = np.abs(xx - cx), np.abs(yy - cy)
        in_square = (dx < cw) & (dy < cw)
        in_band = (dx < bw) | (dy < bw)
        # fora do arco do canto arredondado aparece a mesa, não a carta
        outside_round = (dx < radius) & (dy < radius) & (np.hypot(radius - dx, radius - dy) > radius)
        corners |= in_square & in_band & ~outside_round
    return edge, corners


_EDGE_MASK, _CORNER_MASK = _band_masks()


def _bright_specks(gray: np.ndarray, hsv: np.ndarray, mask: np.ndarray) -> tuple[float, float]:
    vals = gray[mask]
    if vals.size == 0:
        return 0.0, 0.0
    base = float(np.median(vals))
    bright = (gray.astype(np.int16) > base + 70) & (hsv[:, :, 1] < 70) & mask
    n, labels, stats, _ = cv2.connectedComponentsWithStats(bright.astype(np.uint8), connectivity=8)
    specks = np.zeros_like(bright)
    max_blob = 0.004 * W * H  # manchas grandes = reflexo da sleeve, não desgaste
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] <= max_blob:
            specks |= labels == i
    return float(specks[mask].mean()), base


def estimate(card_bgr: np.ndarray, border_color: str | None = "black", quality: dict | None = None) -> dict:
    card = card_bgr if card_bgr.shape[:2] == (H, W) else cv2.resize(card_bgr, (W, H), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(card, cv2.COLOR_BGR2HSV)
    edge_frac, edge_base = _bright_specks(gray, hsv, _EDGE_MASK)
    corner_frac, _ = _bright_specks(gray, hsv, _CORNER_MASK)
    score = 0.6 * edge_frac + 0.4 * corner_frac
    grade = GRADES[int(np.searchsorted(THRESHOLDS, score, side="right"))]

    quality = quality or {}
    confidence = 0.7
    reasons = []
    if (border_color or "black") != "black":
        confidence *= 0.45
        reasons.append("borda não é preta (desgaste aparece menos)")
    if edge_base > 90:
        confidence *= 0.5
        reasons.append("borda clara no recorte (sleeve ou recorte deslocado)")
    glare = float(quality.get("glare") or 0)
    if glare > 0.03:
        confidence *= 0.55
        reasons.append("reflexo forte")
    sharp = float(quality.get("sharpness") or 999)
    if sharp < 80:
        confidence *= 0.6
        reasons.append("foto pouco nítida")
    return {"grade": grade, "score": round(score, 4), "confidence": round(confidence, 2),
            "signals": {"edge_whitening": round(edge_frac, 4), "corner_whitening": round(corner_frac, 4)},
            "reasons": reasons, "estimated": True}
