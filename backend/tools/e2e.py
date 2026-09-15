"""Teste ponta a ponta dos processadores com cenas sintéticas (sem HTTP).

  python -m tools.e2e video  [--dir data/synth/video100]  [--regen]
  python -m tools.e2e photos [--dir data/synth/table10]   [--regen]
Compara a lista final com a verdade: contagem por carta, costas, tokens, não identificadas, duplicatas.
"""
from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

from app import config, db
from app.pipeline import deck, photo, store, video
from app.pipeline.imageio import encode_jpeg, load_image_bytes
from tools import synth


def _truth_oracles(ids: list[str]) -> Counter:
    return Counter(synth.oracle_of(i) for i in ids)


def _result_oracles(session_id: str) -> tuple[Counter, dict]:
    s = store.get_session(session_id)
    entries = store.entries(s["deck_id"])
    detected = Counter()
    for e in entries:
        detected[e["oracle_id"]] += e["quantity_detected"]
    dets = store.detections(session_id)
    ids = {d["id"] for d in dets}
    active = [d for d in dets if not (d.get("dup_of") and d["dup_of"] in ids)]
    stats = Counter(d["status"] for d in active)
    stats["merged"] = sum(1 for d in dets if d.get("dup_of") and d["dup_of"] in ids)
    stats["possible_duplicates"] = sum(1 for d in active if d.get("dup_status") == "possible")
    stats["by_source"] = dict(Counter(d.get("source") for d in deck.representatives(dets)))
    return detected, dict(stats)


def _report(name: str, truth: Counter, got: Counter, stats: dict, extra: dict, started: float) -> dict:
    missing = {k: truth[k] - got.get(k, 0) for k in truth if got.get(k, 0) < truth[k]}
    extra_cards = {k: got[k] - truth.get(k, 0) for k in got if got[k] > truth.get(k, 0)}
    names = lambda d: {db.catalog_db().execute("SELECT name_en FROM oracle_cards WHERE oracle_id=?", (k,)).fetchone()[0]
                       if k else "?": v for k, v in d.items()}
    out = {
        "scenario": name, "seconds": round(time.time() - started, 1),
        "truth_cards": sum(truth.values()), "detected_cards": sum(got.values()),
        "exact_match": not missing and not extra_cards,
        "missing": names(missing), "extra": names(extra_cards), "stats": stats, **extra,
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return out


def run_video(folder: Path, regen: bool) -> dict:
    if regen or not (folder / "truth.json").exists():
        synth.make_video(folder)
    truth = json.loads((folder / "truth.json").read_text())
    db.init_all()
    s = store.create_session(config.DEFAULT_USER_ID, "mtg", "commander", "video", "e2e vídeo", {"default_language": "en"})
    cap = store.add_capture(s["id"], "video", None, "deck.mp4", status="processing")
    started = time.time()
    video.process_video_file(s["id"], cap["id"], str(folder / "deck.mp4"))
    got, stats = _result_oracles(s["id"])
    return _report("video", _truth_oracles(truth["cards"]), got, stats,
                   {"session_id": s["id"], "truth_backs": truth["backs"], "truth_tokens": truth["tokens"]}, started)


def run_photos(folder: Path, regen: bool) -> dict:
    if regen or not (folder / "truth.json").exists():
        synth.make_photos(folder)
    truth = json.loads((folder / "truth.json").read_text())
    db.init_all()
    s = store.create_session(config.DEFAULT_USER_ID, "mtg", "collection", "photo", "e2e fotos", {"default_language": "en"})
    started = time.time()
    for p in truth["photos"]:
        img = load_image_bytes((folder / p["file"]).read_bytes())
        cid = db.new_id()
        key = store.store_capture_file(s["id"], cid, encode_jpeg(img, 90), ".jpg", "image/jpeg")
        store.add_capture(s["id"], "image", key, p["file"], capture_id=cid)
        store.update_capture(cid, w=img.shape[1], h=img.shape[0])
        photo.process_photo(s["id"], cid, img)
    got, stats = _result_oracles(s["id"])
    return _report("photos", _truth_oracles(truth["cards"]), got, stats,
                   {"session_id": s["id"], "truth_backs": truth["backs"], "truth_illegible": len(truth["illegible"]),
                    "uncovered_positions": truth["uncovered_positions"]}, started)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("scenario", choices=["video", "photos"])
    p.add_argument("--dir")
    p.add_argument("--regen", action="store_true")
    args = p.parse_args()
    base = config.DATA_DIR / "synth"
    if args.scenario == "video":
        run_video(Path(args.dir) if args.dir else base / "video100", args.regen)
    else:
        run_photos(Path(args.dir) if args.dir else base / "table10", args.regen)


if __name__ == "__main__":
    main()
