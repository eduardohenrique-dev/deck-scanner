"""Fila de processamento assíncrona (threads): capturas serializadas por sessão, identificação em paralelo."""
from __future__ import annotations

import threading
import traceback
from collections import defaultdict
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable

from .events import bus

capture_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="capture")
identify_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="identify")
_session_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)


def submit_capture(session_id: str, fn: Callable, *args) -> Future:
    def run():
        with _session_locks[session_id]:
            try:
                fn(*args)
            except Exception as exc:  # noqa: BLE001 — erro vira evento visível, nunca some
                traceback.print_exc()
                bus.publish(session_id, {"type": "error", "message": f"{type(exc).__name__}: {exc}"})
    return capture_pool.submit(run)


def session_lock(session_id: str) -> threading.Lock:
    return _session_locks[session_id]
