"""Vídeo sintético só com cartas de arte completa e sem borda, para medir a câmera ao vivo nelas.

  .venv\\Scripts\\python -m tools.fullart_video [--out data/synth/fullart40] [--n 40] [--seed 21]
  node --experimental-strip-types tools-js/e2e-video.mjs --live --detect-dim 800 --video backend/data/synth/fullart40/deck.mp4
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from app import db
from tools import synth


def full_art_deck(n: int):
    def deck(rng: np.random.Generator) -> list[dict]:
        rows = db.catalog_db().execute(
            "SELECT id FROM card_refs WHERE image_large IS NOT NULL AND lang='en' AND kind='card' AND oversized=0 "
            "AND highres=1 AND (full_art=1 OR border_color='borderless') ORDER BY id").fetchall()
        ids = [r["id"] for r in rows]
        return [{"id": ids[i]} for i in rng.choice(len(ids), n, replace=False)]
    return deck


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/synth/fullart40")
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--seed", type=int, default=21)
    # quem usa a câmera segura a carta até ficar verde: 3 a 4 s parada, não o 1 a 2 s do vídeo folheado
    ap.add_argument("--hold", type=int, nargs=2, default=(30, 41))
    args = ap.parse_args()
    synth.video_deck = full_art_deck(args.n)
    truth = synth.make_video(Path(args.out), seed=args.seed, hold=tuple(args.hold))
    print(f"{len(truth['cards'])} cartas, {truth['frames']} frames em {args.out}")


if __name__ == "__main__":
    main()
