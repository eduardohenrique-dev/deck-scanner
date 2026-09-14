"""Calibra detecção + confiança do pHash com cenas sintéticas de carta única.

  python -m tools.calibrate --n 250
Mostra taxa de detecção, acerto top-1 e precisão por limiar de confiança.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from app.pipeline import identify
from app.vision import detect, hashing
from app.vision.hashindex import get_index
from tools.synth import add_glare, camera, card_image, card_rgba, oracle_of, paste, quad_for, random_cards, table_texture, SLEEVES


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=250)
    p.add_argument("--seed", type=int, default=3)
    p.add_argument("--hard", action="store_true", help="ângulos, reflexo e desfoque mais agressivos")
    p.add_argument("--dump", help="pasta para salvar exemplos de erro")
    args = p.parse_args()
    rng = np.random.default_rng(args.seed)
    index = get_index()
    cards = random_cards(rng, args.n, set())
    rows = []
    for cid in cards:
        W, H = 1280, 720
        frame = table_texture(W, H, rng, "wood" if rng.random() < 0.5 else "felt")
        sleeve = SLEEVES[int(rng.integers(0, len(SLEEVES)))] if rng.random() < 0.5 else None
        k = 2.0 if args.hard else 1.0
        q = quad_for((W / 2 + rng.normal(0, 40), H / 2 + rng.normal(0, 20)), 0.8 * H * rng.uniform(0.65, 1.0),
                     float(rng.normal(0, 6 * k)), tilt=rng.normal(0, 0.025 * k, (4, 2)))
        upside_down = rng.random() < 0.5
        if upside_down:
            q = q[[2, 3, 0, 1]]  # carta de cabeça para baixo (mesma geometria, conteúdo girado 180°)
        paste(frame, card_rgba(card_image(cid), sleeve, rng), q)
        glare = rng.random() < 0.3 * k
        if glare:
            c = q.mean(axis=0) + rng.normal(0, 60, 2)
            add_glare(frame, (float(c[0]), float(c[1])), float(rng.uniform(40, 90)), float(rng.uniform(0.5, 0.9)))
        blur = float(rng.uniform(0, 1.2 * k))
        frame = camera(frame, rng, blur=blur, noise=4, jpeg=85)
        found = detect.detect_primary_card(frame)
        if found is None:
            rows.append({"detected": False})
            continue
        warped = detect.warp_card(frame, found.pts)
        ctx = detect.warp_card(frame, found.pts, out_w=620, out_h=864, expand=hashing.CONTEXT_EXPAND)
        cands = [c for c in index.query(hashing.compute_query_hashes(warped, ctx), k=16) if not c.is_back]
        truth = oracle_of(cid)
        conf, m = identify.hash_confidence(cands)
        rank = next((i for i, c in enumerate(cands) if c.oracle_id == truth), None)
        iou = detect.quad_iou(found.pts, q)
        row = {"detected": True, "correct": cands[0].oracle_id == truth, "exact": cands[0].card_ref_id == cid,
               "conf": conf, "rank": rank, "sleeve": bool(sleeve), "glare": glare, "blur": round(blur, 2),
               "upside_down": upside_down, "quad_iou": round(iou, 3), **m}
        rows.append(row)
        if not row["correct"] and args.dump:
            import cv2
            out = Path(args.dump)
            out.mkdir(parents=True, exist_ok=True)
            n = len(list(out.glob("*_frame.jpg")))
            if n < 12:
                cv2.polylines(frame, [found.pts.astype(np.int32)], True, (0, 255, 0), 2)
                cv2.imwrite(str(out / f"{n:02d}_frame.jpg"), frame)
                cv2.imwrite(str(out / f"{n:02d}_warped.jpg"), warped)
                cv2.imwrite(str(out / f"{n:02d}_truth.jpg"), card_image(cid))
    det = [r for r in rows if r["detected"]]
    print(f"detecção: {len(det)}/{len(rows)}")
    print(f"top-1 oracle: {sum(r['correct'] for r in det)}/{len(det)}  impressão exata: {sum(r['exact'] for r in det)}")
    print(f"no top-16: {sum(r['rank'] is not None for r in det)}")
    ok = np.array([r["best_score"] for r in det if r["correct"]])
    bad = np.array([r["best_score"] for r in det if not r["correct"]])
    if len(ok):
        print(f"score acerto: p50={np.percentile(ok, 50):.0f} p90={np.percentile(ok, 90):.0f} p99={np.percentile(ok, 99):.0f} max={ok.max():.0f}")
    if len(bad):
        print(f"score erro:   min={bad.min():.0f} p10={np.percentile(bad, 10):.0f} p50={np.percentile(bad, 50):.0f}")
    margins_ok = np.array([r["margin"] for r in det if r["correct"]])
    margins_bad = np.array([r["margin"] for r in det if not r["correct"]])
    if len(margins_ok):
        print(f"margem acerto: p5={np.percentile(margins_ok, 5):.1f} p10={np.percentile(margins_ok, 10):.1f} "
              f"p50={np.percentile(margins_ok, 50):.0f}")
    if len(margins_bad):
        print(f"margem erro: max={margins_bad.max():.1f} p90={np.percentile(margins_bad, 90):.1f}")
    for m in (8, 10, 12, 14, 16, 20, 25):
        acc = [r for r in det if r["margin"] >= m]
        prec = sum(r["correct"] for r in acc) / max(len(acc), 1)
        print(f"margem>={m}: aceitas {len(acc)}/{len(det)}  precisão {prec:.1%}")
    for t in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        acc = [r for r in det if r["conf"] >= t]
        prec = sum(r["correct"] for r in acc) / max(len(acc), 1)
        print(f"conf>={t:.1f}: aceitas {len(acc)}/{len(det)} ({len(acc) / max(len(det), 1):.0%})  precisão {prec:.1%}")
    for key in ("sleeve", "glare", "upside_down"):
        for val in (False, True):
            sub = [r for r in det if r[key] == val]
            if sub:
                print(f"{key}={val}: {sum(r['correct'] for r in sub)}/{len(sub)}")
    for lo, hi in ((0, 0.5), (0.5, 1.0), (1.0, 3.0)):
        sub = [r for r in det if lo <= r["blur"] < hi]
        if sub:
            print(f"blur [{lo},{hi}): {sum(r['correct'] for r in sub)}/{len(sub)}")
    ious = np.array([r["quad_iou"] for r in det])
    print(f"IoU do quad detectado vs real: p10={np.percentile(ious, 10):.2f} p50={np.percentile(ious, 50):.2f}")
    wrong_high = [r for r in det if not r["correct"]]
    print("erros:", json.dumps(sorted(wrong_high, key=lambda r: -r["conf"])[:6], default=float))


if __name__ == "__main__":
    main()
