"""'Isso é mesmo uma carta?': o layout separa carta de mesa, mão ou caixa de arte."""
from __future__ import annotations

import cv2
import numpy as np

from app.vision import cardness


def _fake_card() -> np.ndarray:
    """Retângulo com a estrutura de uma carta: faixas horizontais e linhas de texto."""
    h, w = 680, 488
    img = np.full((h, w, 3), 70, np.uint8)
    img[int(0.10 * h):int(0.55 * h)] = 150  # arte
    for frac in (0.093, 0.548, 0.617, 0.905):  # linhas da moldura
        cv2.line(img, (0, int(frac * h)), (w, int(frac * h)), (240, 240, 240), 3)
    for i in range(6):  # linhas de texto na caixa de regras
        y = int((0.66 + i * 0.035) * h)
        cv2.line(img, (int(0.1 * w), y), (int(0.9 * w), y), (235, 235, 235), 2)
    return img


def test_card_layout_scores_high():
    assert cardness.cardness(_fake_card())["score"] >= cardness.CARD_MIN


def test_table_and_flat_surfaces_score_low():
    rng = np.random.default_rng(7)
    wood = np.clip(np.linspace(40, 90, 680)[:, None, None] + rng.normal(0, 3, (680, 488, 3)), 0, 255).astype(np.uint8)
    assert cardness.cardness(wood)["score"] < cardness.CARD_MIN
    assert cardness.cardness(np.full((680, 488, 3), 200, np.uint8))["score"] < cardness.CARD_MIN
