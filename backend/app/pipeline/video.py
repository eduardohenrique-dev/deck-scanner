"""Modo vídeo — implementação de REFERÊNCIA em Python (ferramentas de teste e calibração).

No app, os frames são analisados no navegador (frontend/src/vision) com a mesma lógica: amostra ~10 fps,
agrupa frames consecutivos da mesma carta pela continuidade temporal, escolhe os melhores frames
(nitidez, reflexo, frontalidade) e envia só esses como uma "leitura" (pipeline/sightings.py).
Aqui a mesma sequência roda sobre um arquivo de vídeo para medir acurácia de ponta a ponta.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable

import cv2
import numpy as np

from .. import config
from ..vision import detect, hashing, quality
from . import sightings, store
from .imageio import encode_jpeg

SAME_THRESH = 100         # bits de 256 (pHash da arte): acima disso, com a carta parada, é outra carta
                          # (pares aleatórios ficam em ~128±8; fragmentos da mesma carta são refundidos pela identidade)
STABLE_MOTION = 0.10      # deslocamento entre frames (fração da largura da carta) para considerar a carta parada
FAST_MOTION = 0.25        # acima disso é a carta sendo tirada/colocada
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


def _center_and_width(pts: np.ndarray) -> tuple[np.ndarray, float]:
    p = np.asarray(pts, np.float32)
    return p.mean(axis=0), float((np.linalg.norm(p[0] - p[1]) + np.linalg.norm(p[3] - p[2])) / 2)


class TemporalGrouper:
    """Agrupa frames por continuidade temporal com carta PARADA.

    - frame estável: carta detectada, nítida, deslocada menos de STABLE_MOTION desde o frame anterior;
    - frames instáveis formam uma transição; a transição guarda o evento mais forte visto:
      "empty" (carta sumiu) > "fast" (carta sendo tirada) > "unstable" (tremida/foco);
    - após transição "empty"/"fast" começa OUTRA carta física, mesmo com a mesma arte (básicos seguidos);
    - após transição leve, continua a mesma carta se a assinatura e a posição conferem;
    - com a carta parada, assinatura muito diferente = carta trocada no lugar.
    """

    STRENGTH = {None: 0, "unstable": 1, "fast": 2, "empty": 3}

    def __init__(self, on_close: Callable[[Group], None]):
        self.on_close = on_close
        self.current: Group | None = None
        self.seq = 0
        self.prev_pts: np.ndarray | None = None
        self.transition: str | None = None
        self.transition_frames = 0
        self.last_stable_pts: np.ndarray | None = None
        self.last_closed_pts: np.ndarray | None = None
        self.areas: list[float] = []
        self.sharps: list[float] = []

    def _mark(self, kind: str) -> None:
        if self.STRENGTH[kind] > self.STRENGTH[self.transition]:
            self.transition = kind
        self.transition_frames += 1

    def push(self, obs: FrameObs) -> None:
        if obs.pts is None:
            self.prev_pts = None
            self._mark("empty")
            if self.current is not None and self.transition_frames >= 2:
                self._close()
            return
        area = float(cv2.contourArea(np.asarray(obs.pts, np.float32)))
        center, width = _center_and_width(obs.pts)
        sharpness = obs.q["sharpness"] if obs.q is not None else 0.0
        ref_sharp = float(np.median(self.sharps[-15:])) if self.current is not None and len(self.sharps) >= 2 else None
        if self.current is not None and len(self.areas) >= 2:
            ref_area = float(np.median(self.areas[-15:]))
            if not (0.65 * ref_area <= area <= 1.5 * ref_area):
                inside = self.last_stable_pts is not None and cv2.pointPolygonTest(
                    np.asarray(self.last_stable_pts, np.float32).reshape(-1, 1, 2),
                    (float(center[0]), float(center[1])), False) >= 0
                # contorno menor dentro da carta parada = falha do detector (caixa de arte, reflexo);
                # contorno maior ou deslocado = carta saindo junto com a mão (evidência de troca).
                self._mark("unstable" if (area < 0.65 * ref_area and inside) else "fast")
                return
        motion = 0.0
        if self.prev_pts is not None:
            motion = float(np.linalg.norm(center - _center_and_width(self.prev_pts)[0])) / max(width, 1.0)
        self.prev_pts = obs.pts
        sharp_ok = sharpness >= MIN_SHARPNESS and (ref_sharp is None or sharpness >= 0.2 * ref_sharp)
        if motion > STABLE_MOTION or not sharp_ok:
            self._mark("fast" if motion > FAST_MOTION else "unstable")
            return

        gap = {"event": self.transition, "frames": self.transition_frames}
        if self.current is None:
            self._open(obs, gap)
        elif self.transition in ("empty", "fast"):
            self._close()
            self._open(obs, gap)
        elif _sig_dist(obs, self.current.ref) > SAME_THRESH:
            self._close()  # carta trocada sem sair do lugar
            self._open(obs, gap)
        elif self.transition == "unstable" and self.last_stable_pts is not None \
                and detect.quad_iou(obs.pts, self.last_stable_pts) < 0.7:
            self._close()
            self._open(obs, gap)
        else:
            self.current.add(obs)
        self.areas.append(area)
        self.sharps.append(sharpness)
        self.transition, self.transition_frames = None, 0
        self.last_stable_pts = obs.pts

    def _open(self, obs: FrameObs, gap: dict) -> None:
        self.seq += 1
        self.current = Group(seq=self.seq, gap_before=gap, prev_last_pts=self.last_closed_pts)
        self.current.add(obs)
        self.areas = []
        self.sharps = []

    def _close(self) -> None:
        g, self.current = self.current, None
        if g is None:
            return
        self.last_closed_pts = g.frames[-1].pts
        self.on_close(g)

    def flush(self) -> None:
        self._close()


class FrameSequenceProcessor:
    """Frames → grupos → leituras enviadas ao mesmo caminho do app (sightings.record_sighting)."""

    def __init__(self, session_id: str, capture_id: str, allow_vlm: bool = True):
        self.session_id = session_id
        self.capture_id = capture_id
        self.allow_vlm = allow_vlm
        self.grouper = TemporalGrouper(self._on_group_closed)
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sighting")
        self.futures = []
        self.frames_seen = 0

    def push_frame(self, frame: np.ndarray, t: float) -> None:
        h, w = frame.shape[:2]
        scale = min(1.0, PROCESS_MAX_SIDE / max(h, w))
        if scale < 1:
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        obs = FrameObs(t=t, idx=self.frames_seen)
        self.frames_seen += 1
        q = detect.detect_primary_card(frame, prior=self.grouper.last_stable_pts)
        if q is not None:
            warped = detect.warp_card(frame, q.pts)
            obs.pts, obs.warped, obs.frame = q.pts, warped, frame
            obs.sig = hashing.compute_hashes(warped).art
            obs.sig180 = hashing.compute_hashes(cv2.rotate(warped, cv2.ROTATE_180)).art
            obs.q = quality.frame_quality(warped, q.pts, frame.shape)
            if q.kind == "edge":  # carta saindo do quadro: vale para agrupar, mas não como melhor frame
                obs.q["score"] = round(obs.q["score"] * 0.6, 4)
        self.grouper.push(obs)

    def _on_group_closed(self, group: Group) -> None:
        best = group.ref
        fh, fw = best.frame.shape[:2]
        frames = []
        for obs in group.best:
            ctx = detect.warp_card(obs.frame, obs.pts, out_w=620, out_h=864, expand=hashing.CONTEXT_EXPAND)
            frames.append(sightings.Frame(card=obs.warped, context=ctx, jpeg=encode_jpeg(obs.warped, 88)))
        meta = sightings.GroupMeta(
            group=group.seq, frame_count=len(group.frames), t_start=group.frames[0].t, t_end=group.frames[-1].t,
            gap_before=group.gap_before, angles=[detect.long_axis_angle(f.pts) for f in group.frames],
            quality={k: best.q[k] for k in ("sharpness", "glare", "frontal", "size", "score")},
            quad=(best.pts / np.array([fw, fh], np.float32)).round(5).tolist(), frame_w=fw, frame_h=fh)
        for obs in group.best:
            obs.frame = obs.warped = None
        self.futures.append(self.pool.submit(sightings.record_sighting, self.session_id, self.capture_id, frames, meta,
                                             self.allow_vlm))

    def finish(self) -> None:
        self.grouper.flush()
        for f in list(self.futures):
            f.result()
        self.pool.shutdown()
        sightings.finish_capture(self.session_id, self.capture_id)


def process_video_file(session_id: str, capture_id: str, path: str) -> dict:
    vc = cv2.VideoCapture(path)
    if not vc.isOpened():
        store.update_capture(capture_id, status="error", error="não foi possível abrir o vídeo")
        return {"error": "open"}
    fps = vc.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(fps / config.VIDEO_SAMPLE_FPS)))
    store.update_capture(capture_id, status="processing", progress=0, w=int(vc.get(cv2.CAP_PROP_FRAME_WIDTH)),
                         h=int(vc.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    proc = FrameSequenceProcessor(session_id, capture_id)
    idx, started = 0, time.time()
    while vc.grab():
        if idx % step == 0:
            ok, frame = vc.retrieve()
            if ok:
                proc.push_frame(frame, idx / fps)
        idx += 1
    vc.release()
    proc.finish()
    info = {"frames": idx, "sampled": proc.frames_seen, "groups": proc.grouper.seq, "fps": round(fps, 2),
            "seconds": round(time.time() - started, 1)}
    store.update_capture(capture_id, quality=info)
    return info
