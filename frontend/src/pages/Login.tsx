import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { BrandMark } from "../components/icons";
import { Button, cx, Field, Input } from "../components/ui";
import { loadConfig, signInWithGoogle, signInWithPassword, signUpWithPassword } from "../lib/auth";

type Mode = "entrar" | "criar";

const PAPER = "field-paper";

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
  const modes: { value: Mode; label: string }[] = [
    { value: "entrar", label: "Já tenho conta" },
    { value: "criar", label: "Criar conta" },
  ];

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark size={60} className="animate-pop" />
          <h1 className="font-brand text-[2.75rem] leading-none font-semibold">Deck Scanner</h1>
          <p className="max-w-sm text-body text-mist-dim">Aponte a câmera para as cartas e receba a lista pronta. E saiba onde cada carta da coleção está.</p>
        </div>
        <div className="parchment animate-rise px-6 py-7 sm:px-8">
          <h2 className="font-display text-title-2 font-semibold text-ink-900">Livro de hóspedes</h2>
          <p className="mt-1 mb-5 text-subhead text-ink-700">Assine para guardar decks, coleção e histórico entre aparelhos.</p>

          {warning && (
            <p className="mb-5 rounded-sm bg-wine-600/10 px-4 py-3 text-subhead text-ink-900 shadow-[inset_0_0_0_1px_rgb(156_45_74/0.35)]" role="alert">
              {warning}
            </p>
          )}

          {google && (
            <button
              type="button"
              onClick={() => void run("google", signInWithGoogle)}
              disabled={!!busy}
              className="btn w-full bg-parchment-50 text-ink-900 shadow-[inset_0_0_0_1px_rgb(92_82_140/0.35),0_1px_2px_rgb(40_30_90/0.15)] hover:bg-white/70 disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
                <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
                <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
                <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8z" />
                <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
              </svg>
              {busy === "google" ? "Abrindo o Google…" : "Entrar com Google"}
            </button>
          )}

          {google && password_ && (
            <div className="my-5 flex items-center gap-3 text-footnote text-ink-500">
              <span className="h-px flex-1 bg-ink-500/30" /> ou com e-mail <span className="h-px flex-1 bg-ink-500/30" />
            </div>
          )}

          {password_ && (
            <form className="space-y-4" onSubmit={submit}>
              {/* segmentado em papel: o mesmo controle do app, com a tinta do pergaminho */}
              <div
                role="radiogroup"
                aria-label="Entrar ou criar conta"
                className="relative isolate grid grid-cols-2 rounded-md bg-parchment-200/70 p-[3px] shadow-[inset_0_1px_2px_rgb(40_30_90/0.2)]"
                style={{ "--i": mode === "entrar" ? 0 : 1 } as CSSProperties}
              >
                <span aria-hidden="true" className="absolute top-[3px] bottom-[3px] left-[3px] -z-10 w-[calc(50%-3px)] translate-x-[calc(var(--i)*100%)] rounded-sm bg-parchment-50 shadow-[0_1px_3px_rgb(40_30_90/0.25),inset_0_1px_0_rgb(255_255_255/0.7)] transition-transform duration-500 ease-spring" />
                {modes.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.value}
                    onClick={() => {
                      setMode(m.value);
                      setError(null);
                    }}
                    className={cx("h-10 rounded-sm text-subhead font-semibold transition-colors", mode === m.value ? "text-ink-900" : "text-ink-500 hover:text-ink-700")}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="space-y-4 [&_label_span]:text-ink-700">
                {mode === "criar" && (
                  <Field label="Como te chamamos">
                    {(id) => <Input id={id} autoComplete="nickname" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Seu nome ou apelido" className={PAPER} />}
                  </Field>
                )}
                <Field label="E-mail">
                  {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" className={PAPER} />}
                </Field>
                <Field label="Senha" hint={mode === "criar" ? "mínimo de 8 caracteres" : undefined}>
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
                        className={`${PAPER} pr-12`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-sm text-ink-500 hover:text-ink-900"
                        aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                      >
                        {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                      </button>
                    </div>
                  )}
                </Field>
              </div>
              <Button type="submit" variant="primary" size="lg" className="w-full" busy={busy === "password"} disabled={!!busy} icon={mode === "entrar" ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}>
                {mode === "entrar" ? "Entrar" : "Criar conta e entrar"}
              </Button>
            </form>
          )}

          {error && (
            <p className="mt-4 text-subhead text-wine-600" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
