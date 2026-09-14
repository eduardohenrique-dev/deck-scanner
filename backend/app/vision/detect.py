"""Etapa 1 (local): detecção de retângulos de carta, correção de perspectiva e recorte."""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

CARD_RATIO = 88.0 / 63.0
WARP_W, WARP_H = 488, 680
RATIO_MIN, RATIO_MAX = 1.18, 1.70


@dataclass
class CardQuad:
    pts: np.ndarray          # (4,2) float32 na imagem original: tl, tr, br, bl (retrato)
    score: float
    area: float
    ratio: float
    support: float = 0.0
    kind: str = "full"       # full | partial
    extras: dict = field(default_factory=dict)

    @property
    def center(self) -> np.ndarray:
        return self.pts.mean(axis=0)

    def bbox(self) -> tuple[float, float, float, float]:
        x0, y0 = self.pts.min(axis=0)
        x1, y1 = self.pts.max(axis=0)
        return float(x0), float(y0), float(x1), float(y1)

    @property
    def width(self) -> float:
        p = self.pts
        return float((np.linalg.norm(p[0] - p[1]) + np.linalg.norm(p[3] - p[2])) / 2)

    @property
    def height(self) -> float:
        p = self.pts
        return float((np.linalg.norm(p[1] - p[2]) + np.linalg.norm(p[0] - p[3])) / 2)


