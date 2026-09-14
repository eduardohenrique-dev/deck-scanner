"""Deduplicação de captura (modo foto).

A mesma carta física aparece em várias fotos porque a mesa foi fotografada em pedaços sobrepostos.
Sinais, em ordem de força:
  1. Registro geométrico entre fotos (ORB + homografia RANSAC; cartas numa mesa formam um plano):
     projeta cada carta da foto A na foto B — mesma posição + mesma carta ⇒ mesma carta física.
     Isso separa corretamente 4 cópias idênticas lado a lado.
  2. Sem homografia: impressão idêntica + contexto espacial (vizinhos iguais na mesma posição relativa),
     com hash do recorte e marcas físicas como desempate.
Duas detecções da MESMA foto nunca colapsam (posições distintas = cartas distintas).
Na dúvida: não colapsa e marca "possível duplicata" para revisão (contar duas vezes irrita menos
que apagar uma carta em silêncio). Decisões do usuário são preservadas.
"""
from __future__ import annotations

import itertools

import cv2
import numpy as np

from ..vision import detect, hashing
from . import store
from .imageio import load_image

_homography_cache: dict[tuple[str, str], np.ndarray | None] = {}
_features_cache: dict[str, tuple] = {}
USER_STATUSES = ("user_same", "user_different")


def _features(cap: dict):
    hit = _features_cache.get(cap["id"])
    if hit is not None:
        return hit
    img = load_image(cap["file_path"])
    h, w = img.shape[:2]
    scale = min(1.0, 1600.0 / max(h, w))
    gray = cv2.cvtColor(cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                        if scale < 1 else img, cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(nfeatures=5000, fastThreshold=8)
    kps, desc = orb.detectAndCompute(gray, None)
    pts = np.float32([k.pt for k in kps]) / scale if kps else np.zeros((0, 2), np.float32)
    hit = (pts, desc, (w, h), img)
    _features_cache[cap["id"]] = hit
    return hit


def estimate_homography(cap_a: dict, cap_b: dict) -> np.ndarray | None:
    key = (cap_a["id"], cap_b["id"])
    if key in _homography_cache:
        return _homography_cache[key]
    pa, da, (wa, ha), _ = _features(cap_a)
    pb, db_, (wb, hb), _ = _features(cap_b)
    H = None
    if da is not None and db_ is not None and len(pa) >= 30 and len(pb) >= 30:
        pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(da, db_, k=2)
        good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]
        if len(good) >= 30:
            src = np.float32([pa[m.queryIdx] for m in good]).reshape(-1, 1, 2)
            dst = np.float32([pb[m.trainIdx] for m in good]).reshape(-1, 1, 2)
            thresh = 0.006 * float(np.hypot(wb, hb))
            M, mask = cv2.findHomography(src, dst, cv2.RANSAC, thresh)
            if M is not None and mask is not None:
                inliers = int(mask.sum())
                det = float(np.linalg.det(M[:2, :2]))
                if inliers >= 25 and inliers / len(good) >= 0.2 and 0.15 < det < 6.0:
                    H = M
    _homography_cache[key] = H
    _homography_cache[(cap_b["id"], cap_a["id"])] = np.linalg.inv(H) if H is not None else None
    return H


def _quad_px(d: dict, cap: dict) -> np.ndarray:
    return np.array(d["bbox"]["quad"], dtype=np.float32) * np.array([cap["w"], cap["h"]], dtype=np.float32)


def _best_overlap(proj: np.ndarray, candidates: list[dict], quads: dict[str, np.ndarray]) -> tuple[dict | None, float, float]:
    area_a = float(cv2.contourArea(proj))
    best, best_overlap, best_iou = None, 0.0, 0.0
    for b in candidates:
        qb = quads[b["id"]]
        inter = float(cv2.intersectConvexConvex(proj.reshape(-1, 1, 2), qb.reshape(-1, 1, 2))[0])
        area_b = float(cv2.contourArea(qb))
        overlap = inter / max(min(area_a, area_b), 1.0)  # relativa à menor área: tolera recorte cortado/estendido
        if overlap > best_overlap:
            best, best_overlap = b, overlap
            best_iou = inter / max(area_a + area_b - inter, 1.0)
    return best, best_overlap, best_iou


