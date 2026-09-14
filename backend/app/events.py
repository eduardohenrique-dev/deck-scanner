"""Barramento de eventos por sessão (threads de processamento → SSE/WebSocket no loop asyncio)."""
from __future__ import annotations

import asyncio
import threading
import time
from collections import defaultdict


class EventBus:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._lock = threading.Lock()

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def publish(self, session_id: str, event: dict) -> None:
        loop = self._loop
        if loop is None:
            return
        payload = {**event, "session_id": session_id, "ts": time.time()}
        with self._lock:
            queues = list(self._subs.get(session_id, ()))
        for q in queues:
            loop.call_soon_threadsafe(_offer, q, payload)

    def subscribe(self, session_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=5000)
        with self._lock:
            self._subs[session_id].add(q)
        return q

    def unsubscribe(self, session_id: str, q: asyncio.Queue) -> None:
        with self._lock:
            self._subs[session_id].discard(q)


def _offer(q: asyncio.Queue, event: dict) -> None:
    if q.full():
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    q.put_nowait(event)


bus = EventBus()
