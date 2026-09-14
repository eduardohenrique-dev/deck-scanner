"""Modo vídeo (principal): amostra ~10 fps, agrupa frames da mesma carta pela continuidade temporal,
escolhe o melhor frame (nitidez, reflexo, frontalidade) e identifica só esse. Uma carta física por grupo.

Serve tanto para arquivo de vídeo enviado quanto para a câmera ao vivo (frames via WebSocket).
"""
from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

import cv2
import numpy as np

from .. import config, db
from ..events import bus
from ..games import registry
from ..jobs import identify_pool
from ..vision import detect, hashing, quality
from . import deck, identify, store, vlm
from .photo import _store_result, finish_if_idle
from .serialize import capture_public, detection_public

SAME_THRESH = 80          # bits de 256 (pHash da arte) para "mesma carta" entre frames
CONFIRM_FRAMES = 2        # frames seguidos com outra assinatura para trocar de carta
GAP_FRAMES = 2            # frames sem carta nítida que encerram o grupo (~200 ms a 10 fps)
MIN_SHARPNESS = 22.0
MAX_BEST_FRAMES = 3
PROCESS_MAX_SIDE = 1280


@dataclass
class FrameObs:
    t: float
    idx: int
    pts: np.ndarray | None = None
    warped: np.ndarray | None = None
    sig: np.ndarray | None = None
    sig180: np.ndarray | None = None
    q: dict | None = None
    frame: np.ndarray | None = None


@dataclass
class Group:
    seq: int
    frames: list[FrameObs] = field(default_factory=list)
    best: list[FrameObs] = field(default_factory=list)
    gap_before: dict = field(default_factory=dict)
    prev_last_pts: np.ndarray | None = None

    @property
    def ref(self) -> FrameObs:
        return self.best[0]

    def add(self, obs: FrameObs) -> None:
        self.frames.append(obs)
        self.best.append(obs)
        self.best.sort(key=lambda o: -o.q["score"])
        for dropped in self.best[MAX_BEST_FRAMES:]:
            dropped.warped = dropped.frame = None  # só os melhores guardam imagem
        self.best = self.best[:MAX_BEST_FRAMES]


def _sig_dist(a: FrameObs, b: FrameObs) -> int:
    return min(hashing.hamming(a.sig, b.sig), hashing.hamming(a.sig, b.sig180))


class TemporalGrouper:
    def __init__(self, on_close: Callable[[Group], None]):
        self.on_close = on_close
        self.current: Group | None = None
        self.pending: list[FrameObs] = []
        self.miss = 0
        self.gap = {"empty": 0, "blurry": 0, "moved": False}
        self.seq = 0
        self.last_valid_pts: np.ndarray | None = None
        self.last_closed_pts: np.ndarray | None = None

    def push(self, obs: FrameObs) -> None:
        valid = obs.pts is not None and obs.q is not None and obs.q["sharpness"] >= MIN_SHARPNESS
        if not valid:
            self.miss += 1
            if obs.pts is None:
                self.gap["empty"] += 1
            else:
                self.gap["blurry"] += 1
                if self.last_valid_pts is not None and detect.quad_iou(obs.pts, self.last_valid_pts) < 0.6:
                    self.gap["moved"] = True
            self.pending.clear()
            if self.current is not None and self.miss >= GAP_FRAMES:
                self._close()
            return
        if self.current is None:
            self._open(obs)
            return
        if _sig_dist(obs, self.current.ref) <= SAME_THRESH:
            self.current.add(obs)
            self.miss = 0
            self.pending.clear()
            self.gap = {"empty": 0, "blurry": 0, "moved": False}
            self.last_valid_pts = obs.pts
            return
        self.pending.append(obs)
        if len(self.pending) >= CONFIRM_FRAMES:
            if _sig_dist(self.pending[-1], self.pending[0]) <= SAME_THRESH:
                pending = self.pending
                self.pending = []
                self._close()
                self.gap = {"empty": 0, "blurry": 0, "moved": True}
                self._open(pending[0])
                for o in pending[1:]:
                    self.current.add(o)
            else:
                self.pending = self.pending[-1:]

    def _open(self, obs: FrameObs) -> None:
        self.seq += 1
        self.current = Group(seq=self.seq, gap_before=dict(self.gap), prev_last_pts=self.last_closed_pts)
        self.current.add(obs)
        self.gap = {"empty": 0, "blurry": 0, "moved": False}
        self.miss = 0
        self.last_valid_pts = obs.pts

    def _close(self) -> None:
        g, self.current = self.current, None
        if g is None:
            return
        self.last_closed_pts = g.frames[-1].pts
        self.on_close(g)

    def flush(self) -> None:
        self.pending.clear()
        self._close()


