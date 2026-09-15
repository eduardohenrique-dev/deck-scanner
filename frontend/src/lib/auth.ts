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

export function loadConfig(): Promise<AppConfig> {
  if (!configPromise) {
    configPromise = fetch("/api/config")
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(typeof body?.detail === "string" ? body.detail : `servidor respondeu ${r.status}`);
        }
        return r.json() as Promise<AppConfig>;
      })
      .catch((e) => {
        configPromise = null;
        throw e;
      });
  }
  return configPromise;
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
  | { status: "error"; message: string }
  | { status: "local"; config: AppConfig }
  | { status: "signed-out"; config: AppConfig }
  | { status: "signed-in"; config: AppConfig; user: AuthUser };

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const config = await loadConfig();
        const client = await authClient();
        if (cancelled) return;
        if (!client) return setState({ status: "local", config });
        // na volta do login com Google a biblioteca troca o código da URL pela sessão aqui
        const { data } = await client.getSession();
        if (cancelled) return;
        setState(data?.user ? { status: "signed-in", config, user: data.user } : { status: "signed-out", config });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: (e as Error).message });
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

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const client = await authClient();
  if (!client) return;
  const { error } = await client.signIn.email({ email, password });
  if (error) fail(error);
  changed();
}

export async function signUpWithPassword(name: string, email: string, password: string): Promise<void> {
  const client = await authClient();
  if (!client) return;
  const { error } = await client.signUp.email({ name, email, password });
  if (error) fail(error);
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
