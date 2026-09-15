"""Índice em memória dos hashes perceptuais — busca por distância de Hamming vetorizada (NumPy).

A base (~112 mil impressões) vem de um arquivo compacto `hashindex.npz` gerado a partir do catálogo
(local: backend/data; hospedado: baixado do storage na primeira consulta da instância).
Hashes aprendidos por correção ficam no banco, separados por usuário.
"""
from __future__ import annotations

import io
import threading
import uuid
from dataclasses import dataclass

import numpy as np

from .. import config, db
from .hashing import CardHashes

W_FULL = 0.5          # peso do hash da carta inteira (menos discriminativo que a arte)
W_COLOR = 0.04        # desempate por cor (só no re-ranqueamento do top-k)
LEARNED_BONUS = 14.0  # hashes aprendidos por correção refletem a mesa/luz do usuário
BACK_PREFIX = "__back__"
INDEX_STORAGE_KEY = "system/hashindex-v1.npz"


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
    variant: int = 0  # índice do hash de consulta que casou (orientação × recorte)

    @property
    def is_back(self) -> bool:
        return self.card_ref_id.startswith(BACK_PREFIX)

    def as_dict(self) -> dict:
        return {
            "card_ref_id": self.card_ref_id, "face": self.face, "oracle_id": self.oracle_id,
            "score": round(float(self.score), 1), "d_art": int(self.d_art), "d_full": int(self.d_full),
            "orientation": self.orientation, "learned": self.learned,
        }


def _uuid_bytes(value: str | None) -> bytes:
    if not value:
        return bytes(16)
    return uuid.UUID(value.split(":", 1)[-1]).bytes


def _uuid_str(raw: np.ndarray) -> str | None:
    b = raw.tobytes()
    return None if b == bytes(16) else str(uuid.UUID(bytes=b))


class _Arrays:
    """Bloco de hashes (base ou aprendidos de um usuário)."""

    def __init__(self, art, full, color, faces, ids, oracles, is_back, learned: bool):
        self.art, self.full, self.color = art, full, color
        self.faces, self.ids, self.oracles, self.is_back = faces, ids, oracles, is_back
        self.learned = learned

    def __len__(self) -> int:
        return len(self.faces)

    def card_ref_id(self, i: int) -> str:
        base = _uuid_str(self.ids[i]) or ""
        return f"{BACK_PREFIX}:{base}" if self.is_back[i] else base

    @staticmethod
    def empty(learned: bool) -> "_Arrays":
        return _Arrays(np.zeros((0, 4), np.uint64), np.zeros((0, 4), np.uint64), np.zeros((0, 32), np.uint8),
                       np.zeros(0, np.int16), np.zeros((0, 16), np.uint8), np.zeros((0, 16), np.uint8),
                       np.zeros(0, bool), learned)

    def append(self, card_ref_id: str, face: int, oracle_id: str | None, h: CardHashes) -> "_Arrays":
        return _Arrays(
            np.vstack([self.art, h.art.reshape(1, 32).view(np.uint64)]),
            np.vstack([self.full, h.full.reshape(1, 32).view(np.uint64)]),
            np.vstack([self.color, h.color.reshape(1, 32)]),
            np.append(self.faces, np.int16(face)),
            np.vstack([self.ids, np.frombuffer(_uuid_bytes(card_ref_id), np.uint8).reshape(1, 16)]),
            np.vstack([self.oracles, np.frombuffer(_uuid_bytes(oracle_id), np.uint8).reshape(1, 16)]),
            np.append(self.is_back, card_ref_id.startswith(BACK_PREFIX)),
            self.learned,
        )


def _u64(blobs: list[bytes]) -> np.ndarray:
    if not blobs:
        return np.zeros((0, 4), dtype=np.uint64)
    return np.frombuffer(b"".join(blobs), dtype=np.uint8).reshape(len(blobs), 32).view(np.uint64).copy()


def build_index_file(target=config.HASH_INDEX_FILE) -> dict:
    """Gera o arquivo do índice a partir de art_hashes do catálogo SQLite local."""
    rows = db.catalog_db().execute(
        "SELECT h.card_ref_id, h.face, h.art, h.\"full\", h.color, r.oracle_id "
        "FROM art_hashes h LEFT JOIN card_refs r ON r.id = h.card_ref_id").fetchall()
    ids = np.frombuffer(b"".join(_uuid_bytes(r[0]) for r in rows), np.uint8).reshape(len(rows), 16)
    oracles = np.frombuffer(b"".join(_uuid_bytes(r[5]) for r in rows), np.uint8).reshape(len(rows), 16)
    np.savez(
        target,
        art=_u64([r[2] for r in rows]), full=_u64([r[3] for r in rows]),
        color=np.frombuffer(b"".join((r[4] or bytes(32)) for r in rows), np.uint8).reshape(len(rows), 32),
        faces=np.array([r[1] for r in rows], np.int16), ids=ids, oracles=oracles,
        is_back=np.array([str(r[0]).startswith(BACK_PREFIX) for r in rows], bool),
    )
    return {"entries": len(rows), "file": str(target)}