class FrameSequenceProcessor:
    def __init__(self, session_id: str, capture_id: str):
        self.session_id = session_id
        self.capture_id = capture_id
        session = store.get_session(session_id)
        self.adapter = registry.get(session["game_id"])
        self.default_lang = (session.get("settings") or {}).get("default_language", "en")
        self.grouper = TemporalGrouper(self._on_group_closed)
        self.futures = []
        self.lock = threading.Lock()
        self.groups: dict[int, dict] = {}
        self.frames_seen = 0
        self.frame_shape: tuple | None = None

    def push_frame(self, frame: np.ndarray, t: float) -> dict:
        h, w = frame.shape[:2]
        scale = min(1.0, PROCESS_MAX_SIDE / max(h, w))
        if scale < 1:
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        self.frame_shape = frame.shape
        obs = FrameObs(t=t, idx=self.frames_seen)
        self.frames_seen += 1
        q = detect.detect_primary_card(frame)
        if q is not None:
            warped = detect.warp_card(frame, q.pts)
            obs.pts, obs.warped, obs.frame = q.pts, warped, frame
            obs.sig = hashing.compute_hashes(warped).art
            obs.sig180 = hashing.compute_hashes(cv2.rotate(warped, cv2.ROTATE_180)).art
            obs.q = quality.frame_quality(warped, q.pts, frame.shape)
        self.grouper.push(obs)
        fh, fw = frame.shape[:2]
        cur = self.grouper.current
        return {
            "type": "frame_state", "t": round(t, 3),
            "tracking": cur is not None and obs.pts is not None,
            "quad": (obs.pts / np.array([fw, fh], np.float32)).round(4).tolist() if obs.pts is not None else None,
            "group_frames": len(cur.frames) if cur else 0,
            "sharpness": obs.q["sharpness"] if obs.q else None,
            "glare": obs.q["glare"] if obs.q else None,
            "cards_closed": self.grouper.seq - (1 if cur else 0),
        }

    def _on_group_closed(self, group: Group) -> None:
        best = group.ref
        det_id = db.new_id()
        fh, fw = best.frame.shape[:2]
        quad = (best.pts / np.array([fw, fh], np.float32)).round(5).tolist()
        xs, ys = [p[0] for p in quad], [p[1] for p in quad]
        crop = store.save_crop(self.session_id, det_id, best.warped)
        det = store.insert_detection(
            self.session_id, self.capture_id, id=det_id, seq=store.next_seq(self.session_id),
            bbox={"quad": quad, "rect": [min(xs), min(ys), max(xs), max(ys)]}, crop_path=crop, status="pending",
            confidence=0.0, source="none", temporal_group=group.seq, frame_count=len(group.frames),
            t_start=round(group.frames[0].t, 3), t_end=round(group.frames[-1].t, 3),
            quality={**best.q, "kind": "full", "gap_before": group.gap_before, "frames": len(group.frames)}, notes=[])
        bus.publish(self.session_id, {"type": "detection", "detection": detection_public(det, self.adapter)})
        with self.lock:
            self.groups[group.seq] = {"det_id": det_id, "done": False, "gap_before": group.gap_before,
                                      "first_pts": group.frames[0].pts, "prev_last_pts": group.prev_last_pts}
        self.futures.append(identify_pool.submit(self._identify_group, group, det_id))

    def _identify_group(self, group: Group, det_id: str) -> None:
        try:
            tries: list[tuple[identify.IdentifyResult, FrameObs]] = []
            chosen = None
            for obs in group.best:
                ctx = detect.warp_card(obs.frame, obs.pts, out_w=620, out_h=864, expand=0.12)
                r = identify.identify(obs.warped, adapter=self.adapter, context_bgr=ctx, default_language=self.default_lang,
                                      session_id=self.session_id, allow_vlm=False)
                tries.append((r, obs))
                if r.status == "back" or (r.status in ("identified", "token") and r.confidence >= identify.HASH_ACCEPT):
                    chosen = (r, obs)
                    break
            if chosen is None:
                ranked = sorted(tries, key=lambda x: (x[0].status in ("identified", "token", "back"), x[0].confidence),
                                reverse=True)
                chosen = ranked[0]
                if chosen[0].status == "unidentified" and vlm.enabled():
                    obs = group.ref
                    ctx = detect.warp_card(obs.frame, obs.pts, out_w=620, out_h=864, expand=0.12)
                    chosen = (identify.identify(obs.warped, adapter=self.adapter, context_bgr=ctx,
                                                default_language=self.default_lang, session_id=self.session_id,
                                                allow_orb=False), obs)
            result, obs = chosen
            if len(group.frames) <= 1 and result.status == "unidentified":
                result.status = "noise"
                result.notes.append("aparição muito breve (1 frame) — provavelmente não era uma carta")
            elif len(group.frames) < 3 and result.status == "identified":
                result.notes.append("carta vista por muito pouco tempo — confira")
            if obs is not group.ref:
                store.save_crop(self.session_id, det_id, obs.warped)
            _store_result(self.session_id, det_id, result, obs.warped)
            bus.publish(self.session_id, {"type": "detection",
                                          "detection": detection_public(store.get_detection(det_id), self.adapter)})
            with self.lock:
                self.groups[group.seq]["done"] = True
            self._check_repeat(group.seq)
            self._check_repeat(group.seq + 1)
            deck.rebuild(self.session_id)
        finally:
            for o in group.best:
                o.frame = o.warped = None

    def _check_repeat(self, seq: int) -> None:
        """Mesma carta em grupos seguidos: foco/tremida sem sair do lugar colapsa; do contrário são cópias."""
        with self.lock:
            cur, prev = self.groups.get(seq), self.groups.get(seq - 1)
            if not cur or not prev or not cur["done"] or not prev["done"]:
                return
        dc, dp = store.get_detection(cur["det_id"]), store.get_detection(prev["det_id"])
        if dc["status"] != "identified" or dp["status"] != "identified" or dc["oracle_id"] != dp["oracle_id"]:
            return
        gap = cur["gap_before"]
        iou = detect.quad_iou(cur["prev_last_pts"], cur["first_pts"]) if cur["prev_last_pts"] is not None else 0.0
        if gap.get("empty", 0) == 0 and not gap.get("moved") and iou >= 0.85:
            store.update_detection(dc["id"], dup_of=dp.get("dup_of") or dp["id"], dup_status="auto",
                                   dup_candidates={"merged_reasons": ["mesma carta sem sair do quadro (foco ou tremida)"]})
        else:
            note = "mesma carta do grupo anterior — contada como outra cópia"
            if note not in (dc.get("notes") or []):
                store.update_detection(dc["id"], notes=(dc.get("notes") or []) + [note])

    def finish(self) -> None:
        self.grouper.flush()
        for f in list(self.futures):
            f.result()
        deck.rebuild(self.session_id)


