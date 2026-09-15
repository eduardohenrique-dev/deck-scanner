"""Barramento de eventos por sessão, dentro do processo.

As threads de processamento publicam; a requisição que disparou o processamento (upload de foto,
leitura de carta) assina e devolve os eventos em streaming para o navegador. Não há canal entre
instâncias: cada requisição acompanha o trabalho que ela mesma executa.
"""
from __future__ import annotations

import asyncio
import threading
import time
from collections import defaultdict


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = defaultdict(set)
        self._lock = threading.Lock()

    def publish(self, session_id: str, event: dict) -> None:
        payload = {**event, "session_id": session_id, "ts": time.time()}
        with self._lock:
            subs = list(self._subs.get(session_id, ()))
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(_offer, q, payload)
            except RuntimeError:  # loop já encerrado
                pass

    def subscribe(self, session_id: str) -> tuple[asyncio.AbstractEventLoop, asyncio.Queue]:
        sub = (asyncio.get_running_loop(), asyncio.Queue(maxsize=5000))
        with self._lock:
            self._subs[session_id].add(sub)
        return sub

    def unsubscribe(self, session_id: str, sub: tuple[asyncio.AbstractEventLoop, asyncio.Queue]) -> None:
        with self._lock:
            self._subs[session_id].discard(sub)
            if not self._subs[session_id]:
                self._subs.pop(session_id, None)


def _offer(q: asyncio.Queue, event: dict) -> None:
    if q.full():
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    q.put_nowait(event)


bus = EventBus()