def _agree(h1: np.ndarray, h2: np.ndarray, anchor_b: np.ndarray, dbb: list[dict], cap_b: dict) -> bool:
    """A homografia ORB concorda com a da âncora nas cartas próximas dela (até 2,5 larguras de carta)."""
    card_w = float(np.linalg.norm(anchor_b[0] - anchor_b[1]))
    center = anchor_b.mean(axis=0)
    quads = [q for q in (_quad_px(b, cap_b) for b in dbb) if np.linalg.norm(q.mean(axis=0) - center) <= 2.5 * card_w]
    pts = np.concatenate(quads + [anchor_b]).reshape(-1, 1, 2)
    back1 = cv2.perspectiveTransform(pts, np.linalg.inv(h1))
    back2 = cv2.perspectiveTransform(pts, np.linalg.inv(h2))
    return float(np.linalg.norm(back1 - back2, axis=2).max()) <= 0.3 * card_w


def homography_consistent(H: np.ndarray, da: list[dict], dbb: list[dict], cap_a: dict, cap_b: dict) -> tuple[bool, dict]:
    """Valida o registro geométrico com as próprias detecções.

    Arte repetida (4 cópias da mesma carta) engana o RANSAC: ele alinha uma cópia com OUTRA e a
    homografia parece boa. Projetando as demais cartas identificadas, uma homografia espúria faz
    cartas caírem sobre cartas diferentes — isso a invalida.
    """
    quads_b = {b["id"]: _quad_px(b, cap_b) for b in dbb}
    ident_b = [b for b in dbb if identity(b)]
    W, Hh = cap_b["w"], cap_b["h"]
    count_a = {}
    for a in da:
        if identity(a):
            count_a[identity(a)] = count_a.get(identity(a), 0) + 1
    count_b = {}
    for b in ident_b:
        count_b[identity(b)] = count_b.get(identity(b), 0) + 1
    consistent = inconsistent = unique_anchors = 0
    matched_ids: set[str] = set()
    for a in da:
        if identity(a) is None:
            continue
        proj = cv2.perspectiveTransform(_quad_px(a, cap_a).reshape(-1, 1, 2), H).reshape(4, 2)
        cx, cy = proj.mean(axis=0)
        if not (0 <= cx <= W and 0 <= cy <= Hh):
            continue
        best, overlap, _ = _best_overlap(proj, ident_b, quads_b)
        if best is not None and overlap >= 0.6:
            if identity(best) == identity(a):
                consistent += 1
                matched_ids.add(identity(a))
                if count_a.get(identity(a)) == 1 and count_b.get(identity(a)) == 1:
                    unique_anchors += 1
            else:
                inconsistent += 1
            continue
        # carta caiu bem dentro da outra foto, mas lá não há nada: registro provavelmente espúrio
        inside = 0.12 * W <= cx <= 0.88 * W and 0.12 * Hh <= cy <= 0.88 * Hh
        any_there, any_overlap, _ = _best_overlap(proj, dbb, quads_b)
        if inside and (any_there is None or any_overlap < 0.3):
            inconsistent += 1
    # cópias idênticas (4 Lightning Bolts) não servem de âncora sozinhas
    ok = (unique_anchors >= 1 or len(matched_ids) >= 2) and inconsistent <= consistent // 3
    return ok, {"consistent": consistent, "inconsistent": inconsistent, "unique_anchors": unique_anchors}


def _anchors(da: list[dict], dbb: list[dict]) -> list[tuple[dict, dict]]:
    """Pares de cartas com identidade ÚNICA nas duas fotos (cópias idênticas e versos não servem de âncora)."""
    def unique(ds: list[dict]) -> dict[str, dict]:
        count: dict[str, list[dict]] = {}
        for d in ds:
            if d["status"] == "identified" and d.get("oracle_id") and (d.get("quality") or {}).get("kind") != "edge":
                count.setdefault(d["oracle_id"], []).append(d)
        return {k: v[0] for k, v in count.items() if len(v) == 1}
    ua, ub = unique(da), unique(dbb)
    return [(ua[k], ub[k]) for k in ua.keys() & ub.keys()]