def process_video_file(session_id: str, capture_id: str) -> None:
    cap = store.get_capture(capture_id)
    vc = cv2.VideoCapture(cap["file_path"])
    if not vc.isOpened():
        store.update_capture(capture_id, status="error", error="não foi possível abrir o vídeo")
        bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})
        return
    fps = vc.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(vc.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, int(round(fps / config.VIDEO_SAMPLE_FPS)))
    store.update_capture(capture_id, status="processing", progress=0, w=int(vc.get(cv2.CAP_PROP_FRAME_WIDTH)),
                         h=int(vc.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    store.update_session(session_id, status="processing")
    bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})
    proc = FrameSequenceProcessor(session_id, capture_id)
    idx, last_pub, started = 0, 0.0, time.time()
    while vc.grab():
        if idx % step == 0:
            ok, frame = vc.retrieve()
            if ok:
                proc.push_frame(frame, idx / fps)
            if time.time() - last_pub > 0.7:
                last_pub = time.time()
                store.update_capture(capture_id, progress=round(idx / total, 3) if total else None)
                bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})
        idx += 1
    vc.release()
    proc.finish()
    store.update_capture(capture_id, status="done", progress=1,
                         quality={"frames": idx, "sampled": proc.frames_seen, "groups": proc.grouper.seq,
                                  "fps": round(fps, 2), "seconds": round(time.time() - started, 1)})
    bus.publish(session_id, {"type": "capture", "capture": capture_public(store.get_capture(capture_id))})
    finish_if_idle(session_id)


class LiveRunner:
    """Câmera ao vivo: frames JPEG chegam pelo WebSocket; processa sempre o mais recente."""

    def __init__(self, session_id: str, send: Callable[[dict], None]):
        self.session_id = session_id
        capture = store.add_capture(session_id, "video", "", "câmera ao vivo")
        self.capture_id = capture["id"]
        store.update_capture(self.capture_id, status="processing")
        store.update_session(session_id, status="processing")
        self.proc = FrameSequenceProcessor(session_id, self.capture_id)
        self.send = send
        self.q: queue.Queue = queue.Queue(maxsize=2)
        self.dropped = 0
        self.running = True
        self.thread = threading.Thread(target=self._run, name=f"live-{session_id[:6]}", daemon=True)
        self.thread.start()

    def submit(self, t: float, jpeg: bytes) -> None:
        try:
            self.q.put_nowait((t, jpeg))
        except queue.Full:
            try:
                self.q.get_nowait()
                self.dropped += 1
            except queue.Empty:
                pass
            self.q.put_nowait((t, jpeg))

    def _run(self) -> None:
        while self.running or not self.q.empty():
            try:
                t, jpeg = self.q.get(timeout=0.3)
            except queue.Empty:
                continue
            frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                continue
            state = self.proc.push_frame(frame, t)
            state["dropped"] = self.dropped
            self.send(state)

    def stop(self) -> None:
        self.running = False
        self.thread.join(timeout=10)
        self.proc.finish()
        store.update_capture(self.capture_id, status="done", progress=1,
                             quality={"sampled": self.proc.frames_seen, "groups": self.proc.grouper.seq,
                                      "dropped": self.dropped})
        bus.publish(self.session_id, {"type": "capture", "capture": capture_public(store.get_capture(self.capture_id))})
        finish_if_idle(self.session_id)
