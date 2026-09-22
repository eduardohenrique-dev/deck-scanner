import { LogOut } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { BrandMark, Candle, Chest, Goblet, Lens, Tankard, Tome } from "./components/icons";
import { Button, cx, IconButton, Spinner } from "./components/ui";
import { signOut, useAuth } from "./lib/auth";
import { Link, matchRoute, useLocation } from "./lib/router";
import { Toaster } from "./lib/toast";
import Login from "./pages/Login";

const Home = lazy(() => import("./pages/Home"));
const NewScan = lazy(() => import("./pages/NewScan"));
const ScanSession = lazy(() => import("./pages/ScanSession"));
const Decks = lazy(() => import("./pages/Decks"));
const DeckPage = lazy(() => import("./pages/DeckPage"));
const Collection = lazy(() => import("./pages/Collection"));
const Tournaments = lazy(() => import("./pages/Tournaments"));
const TournamentPage = lazy(() => import("./pages/TournamentPage"));
const TournamentDisplay = lazy(() => import("./pages/TournamentDisplay"));
const NotFound = lazy(() => import("./pages/NotFound"));

const NAV = [
  { to: "/", label: "Taverna", icon: Tankard, match: (p: string) => p === "/" },
  { to: "/escanear", label: "Escanear", icon: Lens, match: (p: string) => p.startsWith("/escanear") || p.startsWith("/s/") },
  { to: "/decks", label: "Decks", icon: Tome, match: (p: string) => p.startsWith("/decks") },
  { to: "/colecao", label: "Coleção", icon: Chest, match: (p: string) => p.startsWith("/colecao") },
  { to: "/torneios", label: "Torneio", icon: Goblet, match: (p: string) => p.startsWith("/torneios") },
];

export default function App() {
  const auth = useAuth();
  const { path } = useLocation();

  useEffect(() => {
    const onExpired = () => void signOut();
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  if (auth.status === "loading")
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4">
          <BrandMark size={48} className="animate-pop" />
          <Spinner className="size-6" />
          <DelayedText />
        </div>
      </FullScreen>
    );
  if (auth.status === "error")
    return (
      <FullScreen>
        <div className="glass w-full max-w-md space-y-4 p-6 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-brass-300/10 text-brass-300">
            <Candle size={30} />
          </div>
          <div className="space-y-2">
            <p className="font-display text-title-2 font-semibold text-cream">A taverna está fechada</p>
            <p className="text-body text-cream-dim">
              {auth.step === "session"
                ? "Não consegui falar com o serviço de login. Se você usa bloqueador de anúncios ou uma rede do trabalho, ele pode estar barrando o acesso."
                : "Não consegui falar com o servidor. Ele pode estar acordando: espere alguns segundos e tente de novo."}
            </p>
            <p className="text-footnote text-cream-faint">Detalhe: {auth.message}</p>
          </div>
          <Button variant="primary" onClick={() => location.reload()}>
            Tentar de novo
          </Button>
        </div>
      </FullScreen>
    );
  if (auth.status === "signed-out") return <Login warning={auth.warning} />;

  const route = matchRoute(path);
  const email = auth.status === "signed-in" ? auth.user.email : null;

  // telão: tela cheia, sem a moldura do app
  if (route.name === "tournament-display")
    return (
      <Suspense fallback={<FullScreen><Spinner className="size-7" /></FullScreen>}>
        <TournamentDisplay id={route.id} />
        <Toaster />
      </Suspense>
    );

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#conteudo" className="btn btn-primary sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
        Pular para o conteúdo
      </a>
      <header className="bar-glass sticky top-0 z-40 shadow-[inset_0_-1px_0_rgb(255_226_184/0.08),0_8px_24px_-16px_rgb(0_0_0/0.8)]">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 rounded-sm" aria-label="Deck Scanner, início">
            <BrandMark size={32} />
            <span className="font-brand text-[1.625rem] leading-none font-semibold tracking-[0.01em] text-cream">Deck Scanner</span>
          </Link>
          <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="Principal">
            {NAV.map((item) => {
              const active = item.match(path);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex h-10 items-center gap-2 rounded-full px-3.5 text-subhead font-medium transition-colors duration-200",
                    active
                      ? "bg-brass-300/12 text-brass-200 shadow-[inset_0_0_0_1px_rgb(235_198_116/0.22),inset_0_1px_0_rgb(255_240_210/0.12)]"
                      : "text-cream-dim hover:bg-cream/5 hover:text-cream",
                  )}
                >
                  <item.icon size={19} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {email && <span className="hidden max-w-48 truncate text-footnote text-cream-faint lg:inline">{email}</span>}
            {auth.status === "signed-in" && (
              <IconButton label="Sair" onClick={() => void signOut()}>
                <LogOut className="size-[18px]" />
              </IconButton>
            )}
          </div>
        </div>
      </header>

      <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-32 sm:px-6 sm:pt-8 md:pb-16">
        <Suspense
          fallback={
            <div className="grid place-items-center py-24">
              <Spinner className="size-7" />
            </div>
          }
        >
          {route.name === "home" && <Home />}
          {route.name === "scan-new" && <NewScan />}
          {route.name === "session" && <ScanSession key={route.id} id={route.id} />}
          {route.name === "decks" && <Decks />}
          {route.name === "deck" && <DeckPage key={route.id} id={route.id} />}
          {route.name === "collection" && <Collection />}
          {route.name === "tournaments" && <Tournaments />}
          {route.name === "tournament" && <TournamentPage key={route.id} id={route.id} />}
          {route.name === "not-found" && <NotFound />}
        </Suspense>
      </main>

      <nav
        className="bar-glass fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] shadow-[inset_0_1px_0_rgb(255_226_184/0.1),0_-8px_24px_-16px_rgb(0_0_0/0.8)] md:hidden"
        aria-label="Principal"
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }}>
          {NAV.map((item) => {
            const active = item.match(path);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cx("flex h-16 flex-col items-center justify-center gap-1 text-caption font-medium transition-colors duration-200", active ? "text-brass-200" : "text-cream-faint")}
              >
                <item.icon size={24} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <Toaster />
      <WakeNotice />
    </div>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-6">{children}</div>;
}

const WAKE_TEXT = "Acordando a taverna… depois de um tempo parada, a primeira ação leva alguns segundos.";

function DelayedText() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 1500);
    return () => window.clearTimeout(t);
  }, []);
  return <p className={cx("max-w-xs text-center text-subhead text-cream-dim transition-opacity duration-500", show ? "opacity-100" : "opacity-0")}>{WAKE_TEXT}</p>;
}

/** Aviso discreto enquanto servidor e banco acordam (a requisição em curso não está travada). */
function WakeNotice() {
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setWaking((e as CustomEvent<boolean>).detail);
    window.addEventListener("server:waking", on);
    return () => window.removeEventListener("server:waking", on);
  }, []);
  if (!waking) return null;
  return (
    <div role="status" className="animate-rise fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-6">
      <p className="glass-float flex max-w-md items-center gap-3 px-4 py-3 text-subhead text-cream-dim">
        <Candle size={18} className="shrink-0 text-brass-300" />
        {WAKE_TEXT}
      </p>
    </div>
  );
}