def anchor_homography(da: list[dict], dbb: list[dict], cap_a: dict, cap_b: dict) -> tuple[np.ndarray | None, int]:
    """Homografia a partir dos cantos das cartas-âncora (imune a arte repetida)."""
    pairs = _anchors(da, dbb)
    if not pairs:
        return None, 0
    qa = [_quad_px(a, cap_a) for a, _ in pairs]
    qb = [_quad_px(b, cap_b) for _, b in pairs]
    card_w = float(np.median([np.linalg.norm(q[0] - q[1]) for q in qb]))
    best: tuple[int, float, np.ndarray | None] = (0, 1e18, None)
    for shift in range(4):  # a ordem dos cantos pode girar entre fotos (celular girado)
        src = np.concatenate(qa).reshape(-1, 1, 2)
        dst = np.concatenate([np.roll(q, -shift, axis=0) for q in qb]).reshape(-1, 1, 2)
        if len(pairs) == 1:
            H = cv2.getPerspectiveTransform(src.reshape(4, 2), dst.reshape(4, 2))
            cards_ok = 1
        else:
            H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 0.05 * card_w)
            if H is None:
                continue
            cards_ok = int(sum(mask.reshape(-1, 4).sum(axis=1) >= 3))
        err = float(np.linalg.norm(cv2.perspectiveTransform(src, H) - dst, axis=2).mean())
        if cards_ok > best[0] or (cards_ok == best[0] and err < best[1]):
            best = (cards_ok, err, H)
    cards_ok, err, H = best
    if H is None or err > 0.08 * card_w or (len(pairs) >= 2 and cards_ok < 2):
        return None, 0
    return H, cards_ok


def register_photos(caps: dict[str, dict], by_cap: dict[str, list[dict]]) -> tuple[dict, callable]:
    """Registro geométrico global das fotos da mesa.

    Aresta entre duas fotos: homografia pelos cantos de ≥2 cartas-âncora, ou por 1 âncora quando o registro
    ORB da imagem inteira concorda com ela. As fotos são então ligadas por árvore geradora máxima
    (arestas com mais âncoras primeiro) e as homografias compostas num referencial comum.
    """
    ordered = sorted(caps, key=lambda c: caps[c]["idx"])
    direct: dict[tuple[str, str], np.ndarray] = {}
    weight: dict[tuple[str, str], int] = {}
    for ca, cb in itertools.combinations(ordered, 2):
        da, dbb = by_cap[ca], by_cap[cb]
        if not da or not dbb:
            continue
        anchor_h, n_anchor = anchor_homography(da, dbb, caps[ca], caps[cb])
        orb = estimate_homography(caps[ca], caps[cb])
        chosen, w = None, 0
        if orb is not None:
            ok, info = homography_consistent(orb, da, dbb, caps[ca], caps[cb])
            if ok and info["unique_anchors"] >= 2:
                chosen, w = orb, 10 * info["unique_anchors"]          # forte: ORB + ≥2 âncoras únicas
            elif ok and anchor_h is not None and n_anchor == 1:
                anchor_b = _quad_px(_anchors(da, dbb)[0][1], caps[cb])
                if _agree(anchor_h, orb, anchor_b, dbb, caps[cb]):
                    chosen, w = orb, 1                                 # fraca: 1 âncora que concorda com o ORB
        if chosen is None and anchor_h is not None and n_anchor >= 2:
            if homography_consistent(anchor_h, da, dbb, caps[ca], caps[cb])[0]:
                chosen, w = anchor_h, 10 * n_anchor                    # forte: cantos de ≥2 âncoras
        if chosen is None:
            continue
        direct[(ca, cb)], direct[(cb, ca)] = chosen, np.linalg.inv(chosen)
        weight[(ca, cb)] = weight[(cb, ca)] = w
    to_root: dict[str, tuple[str, np.ndarray]] = {}
    for start in sorted(ordered, key=lambda c: -sum(w for (x, _), w in weight.items() if x == c)):
        if start in to_root:
            continue
        to_root[start] = (start, np.eye(3))
        while True:  # Prim: sempre a aresta mais forte saindo da árvore
            frontier = [(weight[(y, x)], y, x) for (y, x) in direct if x in to_root and y not in to_root]
            if not frontier:
                break
            _, y, x = max(frontier)
            to_root[y] = (start, to_root[x][1] @ direct[(y, x)])

    def pair_h(a: str, b: str) -> np.ndarray | None:
        if (a, b) in direct:
            return direct[(a, b)]
        (ra, ta), (rb, tb) = to_root[a], to_root[b]
        if ra != rb:
            return None
        composed = np.linalg.inv(tb) @ ta
        # composição de arestas já validadas: basta não contradizer as cartas do par (acumula erro)
        _, info = homography_consistent(composed, by_cap[a], by_cap[b], caps[a], caps[b])
        return composed if info["inconsistent"] <= info["consistent"] // 3 else None

    return direct, pair_h


