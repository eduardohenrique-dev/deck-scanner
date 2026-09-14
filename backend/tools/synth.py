"""Gerador de cenas sintéticas para testar o pipeline sem cartas físicas.

Renderiza imagens oficiais (Scryfall 'large') como se fossem fotografadas: mesa texturizada,
perspectiva, rotação, sleeves, reflexo, desfoque, ruído, JPEG, iluminação e transições de vídeo
(carta deslizando com motion blur revelando a próxima, mão cobrindo borda).

Uso:
  python -m tools.synth video  --out data/synth/video100   [--seed 7]
  python -m tools.synth photos --out data/synth/table10    [--seed 11]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import httpx
import numpy as np

from app import config, db

CACHE = config.CACHE_DIR / "large"
BACK_URL = "https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg"


# ------------------------------------------------------------------ dados
def card_image(card_ref_id: str) -> np.ndarray:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{card_ref_id}.jpg"
    if not path.exists():
        if card_ref_id == "__back__":
            url = BACK_URL
        else:
            row = db.catalog_db().execute("SELECT image_large, faces FROM card_refs WHERE id=?", (card_ref_id,)).fetchone()
            url = row["image_large"]
            faces = db.loads(row["faces"], None) or []
            if not url and faces:
                url = faces[0].get("image_large")
        resp = httpx.get(url, headers={"User-Agent": config.USER_AGENT}, timeout=30, follow_redirects=True)
        resp.raise_for_status()
        path.write_bytes(resp.content)
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    return cv2.resize(img, (630, 880), interpolation=cv2.INTER_AREA)


def ref(name: str, lang: str = "en", set_code: str | None = None) -> str:
    sql = ("SELECT r.id FROM card_refs r JOIN oracle_cards o ON o.oracle_id=r.oracle_id WHERE (o.name_en=? OR r.printed_name=?) "
           "AND r.lang=? AND r.image_large IS NOT NULL")
    params: list = [name, name, lang]
    if set_code:
        sql += " AND r.set_code=?"
        params.append(set_code)
    sql += " ORDER BY r.highres DESC, r.promo ASC, r.full_art ASC, r.released_at DESC LIMIT 1"
    row = db.catalog_db().execute(sql, params).fetchone()
    assert row, f"sem impressão: {name} ({lang})"
    return row["id"]


def random_cards(rng: np.random.Generator, n: int, exclude_oracles: set[str]) -> list[str]:
    rows = db.catalog_db().execute(
        "SELECT r.id, r.oracle_id FROM card_refs r JOIN oracle_cards o ON o.oracle_id = r.oracle_id "
        "WHERE r.lang='en' AND r.kind='card' AND r.layout='normal' AND r.highres=1 AND r.promo=0 AND r.full_art=0 "
        "AND r.border_color='black' AND r.released_at >= '2010-01-01' AND o.type_line NOT LIKE '%Land%' "
        "AND r.id = o.default_ref_id ORDER BY r.id").fetchall()
    picks, seen = [], set(exclude_oracles)
    for i in rng.permutation(len(rows)):
        r = rows[int(i)]
        if r["oracle_id"] in seen:
            continue
        seen.add(r["oracle_id"])
        picks.append(r["id"])
        if len(picks) == n:
            break
    return picks


def oracle_of(card_ref_id: str) -> str | None:
    if card_ref_id == "__back__":
        return None
    return db.catalog_db().execute("SELECT oracle_id FROM card_refs WHERE id=?", (card_ref_id,)).fetchone()[0]


# ------------------------------------------------------------------ renderização
def table_texture(w: int, h: int, rng: np.random.Generator, kind: str = "wood") -> np.ndarray:
    if kind == "wood":
        base = np.array([45, 75, 115], np.float32)
        noise = rng.normal(0, 1, (max(2, h // 8), max(2, w // 64))).astype(np.float32)
        grain = cv2.resize(noise, (w, h), interpolation=cv2.INTER_CUBIC)
        fine = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 1.5)
        tex = base[None, None, :] * (1 + 0.18 * grain[..., None] + 0.05 * fine[..., None])
    else:
        base = np.array([80, 60, 30], np.float32)
        fine = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 2)
        tex = base[None, None, :] * (1 + 0.08 * fine[..., None])
    return np.clip(tex, 0, 255).astype(np.uint8)


def rounded_mask(w: int, h: int, radius_frac: float = 0.045) -> np.ndarray:
    r = max(2, int(radius_frac * w))
    mask = np.zeros((h, w), np.uint8)
    cv2.rectangle(mask, (r, 0), (w - r - 1, h - 1), 255, -1)
    cv2.rectangle(mask, (0, r), (w - 1, h - r - 1), 255, -1)
    for cx, cy in ((r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)):
        cv2.circle(mask, (cx, cy), r, 255, -1)
    return mask


def card_rgba(img: np.ndarray, sleeve: tuple | None = None, rng: np.random.Generator | None = None) -> np.ndarray:
    h, w = img.shape[:2]
    rgba = np.dstack([img, rounded_mask(w, h)])
    if not sleeve:
        return rgba
    pad = int(0.035 * w)
    big = np.zeros((h + 2 * pad, w + 2 * pad, 4), np.uint8)
    big[..., :3] = sleeve
    big[..., 3] = rounded_mask(w + 2 * pad, h + 2 * pad, 0.05)
    inner = big[pad:pad + h, pad:pad + w]
    a = rgba[..., 3:4].astype(np.float32) / 255
    inner[..., :3] = (inner[..., :3] * (1 - a) + rgba[..., :3] * a).astype(np.uint8)
    # brilho plástico da sleeve: faixa diagonal suave
    yy, xx = np.mgrid[0:big.shape[0], 0:big.shape[1]].astype(np.float32)
    band = np.exp(-((xx * 0.7 + yy * 0.3 - big.shape[1] * (0.3 + 0.4 * (rng.random() if rng is not None else 0.5))) ** 2)
                  / (2 * (big.shape[1] * 0.08) ** 2))
    big[..., :3] = np.clip(big[..., :3] + band[..., None] * 38, 0, 255).astype(np.uint8)
    return big


def quad_for(center: tuple[float, float], card_h: float, angle_deg: float, tilt: np.ndarray | None = None,
             ratio: float = 63 / 88) -> np.ndarray:
    w, h = card_h * ratio, card_h
    pts = np.float32([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]])
    a = np.deg2rad(angle_deg)
    R = np.float32([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    pts = pts @ R.T + np.float32(center)
    if tilt is not None:
        pts = pts + tilt.astype(np.float32) * card_h
    return pts.astype(np.float32)


def paste(canvas: np.ndarray, rgba: np.ndarray, quad: np.ndarray, blur_kernel: np.ndarray | None = None) -> None:
    h, w = rgba.shape[:2]
    src = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    M = cv2.getPerspectiveTransform(src, quad.astype(np.float32))
    x0, y0 = np.floor(quad.min(axis=0)).astype(int) - 40
    x1, y1 = np.ceil(quad.max(axis=0)).astype(int) + 40
    H, W = canvas.shape[:2]
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    if x1 <= x0 or y1 <= y0:
        return
    T = np.float32([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]])
    layer = cv2.warpPerspective(rgba, T @ M, (x1 - x0, y1 - y0), flags=cv2.INTER_AREA,
                                borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    if blur_kernel is not None:
        layer = cv2.filter2D(layer, -1, blur_kernel)
    a = layer[..., 3:4].astype(np.float32) / 255
    roi = canvas[y0:y1, x0:x1]
    roi[:] = (roi * (1 - a) + layer[..., :3] * a).astype(np.uint8)


def add_glare(img: np.ndarray, center: tuple[float, float], radius: float, strength: float = 1.0) -> None:
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    g = np.exp(-(((xx - center[0]) / radius) ** 2 + ((yy - center[1]) / (radius * 0.6)) ** 2))
    img[:] = np.clip(img.astype(np.float32) + g[..., None] * 255 * strength, 0, 255).astype(np.uint8)


def motion_kernel(length: int, angle_deg: float = 0.0) -> np.ndarray:
    k = np.zeros((length, length), np.float32)
    k[length // 2, :] = 1.0
    M = cv2.getRotationMatrix2D((length / 2 - 0.5, length / 2 - 0.5), angle_deg, 1.0)
    k = cv2.warpAffine(k, M, (length, length))
    return k / max(k.sum(), 1e-6)


def camera(img: np.ndarray, rng: np.random.Generator, blur: float = 0.0, noise: float = 3.0,
           jpeg: int = 85, gain: float = 1.0) -> np.ndarray:
    out = img.astype(np.float32) * gain
    if blur > 0.05:
        out = cv2.GaussianBlur(out, (0, 0), blur)
    out += rng.normal(0, noise, out.shape).astype(np.float32)
    out = np.clip(out, 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, jpeg])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


SLEEVES = [(25, 25, 25), (40, 40, 150), (120, 60, 20), (30, 90, 30)]


# ------------------------------------------------------------------ cenário: vídeo folheando o deck
def video_deck(rng: np.random.Generator) -> list[dict]:
    commander = ref("Kaalia of the Vast")
    pt_barrens = ref("Scoured Barrens", lang="pt")
    en_barrens = ref("Scoured Barrens", lang="en")
    dfc = ref("Westvale Abbey // Ormendahl, Profane Prince")
    basics = [ref("Swamp")] * 12 + [ref("Mountain")] * 10 + [ref("Plains")] * 10
    fixed = {oracle_of(x) for x in (commander, pt_barrens, dfc, *basics)}
    spells = random_cards(rng, 64, fixed)
    items = [{"id": x} for x in spells + [pt_barrens, en_barrens, dfc]]
    rng.shuffle(items)
    # básicos em blocos (cópias idênticas seguidas testam a contagem)
    for chunk in (basics[:4], basics[12:15], basics[22:24]):
        pos = int(rng.integers(0, len(items)))
        items[pos:pos] = [{"id": x} for x in chunk]
    rest = basics[4:12] + basics[15:22] + basics[24:]
    for x in rest:
        items.insert(int(rng.integers(0, len(items))), {"id": x})
    assert len(items) + 1 == 100, len(items) + 1
    items.insert(0, {"id": commander, "commander": True})
    token = db.catalog_db().execute(
        "SELECT id FROM card_refs WHERE kind='token' AND lang='en' AND highres=1 AND layout='token' "
        "AND image_large IS NOT NULL ORDER BY released_at DESC LIMIT 1").fetchone()["id"]
    items.insert(int(rng.integers(20, 60)), {"id": token, "kind": "token"})
    items.insert(int(rng.integers(60, 95)), {"id": "__back__", "kind": "back"})
    return items


def make_video(out_dir: Path, seed: int = 7, size=(1280, 720), fps: int = 10) -> dict:
    rng = np.random.default_rng(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    items = video_deck(rng)
    W, H = size
    bg = table_texture(W, H, rng, "wood")
    writer = cv2.VideoWriter(str(out_dir / "deck.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
    card_h = 0.8 * H
    rest_center = (W * 0.5, H * 0.5)
    rgbas = {}

    def rgba_of(i: int) -> np.ndarray:
        if i not in rgbas:
            it = items[i]
            sleeve = SLEEVES[int(rng.integers(0, len(SLEEVES)))] if rng.random() < 0.5 else None
            rgbas[i] = card_rgba(card_image(it["id"]), sleeve, rng)
            it["sleeve"] = bool(sleeve)
        return rgbas[i]

    frames = 0
    for i, it in enumerate(items):
        rgba = rgba_of(i)
        glare = rng.random() < 0.25
        base_angle = float(rng.normal(0, 2.5))
        n_hold = int(rng.integers(10, 21))
        for f in range(n_hold):
            frame = bg.copy()
            jitter = (rng.normal(0, 0.008 * W), rng.normal(0, 0.008 * H))
            q = quad_for((rest_center[0] + jitter[0], rest_center[1] + jitter[1]), card_h * (1 + rng.normal(0, 0.01)),
                         base_angle + rng.normal(0, 0.8), tilt=rng.normal(0, 0.008, (4, 2)))
            paste(frame, rgba, q)
            if glare:
                c = q.mean(axis=0) + rng.normal(0, 25, 2)
                add_glare(frame, (float(c[0]), float(c[1] - card_h * 0.1)), card_h * 0.13, 0.7)
            blur = float(rng.uniform(0, 0.7)) if rng.random() > 0.08 else float(rng.uniform(1.5, 2.5))
            frame = camera(frame, rng, blur=blur, noise=3, jpeg=88, gain=float(rng.uniform(0.95, 1.05)))
            writer.write(frame)
            frames += 1
        n_tr = int(rng.integers(2, 5))
        direction = 1 if rng.random() < 0.5 else -1
        nxt = rgba_of(i + 1) if i + 1 < len(items) else None
        for f in range(n_tr):
            frame = bg.copy()
            if nxt is not None:
                paste(frame, nxt, quad_for(rest_center, card_h, float(rng.normal(0, 2))))
            prog = (f + 1) / (n_tr + 1)
            center = (rest_center[0] + direction * prog * W * 0.75, rest_center[1] + prog * H * 0.08)
            q = quad_for(center, card_h, base_angle + direction * prog * 12)
            paste(frame, rgba, q, blur_kernel=motion_kernel(int(15 + 25 * prog), 0))
            hand = q.mean(axis=0) + np.float32([direction * card_h * 0.3, card_h * 0.35])
            cv2.ellipse(frame, (int(hand[0]), int(hand[1])), (int(card_h * 0.18), int(card_h * 0.28)), 20, 0, 360,
                        (120, 160, 215), -1)
            frame = camera(frame, rng, blur=1.2, noise=4, jpeg=85)
            writer.write(frame)
            frames += 1
    writer.release()
    truth = {
        "cards": [it["id"] for it in items if it.get("kind") is None],
        "backs": sum(1 for it in items if it.get("kind") == "back"),
        "tokens": sum(1 for it in items if it.get("kind") == "token"),
        "commander": items[0]["id"], "frames": frames, "fps": fps,
    }
    (out_dir / "truth.json").write_text(json.dumps(truth, indent=2))
    return truth


# ------------------------------------------------------------------ cenário: mesa fotografada em pedaços
def make_photos(out_dir: Path, seed: int = 11, n_photos: int = 10) -> dict:
    rng = np.random.default_rng(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    bolt = ref("Lightning Bolt")
    pt_barrens, en_barrens = ref("Scoured Barrens", lang="pt"), ref("Scoured Barrens", lang="en")
    fixed = {oracle_of(bolt), oracle_of(pt_barrens)}
    layout = [{"id": x} for x in random_cards(rng, 16, fixed)]
    layout += [{"id": bolt} for _ in range(4)] + [{"id": pt_barrens}, {"id": en_barrens}]
    layout += [{"id": random_cards(rng, 1, fixed | {oracle_of(x["id"]) for x in layout})[0], "illegible": True}]
    layout += [{"id": "__back__", "kind": "back"}]
    rng.shuffle(layout)

    cols, rows = 6, 4
    card_h = 560
    card_w = card_h * 63 / 88
    gap_x, gap_y = card_w * 0.08, card_h * 0.10
    TW = int(cols * (card_w + gap_x) + 300)
    TH = int(rows * (card_h + gap_y) + 300)
    table = table_texture(TW, TH, rng, "felt" if rng.random() < 0.5 else "wood")
    quads = []
    for k, it in enumerate(layout):
        r, c = divmod(k, cols)
        overlap = -card_w * 0.14 if (c > 0 and rng.random() < 0.2) else 0.0  # sobreposição parcial com a vizinha
        cx = 150 + card_w / 2 + c * (card_w + gap_x) + overlap
        cy = 150 + card_h / 2 + r * (card_h + gap_y)
        img = card_image(it["id"])
        if it.get("illegible"):
            # reflexo total + ruído sobre todo o interior; a borda preta fica: a carta é detectável, não legível
            veil_rng = np.random.default_rng(seed + 1000)  # RNG separado: não altera o resto da cena
            img = np.clip(veil_rng.normal(232, 16, img.shape), 0, 255).astype(np.uint8)
            cv2.rectangle(img, (0, 0), (629, 879), (15, 15, 15), 26)
        sleeve = SLEEVES[int(rng.integers(0, len(SLEEVES)))] if rng.random() < 0.4 else None
        q = quad_for((cx, cy), card_h, float(rng.normal(0, 3)))
        paste(table, card_rgba(img, sleeve, rng), q)
        quads.append(q)
        it["quad_table"] = q.tolist()

    # janelas sobrepostas (como a câmera guiada orienta): cada foto cobre ~2 fileiras × 4 cartas,
    # com cartas em comum entre fotos vizinhas; várias cartas aparecem em 3–5 fotos
    windows = [(0, 0), (0, 2), (2, 0), (2, 2), (1, 0), (1, 2), (0, 1), (2, 1), (1, 1), (0.5, 1.5)][:n_photos]
    photos = []
    PW, PH = 2000, 1500
    for n, (r0, c0) in enumerate(windows, start=1):
        x0 = 150 + c0 * (card_w + gap_x) - card_w * 0.25
        y0 = 150 + r0 * (card_h + gap_y) - card_h * 0.2
        w = 4.6 * (card_w + gap_x)
        h = w * PH / PW
        src = np.float32([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]])
        jitter = rng.normal(0, 0.03, (4, 2)).astype(np.float32) * np.float32([w, h])
        Hm = cv2.getPerspectiveTransform(src + jitter, np.float32([[0, 0], [PW, 0], [PW, PH], [0, PH]]))
        img = cv2.warpPerspective(table, Hm, (PW, PH), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
        for _ in range(int(rng.integers(0, 3))):
            add_glare(img, (float(rng.uniform(0, PW)), float(rng.uniform(0, PH))), float(rng.uniform(60, 140)), 0.8)
        img = camera(img, rng, blur=float(rng.uniform(0.3, 1.0)), noise=4, jpeg=88, gain=float(rng.uniform(0.9, 1.1)))
        path = out_dir / f"photo_{n:02d}.jpg"
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        visible = []
        for k, q in enumerate(quads):
            pq = cv2.perspectiveTransform(np.float32(q).reshape(-1, 1, 2), Hm).reshape(4, 2)
            if (pq[:, 0] >= 0).all() and (pq[:, 0] < PW).all() and (pq[:, 1] >= 0).all() and (pq[:, 1] < PH).all():
                visible.append(k)
        photos.append({"file": path.name, "fully_visible": visible})
    covered = set().union(*[set(p["fully_visible"]) for p in photos])
    truth = {
        "cards": [it["id"] for it in layout if it.get("kind") is None and not it.get("illegible")],
        "illegible": [it["id"] for it in layout if it.get("illegible")],
        "backs": sum(1 for it in layout if it.get("kind") == "back"),
        "table_cards": len(layout),
        "uncovered_positions": sorted(set(range(len(layout))) - covered),
        "photos": photos,
        "layout": [{"pos": k, "id": it["id"], "kind": it.get("kind"), "illegible": bool(it.get("illegible"))}
                   for k, it in enumerate(layout)],
    }
    (out_dir / "truth.json").write_text(json.dumps(truth, indent=2))
    cv2.imwrite(str(out_dir / "table_full.jpg"), cv2.resize(table, (TW // 3, TH // 3)))
    return truth


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("scenario", choices=["video", "photos"])
    p.add_argument("--out", required=True)
    p.add_argument("--seed", type=int, default=None)
    args = p.parse_args()
    out = Path(args.out)
    if args.scenario == "video":
        t = make_video(out, seed=args.seed or 7)
        print(json.dumps({k: v for k, v in t.items() if k != "cards"} | {"cards": len(t["cards"])}))
    else:
        t = make_photos(out, seed=args.seed or 11)
        print(json.dumps({k: v for k, v in t.items() if k not in ("cards", "photos")} | {"cards": len(t["cards"])}))


if __name__ == "__main__":
    main()
