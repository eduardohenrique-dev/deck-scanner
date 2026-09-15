"""Qual impressão exatamente: idioma e coleção quando a arte é a mesma.

O pHash da arte identifica a ilustração, mas a mesma arte sai em várias coleções e idiomas. O que muda fica
FORA da arte: nome, linha de tipo e caixa de texto (idioma), símbolo da coleção, rodapé e moldura (coleção).

Os scans oficiais em outros idiomas vêm com resolução e enquadramento diferentes. Por isso a foto é
primeiro ALINHADA a cada imagem oficial pela própria arte (idêntica em todas as impressões: ORB +
homografia). Como a homografia vem só da arte, o erro cresce nas bordas da carta: cada região ainda é
reencaixada com uma busca local (correlação normalizada de gradientes suavizados, que tolera luz e nitidez
diferentes). Pixels estourados de reflexo não contam.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

W, H = 366, 510
ART_BOX = (0.08, 0.10, 0.92, 0.55)
CONTEXT_EXPAND = 0.12  # igual a hashing.CONTEXT_EXPAND

# regiões normalizadas (x0, y0, x1, y1) e peso
TEXT_REGIONS = {
    "title": ((0.06, 0.035, 0.80, 0.10), 1.0),
    "type": ((0.06, 0.555, 0.82, 0.615), 1.2),
    "text": ((0.07, 0.63, 0.93, 0.90), 2.0),
}
PRINT_REGIONS = {
    # o símbolo da coleção é o sinal mais estável entre reimpressões; rodapé e texto sofrem com a nitidez
    "symbol": ((0.80, 0.552, 0.945, 0.618), 3.0),
    "footer": ((0.03, 0.915, 0.70, 0.975), 0.8),
    "frame_top": ((0.00, 0.00, 1.00, 0.12), 0.8),
    "frame_bottom": ((0.00, 0.54, 1.00, 1.00), 0.5),
}
SEARCH = 7      # pixels de reencaixe por região depois do alinhamento pela arte
SEARCH_RAW = 12  # sem alinhamento


@dataclass
class RegionScore:
    total: float
    regions: dict[str, float | None]
    aligned: bool = False


def _mask(w: int, h: int, box: tuple[float, float, float, float]) -> np.ndarray:
    m = np.zeros((h, w), np.uint8)
    x0, y0, x1, y1 = box
    m[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = 255
    return m


_orb = cv2.ORB_create(nfeatures=2000, fastThreshold=10)
_REF_MASK = _mask(W, H, ART_BOX)


def _context_art_box() -> tuple[float, float, float, float]:
    s = 1.0 / (1.0 + CONTEXT_EXPAND)
    x0, y0, x1, y1 = ART_BOX
    return (0.5 + (x0 - 0.5) * s, 0.5 + (y0 - 0.5) * s, 0.5 + (x1 - 0.5) * s, 0.5 + (y1 - 0.5) * s)


def query_features(query_bgr: np.ndarray, query_is_context: bool = False):
    if query_is_context:  # carta inteira com margem: mantém a resolução da carta e restringe a busca à arte
        qw, qh = int(round(W * (1 + CONTEXT_EXPAND))), int(round(H * (1 + CONTEXT_EXPAND)))
        qmask = _mask(qw, qh, _context_art_box())
    else:
        qw, qh, qmask = W, H, _REF_MASK
    q = cv2.resize(query_bgr, (qw, qh), interpolation=cv2.INTER_AREA)
    kq, dq = _orb.detectAndCompute(cv2.cvtColor(q, cv2.COLOR_BGR2GRAY), qmask)
    return q, kq, dq, qw, qh


def ref_features(ref_bgr: np.ndarray):
    rg = cv2.cvtColor(cv2.resize(ref_bgr, (W, H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    return _orb.detectAndCompute(rg, _REF_MASK)


def align(query_bgr: np.ndarray, ref_bgr: np.ndarray, query_is_context: bool = False, qfeat=None, rfeat=None
          ) -> tuple[np.ndarray, np.ndarray] | None:
    """Foto levada ao referencial da imagem oficial (e máscara dos pixels que vieram da foto)."""
    q, kq, dq, qw, qh = qfeat if qfeat is not None else query_features(query_bgr, query_is_context)
    kr, dr = rfeat if rfeat is not None else ref_features(ref_bgr)
    if dq is None or dr is None or len(kq) < 15 or len(kr) < 15:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(dq, dr, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.8 * p[1].distance]
    if len(good) < 12:
        return None
    src = np.float32([kq[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kr[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    # MAGSAC++: homografia mais precisa que o RANSAC clássico — o erro de escala da arte vira desalinhamento
    # de vários pixels no texto, que fica longe dos pontos usados
    method = getattr(cv2, "USAC_MAGSAC", cv2.RANSAC)
    M, inl = cv2.findHomography(src, dst, method, 2.5, maxIters=4000, confidence=0.999)
    if M is None or inl is None or int(inl.sum()) < 10:
        return None
    # sanidade: a carta da foto precisa cair perto da carta oficial
    if query_is_context:
        off = (np.array([qw, qh]) - np.array([W, H])) / 2
        card = np.float32([[off[0], off[1]], [off[0] + W, off[1]], [off[0] + W, off[1] + H], [off[0], off[1] + H]])
    else:
        card = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    moved = cv2.perspectiveTransform(card.reshape(-1, 1, 2), M).reshape(4, 2)
    target = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    if float(np.linalg.norm(moved - target, axis=1).max()) > 0.12 * np.hypot(W, H):
        return None
    aligned = cv2.warpPerspective(q, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    valid = cv2.warpPerspective(np.full((qh, qw), 255, np.uint8), M, (W, H), flags=cv2.INTER_NEAREST) > 0
    return aligned, valid


def _prep(img_bgr: np.ndarray, valid: np.ndarray | None = None, blur: float = 1.4) -> tuple[np.ndarray, np.ndarray]:
    img = cv2.resize(img_bgr, (W, H), interpolation=cv2.INTER_AREA) if img_bgr.shape[:2] != (H, W) else img_bgr
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    ok = ~((hsv[:, :, 2] >= 245) & (hsv[:, :, 1] <= 30))
    if valid is not None:
        ok &= valid
    ok = cv2.erode(ok.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    # suaviza os dois lados igualmente: scans oficiais têm nitidez bem diferente das fotos
    gray = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), blur)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.GaussianBlur(np.sqrt(gx * gx + gy * gy), (0, 0), 1.0)
    mean = cv2.blur(mag, (21, 21))
    sq = cv2.blur(mag * mag, (21, 21))
    std = np.sqrt(np.maximum(sq - mean * mean, 1e-3))
    norm = (mag - mean) / (std + 3.0)
    norm[~ok] = 0.0  # sem evidência: neutro para a correlação
    return norm.astype(np.float32), ok


def _box(region) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = region
    return int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)


def _region_similarity(q: np.ndarray, qok: np.ndarray, r: np.ndarray, region, search: int) -> float:
    """A região da imagem oficial procurada numa janela ±search da foto alinhada (matchTemplate)."""
    x0, y0, x1, y1 = _box(region)
    templ = r[y0:y1, x0:x1]
    sx0, sy0 = max(0, x0 - search), max(0, y0 - search)
    sx1, sy1 = min(W, x1 + search), min(H, y1 + search)
    window = q[sy0:sy1, sx0:sx1]
    if window.shape[0] < templ.shape[0] or window.shape[1] < templ.shape[1]:
        # região encostada na borda: reduz o gabarito ao que cabe
        th, tw = min(templ.shape[0], window.shape[0]), min(templ.shape[1], window.shape[1])
        templ = templ[:th, :tw]
    if float(qok[sy0:sy1, sx0:sx1].mean()) < 0.45 or float(np.abs(templ).sum()) < 1e-3:
        return float("nan")
    res = cv2.matchTemplate(window, templ, cv2.TM_CCOEFF_NORMED)
    return float(res.max())


def _combine(q: np.ndarray, qok: np.ndarray, r: np.ndarray, regions: dict, search: int, aligned: bool) -> RegionScore:
    per, wsum, total = {}, 0.0, 0.0
    for name, (region, weight) in regions.items():
        v = _region_similarity(q, qok, r, region, search)
        per[name] = None if np.isnan(v) else round(v, 4)
        if not np.isnan(v):
            total += weight * v
            wsum += weight
    return RegionScore(total=total / wsum if wsum else float("nan"), regions=per, aligned=aligned)


class QueryMatcher:
    """Uma foto comparada com várias imagens oficiais: pontos ORB e alinhamentos calculados uma vez só."""

    def __init__(self, query_bgr: np.ndarray, query_is_context: bool = False):
        self.query = query_bgr
        self.is_context = query_is_context
        self._qfeat = None
        self._aligned: dict[str, tuple[np.ndarray, np.ndarray] | None] = {}
        self._prepped: dict[tuple[str, float], tuple[np.ndarray, np.ndarray]] = {}
        self._refs: dict[tuple[str, float], np.ndarray] = {}

    def _alignment(self, ref_id: str, ref_bgr: np.ndarray):
        if ref_id not in self._aligned:
            if self._qfeat is None:
                self._qfeat = query_features(self.query, self.is_context)
            self._aligned[ref_id] = align(self.query, ref_bgr, self.is_context, qfeat=self._qfeat)
        return self._aligned[ref_id]

    def score(self, ref_id: str, ref_bgr: np.ndarray, regions: dict, blur: float = 1.4) -> RegionScore:
        aligned = self._alignment(ref_id, ref_bgr)
        if aligned is None and self.is_context:
            return RegionScore(total=float("nan"), regions={}, aligned=False)
        key = (ref_id, blur)
        if key not in self._prepped:
            self._prepped[key] = _prep(aligned[0], aligned[1], blur) if aligned is not None \
                else _prep(self.query, None, blur)
        if key not in self._refs:
            self._refs[key] = _prep(ref_bgr, None, blur)[0]
        q, qok = self._prepped[key]
        return _combine(q, qok, self._refs[key], regions, SEARCH if aligned is not None else SEARCH_RAW,
                        aligned is not None)

    def rank(self, references: dict[str, np.ndarray], regions: dict, blur: float = 1.4) -> list[tuple[str, RegionScore]]:
        out = [(key, self.score(key, ref, regions, blur)) for key, ref in references.items()]
        out.sort(key=lambda kv: -(kv[1].total if not np.isnan(kv[1].total) else -9))
        return out


def score(query_bgr: np.ndarray, reference_bgr: np.ndarray, regions: dict, query_is_context: bool = False,
          blur: float = 1.4) -> RegionScore:
    return QueryMatcher(query_bgr, query_is_context).score("ref", reference_bgr, regions, blur)


def rank(query_bgr: np.ndarray, references: dict[str, np.ndarray], regions: dict, query_is_context: bool = False,
         blur: float = 1.4) -> list[tuple[str, RegionScore]]:
    """Ordena as impressões candidatas (id → imagem oficial) pela semelhança fora da arte."""
    return QueryMatcher(query_bgr, query_is_context).rank(references, regions, blur)
