"""Índice em memória dos hashes perceptuais — busca por distância de Hamming vetorizada (NumPy)."""
from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np

from .. import db
from .hashing import CardHashes

W_FULL = 0.5          # peso do hash da carta inteira (menos discriminativo que a arte)
W_COLOR = 0.04        # desempate por cor (só no re-ranqueamento do top-k)
LEARNED_BONUS = 14.0  # hashes aprendidos por correção refletem a mesa/luz do usuário
BACK_PREFIX = "__back__"


@dataclass
class Candidate:
    card_ref_id: str
    face: int
    oracle_id: str | None
    score: float
    d_art: int
    d_full: int
    orientation: int  # 0 ou 180
    learned: bool
    variant: int = 0  # índice do hash de consulta que casou (orientação × recorte com/sem sleeve)

    @property
    def is_back(self) -> bool:
        return self.card_ref_id.startswith(BACK_PREFIX)

    def as_dict(self) -> dict:
        return {
            "card_ref_id": self.card_ref_id, "face": self.face, "oracle_id": self.oracle_id,
            "score": round(float(self.score), 1), "d_art": int(self.d_art), "d_full": int(self.d_full),
            "orientation": self.orientation, "learned": self.learned,
        }


def _blobs_to_u64(blobs: list[bytes]) -> np.ndarray:
    if not blobs:
        return np.zeros((0, 4), dtype=np.uint64)
    return np.frombuffer(b"".join(blobs), dtype=np.uint8).reshape(len(blobs), 32).view(np.uint64).copy()


class HashIndex:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.ids: list[str] = []
        self.oracles: list[str | None] = []
        self.faces = np.zeros(0, dtype=np.int16)
        self.art = np.zeros((0, 4), dtype=np.uint64)
        self.full = np.zeros((0, 4), dtype=np.uint64)
        self.color = np.zeros((0, 32), dtype=np.uint8)
        self.learned = np.zeros(0, dtype=bool)
        self.count_base = 0
        self.count_learned = 0

    def load(self, user_id: str | None = None) -> None:
        conn = db.catalog_db()
        rows = conn.execute(
            "SELECT h.card_ref_id, h.face, h.art, h.full, h.color, r.oracle_id "
            "FROM art_hashes h LEFT JOIN card_refs r ON r.id = h.card_ref_id"
        ).fetchall()
        learned_sql = ("SELECT l.card_ref_id, l.face, l.art, l.full, l.color, r.oracle_id "
                       "FROM learned_hashes l LEFT JOIN card_refs r ON r.id = l.card_ref_id")
        params: tuple = ()
        if user_id:
            learned_sql += " WHERE l.user_id=?"
            params = (user_id,)
        learned = conn.execute(learned_sql, params).fetchall()
        all_rows = list(rows) + list(learned)
        with self._lock:
            self.ids = [r[0] for r in all_rows]
            self.oracles = [r[5] for r in all_rows]
            self.faces = np.array([r[1] for r in all_rows], dtype=np.int16)
            self.art = _blobs_to_u64([r[2] for r in all_rows])
            self.full = _blobs_to_u64([r[3] for r in all_rows])
            self.color = (np.frombuffer(b"".join((r[4] or bytes(32)) for r in all_rows), dtype=np.uint8)
                          .reshape(len(all_rows), 32).copy() if all_rows else np.zeros((0, 32), np.uint8))
            self.learned = np.array([False] * len(rows) + [True] * len(learned), dtype=bool)
            self.count_base = len(rows)
            self.count_learned = len(learned)

    def add_learned(self, card_ref_id: str, face: int, oracle_id: str | None, h: CardHashes) -> None:
        with self._lock:
            self.ids.append(card_ref_id)
            self.oracles.append(oracle_id)
            self.faces = np.append(self.faces, np.int16(face))
            self.art = np.vstack([self.art, h.art.reshape(1, 32).view(np.uint64)])
            self.full = np.vstack([self.full, h.full.reshape(1, 32).view(np.uint64)])
            self.color = np.vstack([self.color, h.color.reshape(1, 32)])
            self.learned = np.append(self.learned, True)
            self.count_learned += 1

    def __len__(self) -> int:
        return len(self.ids)

    def query(self, hashes: list[CardHashes], k: int = 12) -> list[Candidate]:
        with self._lock:
            art, full, color, learned = self.art, self.full, self.color, self.learned
            ids, oracles, faces = self.ids, self.oracles, self.faces
        n = len(ids)
        if n == 0:
            return []
        scores = np.empty((len(hashes), n), dtype=np.float32)
        d_art_all = np.empty((len(hashes), n), dtype=np.int32)
        d_full_all = np.empty((len(hashes), n), dtype=np.int32)
        for o, h in enumerate(hashes):
            qa = h.art.reshape(32).view(np.uint64)
            qf = h.full.reshape(32).view(np.uint64)
            da = np.bitwise_count(art ^ qa).sum(axis=1, dtype=np.int32)
            dfull = np.bitwise_count(full ^ qf).sum(axis=1, dtype=np.int32)
            d_art_all[o], d_full_all[o] = da, dfull
            scores[o] = da + W_FULL * dfull - LEARNED_BONUS * learned
        orient = np.argmin(scores, axis=0)
        best = scores[orient, np.arange(n)]
        kk = min(k * 3, n)
        top = np.argpartition(best, kk - 1)[:kk]
        out: list[Candidate] = []
        for idx in top:
            o = int(orient[idx])
            col = np.abs(color[idx].astype(np.int16) - hashes[o].color.astype(np.int16)).mean()
            out.append(Candidate(
                card_ref_id=ids[idx], face=int(faces[idx]), oracle_id=oracles[idx],
                score=float(best[idx] + W_COLOR * col * 10), d_art=int(d_art_all[o, idx]),
                d_full=int(d_full_all[o, idx]), orientation=180 if o % 2 else 0, learned=bool(learned[idx]),
                variant=o,
            ))
        out.sort(key=lambda c: c.score)
        return out[:k]


_index: HashIndex | None = None
_index_lock = threading.Lock()


def get_index() -> HashIndex:
    global _index
    with _index_lock:
        if _index is None:
            _index = HashIndex()
            _index.load()
        return _index


def reload_index() -> HashIndex:
    global _index
    with _index_lock:
        idx = HashIndex()
        idx.load()
        _index = idx
        return idx
