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
        self.fast_run = 0
        self.empty_run = 0
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
            self.empty_run += 1
            self.fast_run = 0
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
                # (tratar contorno borrado como troca corrigia um caso e partia várias cartas com reflexo)
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
        self.fast_run = 0
        self.empty_run = 0

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
    def __init__(self, session_id: str, capture_id: str):
        self.session_id = session_id
        self.capture_id = capture_id
        session = store.get_session(session_id)
        self.adapter = registry.get(session["game_id"])
        self.default_lang = (session.get("settings") or {}).get("default_language", "en")
        self.grouper = TemporalGrouper(self._on_group_closed)
        self.futures = []
        self.lock = threading.Lock()
        self.consolidate_lock = threading.Lock()
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
        det = store.insert_detection_seq(
            self.session_id, self.capture_id, id=det_id,
            bbox={"quad": quad, "rect": [min(xs), min(ys), max(xs), max(ys)]}, crop_path=crop, status="pending",
            confidence=0.0, source="none", temporal_group=group.seq, frame_count=len(group.frames),
            t_start=round(group.frames[0].t, 3), t_end=round(group.frames[-1].t, 3),
            quality={**best.q, "kind": "full", "gap_before": group.gap_before, "frames": len(group.frames)}, notes=[])
        bus.publish(self.session_id, {"type": "detection", "detection": detection_public(det, self.adapter)})
        with self.lock:
            self.groups[group.seq] = {"det_id": det_id, "done": False, "gap_before": group.gap_before,
                                      "frames": len(group.frames),
                                      "angles": [detect.long_axis_angle(f.pts) for f in group.frames]}
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
            self.consolidate(final=False)
            deck.rebuild(self.session_id)
        finally:
            for o in group.best:
                o.frame = o.warped = None

    NOTE_COPY = "mesma carta do grupo anterior — contada como outra cópia"
    NOTE_LONG = "exibição longa: podem ser 2 cópias seguidas — confira a quantidade"

    def consolidate(self, final: bool) -> None:
        """Consolida a sequência de grupos (uma carta física por grupo) de forma idempotente.

        - fragmento ruim (não identificado/ruído) sem transição forte = frames ruins da carta anterior;
        - mesma identidade em grupos seguidos: funde se não houve carta saindo/movimento de troca, ou se
          um dos lados é um fragmento curto; senão são cópias diferentes (com aviso);
        - exibição muito mais longa que as demais recebe aviso de possível cópia dupla.
        """
        with self.consolidate_lock:
            with self.lock:
                ordered = sorted(self.groups.items())
            items: list[dict] = []
            for _, g in ordered:
                if not g["done"]:
                    if not final:
                        break
                    continue
                items.append({"g": g, "d": store.get_detection(g["det_id"]), "frames": g["frames"]})
            if not items:
                return
            durations = [it["d"]["t_end"] - it["d"]["t_start"] for it in items
                         if it["d"]["status"] == "identified" and it["frames"] >= 4]
            median_dur = float(np.median(durations)) if len(durations) >= 5 else None
            decisions: dict[str, tuple[str | None, list[str]]] = {}
            prev_real: dict | None = None
            for it in items:
                g, d = it["g"], it["d"]
                gap = g["gap_before"] or {}
                event = gap.get("event")
                parent, reasons = None, []
                if prev_real is not None:
                    pd = prev_real["d"]
                    same = d["status"] == pd["status"] and d["status"] in ("identified", "token", "back") \
                        and d.get("oracle_id") == pd.get("oracle_id")
                    if d["status"] in ("unidentified", "noise") and event in (None, "unstable"):
                        parent, reasons = prev_real, ["frames ruins da mesma carta (sem transição)"]
                    elif same and event in (None, "unstable"):
                        parent, reasons = prev_real, ["mesma carta sem sair do quadro (tremida ou reposicionada)"]
                    elif same and min(it["frames"], prev_real["frames"]) < 4 and gap.get("frames", 0) <= 3:
                        parent, reasons = prev_real, ["fragmento curto da mesma carta"]
                    elif same and median_dur and (d["t_end"] - pd["t_start"]) <= 1.6 * median_dur:
                        # duas cópias reais somariam ~2 exibições + a troca; isto cabe em uma só
                        parent, reasons = prev_real, ["mesma carta: interrupção curta dentro de uma exibição normal"]
                if parent is not None:
                    decisions[d["id"]] = (parent["d"]["id"], reasons)
                    parent["frames"] += it["frames"]  # acumulador local: a carta fundida soma a exibição
                else:
                    decisions[d["id"]] = (None, [])
                    if d["status"] != "noise":
                        prev_real = it
            lengths = [it["frames"] for it in items if decisions[it["d"]["id"]][0] is None and it["d"]["status"] == "identified"]
            median_len = float(np.median(lengths)) if lengths else 0.0
            plain = [(it["g"], it["d"]) for it in items]
            for it in items:
                g, d = it["g"], it["d"]
                if d.get("dup_status") in ("user_same", "user_different"):
                    continue  # decisão da revisão prevalece
                root, reasons = decisions[d["id"]]
                notes = [n for n in (d.get("notes") or []) if n not in (self.NOTE_COPY, self.NOTE_LONG)]
                if root is None:
                    fields = {}
                    if d.get("dup_status") == "auto":
                        fields.update(dup_of=None, dup_status=None)
                    if d["status"] == "identified" and median_len and it["frames"] >= max(16, 1.8 * median_len):
                        notes.append(self.NOTE_LONG)
                    prev = self._previous_kept(plain, decisions, d["id"])
                    if prev is not None and prev["status"] == d["status"] == "identified" and prev.get("oracle_id") == d.get("oracle_id"):
                        notes.append(self.NOTE_COPY)
                    if notes != (d.get("notes") or []):
                        fields["notes"] = notes
                    if fields:
                        store.update_detection(d["id"], **fields)
                elif d.get("dup_of") != root or d.get("dup_status") != "auto" or notes != (d.get("notes") or []):
                    store.update_detection(d["id"], dup_of=root, dup_status="auto", notes=notes,
                                           dup_candidates={"merged_reasons": reasons})

    NOTE_SPLIT = "segunda cópia inferida: a pose da carta mudou no meio de uma exibição longa — confira"

    def infer_hidden_copies(self) -> None:
        """Cópias idênticas trocadas sem evento visível (ex.: básicos seguidos) viram uma exibição longa só.

        Duas cartas físicas nunca ficam na mesma pose: se uma exibição longa (≥ 1,6× a mediana) tem uma mudança
        sustentada de ângulo no meio, registra uma segunda cópia — sempre com aviso para conferir.
        """
        with self.lock:
            ordered = sorted(self.groups.items())
        dets = {g["det_id"]: store.get_detection(g["det_id"]) for _, g in ordered}
        roots: dict[str, list[dict]] = {}
        for _, g in ordered:
            d = dets[g["det_id"]]
            root = d.get("dup_of") if d.get("dup_status") == "auto" and d.get("dup_of") in dets else d["id"]
            roots.setdefault(root, []).append(g)
        spans = []
        for root, parts in roots.items():
            d = dets[root]
            if d["status"] != "identified":
                continue
            t0 = min(dets[p["det_id"]]["t_start"] for p in parts)
            t1 = max(dets[p["det_id"]]["t_end"] for p in parts)
            spans.append((root, parts, t1 - t0))
        if len(spans) < 5:
            return
        median = float(np.median([s for _, _, s in spans]))
        for root, parts, span in spans:
            if span < 1.6 * median:
                continue
            angles = [a for p in parts for a in p.get("angles", [])]
            if len(angles) < 10:
                continue
            best_delta, best_k = 0.0, None
            for k in range(5, len(angles) - 4):
                delta = abs(float(np.median(angles[:k])) - float(np.median(angles[k:])))
                delta = min(delta, 180.0 - delta)
                if delta > best_delta:
                    best_delta, best_k = delta, k
            clone_key = f"clone:{root}"
            existing = db.app_db().execute(
                "SELECT id FROM detections WHERE session_id=? AND raw_name=?", (self.session_id, clone_key)).fetchone()
            if best_k is None or best_delta < 1.8:
                continue
            if existing:
                continue
            base = dets[root]
            clone = {k: base[k] for k in ("bbox", "crop_path", "card_ref_id", "oracle_id", "face", "language", "finish",
                                          "candidates", "quality", "temporal_group", "frame_count", "t_start", "t_end",
                                          "art_phash", "full_phash")}
            clone.update(status="identified", confidence=round(min(base["confidence"], 0.75), 3), source=base["source"],
                         notes=[self.NOTE_SPLIT], raw_name=clone_key)
            store.insert_detection_seq(self.session_id, self.capture_id, id=db.new_id(), **clone)
            notes = [n for n in (base.get("notes") or []) if n != self.NOTE_LONG] + [self.NOTE_SPLIT]
            store.update_detection(root, notes=notes)

    @staticmethod
    def _previous_kept(items: list, decisions: dict, det_id: str) -> dict | None:
        prev = None
        for _, d in items:
            if d["id"] == det_id:
                return prev
            if decisions[d["id"]][0] is None and d["status"] != "noise":
                prev = d
        return None

    def finish(self) -> None:
        self.grouper.flush()
        for f in list(self.futures):
            f.result()
        self.consolidate(final=True)
        self.infer_hidden_copies()
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
