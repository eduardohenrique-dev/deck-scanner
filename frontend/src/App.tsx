import { LogOut } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { BrandMark, Candle, Chest, Lens, Tankard, Tome } from "./components/icons";
import { cx, IconButton, Spinner } from "./components/ui";
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
const NotFound = lazy(() => import("./pages/NotFound"));

const NAV = [
  { to: "/", label: "Taverna", icon: Tankard, match: (p: string) => p === "/" },
  { to: "/escanear", label: "Escanear", icon: Lens, match: (p: string) => p.startsWith("/escanear") || p.startsWith("/s/") },
  { to: "/decks", label: "Decks", icon: Tome, match: (p: string) => p.startsWith("/decks") },
  { to: "/colecao", label: "Coleção", icon: Chest, match: (p: string) => p.startsWith("/colecao") },
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
        <div className="flex flex-col items-center gap-3">
          <Spinner className="size-7" />
          <DelayedText />
        </div>
      </FullScreen>
    );
  if (auth.status === "error")
    return (
      <FullScreen>
        <div className="max-w-sm space-y-2 text-center">
          <p className="font-serif text-[21px] text-cream">A taverna está fechada</p>
          <p className="text-cream-dim">Não consegui falar com o servidor ({auth.message}). Tente recarregar a página em instantes.</p>
        </div>
      </FullScreen>
    );
  if (auth.status === "signed-out") return <Login />;

  const route = matchRoute(path);
  const email = auth.status === "signed-in" ? auth.user.email : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-brass-400 focus:px-3 focus:py-2 focus:text-ink-900">
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-40 bg-oak-900/95 backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Deck Scanner — início">
            <BrandMark size={32} />
            <span className="font-display text-[25px] leading-none font-semibold tracking-[0.01em] text-cream">Deck Scanner</span>
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
                    "flex h-10 items-center gap-2 rounded-[5px] px-3 font-caps text-[16px] font-bold lowercase tracking-[0.04em] transition-colors",
                    active ? "bg-oak-750 text-brass-200 shadow-[inset_0_-2px_0_var(--color-brass-400)]" : "text-cream-dim hover:bg-oak-800 hover:text-cream",
                  )}
                >
                  <item.icon size={19} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {email && <span className="hidden max-w-48 truncate text-[14px] text-cream-faint lg:inline">{email}</span>}
            {auth.status === "signed-in" && (
              <IconButton label="Sair" onClick={() => void signOut()}>
                <LogOut className="size-[18px]" />
              </IconButton>
            )}
          </div>
        </div>
        <div className="brass-rule" />
      </header>

      <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-28 sm:px-6 md:pb-12">
        <Suspense fallback={<div className="grid place-items-center py-24"><Spinner className="size-7" /></div>}>
          {route.name === "home" && <Home />}
          {route.name === "scan-new" && <NewScan />}
          {route.name === "session" && <ScanSession key={route.id} id={route.id} />}
          {route.name === "decks" && <Decks />}
          {route.name === "deck" && <DeckPage key={route.id} id={route.id} />}
          {route.name === "collection" && <Collection />}
          {route.name === "not-found" && <NotFound />}
        </Suspense>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-brass-700/70 bg-oak-900/97 pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Principal"
      >
        <div className="grid grid-cols-4">
          {NAV.map((item) => {
            const active = item.match(path);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cx("flex h-16 flex-col items-center justify-center gap-1 font-caps text-[13px] font-bold lowercase tracking-[0.04em]", active ? "text-brass-200" : "text-cream-faint")}
              >
                <item.icon size={22} />
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
  return <p className={cx("max-w-xs text-center text-[15px] text-cream-dim transition-opacity duration-500", show ? "opacity-100" : "opacity-0")}>{WAKE_TEXT}</p>;
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
    <div role="status" className="animate-rise fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6">
      <p className="flex max-w-md items-center gap-2.5 rounded-[6px] border border-brass-700 bg-oak-900/95 px-3.5 py-2.5 text-[14px] text-cream-dim shadow-[0_4px_14px_rgb(0_0_0/0.5)]">
        <Candle size={18} className="animate-candle shrink-0 text-brass-300" />
        {WAKE_TEXT}
      </p>
    </div>
  );
}
