import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Detection, SessionState } from "./types";

export type LiveEvent =
  | { type: "detection"; detection: Detection }
  | { type: "capture" }
  | { type: "deck_updated" }
  | { type: "session"; status: string }
  | { type: "error"; message: string };

/**
 * Estado completo da sessão + atualização incremental via SSE.
 * Detecções chegam na hora (lista cresce enquanto processa); o estado consolidado
 * (deck, validação) é recarregado com throttle a cada mudança.
 */
export function useSession(id: string) {
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<(ev: LiveEvent) => void>());
  const timer = useRef<number | null>(null);
  const inflight = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    try {
      setState(await api.session(id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inflight.current = false;
      if (again.current) {
        again.current = false;
        void refresh();
      }
    }
  }, [id]);

  const scheduleRefresh = useCallback(
    (delay = 350) => {
      if (timer.current !== null) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void refresh();
      }, delay);
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    const es = new EventSource(`/api/sessions/${id}/events`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      let ev: LiveEvent;
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (ev.type === "detection") {
        const det = ev.detection;
        setState((prev) => {
          if (!prev) return prev;
          const idx = prev.detections.findIndex((d) => d.id === det.id);
          const detections = idx >= 0 ? prev.detections.map((d, i) => (i === idx ? det : d)) : [...prev.detections, det];
          return { ...prev, detections };
        });
      }
      listeners.current.forEach((fn) => fn(ev));
      scheduleRefresh(ev.type === "detection" ? 600 : 250);
    };
    return () => {
      es.close();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [id, refresh, scheduleRefresh]);

  const subscribe = useCallback((fn: (ev: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  /** Aplica a resposta de uma mutação (a API devolve o estado novo). */
  const apply = useCallback((next: SessionState) => setState(next), []);

  return { state, error, connected, refresh, apply, subscribe };
}
