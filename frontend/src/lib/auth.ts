import { useEffect, useState } from "react";
import type { AppConfig } from "./types";

/**
 * Login só existe no modo hospedado. No modo local o app abre direto, com um usuário só.
 *
 * Tudo passa pelo NOSSO domínio (`/api/auth/*`): o servidor conversa com o Neon Auth e guarda a sessão num
 * cookie nosso. É o que faz o login funcionar no iPhone, no Brave e em aba anônima, que bloqueiam cookies de
 * outro site. Aqui só ficam o usuário e o JWT de 15 minutos usado nas chamadas da API.
 */
let configPromise: Promise<AppConfig> | null = null;

type SessionReply = { user: AuthUser; token: string; expires_at?: number };

export type AuthUser = { id: string; email: string; name?: string | null; image?: string | null };

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/**
 * Tenta de novo antes de desistir: no servidor sem uso a primeira resposta demora (função e banco
 * acordando) e uma falha de rede no celular é comum. Só o erro da última tentativa chega à tela.
 */
async function retrying<T>(what: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts) await sleep(700 * i);
    }
  }
  report(what, last);
  throw last;
}

export function loadConfig(): Promise<AppConfig> {
  if (!configPromise) {
    configPromise = retrying("config", async () => {
      const r = await fetch("/api/config", { cache: "no-store" });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : `servidor respondeu ${r.status}`);
      }
      return (await r.json()) as AppConfig;
    }).catch((e) => {
      configPromise = null;
      throw e;
    });
  }
  return configPromise;
}

/** Conta ao servidor o que falhou no navegador de quem não conseguiu entrar (aparece no log da Vercel). */
function report(step: string, error: unknown) {
  try {
    const body = JSON.stringify({ step, message: error instanceof Error ? error.message : String(error), url: location.href });
    if (!navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" })))
      void fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    /* diagnóstico é opcional */
  }
}

async function post(path: string, body?: unknown): Promise<any> {
  const r = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(friendly(typeof data?.detail === "string" ? data.detail : `erro ${r.status}`));
  return data;
}

/** Sessão em memória: o cookie é do servidor, aqui fica só o JWT curto que vai nas chamadas da API. */
let cached: { user: AuthUser; token: string; expiresAt: number } | null = null;
let loading: Promise<SessionReply | null> | null = null;

async function fetchSession(): Promise<SessionReply | null> {
  const r = await fetch("/api/auth/session", { cache: "no-store" });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`o serviço de login respondeu ${r.status}`);
  return (await r.json()) as SessionReply;
}

async function loadSession(force = false): Promise<AuthUser | null> {
  if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached.user;
  loading ??= fetchSession().finally(() => (loading = null));
  const data = await loading;
  cached = data ? { user: data.user, token: data.token, expiresAt: (data.expires_at ?? 0) * 1000 || Date.now() + 10 * 60_000 } : null;
  return cached?.user ?? null;
}

export async function accessToken(): Promise<string | null> {
  const cfg = await loadConfig();
  if (cfg.auth !== "neon") return null;
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  await loadSession(true);
  return cached?.token ?? null;
}

function changed() {
  window.dispatchEvent(new Event("auth:changed"));
}

export type AuthState =
  | { status: "loading" }
  | { status: "error"; message: string; step: "config" | "session" }
  | { status: "local"; config: AppConfig }
  | { status: "signed-out"; config: AppConfig; warning?: string }
  | { status: "signed-in"; config: AppConfig; user: AuthUser };

/** O servidor manda `?login=falhou` quando a volta do Google não fechou a sessão. */
function loginFailedInUrl(): boolean {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get("login") !== "falhou") return false;
    url.searchParams.delete("login");
    history.replaceState(history.state, "", url.href.replace(/\?$/, ""));
    return true;
  } catch {
    return false;
  }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      let step: "config" | "session" = "config";
      try {
        const config = await loadConfig();
        if (cancelled) return;
        if (config.auth !== "neon") return setState({ status: "local", config });
        step = "session";
        const failed = loginFailedInUrl();
        let user: AuthUser | null = null;
        try {
          user = await retrying("session", () => loadSession(true));
        } catch (e) {
          // sem sessão o app continua: tela de entrada em vez de um beco sem saída
          if (cancelled) return;
          return setState({ status: "signed-out", config, warning: (e as Error).message });
        }
        if (cancelled) return;
        if (user) return setState({ status: "signed-in", config, user });
        setState({ status: "signed-out", config, warning: failed ? "Não consegui concluir a entrada com o Google. Tente de novo ou use e-mail e senha." : undefined });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: (e as Error).message, step });
      }
    };
    void refresh();
    window.addEventListener("auth:changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("auth:changed", refresh);
    };
  }, []);
  return state;
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha não conferem.",
  USER_ALREADY_EXISTS: "Já existe uma conta com esse e-mail. Entre com a senha.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Já existe uma conta com esse e-mail. Entre com a senha.",
  PASSWORD_TOO_SHORT: "A senha precisa de pelo menos 8 caracteres.",
  INVALID_EMAIL: "Esse e-mail não parece válido.",
};

/** As mensagens do serviço de login vêm em inglês; as conhecidas ganham texto nosso. */
function friendly(detail: string): string {
  const key = detail.toUpperCase().replace(/[^A-Z]+/g, "_");
  for (const [code, text] of Object.entries(MESSAGES)) if (key.includes(code)) return text;
  if (/INVALID.*(EMAIL|PASSWORD)|CREDENTIAL/i.test(detail)) return MESSAGES.INVALID_EMAIL_OR_PASSWORD;
  if (/EXIST/i.test(detail)) return MESSAGES.USER_ALREADY_EXISTS;
  if (/SHORT|LENGTH/i.test(detail)) return MESSAGES.PASSWORD_TOO_SHORT;
  return detail;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  await post("/api/auth/password/sign-in", { email, password });
  await loadSession(true);
  changed();
}

export async function signUpWithPassword(name: string, email: string, password: string): Promise<void> {
  await post("/api/auth/password/sign-up", { name, email, password });
  await loadSession(true);
  changed();
}

export async function signInWithGoogle(): Promise<void> {
  location.href = `/api/auth/google/start?next=${encodeURIComponent(location.pathname + location.search)}`;
  await sleep(4000); // a navegação assume; o await só mantém o botão ocupado
}

export async function signOut(): Promise<void> {
  cached = null;
  try {
    await post("/api/auth/sign-out");
  } catch {
    /* sessão já inválida: sai do mesmo jeito */
  }
  changed();
}