def _context_score(a: dict, b: dict) -> float:
    na = [n for n in (a.get("neighbors") or []) if n.get("oracle_id")]
    nb = [n for n in (b.get("neighbors") or []) if n.get("oracle_id")]
    if not na or not nb:
        return 0.0
    used, hits = set(), 0
    for x in na:
        for i, y in enumerate(nb):
            if i in used or x["oracle_id"] != y["oracle_id"]:
                continue
            if abs(x["dx"] - y["dx"]) <= 0.6 and abs(x["dy"] - y["dy"]) <= 0.6:
                used.add(i)
                hits += 1
                break
    return hits / max(len(na), len(nb))


def _crop_similarity(a: dict, b: dict) -> float:
    if not a.get("full_phash") or not b.get("full_phash"):
        return 0.0
    d = hashing.hamming(hashing.from_hex(a["full_phash"]), hashing.from_hex(b["full_phash"]))
    return float(np.clip(1 - d / 110.0, 0, 1))


def _wear_similarity(a: dict, b: dict) -> float:
    """Marcas físicas: compara bordas (desgaste/riscos/reflexo da sleeve) no anel externo do recorte."""
    ia, ib = cv2.imread(a["crop_path"], cv2.IMREAD_GRAYSCALE), cv2.imread(b["crop_path"], cv2.IMREAD_GRAYSCALE)
    if ia is None or ib is None:
        return 0.0
    ea = cv2.Canny(cv2.resize(ia, (244, 340)), 60, 160)
    eb = cv2.Canny(cv2.resize(ib, (244, 340)), 60, 160)
    ring = np.ones_like(ea, dtype=bool)
    ring[26:-26, 26:-26] = False
    ka, kb = cv2.dilate(ea, np.ones((5, 5), np.uint8)) > 0, cv2.dilate(eb, np.ones((5, 5), np.uint8)) > 0
    inter = np.logical_and(ka, kb)[ring].sum()
    union = np.logical_or(ka, kb)[ring].sum()
    return float(inter / union) if union else 0.0


def identity(d: dict) -> str | None:
    """Identidade para deduplicação: carta identificada ou verso (versos também não podem contar em dobro)."""
    if d["status"] == "identified":
        return d.get("oracle_id")
    if d["status"] == "back":
        return "__back__"
    return None


class _UnionFind:
    def __init__(self, dets: list[dict]):
        self.parent = {d["id"]: d["id"] for d in dets}
        self.captures = {d["id"]: {d["capture_id"]} for d in dets}
        self.oracles = {d["id"]: ({identity(d)} if identity(d) else set()) for d in dets}

    def find(self, x: str) -> str:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: str, b: str) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return True
        if self.captures[ra] & self.captures[rb]:
            return False  # colapsar juntaria duas cartas da mesma foto
        if self.oracles[ra] and self.oracles[rb] and self.oracles[ra] != self.oracles[rb]:
            return False  # nunca encadear cartas diferentes através de leituras falhas
        self.parent[rb] = ra
        self.captures[ra] |= self.captures.pop(rb)
        self.oracles[ra] |= self.oracles.pop(rb)
        return True


