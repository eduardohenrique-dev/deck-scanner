import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { BrandMark } from "../components/icons";
import { Button, Field, Input, Segmented } from "../components/ui";
import { loadConfig, signInWithGoogle, signInWithPassword, signUpWithPassword } from "../lib/auth";

type Mode = "entrar" | "criar";

const PARCHMENT_INPUT = "border-ink-500/40 bg-parchment-50 text-ink-900 shadow-none placeholder:text-ink-500 focus:border-brass-600";

export default function Login({ warning }: { warning?: string }) {
  const [mode, setMode] = useState<Mode>("entrar");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>(["password"]);

  useEffect(() => {
    loadConfig()
      .then((c) => setProviders(c.auth_providers ?? ["password"]))
      .catch(() => undefined);
  }, []);

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || "Não deu certo, tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "entrar") void run("password", () => signInWithPassword(email.trim(), password));
    else void run("password", () => signUpWithPassword(name.trim() || email.split("@")[0], email.trim(), password));
  }

  const google = providers.includes("google");
  const password_ = providers.includes("password");

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

          {warning && (
            <p className="mb-4 rounded-[5px] border border-wine-600/50 bg-wine-600/10 px-3 py-2 text-[14px] text-ink-900" role="alert">
              {warning}
            </p>
          )}

          {google && (
            <button
              onClick={() => void run("google", signInWithGoogle)}
              disabled={!!busy}
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[5px] border border-ink-500/40 bg-parchment-50 font-caps text-[15px] font-bold lowercase text-ink-900 hover:bg-white/60 disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
                <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
                <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
                <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8z" />
                <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
              </svg>
              {busy === "google" ? "abrindo o Google…" : "entrar com Google"}
            </button>
          )}

          {google && password_ && (
            <div className="my-4 flex items-center gap-3 text-[13px] text-ink-500">
              <span className="h-px flex-1 bg-ink-500/30" /> ou com e-mail <span className="h-px flex-1 bg-ink-500/30" />
            </div>
          )}

          {password_ && (
            <form className="space-y-3" onSubmit={submit}>
              <Segmented
                size="sm"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setError(null);
                }}
                options={[
                  { value: "entrar", label: "já tenho conta" },
                  { value: "criar", label: "criar conta" },
                ]}
              />
              <div className="space-y-3 [&_label_span]:text-ink-700">
                {mode === "criar" && (
                  <Field label="como te chamamos">
                    {(id) => <Input id={id} autoComplete="nickname" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Seu nome ou apelido" className={PARCHMENT_INPUT} />}
                  </Field>
                )}
                <Field label="e-mail">
                  {(id) => (
                    <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" className={PARCHMENT_INPUT} />
                  )}
                </Field>
                <Field label="senha" hint={mode === "criar" ? "mínimo de 8 caracteres" : undefined}>
                  {(id) => (
                    <div className="relative">
                      <Input
                        id={id}
                        type={showPassword ? "text" : "password"}
                        autoComplete={mode === "criar" ? "new-password" : "current-password"}
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${PARCHMENT_INPUT} pr-11`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-[4px] text-ink-500 hover:text-ink-900"
                        aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  )}
                </Field>
              </div>
              <Button type="submit" variant="brass" className="w-full" busy={busy === "password"} disabled={!!busy} icon={mode === "entrar" ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}>
                {mode === "entrar" ? "entrar" : "criar conta e entrar"}
              </Button>
            </form>
          )}

          {error && (
            <p className="mt-3 text-[15px] text-wine-600" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
