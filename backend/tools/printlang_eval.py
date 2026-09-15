"""Avalia a escolha de idioma e de coleção (mesma arte) com cenas sintéticas.

  python -m tools.printlang_eval --n 40 [--seed 5] [--hard]

Idioma: sorteia cartas com impressão em português e em inglês na MESMA coleção/número; renderiza uma das
duas e mede se o recorte é atribuído ao idioma certo.
Coleção: sorteia ilustrações impressas em várias coleções em inglês; renderiza uma e mede se a coleção
escolhida é a certa.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from app import db
from app.pipeline import printresolve
from app.vision import detect, hashing
from app.vision.hashindex import get_index
from app.games import registry
from tools.synth import SLEEVES, add_glare, camera, card_image, card_rgba, paste, quad_for, table_texture


def _pairs_language(rng, n: int) -> list[tuple[str, str]]:
    rows = db.catalog_db().execute(
        "SELECT p.id AS pt, e.id AS en FROM card_refs p JOIN card_refs e ON e.set_code = p.set_code "
        "AND e.collector_number = p.collector_number AND e.lang = 'en' WHERE p.lang = 'pt' AND p.kind = 'card' "
        "AND p.layout = 'normal' AND p.image_large IS NOT NULL AND e.image_large IS NOT NULL AND p.full_art = 0 "
        "AND p.released_at >= '2012-01-01' AND p.image_status IN ('lowres', 'highres_scan') ORDER BY p.id").fetchall()
    idx = rng.choice(len(rows), size=min(n, len(rows)), replace=False)
    return [(rows[int(i)]["en"], rows[int(i)]["pt"]) for i in idx]


def _multi_print_arts(rng, n: int) -> list[str]:
    rows = db.catalog_db().execute(
        "SELECT illustration_id, MIN(id) AS any_id, COUNT(DISTINCT set_code) AS sets FROM card_refs "
        "WHERE lang='en' AND kind='card' AND layout='normal' AND image_large IS NOT NULL AND full_art=0 "
        "AND illustration_id IS NOT NULL GROUP BY illustration_id HAVING COUNT(DISTINCT set_code) BETWEEN 2 AND 6 "
        "ORDER BY illustration_id").fetchall()
    out = []
    for i in rng.choice(len(rows), size=min(n * 3, len(rows)), replace=False):
        illus = rows[int(i)]["illustration_id"]
        prints = db.catalog_db().execute(
            "SELECT id FROM card_refs WHERE illustration_id=? AND lang='en' AND image_large IS NOT NULL ORDER BY id",
            (illus,)).fetchall()
        out.append(prints[int(rng.integers(len(prints)))]["id"])
        if len(out) == n:
            break
    return out


SIZE = (0.55, 0.78)  # altura da carta como fração da altura do quadro (960 px)


def _scene(card_ref_id: str, rng, hard: bool):
    W, H = 1280, 960
    frame = table_texture(W, H, rng, "wood" if rng.random() < 0.5 else "felt")
    k = 1.8 if hard else 1.0
    sleeve = SLEEVES[int(rng.integers(0, len(SLEEVES)))] if rng.random() < 0.5 else None
    q = quad_for((W / 2 + rng.normal(0, 30), H / 2 + rng.normal(0, 20)), H * rng.uniform(*SIZE),
                 float(rng.normal(0, 5 * k)), tilt=rng.normal(0, 0.02 * k, (4, 2)))
    paste(frame, card_rgba(card_image(card_ref_id), sleeve, rng), q)
    if rng.random() < 0.3 * k:
        c = q.mean(axis=0) + rng.normal(0, 80, 2)
        add_glare(frame, (float(c[0]), float(c[1])), float(rng.uniform(40, 80)), float(rng.uniform(0.4, 0.8)))
    return camera(frame, rng, blur=float(rng.uniform(0, 1.0 * k)), noise=4, jpeg=85)


def _identify(frame):
    found = detect.detect_primary_card(frame)
    if found is None:
        return None
    card = detect.warp_card(frame, found.pts)
    ctx = detect.warp_card(frame, found.pts, out_w=620, out_h=864, expand=hashing.CONTEXT_EXPAND)
    qh = hashing.compute_query_hashes(card, ctx)
    cands = [c for c in get_index().query(qh, k=16) if not c.is_back]
    return card, ctx, cands, found.height


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=40)
    p.add_argument("--seed", type=int, default=5)
    p.add_argument("--hard", action="store_true")
    p.add_argument("--only", choices=["language", "print"])
    p.add_argument("--dump", help="pasta para imagens dos erros confiantes")
    p.add_argument("--small", action="store_true", help="cartas pequenas no quadro (fotos de mesa)")
    args = p.parse_args()
    global SIZE
    if args.small:
        SIZE = (0.18, 0.45)
    rng = np.random.default_rng(args.seed)
    adapter = registry.get("mtg")
    report: dict = {}

    if args.only in (None, "language"):
        rows = []
        for en_id, pt_id in _pairs_language(rng, args.n):
            for truth_id, truth_lang in ((pt_id, "pt"), (en_id, "en")):
                got = _identify(_scene(truth_id, rng, args.hard))
                if got is None:
                    rows.append({"truth": truth_lang, "detected": False})
                    continue
                card, ctx, cands, height = got
                res = printresolve.resolve(card, ctx, cands, adapter, default_language="pt", source_height=height)
                truth_set = adapter.card_summary(truth_id)["set_code"]
                rows.append({"truth": truth_lang, "detected": True, "lang": res.language,
                             "confident": res.language_confident, "margin": res.metrics.get("language_margin"),
                             "exact": res.card_ref_id == truth_id,
                             "hash_set_ok": bool(cands) and adapter.card_summary(cands[0].card_ref_id)["set_code"] == truth_set,
                             "height": round(height), "scores": [res.metrics.get("en_score"), res.metrics.get("pt_score")],
                             "notes": res.notes})
        det = [r for r in rows if r["detected"]]
        conf = [r for r in det if r["confident"]]
        report["language"] = {
            "samples": len(rows), "detected": len(det),
            "accuracy_all": round(sum(r["lang"] == r["truth"] for r in det) / max(len(det), 1), 3),
            "confident": len(conf),
            "accuracy_confident": round(sum(r["lang"] == r["truth"] for r in conf) / max(len(conf), 1), 3),
            "margins_pt": sorted(r["margin"] for r in det if r["truth"] == "pt" and r["margin"] is not None),
            "margins_en": sorted(r["margin"] for r in det if r["truth"] == "en" and r["margin"] is not None),
            "by_height": sorted((r["height"], r["truth"], r["margin"], r["scores"]) for r in det if r["margin"] is not None),
            "errors": [r for r in det if r["lang"] != r["truth"]][:10],
        }

    if args.only in (None, "print"):
        rows = []
        for truth_id in _multi_print_arts(rng, args.n):
            got = _identify(_scene(truth_id, rng, args.hard))
            if got is None:
                rows.append({"detected": False})
                continue
            card, ctx, cands, height = got
            hash_pick = cands[0].card_ref_id if cands else None
            res = printresolve.resolve(card, ctx, cands, adapter, default_language="en", source_height=height)
            truth_set = adapter.card_summary(truth_id)["set_code"]
            got_set = (adapter.card_summary(res.card_ref_id) or {}).get("set_code") if res.card_ref_id else None
            hash_set = (adapter.card_summary(hash_pick) or {}).get("set_code") if hash_pick else None
            detail = None
            if got_set != truth_set and res.print_confident:
                from app.vision import printmatch, verify
                from app.pipeline.printresolve import query_image
                q, isctx = query_image(card, ctx, cands[0].variant)
                detail = {}
                tiles = [cv2.resize(q, (printmatch.W, printmatch.H))]
                for pid in [truth_id, res.card_ref_id]:
                    ref_img = verify.reference_image(pid, 0)
                    if ref_img is not None:
                        s = printmatch.score(q, ref_img, printmatch.PRINT_REGIONS, query_is_context=isctx, blur=0.9)
                        detail[adapter.card_summary(pid)["set_code"]] = {"total": round(s.total, 3), **s.regions,
                                                                         "aligned": s.aligned}
                        tiles.append(cv2.resize(ref_img, (printmatch.W, printmatch.H)))
                        al = printmatch.align(q, ref_img, query_is_context=isctx)
                        if al is not None:
                            tiles.append(al[0])
                if args.dump:
                    Path(args.dump).mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(str(Path(args.dump) / f"print_err_{len(rows)}.jpg"), np.hstack(tiles))
            rows.append({"detected": True, "ok": got_set == truth_set, "hash_ok": hash_set == truth_set,
                         "confident": res.print_confident, "margin": res.metrics.get("print_margin"),
                         "candidates": res.metrics.get("print_candidates"), "detail": detail})
        det = [r for r in rows if r["detected"]]
        conf = [r for r in det if r["confident"]]
        report["print"] = {
            "samples": len(rows), "detected": len(det),
            "hash_only_accuracy": round(sum(r["hash_ok"] for r in det) / max(len(det), 1), 3),
            "accuracy_all": round(sum(r["ok"] for r in det) / max(len(det), 1), 3),
            "confident": len(conf),
            "accuracy_confident": round(sum(r["ok"] for r in conf) / max(len(conf), 1), 3),
            "margins_ok": sorted(r["margin"] for r in det if r["ok"] and r["margin"] is not None),
            "margins_wrong": sorted(r["margin"] for r in det if not r["ok"] and r["margin"] is not None),
            "confident_errors": [r["detail"] for r in det if r.get("detail")],
        }
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
