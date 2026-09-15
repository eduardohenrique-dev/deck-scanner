import type { Session as SupaSession, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { AppConfig } from "./types";

/**
 * Login só existe no modo hospedado (Supabase). No modo local o app abre direto, com um usuário só.
 * O cliente do Supabase é carregado sob demanda: quem roda local não baixa esse código.
 */
let configPromise: Promise<AppConfig> | null = null;
let clientPromise: Promise<SupabaseClient | null> | null = null;

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

export function getSupabase(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = loadConfig().then(async (cfg) => {
      if (cfg.auth !== "supabase" || !cfg.supabase_url || !cfg.supabase_publishable_key) return null;
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(cfg.supabase_url, cfg.supabase_publishable_key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    });
  }
  return clientPromise;
}

export async function accessToken(): Promise<string | null> {
  const client = await getSupabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export type AuthState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "local"; config: AppConfig }
  | { status: "signed-out"; config: AppConfig }
  | { status: "signed-in"; config: AppConfig; session: SupaSession };

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const config = await loadConfig();
        const client = await getSupabase();
        if (cancelled) return;
        if (!client) {
          setState({ status: "local", config });
          return;
        }
        const { data } = await client.auth.getSession();
        if (cancelled) return;
        setState(data.session ? { status: "signed-in", config, session: data.session } : { status: "signed-out", config });
        const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
          setState(session ? { status: "signed-in", config, session } : { status: "signed-out", config });
        });
        unsub = () => sub.subscription.unsubscribe();
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);
  return state;
}

export async function signInWithEmail(email: string): Promise<void> {
  const client = await getSupabase();
  if (!client) return;
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
  if (error) throw error;
}

export async function signInWithGoogle(): Promise<void> {
  const client = await getSupabase();
  if (!client) return;
  const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin } });
  if (error) throw error;
}

export async function signInAnonymously(): Promise<void> {
  const client = await getSupabase();
  if (!client) return;
  const { error } = await client.auth.signInAnonymously();
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const client = await getSupabase();
  await client?.auth.signOut();
}
