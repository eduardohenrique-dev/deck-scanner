"""Simula a câmera ao vivo: envia frames de um vídeo pelo WebSocket como o navegador faz.

  python -m tools.live_client --session <id> --video data/synth/video100/deck.mp4 [--max-frames 300]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import struct
import time

import cv2
import websockets


async def run(session_id: str, video: str, max_frames: int, base: str) -> None:
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 10
    states = 0
    tracking = 0
    last = {}
    async with websockets.connect(f"{base}/api/sessions/{session_id}/live", max_size=None) as ws:
        async def reader():
            nonlocal states, tracking, last
            async for msg in ws:
                data = json.loads(msg)
                if data.get("type") == "frame_state":
                    states += 1
                    tracking += int(bool(data.get("tracking")))
                    last = data
                elif data.get("type") == "stopped":
                    return

        task = asyncio.create_task(reader())
        started = time.time()
        for i in range(max_frames):
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            scale = min(1.0, 960 / max(h, w))
            small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1 else frame
            ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 72])
            await ws.send(struct.pack("<d", (i / fps) * 1000.0) + buf.tobytes())
            # tempo real (10 fps), como a câmera
            await asyncio.sleep(max(0.0, started + (i + 1) / fps - time.time()))
        await ws.send("stop")
        await asyncio.wait_for(task, timeout=120)
    print(json.dumps({"frames_sent": i + 1, "frame_states": states, "tracking_states": tracking,
                      "cards_closed_last": last.get("cards_closed"), "dropped": last.get("dropped"),
                      "seconds": round(time.time() - started, 1)}))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--session", required=True)
    p.add_argument("--video", required=True)
    p.add_argument("--max-frames", type=int, default=300)
    p.add_argument("--base", default="ws://127.0.0.1:8420")
    args = p.parse_args()
    asyncio.run(run(args.session, args.video, args.max_frames, args.base))


if __name__ == "__main__":
    main()