def _load_base() -> _Arrays:
    data = None
    if config.HASH_INDEX_FILE.exists():
        data = config.HASH_INDEX_FILE.read_bytes()
    else:
        from ..storage import get_storage

        storage = get_storage()
        if storage.backend != "local":
            data = storage.get(INDEX_STORAGE_KEY)
            if data:
                try:
                    config.HASH_INDEX_FILE.write_bytes(data)
                except OSError:
                    pass
        elif config.CATALOG_DB.exists():
            build_index_file()
            data = config.HASH_INDEX_FILE.read_bytes()
    if not data:
        return _Arrays.empty(False)
    z = np.load(io.BytesIO(data))
    return _Arrays(z["art"], z["full"], z["color"], z["faces"], z["ids"], z["oracles"], z["is_back"], False)


class HashIndex:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.base = _load_base()
        self._learned: dict[str, _Arrays] = {}

    @property
    def count_base(self) -> int:
        return len(self.base)

    def count_learned(self, user_id: str | None = None) -> int:
        return len(self._user_learned(user_id)) if user_id else sum(len(a) for a in self._learned.values())

    def __len__(self) -> int:
        return len(self.base)

    def _user_learned(self, user_id: str | None) -> _Arrays:
        if not user_id:
            return _Arrays.empty(True)
        with self._lock:
            hit = self._learned.get(user_id)
        if hit is not None:
            return hit
        rows = db.app_db().execute(
            "SELECT card_ref_id, face, oracle_id, art, full_hash, color FROM learned_hashes WHERE user_id=?",
            (user_id,)).fetchall()
        arr = _Arrays.empty(True)
        for r in rows:
            h = CardHashes(art=np.frombuffer(bytes(r[3]), np.uint8), full=np.frombuffer(bytes(r[4]), np.uint8),
                           color=np.frombuffer(bytes(r[5] or bytes(32)), np.uint8))
            arr = arr.append(r[0], int(r[1]), r[2], h)
        with self._lock:
            self._learned[user_id] = arr
        return arr

    def add_learned(self, user_id: str, card_ref_id: str, face: int, oracle_id: str | None, h: CardHashes) -> None:
        current = self._user_learned(user_id)
        with self._lock:
            self._learned[user_id] = current.append(card_ref_id, face, oracle_id, h)

    def query(self, hashes: list[CardHashes], k: int = 12, user_id: str | None = None) -> list[Candidate]:
        out = self._query_block(self.base, hashes, k)
        learned = self._user_learned(user_id)
        if len(learned):
            out += self._query_block(learned, hashes, k)
        out.sort(key=lambda c: c.score)
        return out[:k]

    @staticmethod
    def _query_block(block: _Arrays, hashes: list[CardHashes], k: int) -> list[Candidate]:
        n = len(block)
        if n == 0:
            return []
        scores = np.empty((len(hashes), n), dtype=np.float32)
        d_art_all = np.empty((len(hashes), n), dtype=np.int32)
        d_full_all = np.empty((len(hashes), n), dtype=np.int32)
        bonus = LEARNED_BONUS if block.learned else 0.0
        for o, h in enumerate(hashes):
            qa = h.art.reshape(32).view(np.uint64)
            qf = h.full.reshape(32).view(np.uint64)
            da = np.bitwise_count(block.art ^ qa).sum(axis=1, dtype=np.int32)
            dfull = np.bitwise_count(block.full ^ qf).sum(axis=1, dtype=np.int32)
            d_art_all[o], d_full_all[o] = da, dfull
            scores[o] = da + W_FULL * dfull - bonus
        orient = np.argmin(scores, axis=0)
        best = scores[orient, np.arange(n)]
        kk = min(k * 3, n)
        top = np.argpartition(best, kk - 1)[:kk]
        out: list[Candidate] = []
        for idx in top:
            o = int(orient[idx])
            col = np.abs(block.color[idx].astype(np.int16) - hashes[o].color.astype(np.int16)).mean()
            out.append(Candidate(
                card_ref_id=block.card_ref_id(int(idx)), face=int(block.faces[idx]),
                oracle_id=_uuid_str(block.oracles[idx]),
                score=float(best[idx] + W_COLOR * col * 10), d_art=int(d_art_all[o, idx]),
                d_full=int(d_full_all[o, idx]), orientation=180 if o % 2 else 0, learned=block.learned,
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
        return _index


def reload_index() -> HashIndex:
    global _index
    with _index_lock:
        _index = HashIndex()
        return _index
