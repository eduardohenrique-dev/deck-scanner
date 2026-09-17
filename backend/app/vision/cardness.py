"""'Isso é mesmo uma carta?' pelo LAYOUT do recorte — porta de frontend/src/vision/cardness.ts.

O detector aceita qualquer retângulo com proporção de carta: a caixa de arte da própria carta, a tela do
celular, um envelope, a borda da mesa. O que só uma carta tem é a estrutura interna — faixa do nome, arte,
linha de tipo e caixa de texto — e é isso que as três medidas abaixo olham. Usado como desempate: recorte
que o hash NÃO reconheceu e que não tem cara de carta vira ruído em vez de encher a revisão.
"""
from __future__ import annotations

import cv2
import numpy as np

W, H = 122, 170
LAYOUT_ROWS = (0.093, 0.548, 0.617, 0.905)
ROW_TOLERANCE = 0.022
TEXT_BAND = (0.63, 0.90)
# abaixo disso não parece carta (calibrado junto com o lado do navegador, tools-js/cardness-eval.mjs)
CARD_MIN = 0.5


def cardness(card_bgr: np.ndarray) -> dict:
    """Recebe a carta já retificada. Devolve as medidas e o `score` de 0 a 1."""
    gray = cv2.cvtColor(card_bgr, cv2.COLOR_BGR2GRAY) if card_bgr.ndim == 3 else card_bgr
    small = cv2.resize(gray, (W, H), interpolation=cv2.INTER_AREA)
    sobel = np.abs(cv2.Sobel(small, cv2.CV_32F, 0, 1, ksize=3))
    rows = sobel[:, 6:W - 6].mean(axis=1)
    base = max(float(np.median(rows)), 1.0)
    norm = rows / base

    peaks = []
    for frac in LAYOUT_ROWS:
        lo = max(0, int(round((frac - ROW_TOLERANCE) * H)))
        hi = min(H - 1, int(round((frac + ROW_TOLERANCE) * H)))
        peaks.append(float(norm[lo:hi + 1].max()))
    peaks.sort(reverse=True)
    layout = _clamp(((peaks[0] + peaks[1]) / 2 - 1.4) / 2.2)

    lo, hi = int(TEXT_BAND[0] * H), int(TEXT_BAND[1] * H)
    lines = sum(1 for y in range(lo + 1, hi) if norm[y] > 1.35 and norm[y] >= norm[y - 1] and norm[y] > norm[y + 1])
    text = _clamp((lines - 1) / 7)
    detail = _clamp((base - 4) / 14)

    score = _clamp(0.75 * layout + 0.15 * text + 0.1 * detail)
    return {"layout": round(layout, 3), "text": round(text, 3), "detail": round(detail, 3), "score": round(score, 3)}


def _clamp(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else float(v)