def run(session_id: str) -> dict:
    caps = {c["id"]: c for c in store.captures(session_id) if c["type"] == "image" and c["status"] == "done" and c.get("w")}
    all_dets = store.detections(session_id)
    dets = [d for d in all_dets if d["capture_id"] in caps and d.get("bbox")
            and (d["status"] in ("identified", "back")
                 or (d["status"] == "unidentified" and (d.get("quality") or {}).get("kind", "full") == "full"))]
    by_id = {d["id"]: d for d in dets}
    uf = _UnionFind(dets)
    forced, blocked = set(), set()
    for d in dets:
        info = d.get("dup_candidates") or {}
        for other in info.get("forced", []):
            forced.add(tuple(sorted((d["id"], other))))
        for other in info.get("blocked", []):
            blocked.add(tuple(sorted((d["id"], other))))
    for a, b in forced:
        if a in by_id and b in by_id:
            uf.union(a, b)

    reasons: dict[tuple[str, str], list[str]] = {}
    possible: dict[tuple[str, str], list[str]] = {}
    by_cap: dict[str, list[dict]] = {cid: [] for cid in caps}
    for d in dets:
        by_cap[d["capture_id"]].append(d)

    _, pair_h = register_photos(caps, by_cap)
    for ca, cb in itertools.combinations(sorted(caps, key=lambda c: caps[c]["idx"]), 2):
        da, dbb = by_cap[ca], by_cap[cb]
        if not da or not dbb:
            continue
        H = pair_h(ca, cb)  # direta ou composta pelo registro global; None = fotos sem ligação geométrica
        if H is not None:
            quads_b = {b["id"]: _quad_px(b, caps[cb]) for b in dbb}
            W, Hh = caps[cb]["w"], caps[cb]["h"]
            for a in da:
                proj = cv2.perspectiveTransform(_quad_px(a, caps[ca]).reshape(-1, 1, 2), H).reshape(4, 2)
                cx, cy = proj.mean(axis=0)
                if not (-0.02 * W <= cx <= 1.02 * W and -0.02 * Hh <= cy <= 1.02 * Hh):
                    continue
                best, best_overlap, best_iou = _best_overlap(proj, dbb, quads_b)
                if best is None:
                    continue
                both = identity(a) is not None and identity(best) is not None
                if (both and best_overlap < 0.6) or (not both and best_iou < 0.55):
                    continue
                pair = tuple(sorted((a["id"], best["id"])))
                if pair in blocked:
                    continue
                if both and identity(a) != identity(best):
                    possible[pair] = [f"mesma posição nas fotos {caps[ca]['idx']} e {caps[cb]['idx']}, "
                                      f"mas identificações diferentes"]
                    continue
                if uf.union(a["id"], best["id"]):
                    reasons[pair] = [f"mesma posição nas fotos {caps[ca]['idx']} e {caps[cb]['idx']} (registro geométrico)",
                                     "mesma carta" if both else "uma das leituras falhou; identidade herdada"]
            continue

        # sem homografia: impressão + contexto espacial; dúvida vira "possível duplicata"
        keys = {d["oracle_id"] for d in da if d["status"] == "identified"} & \
               {d["oracle_id"] for d in dbb if d["status"] == "identified"}
        for key in keys:
            A = [d for d in da if d["oracle_id"] == key and d["status"] == "identified"]
            B = [d for d in dbb if d["oracle_id"] == key and d["status"] == "identified"]
            scored = []
            for a in A:
                for b in B:
                    ctx = _context_score(a, b)
                    same_print = (a["card_ref_id"], a.get("language"), a.get("finish")) == \
                                 (b["card_ref_id"], b.get("language"), b.get("finish"))
                    tie = 0.1 * _crop_similarity(a, b) + 0.1 * (_wear_similarity(a, b) if len(A) > 1 or len(B) > 1 else 0)
                    scored.append((ctx + (0.15 if same_print else 0) + tie, ctx, same_print, a, b))
            used = set()
            for score, ctx, same_print, a, b in sorted(scored, key=lambda x: -x[0]):
                if a["id"] in used or b["id"] in used:
                    continue
                pair = tuple(sorted((a["id"], b["id"])))
                if pair in blocked:
                    continue
                used |= {a["id"], b["id"]}
                if ctx >= 0.5 and uf.union(a["id"], b["id"]):
                    reasons[pair] = ["mesma carta e mesmos vizinhos na mesma posição relativa"]
                else:
                    why = ["mesma impressão" if same_print else "mesma carta (impressão diferente)",
                           "vizinhos não conferem" if ctx < 0.5 else "vizinhos conferem parcialmente"]
                    possible[pair] = why

    clusters: dict[str, list[dict]] = {}
    for d in dets:
        clusters.setdefault(uf.find(d["id"]), []).append(d)

    merged = 0
    for members in clusters.values():
        identified = [m for m in members if m["status"] == "identified"]
        rep = max(identified or members, key=lambda m: (m.get("confidence") or 0, -m["seq"]))
        for m in members:
            status = m.get("dup_status")
            if m["id"] == rep["id"]:
                if m.get("dup_of") and status not in USER_STATUSES:
                    store.update_detection(m["id"], dup_of=None, dup_status=None)
                continue
            why = []
            for pair, r in reasons.items():
                if m["id"] in pair:
                    why += r
            info = dict(m.get("dup_candidates") or {})
            info["merged_reasons"] = sorted(set(why))
            store.update_detection(m["id"], dup_of=rep["id"],
                                   dup_status=status if status in USER_STATUSES else "auto", dup_candidates=info)
            if m["status"] == "unidentified" and rep["status"] == "identified":
                notes = list(m.get("notes") or [])
                msg = "ilegível nesta foto; identificada pela mesma carta em outra foto"
                if msg not in notes:
                    store.update_detection(m["id"], notes=notes + [msg])
            merged += 1

    # possíveis duplicatas: não colapsam, só sinalizam
    flagged: dict[str, list[dict]] = {}
    for (a, b), why in possible.items():
        if uf.find(a) == uf.find(b):
            continue
        flagged.setdefault(a, []).append({"id": b, "reasons": why})
        flagged.setdefault(b, []).append({"id": a, "reasons": why})
    for d in dets:
        if uf.find(d["id"]) != d["id"] and d["id"] not in flagged:
            continue
        info = dict(d.get("dup_candidates") or {})
        new_possible = flagged.get(d["id"], [])
        if info.get("possible") != new_possible:
            info["possible"] = new_possible
            fields = {"dup_candidates": info}
            if uf.find(d["id"]) == d["id"] and d.get("dup_status") not in USER_STATUSES:
                fields["dup_status"] = "possible" if new_possible else None
                if d.get("dup_of"):
                    fields["dup_of"] = None
            store.update_detection(d["id"], **fields)
    return {"merged": merged, "possible_pairs": len([p for p in possible if uf.find(p[0]) != uf.find(p[1])])}


