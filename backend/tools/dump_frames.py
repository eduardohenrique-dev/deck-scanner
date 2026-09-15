"""Emite em stdout os frames amostrados de um vídeo (RGBA cru) para o teste da visão do navegador.

  python -m tools.dump_frames data/synth/video100/deck.mp4 | node --experimental-strip-types ../tools-js/e2e-video.mjs

Cada frame: cabeçalho <int32 largura, int32 altura, float64 tempo> + largura*altura*4 bytes.
Mesma amostragem e redução do processamento de referência (pipeline/video.py).
"""
from __future__ import annotations

import argparse
import struct
import sys

import cv2

from app import config
from app.pipeline.video import PROCESS_MAX_SIDE


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--fps", type=float, default=config.VIDEO_SAMPLE_FPS)
    p.add_argument("--limit", type=int, default=0)
    args = p.parse_args()
    vc = cv2.VideoCapture(args.video)
    if not vc.isOpened():
        sys.exit(f"não consegui abrir {args.video}")
    fps = vc.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(fps / args.fps)))
    out = sys.stdout.buffer
    idx = sent = 0
    while vc.grab():
        if idx % step == 0:
            ok, frame = vc.retrieve()
            if ok:
                h, w = frame.shape[:2]
                scale = min(1.0, PROCESS_MAX_SIDE / max(h, w))
                if scale < 1:
                    frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                rgba = cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA)
                out.write(struct.pack("<iid", rgba.shape[1], rgba.shape[0], idx / fps))
                out.write(rgba.tobytes())
                sent += 1
                if args.limit and sent >= args.limit:
                    break
        idx += 1
    out.flush()


if __name__ == "__main__":
    main()
