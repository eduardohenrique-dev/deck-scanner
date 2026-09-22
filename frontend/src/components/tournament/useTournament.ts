/**
 * Estado de um torneio na tela: cada toque aplica o comando na hora (otimista), guarda uma cópia neste
 * aparelho e envia ao servidor logo em seguida. Se outro aparelho gravou antes (409), as ações daqui são
 * reaplicadas por cima da versão de lá — os comandos são puros, então o resultado é o mesmo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type TournamentRecord } from "../../lib/api";
import { toast } from "../../lib/toast";
import { apply, inverse, TournamentError, type Command } from "../../tournament/engine.ts";
import { serverSummary } from "./labels";
import type { Tournament } from "../../tournament/types.ts";

export type SaveState = "saved" | "saving" | "pending" | "offline" | "error";

type Local = { doc: Tournament; version: number; pending: Command[] };

const key = (id: string) => `deckscanner:tournament:${id}`;
const channelName = (id: string) => `deckscanner:tournament:${id}`;

function readLocal(id: string): Local | null {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as Local) : null;
  } catch {
    return null;
  }
}

function writeLocal(id: string, value: Local | null) {
  try {
    if (value && value.pending.length) localStorage.setItem(key(id), JSON.stringify(value));
    else localStorage.removeItem(key(id));
  } catch {
    /* sem armazenamento: vale só a memória desta visita */
  }
}

/** Reaplica ações sobre outra versão; a que não couber mais (ex.: mesa já lançada lá) é descartada. */
function replay(base: Tournament, commands: Command[]): { doc: Tournament; dropped: number } {
  let doc = base;
  let dropped = 0;
  for (const c of commands) {
    try {
      doc = apply(doc, c);
    } catch {
      dropped++;
    }
  }
  return { doc, dropped };
}

export type Dispatch = (cmd: Command, opts?: { undo?: string; silent?: boolean }) => Tournament | null;

export function useTournament(id: string) {
  const [doc, setDoc] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const docRef = useRef<Tournament | null>(null);
  const version = useRef(0);
  const pending = useRef<Command[]>([]);
  const inFlight = useRef(false);
  const timer = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  const publish = useCallback((next: Tournament) => {
    docRef.current = next;
    setDoc(next);
    try {
      channel.current?.postMessage({ doc: next, version: version.current });
    } catch {
      /* canal indisponível */
    }
  }, []);

  const persistLocal = useCallback(() => {
    if (docRef.current) writeLocal(id, { doc: docRef.current, version: version.current, pending: pending.current });
  }, [id]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (inFlight.current || !pending.current.length || !docRef.current) return;
    inFlight.current = true;
    setSave("saving");
    const sending = pending.current.length;
    const snapshot = docRef.current;
    try {
      const res = await api.saveTournament(id, snapshot, serverSummary(snapshot), version.current);
      version.current = res.version;
      pending.current = pending.current.slice(sending);
      persistLocal();
      setSave(pending.current.length ? "pending" : "saved");
      // o que foi tocado enquanto esta gravação ia vai na próxima
      if (pending.current.length) timer.current = window.setTimeout(() => void flush(), 300);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.current) {
        const current = e.body.current as TournamentRecord;
        const { doc: rebased, dropped } = replay(current.doc, pending.current);
        version.current = current.version;
        publish(rebased);
        persistLocal();
        toast(dropped ? "Juntei com o que foi feito em outro aparelho; uma ação daqui não cabia mais e ficou de fora." : "Juntei com o que foi feito em outro aparelho.", { tone: "info" });
        inFlight.current = false;
        void flush();
        return;
      }
      if (e instanceof ApiError && e.status === 0) {
        setSave("offline");
        timer.current = window.setTimeout(() => void flush(), 8000);
      } else {
        setSave("error");
        toast(e instanceof Error ? `Não consegui salvar: ${e.message}` : "Não consegui salvar.", { tone: "bad" });
        timer.current = window.setTimeout(() => void flush(), 15000);
      }
    } finally {
      inFlight.current = false;
    }
  }, [id, persistLocal, publish]);

  // carrega: servidor + o que tiver ficado pendente neste aparelho (ex.: sem internet)
  useEffect(() => {
    let cancelled = false;
    const local = readLocal(id);
    try {
      channel.current = new BroadcastChannel(channelName(id));
    } catch {
      channel.current = null;
    }
    api
      .tournament(id)
      .then((rec) => {
        if (cancelled) return;
        if (local?.pending.length) {
          const base = local.version === rec.version ? local.doc : replay(rec.doc, local.pending).doc;
          version.current = rec.version;
          pending.current = local.pending;
          publish(base);
          setSave("pending");
          void flush();
        } else {
          version.current = rec.version;
          publish(rec.doc);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (local) {
          version.current = local.version;
          pending.current = local.pending;
          publish(local.doc);
          setSave("offline");
        } else setError(e instanceof Error ? e.message : String(e));
      });
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => {
      cancelled = true;
      window.removeEventListener("online", online);
      window.clearTimeout(timer.current);
      channel.current?.close();
    };
  }, [id, flush, publish]);

  const dispatch: Dispatch = useCallback(
    (cmd, opts) => {
      const before = docRef.current;
      if (!before) return null;
      let next: Tournament;
      const inv = opts?.undo ? inverse(before, cmd) : null;
      try {
        next = { ...apply(before, cmd), updatedAt: new Date().toISOString() };
      } catch (e) {
        if (!opts?.silent) toast(e instanceof TournamentError ? e.message : String(e), { tone: "bad" });
        return null;
      }
      pending.current = [...pending.current, cmd];
      publish(next);
      persistLocal();
      setSave("pending");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 450);
      if (opts?.undo) {
        if (inv) toast(opts.undo, { group: "tournament", action: { label: "Desfazer", run: () => void dispatch(inv) } });
        else toast(opts.undo, { group: "tournament" });
      }
      return next;
    },
    [flush, persistLocal, publish],
  );

  return { t: doc, error, save, dispatch, flush };
}

/**
 * Leitura ao vivo para o telão: recebe na hora o que o organizador faz neste aparelho (BroadcastChannel)
 * e pergunta ao servidor a cada poucos segundos se algo mudou em outro aparelho.
 */
export function useLiveTournament(id: string, everyMs = 4000) {
  const [doc, setDoc] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(channelName(id));
      channel.onmessage = (e) => {
        const data = e.data as { doc: Tournament; version: number };
        if (data?.doc) setDoc(data.doc);
      };
    } catch {
      channel = null;
    }
    const load = async () => {
      try {
        const rec = version.current ? await api.tournamentSince(id, version.current) : await api.tournament(id);
        if (cancelled || !rec) return;
        version.current = rec.version;
        setDoc(rec.doc);
        setError(null);
      } catch (e) {
        if (!cancelled && !version.current) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(), everyMs);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      channel?.close();
    };
  }, [id, everyMs]);

  return { t: doc, error };
}