def decide(session_id: str, detection_id: str, other_id: str, same: bool) -> None:
    """Decisão humana sobre um par: mesma carta (força colapso) ou cartas diferentes (bloqueia)."""
    first, second = store.get_detection(detection_id), store.get_detection(other_id)
    capture = store.get_capture(first["capture_id"]) if first else None
    if first and second and capture and capture["type"] != "image":
        # vídeo: a sequência já é a evidência; a exibição posterior aponta (ou deixa de apontar) para a anterior
        later, earlier = (first, second) if first["seq"] > second["seq"] else (second, first)
        notes = [n for n in (later.get("notes") or []) if n != "mesma carta do grupo anterior — contada como outra cópia"]
        if same:
            store.update_detection(later["id"], dup_of=earlier.get("dup_of") or earlier["id"], dup_status="user_same",
                                   notes=notes, dup_candidates={"merged_reasons": ["confirmado na revisão: mesma carta"]})
        else:
            store.update_detection(later["id"], dup_of=None, dup_status="user_different", notes=notes)
        return
    for a, b in ((detection_id, other_id), (other_id, detection_id)):
        d = store.get_detection(a)
        if d is None:
            continue
        info = dict(d.get("dup_candidates") or {})
        forced, blocked = set(info.get("forced", [])), set(info.get("blocked", []))
        (forced if same else blocked).add(b)
        (blocked if same else forced).discard(b)
        info["forced"], info["blocked"] = sorted(forced), sorted(blocked)
        info["possible"] = [p for p in info.get("possible", []) if p["id"] != b]
        store.update_detection(a, dup_candidates=info, dup_status="user_same" if same else "user_different")
    if not same:
        for x in (detection_id, other_id):
            d = store.get_detection(x)
            if d and d.get("dup_of") in (detection_id, other_id):
                store.update_detection(x, dup_of=None)
    run(session_id)
