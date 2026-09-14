"""Hashes perceptuais (etapa 2 da cascata).

Banco e consulta passam pela MESMA normalização geométrica: a carta retificada é reduzida
ao tamanho 'small' da Scryfall (146x204) e a região da arte é recortada numa caixa fixa.
Como a caixa é a mesma dos dois lados, o conteúdo coincide para qualquer moldura
(inclusive borderless/showcase), e a região evita nome e linha de tipo — logo o hash da arte
não depende do idioma impresso.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

CANON_W, CANON_H = 146, 204
ART_BOX = (0.12, 0.13, 0.88, 0.52)  # x0, y0, x1, y1 normalizados
HASH_BYTES = 32  # 256 bits


@dataclass
class CardHashes:
    art: np.ndarray    # (32,) uint8 — pHash 256 bits da região da arte
    full: np.ndarray   # (32,) uint8 — pHash 256 bits da carta inteira
    color: np.ndarray  # (32,) uint8 — assinatura de cor (a,b do Lab em grade 4x4)

    def art_hex(self) -> str:
        return self.art.tobytes().hex()

    def full_hex(self) -> str:
        return self.full.tobytes().hex()


def normalize_card(card_bgr: np.ndarray) -> np.ndarray:
    h, w = card_bgr.shape[:2]
    if (w, h) == (CANON_W, CANON_H):
        return card_bgr
    return cv2.resize(card_bgr, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)


def art_region(card: np.ndarray) -> np.ndarray:
    h, w = card.shape[:2]
    x0, y0, x1, y1 = ART_BOX
    return card[int(round(y0 * h)):int(round(y1 * h)), int(round(x0 * w)):int(round(x1 * w))]


def phash256(gray: np.ndarray) -> np.ndarray:
    small = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32)
    low = cv2.dct(small)[:16, :16]
    bits = (low > np.median(low)).astype(np.uint8).ravel()
    return np.packbits(bits)


def dhash64(gray: np.ndarray) -> np.ndarray:
    """Hash barato (64 bits) usado só para agrupamento temporal de frames."""
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    return np.packbits((small[:, 1:] > small[:, :-1]).astype(np.uint8).ravel())


def color_signature(art_bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(art_bgr, cv2.COLOR_BGR2LAB)
    grid = cv2.resize(lab, (4, 4), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(grid[:, :, 1:]).astype(np.uint8).ravel()


def compute_hashes(card_bgr: np.ndarray) -> CardHashes:
    card = normalize_card(card_bgr)
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    return CardHashes(
        art=phash256(art_region(gray)),
        full=phash256(gray),
        color=color_signature(art_region(card)),
    )


SLEEVE_INSET = (0.034, 0.025)  # margem de uma sleeve em volta da carta (fração por lado: largura, altura)
CONTEXT_EXPAND = 0.12          # a imagem de contexto é o quadrilátero ampliado 12% em torno do centro
# Recortes de consulta relativos ao quadrilátero detectado (fração por lado):
# como detectado · sem a margem da sleeve · ampliado (detector pegou a borda interna da moldura)
CROP_VARIANTS = ((0.0, 0.0), (-SLEEVE_INSET[0], -SLEEVE_INSET[1]), (0.045, 0.033))


def inset_card(card_bgr: np.ndarray, fx: float, fy: float) -> np.ndarray:
    h, w = card_bgr.shape[:2]
    dx, dy = int(round(fx * w)), int(round(fy * h))
    return card_bgr[dy:h - dy, dx:w - dx]


def crop_from_context(context_bgr: np.ndarray, dx: float, dy: float, expand: float = CONTEXT_EXPAND) -> np.ndarray:
    h, w = context_bgr.shape[:2]
    vw, vh = w / (1 + expand) * (1 + 2 * dx), h / (1 + expand) * (1 + 2 * dy)
    x0, y0 = (w - vw) / 2, (h - vh) / 2
    return context_bgr[max(0, int(round(y0))):int(round(y0 + vh)), max(0, int(round(x0))):int(round(x0 + vw))]


def _both_orientations(img: np.ndarray) -> list[CardHashes]:
    return [compute_hashes(img), compute_hashes(cv2.rotate(img, cv2.ROTATE_180))]


def compute_query_hashes(card_bgr: np.ndarray, context_bgr: np.ndarray | None = None) -> list[CardHashes]:
    """Hashes de consulta (o índice usa a melhor variante).

    Ordem: pares (0°, 180°) para cada recorte. Com imagem de contexto usa CROP_VARIANTS;
    sem contexto, só o recorte detectado e o recorte sem margem de sleeve.
    """
    out: list[CardHashes] = []
    if context_bgr is not None:
        for dx, dy in CROP_VARIANTS:
            out += _both_orientations(crop_from_context(context_bgr, dx, dy))
        return out
    out += _both_orientations(card_bgr)
    out += _both_orientations(inset_card(card_bgr, *SLEEVE_INSET))
    return out


def hamming(a: np.ndarray, b: np.ndarray) -> int:
    return int(np.bitwise_count(np.bitwise_xor(a, b)).sum())


def from_hex(value: str) -> np.ndarray:
    return np.frombuffer(bytes.fromhex(value), dtype=np.uint8)


def decode_image(data: bytes) -> np.ndarray | None:
    arr = np.frombuffer(data, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)