def order_quad(pts: np.ndarray) -> np.ndarray:
    """Ordena em sentido horário a partir do canto superior-esquerdo e força retrato (lado 0→1 curto)."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    pts = pts[np.argsort(ang)]
    pts = np.roll(pts, -int(np.argmin(pts.sum(axis=1))), axis=0)
    w = np.linalg.norm(pts[0] - pts[1]) + np.linalg.norm(pts[3] - pts[2])
    h = np.linalg.norm(pts[1] - pts[2]) + np.linalg.norm(pts[0] - pts[3])
    if w > h:
        pts = np.roll(pts, -1, axis=0)
    return pts.astype(np.float32)


def _angles_ok(q: np.ndarray, lo: float = 55.0, hi: float = 125.0) -> tuple[bool, float]:
    worst = 0.0
    for i in range(4):
        a, b, c = q[i - 1], q[i], q[(i + 1) % 4]
        v1, v2 = a - b, c - b
        denom = float(np.linalg.norm(v1) * np.linalg.norm(v2))
        if denom <= 1e-6:
            return False, 90.0
        ang = float(np.degrees(np.arccos(np.clip(np.dot(v1, v2) / denom, -1.0, 1.0))))
        if ang < lo or ang > hi:
            return False, abs(ang - 90)
        worst = max(worst, abs(ang - 90))
    return True, worst


def _contour_quads(cnt: np.ndarray) -> list[np.ndarray]:
    hull = cv2.convexHull(cnt)
    peri = cv2.arcLength(hull, True)
    for eps in (0.02, 0.035, 0.05):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            return [approx.reshape(4, 2).astype(np.float32)]
    # fallback (dedos cobrindo um canto etc.): retângulo mínimo — não segue a perspectiva, só vale se nada melhor
    rect = cv2.minAreaRect(hull)
    rw, rh = rect[1]
    if rw * rh > 0 and cv2.contourArea(hull) / (rw * rh) >= 0.86:
        return [cv2.boxPoints(rect).astype(np.float32)]
    return []


def _sides_parallel(a: np.ndarray, b: np.ndarray, max_deg: float = 2.5) -> bool:
    """Quadriláteros ordenados com lados correspondentes paralelos (contornos concêntricos da mesma carta)."""
    for i in range(4):
        va, vb = a[(i + 1) % 4] - a[i], b[(i + 1) % 4] - b[i]
        cos = abs(float(np.dot(va, vb))) / max(float(np.linalg.norm(va) * np.linalg.norm(vb)), 1e-6)
        if np.degrees(np.arccos(min(1.0, cos))) > max_deg:
            return False
    return True


def _binary_maps(small: np.ndarray, gray: np.ndarray) -> list[np.ndarray]:
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    med = float(np.median(blur))
    k3 = np.ones((3, 3), np.uint8)
    maps = []
    auto = cv2.Canny(blur, int(max(10, 0.66 * med)), int(min(255, 1.33 * med + 20)))
    maps.append(cv2.morphologyEx(cv2.dilate(auto, k3, iterations=2), cv2.MORPH_CLOSE, k3))
    # sem dilatação: preserva o vão fino entre cartas encostadas
    maps.append(cv2.morphologyEx(cv2.Canny(blur, 40, 120), cv2.MORPH_CLOSE, k3))
    weak = cv2.Canny(blur, 20, 60)
    maps.append(cv2.dilate(weak, k3, iterations=1))
    # borda preta das cartas contra fundos mais claros
    block = max(15, (min(gray.shape) // 16) | 1)
    adapt = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, block, 8)
    maps.append(cv2.morphologyEx(adapt, cv2.MORPH_CLOSE, k3, iterations=2))
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    maps.append(otsu)
    maps.append(255 - otsu)
    # cartas de borda clara/colorida: canal de saturação ajuda em mesas neutras
    sat = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)[:, :, 1]
    sat_edges = cv2.Canny(cv2.GaussianBlur(sat, (5, 5), 0), 30, 90)
    maps.append(cv2.dilate(sat_edges, k3, iterations=2))
    return maps


def _edge_support(q: np.ndarray, edges: np.ndarray, samples: int = 48) -> float:
    h, w = edges.shape
    hits = total = 0
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        ts = np.linspace(0.08, 0.92, samples)
        pts = a[None, :] * (1 - ts[:, None]) + b[None, :] * ts[:, None]
        xs = np.clip(pts[:, 0].round().astype(int), 0, w - 1)
        ys = np.clip(pts[:, 1].round().astype(int), 0, h - 1)
        hits += int((edges[ys, xs] > 0).sum())
        total += samples
    return hits / max(total, 1)


def _intersection(a: np.ndarray, b: np.ndarray) -> float:
    area, _ = cv2.intersectConvexConvex(a.reshape(-1, 1, 2), b.reshape(-1, 1, 2))
    return float(area)


def detect_cards(img: np.ndarray, *, max_dim: int = 1280, min_area_frac: float = 0.003,
                 max_area_frac: float = 0.7, include_partial: bool = False) -> list[CardQuad]:
    H, W = img.shape[:2]
    scale = min(1.0, max_dim / float(max(H, W)))
    small = cv2.resize(img, (int(W * scale), int(H * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else img
    h, w = small.shape[:2]
    img_area = float(h * w)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    support_edges = cv2.dilate(cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 30, 100), np.ones((5, 5), np.uint8))

    raw: list[CardQuad] = []
    partial_raw: list[CardQuad] = []
    for m in _binary_maps(small, gray):
        contours, _ = cv2.findContours(m, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area_frac * img_area or area > max_area_frac * img_area:
                continue
            for q in _contour_quads(cnt):
                q = order_quad(q)
                sides = [np.linalg.norm(q[i] - q[(i + 1) % 4]) for i in range(4)]
                if min(sides) < 12:
                    continue
                if min(sides[0], sides[2]) / max(sides[0], sides[2]) < 0.6:
                    continue
                if min(sides[1], sides[3]) / max(sides[1], sides[3]) < 0.6:
                    continue
                ok, dev = _angles_ok(q)
                if not ok:
                    continue
                qarea = float(cv2.contourArea(q))
                if qarea < min_area_frac * img_area or qarea > max_area_frac * img_area:
                    continue
                ratio = ((sides[1] + sides[3]) / 2) / ((sides[0] + sides[2]) / 2)
                support = _edge_support(q, support_edges)
                if support < 0.35:
                    continue
                ratio = float(ratio)
                ratio_fit = max(0.0, 1 - abs(ratio - CARD_RATIO) / 0.3)
                score = float(0.5 * support + 0.3 * ratio_fit + 0.2 * (1 - dev / 35.0))
                cq = CardQuad(pts=q, score=score, area=qarea, ratio=ratio, support=float(support))
                if RATIO_MIN <= ratio <= RATIO_MAX:
                    raw.append(cq)
                elif include_partial and support >= 0.55:
                    cq.kind = "partial"
                    partial_raw.append(cq)

    kept = _nms(raw)
    if include_partial and kept:
        kept += _filter_partials(_nms(partial_raw), kept)
    margin = 0.006 * max(w, h)
    for q in kept:
        near_border = ((q.pts[:, 0] <= margin) | (q.pts[:, 0] >= w - 1 - margin) |
                       (q.pts[:, 1] <= margin) | (q.pts[:, 1] >= h - 1 - margin))
        if near_border.any():
            q.kind = "edge"  # cortada pela borda da foto: geometria incompleta
        q.pts = (q.pts / scale).astype(np.float32)
        q.area = q.area / (scale * scale)
    kept.sort(key=lambda q: (round(q.center[1] / max(q.height, 1)), q.center[0]))
    return kept


def _nms(cands: list[CardQuad]) -> list[CardQuad]:
    cands = sorted(cands, key=lambda c: -c.score)
    kept: list[CardQuad] = []
    for c in cands:
        dup = False
        for idx, k in enumerate(kept):
            inter = _intersection(c.pts, k.pts)
            union = c.area + k.area - inter
            if union > 0 and inter / union > 0.65:
                dup = True
                # mesma carta em contornos concêntricos (borda interna da moldura, borda da carta, sleeve):
                # prefere o mais externo com boa evidência — os recortes de consulta compensam a sleeve
                if (c.area > k.area * 1.03 and c.support >= 0.9 * k.support and inter / k.area > 0.9
                        and _sides_parallel(c.pts, k.pts)):
                    kept[idx] = c
                break
        if not dup:
            kept.append(c)
    # contained[i] = quadriláteros dentro de kept[i]
    contained: dict[int, list[int]] = {i: [] for i in range(len(kept))}
    for i, a in enumerate(kept):
        for j, b in enumerate(kept):
            if i == j or b.area >= a.area * 0.75:
                continue
            if _intersection(a.pts, b.pts) / max(b.area, 1) > 0.85:
                contained[i].append(j)
    groups = {i for i in contained if _is_group(kept[i], [kept[j] for j in contained[i]])}
    result = []
    for i, c in enumerate(kept):
        if i in groups:
            continue
        # elemento interno (caixa de arte/texto, carta dentro da sleeve) de uma carta maior já aceita
        if any(i in inner and j not in groups for j, inner in contained.items()):
            continue
        result.append(c)
    return result


def _point_line_dist(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    ab = b - a
    denom = float(np.linalg.norm(ab))
    if denom < 1e-6:
        return float(np.linalg.norm(p - a))
    return abs(float(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0]))) / denom


def _shared_sides(inner: CardQuad, outer: CardQuad, tol: float) -> int:
    count = 0
    for i in range(4):
        a, b = inner.pts[i], inner.pts[(i + 1) % 4]
        for k in range(4):
            c, d = outer.pts[k], outer.pts[(k + 1) % 4]
            if _point_line_dist(a, c, d) < tol and _point_line_dist(b, c, d) < tol:
                count += 1
                break
    return count


def _is_group(outer: CardQuad, inner: list[CardQuad]) -> bool:
    """Contêiner de várias cartas (ex.: duas cartas encostadas viram um retângulo só).

    Cartas encostadas compartilham lados com o contorno do grupo e cobrem quase toda a área.
    Caixas de arte/texto ficam recuadas da borda da carta, então não compartilham lados.
    """
    def disjoint(qs: list[CardQuad]) -> list[CardQuad]:
        chosen: list[CardQuad] = []
        for q in sorted(qs, key=lambda x: -x.area):
            if all(_intersection(q.pts, c.pts) / min(q.area, c.area) < 0.2 for c in chosen):
                chosen.append(q)
        return chosen

    # várias cartas soltas dentro (pasta, área da mesa): 3+ retângulos de carta sem sobreposição
    if len(disjoint([q for q in inner if 0.03 * outer.area <= q.area <= 0.5 * outer.area])) >= 3:
        return True
    tol = 0.03 * min(outer.width, outer.height)
    big = disjoint([q for q in inner if q.area >= 0.25 * outer.area and _shared_sides(q, outer, tol) >= 2])
    return len(big) >= 2 and sum(q.area for q in big) >= 0.75 * outer.area


def long_axis_angle(pts: np.ndarray) -> float:
    """Ângulo (graus, 0–180) do eixo longo do quadrilátero em retrato."""
    p = np.asarray(pts, np.float32)
    v = ((p[3] - p[0]) + (p[2] - p[1])) / 2
    return float(np.degrees(np.arctan2(v[1], v[0])) % 180.0)


def dominant_angle(quads: list[CardQuad], min_count: int = 3) -> float | None:
    full = [q for q in quads if q.kind in ("full", "edge")] if min_count <= 2 else [q for q in quads if q.kind == "full"]
    if len(full) < min_count:
        return None
    # média circular com período de 180°
    ang = np.radians([long_axis_angle(q.pts) * 2 for q in full])
    weights = np.array([q.area for q in full])
    return float(np.degrees(np.arctan2((np.sin(ang) * weights).sum(), (np.cos(ang) * weights).sum())) / 2 % 180.0)


def is_inner_element(q: CardQuad, median_area: float | None, dom_angle: float | None) -> bool:
    """Caixa de arte/texto de uma carta cujo contorno não foi detectado (ex.: carta cortada pela borda)."""
    if median_area is None or dom_angle is None or q.area >= 0.6 * median_area:
        return False
    diff = abs(long_axis_angle(q.pts) - dom_angle) % 180.0
    return min(diff, 180.0 - diff) > 55.0


def _card_from_axes(center: np.ndarray, width_axis: np.ndarray, height_axis: np.ndarray, card_w: float) -> np.ndarray:
    card_h = card_w * CARD_RATIO
    hw, hh = width_axis * card_w / 2, height_axis * card_h / 2
    return order_quad(np.float32([center - hw - hh, center + hw - hh, center + hw + hh, center - hw + hh]))


def hypotheses(q: CardQuad, median_area: float | None, dom_angle: float | None = None) -> list[tuple[str, list[np.ndarray]]]:
    """Geometrias alternativas para um quadrilátero que o hash não resolveu.

    - "split": duas cartas encostadas formam um retângulo com a proporção de uma carta deitada
    - "extend_*": carta parcialmente coberta pela vizinha (ou cortada pela borda) — estende até a proporção real
    - "parent_*": o quadrilátero é a caixa de arte/texto; reconstrói a carta pela geometria da moldura
    """
    p = q.pts.astype(np.float32)
    u = ((p[1] - p[0]) + (p[2] - p[3])) / 2
    v = ((p[3] - p[0]) + (p[2] - p[1])) / 2
    w, h = float(np.linalg.norm(u)), float(np.linalg.norm(v))
    if w < 1 or h < 1:
        return []
    uh, vh = u / w, v / h
    r = h / w
    out: list[tuple[str, list[np.ndarray]]] = []
    if is_inner_element(q, median_area, dom_angle):
        # elemento deitado: o eixo longo dele é a LARGURA da carta; a altura da carta segue ±u
        c = p.mean(axis=0)
        card_w = h / 0.84
        card_h = card_w * CARD_RATIO
        for sign in (1.0, -1.0):
            if 1.15 <= r <= 1.6:   # caixa de arte: centro a 0.33 da altura (carta a 0.5)
                out.append(("parent_art", [_card_from_axes(c + sign * uh * 0.17 * card_h, vh, uh * sign, card_w)]))
            if 1.5 <= r <= 2.3:    # caixa de texto: centro a ~0.765 da altura
                out.append(("parent_text", [_card_from_axes(c - sign * uh * 0.265 * card_h, vh, uh * sign, card_w)]))
        return out
    if median_area and q.area >= 1.35 * median_area:  # divisão falsa é inofensiva: só vale se o hash aceitar
        # bloco de N cartas encostadas ao longo do eixo longo. Lado a lado: o lado curto do bloco é a ALTURA
        # da carta; empilhadas: é a LARGURA. Cada carta é ancorada a partir das extremidades do bloco.
        options = []
        for unit, card_side_u in ((w / CARD_RATIO, w), (w * CARD_RATIO, w)):
            n = int(round(h / unit))
            if 2 <= n <= 5:
                options.append((abs(h / unit - n), n, unit))
        if options:
            _, n, unit = min(options)
            step = (h - unit) / (n - 1)
            parts = []
            for i in range(n):
                a0, a1 = p[0] + vh * (i * step), p[1] + vh * (i * step)
                parts.append(order_quad(np.float32([a0, a1, a1 + vh * unit, a0 + vh * unit])))
            out.append(("split", parts))
    if r > 1.44:
        d = uh * (h / CARD_RATIO - w)
        out.append(("extend_left", [np.float32([p[0] - d, p[1], p[2], p[3] - d])]))
        out.append(("extend_right", [np.float32([p[0], p[1] + d, p[2] + d, p[3]])]))
    if r < 1.36:
        d = vh * (w * CARD_RATIO - h)
        out.append(("extend_down", [np.float32([p[0], p[1], p[2] + d, p[3] + d])]))
        out.append(("extend_up", [np.float32([p[0] - d, p[1] - d, p[2], p[3]])]))
    return out


def _filter_partials(partials: list[CardQuad], full: list[CardQuad]) -> list[CardQuad]:
    widths = sorted(q.width for q in full)
    ref_w = widths[len(widths) // 2]
    out = []
    for p in partials:
        short = min(p.width, p.height)
        if not (0.7 * ref_w <= short <= 1.3 * ref_w):
            continue
        if any(_intersection(p.pts, f.pts) / max(p.area, 1) > 0.3 for f in full):
            continue
        out.append(p)
    return out


def detect_primary_card(frame: np.ndarray, max_dim: int = 960) -> CardQuad | None:
    """Modo vídeo: a carta dominante (maior e mais central) do frame."""
    quads = detect_cards(frame, max_dim=max_dim, min_area_frac=0.02)
    if not quads:
        return None
    H, W = frame.shape[:2]
    center = np.array([W / 2, H / 2], dtype=np.float32)
    diag = float(np.hypot(W, H))

    def rank(q: CardQuad) -> float:
        dist = float(np.linalg.norm(q.center - center)) / diag
        return (q.area / (W * H)) * (0.6 + q.score) * (1.2 - dist) * (0.5 if q.kind == "edge" else 1.0)

    return max(quads, key=rank)


def warp_card(img: np.ndarray, pts: np.ndarray, out_w: int = WARP_W, out_h: int = WARP_H,
              expand: float = 0.0) -> np.ndarray:
    q = np.asarray(pts, dtype=np.float32).copy()
    if expand:
        c = q.mean(axis=0)
        q = c + (q - c) * (1 + expand)
    side_h = max(np.linalg.norm(q[1] - q[2]), np.linalg.norm(q[0] - q[3]))
    inter_h = int(min(max(out_h, side_h), 1400))
    inter_w = int(round(inter_h * out_w / out_h))
    dst = np.float32([[0, 0], [inter_w - 1, 0], [inter_w - 1, inter_h - 1], [0, inter_h - 1]])
    M = cv2.getPerspectiveTransform(q, dst)
    warped = cv2.warpPerspective(img, M, (inter_w, inter_h), flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_REPLICATE)
    if (inter_w, inter_h) != (out_w, out_h):
        warped = cv2.resize(warped, (out_w, out_h), interpolation=cv2.INTER_AREA)
    return warped


def quad_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = _intersection(np.asarray(a, np.float32), np.asarray(b, np.float32))
    ua = float(cv2.contourArea(np.asarray(a, np.float32)))
    ub = float(cv2.contourArea(np.asarray(b, np.float32)))
    union = ua + ub - inter
    return inter / union if union > 0 else 0.0
