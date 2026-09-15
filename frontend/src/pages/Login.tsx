import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "../components/icons";
import { Button, cx, Field, Input } from "../components/ui";
import { loadConfig, signInAnonymously, signInWithEmail, signInWithGoogle } from "../lib/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>(["email"]);
  useEffect(() => {
    loadConfig()
      .then((c) => setProviders(c.auth_providers ?? ["email"]))
      .catch(() => undefined);
  }, []);
  const google = providers.includes("google");
  const anonymous = providers.includes("anonymous");

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      if (kind === "email") setSent(true);
    } catch (e) {
      const msg = (e as Error).message || "não deu certo";
      setError(
        /provider is not enabled|Unsupported provider/i.test(msg)
          ? "Esse jeito de entrar ainda não foi ativado. Use o e-mail."
          : /Anonymous sign-ins are disabled/i.test(msg)
            ? "Entrar sem conta está desativado neste servidor."
            : msg,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark size={56} />
          <h1 className="font-display text-[44px] leading-none font-semibold">Deck Scanner</h1>
          <p className="max-w-sm text-cream-dim">Aponte a câmera para as cartas e receba a lista pronta — e saiba onde cada carta da coleção está.</p>
        </div>
        <div className="parchment px-6 py-6">
          <h2 className="font-serif text-[22px] font-semibold text-ink-900">Livro de hóspedes</h2>
          <p className="mb-4 text-[15px] text-ink-700">Assine para guardar decks, coleção e histórico entre aparelhos.</p>
          {sent ? (
            <div className="space-y-2 text-ink-900">
              <p className="font-semibold">Confira seu e-mail.</p>
              <p className="text-[15px] text-ink-700">Enviamos um link de acesso para <strong>{email}</strong>. Abra no mesmo aparelho.</p>
              <button className="text-[15px] text-brass-700 underline" onClick={() => setSent(false)}>
                usar outro e-mail
              </button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.includes("@")) void run("email", () => signInWithEmail(email.trim()));
              }}
            >
              <div className="[&_label_span]:text-ink-700">
                <Field label="e-mail">
                  {(id) => (
                    <Input
                      id={id}
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="voce@exemplo.com"
                      className="border-ink-500/40 bg-parchment-50 text-ink-900 shadow-none placeholder:text-ink-500 focus:border-brass-600"
                    />
                  )}
                </Field>
              </div>
              <Button type="submit" variant="brass" className="w-full" busy={busy === "email"} icon={<Mail className="size-4" />}>
                Receber link de acesso
              </Button>
            </form>
          )}
          {(google || anonymous) && (
            <>
              <div className="my-4 flex items-center gap-3 text-[13px] text-ink-500">
                <span className="h-px flex-1 bg-ink-500/30" /> ou <span className="h-px flex-1 bg-ink-500/30" />
              </div>
              <div className={cx("grid gap-2", google && anonymous && "sm:grid-cols-2")}>
                {google && (
                  <button
                    onClick={() => void run("google", signInWithGoogle)}
                    className="h-11 rounded-[5px] border border-ink-500/40 bg-parchment-50 font-caps text-[15px] font-bold lowercase text-ink-900 hover:bg-white/60"
                  >
                    {busy === "google" ? "abrindo…" : "entrar com Google"}
                  </button>
                )}
                {anonymous && (
                  <button
                    onClick={() => void run("anon", signInAnonymously)}
                    className="h-11 rounded-[5px] border border-ink-500/40 font-caps text-[15px] font-bold lowercase text-ink-700 hover:bg-white/40"
                    title="Dá para criar a conta depois sem perder o que foi escaneado"
                  >
                    {busy === "anon" ? "entrando…" : "só dar uma olhada"}
                  </button>
                )}
              </div>
            </>
          )}
          {error && <p className="mt-3 text-[15px] text-wine-600" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
