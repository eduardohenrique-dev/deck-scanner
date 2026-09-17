import { useEffect, useState } from "react";
import type { AppConfig } from "./types";

/**
 * Login só existe no modo hospedado (Neon Auth). No modo local o app abre direto, com um usuário só.
 * O cliente de login é carregado sob demanda: quem roda local não baixa esse código.
 * A API recebe o JWT da sessão (válido por 15 min; a biblioteca renova sozinha antes de expirar).
 */
let configPromise: Promise<AppConfig> | null = null;
let clientPromise: Promise<AuthClient | null> | null = null;

type Result<T> = { data: T | null; error: { message?: string; code?: string; status?: number } | null };
type SessionData = { session: { token?: string; expiresAt?: string }; user: { id: string; email: string; name?: string | null; image?: string | null } };
type AuthClient = {
  getSession: () => Promise<Result<SessionData>>;
  signIn: {
    email: (body: { email: string; password: string; callbackURL?: string }) => Promise<Result<unknown>>;
    social: (body: { provider: "google"; callbackURL?: string }) => Promise<Result<unknown>>;
  };
  signUp: { email: (body: { email: string; password: string; name: string; callbackURL?: string }) => Promise<Result<unknown>> };
  signOut: () => Promise<Result<unknown>>;
};

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

function authClient(): Promise<AuthClient | null> {
  if (!clientPromise) {
    clientPromise = loadConfig().then(async (cfg) => {
      if (cfg.auth !== "neon" || !cfg.neon_auth_url) return null;
      const { createAuthClient } = await import("@neondatabase/auth");
      return createAuthClient(cfg.neon_auth_url) as unknown as AuthClient;
    });
  }
  return clientPromise;
}

function changed() {
  window.dispatchEvent(new Event("auth:changed"));
}

export async function accessToken(): Promise<string | null> {
  const client = await authClient();
  if (!client) return null;
  const { data } = await client.getSession();
  return data?.session?.token ?? null;
}

export type AuthUser = SessionData["user"];

export type AuthState =
  | { status: "loading" }
  | { status: "error"; message: string; step: "config" | "session" }
  | { status: "local"; config: AppConfig }
  | { status: "signed-out"; config: AppConfig }
  | { status: "signed-in"; config: AppConfig; user: AuthUser };

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      let step: "config" | "session" = "config";
      try {
        const config = await loadConfig();
        const client = await authClient();
        if (cancelled) return;
        if (!client) return setState({ status: "local", config });
        step = "session";
        // na volta do login com Google a biblioteca troca o código da URL pela sessão aqui
        const { data } = await retrying("session", async () => {
          const r = await client.getSession();
          if (r.error && !r.error.status) throw new Error(r.error.message || "sem resposta do login");
          return r;
        });
        if (cancelled) return;
        setState(data?.user ? { status: "signed-in", config, user: data.user } : { status: "signed-out", config });
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

function fail(error: Result<unknown>["error"]): never {
  const code = error?.code ?? "";
  throw new Error(MESSAGES[code] ?? (error?.status === 429 ? "Muitas tentativas. Espere um minuto e tente de novo." : error?.message || "Não deu certo, tente de novo."));
}

/** O login guarda a sessão num cookie do servidor da Neon; alguns navegadores bloqueiam esse cookie. */
const COOKIES_BLOCKED =
  "Seu navegador bloqueou o cookie que mantém você conectado. No iPhone: Ajustes → Safari → desligue “Impedir rastreamento entre sites”. " +
  "Em aba anônima ou no Brave, libere os cookies deste site — ou use outro navegador.";

/** Entrar só vale se a sessão ficar de pé: sem isso a pessoa voltaria para esta tela sem explicação. */
async function confirmSession(): Promise<void> {
  const client = await authClient();
  const { data } = (await client!.getSession().catch(() => ({ data: null }))) as { data: SessionData | null };
  if (!data?.user) {
    report("cookie", new Error("sessão não persistiu após entrar"));
    throw new Error(COOKIES_BLOCKED);
  }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const client = await authClient();
  if (!client) return;
  const { error } = await client.signIn.email({ email, password });
  if (error) fail(error);
  await confirmSession();
  changed();
}

export async function signUpWithPassword(name: string, email: string, password: string): Promise<void> {
  const client = await authClient();
  if (!client) return;
  const { error } = await client.signUp.email({ name, email, password });
  if (error) fail(error);
  await confirmSession();
  changed();
}

export async function signInWithGoogle(): Promise<void> {
  const client = await authClient();
  if (!client) return;
  const { error } = await client.signIn.social({ provider: "google", callbackURL: location.origin });
  if (error) fail(error);
}

export async function signOut(): Promise<void> {
  const client = await authClient();
  await client?.signOut();
  changed();
}
