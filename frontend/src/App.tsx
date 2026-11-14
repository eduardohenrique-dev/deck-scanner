import { LogOut, UserRound } from "lucide-react";
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
const Account = lazy(() => import("./pages/Account"));
const PublicTournament = lazy(() => import("./pages/PublicTournament"));

const NAV = [
  { to: "/", label: "Início", icon: Tankard, area: "home", match: (p: string) => p === "/" },
  { to: "/escanear", label: "Escanear", icon: Lens, area: "scan", match: (p: string) => p.startsWith("/escanear") || p.startsWith("/s/") },
  { to: "/decks", label: "Decks", icon: Tome, area: "decks", match: (p: string) => p.startsWith("/decks") },
  { to: "/colecao", label: "Coleção", icon: Chest, area: "collection", match: (p: string) => p.startsWith("/colecao") },
  { to: "/torneios", label: "Torneio", icon: Goblet, area: "tournament", match: (p: string) => p.startsWith("/torneios") },
];

export default function App() {
  const auth = useAuth();
  const { path } = useLocation();
  // a cor da área vale para a página e para o que abre por cima dela (janelas, câmera, telão)
  const area = NAV.find((n) => n.match(path))?.area ?? "home";
  useEffect(() => {
    document.body.dataset.area = area;
  }, [area]);

  useEffect(() => {
    const onExpired = () => void signOut();
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  // link público do torneio: abre para qualquer um, com ou sem login (a própria página cuida de entrar)
  const early = matchRoute(path);
  if (early.name === "public-tournament")
    return (
      <Suspense fallback={<FullScreen><Spinner className="size-7" /></FullScreen>}>
        <PublicTournament token={early.token} />
        <Toaster />
      </Suspense>
    );

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
          <div className="mx-auto grid size-14 place-items-center text-arcane-300">
            <Candle size={30} />
          </div>
          <div className="space-y-2">
            <p className="font-display text-title-2 text-mist uppercase">A taverna está fechada</p>
            <p className="text-body text-mist-dim">
              {auth.step === "session"
                ? "Não consegui falar com o serviço de login. Se você usa bloqueador de anúncios ou uma rede do trabalho, ele pode estar barrando o acesso."
                : "Não consegui falar com o servidor. Ele pode estar acordando: espere alguns segundos e tente de novo."}
            </p>
            <p className="text-footnote text-mist-faint">Detalhe: {auth.message}</p>
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
  // primeiro nome do cadastro; sem ele, o começo do e-mail; sem conta (modo local), nada
  const firstName = auth.status === "signed-in" ? (auth.user.name?.trim().split(/s+/)[0] || auth.user.email.split("@")[0] || null) : null;

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
      <header className="bar-glass sticky top-0 z-40 border-b-[3px] border-area">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:h-16 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 rounded-sm" aria-label="Deck Scanner, início">
            <BrandMark size={28} />
            <span className="font-brand text-title-3 leading-none font-extrabold tracking-[0.02em] text-mist uppercase sm:text-title-2">
              Deck <span className="slant !px-1.5 !text-[1em] !leading-[1.05] !tracking-[0.02em]">Scanner</span>
            </span>
          </Link>
          <nav className="ml-2 hidden items-stretch gap-1.5 self-stretch md:flex" aria-label="Principal">
            {NAV.map((item) => {
              const active = item.match(path);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  data-area={item.area}
                  className={cx(
                    "nav-item flex items-center gap-2 px-3.5 font-caps text-headline tracking-[0.05em] uppercase transition-colors duration-200",
                    active ? "text-area-ink" : "text-mist-dim hover:text-area-soft",
                  )}
                >
                  <item.icon size={19} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {email && (
              <Link to="/conta" className="hidden max-w-48 truncate text-footnote text-mist-dim underline-offset-2 hover:underline lg:inline">
                {email}
              </Link>
            )}
            <Link to="/conta" className="btn btn-ghost btn-icon shrink-0 lg:hidden" aria-label="Sua conta" title="Sua conta">
              <UserRound className="size-[18px]" />
            </Link>
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
          {route.name === "home" && <Home name={firstName} />}
          {route.name === "scan-new" && <NewScan />}
          {route.name === "session" && <ScanSession key={route.id} id={route.id} />}
          {route.name === "decks" && <Decks />}
          {route.name === "deck" && <DeckPage key={route.id} id={route.id} />}
          {route.name === "collection" && <Collection />}
          {route.name === "tournaments" && <Tournaments />}
          {route.name === "tournament" && <TournamentPage key={route.id} id={route.id} />}
          {route.name === "account" && <Account />}
          {route.name === "not-found" && <NotFound />}
        </Suspense>
      </main>

      <nav
        className="bar-glass fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-area pb-[env(safe-area-inset-bottom)] md:hidden"
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
                data-area={item.area}
                className={cx(
                  "nav-item flex h-15 flex-col items-center justify-center gap-0.5 font-caps text-footnote tracking-[0.04em] uppercase transition-colors duration-200",
                  active ? "text-area-ink" : "text-mist-dim",
                )}
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
  return <p className={cx("max-w-xs text-center text-subhead text-mist-dim transition-opacity duration-500", show ? "opacity-100" : "opacity-0")}>{WAKE_TEXT}</p>;
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
      <p className="glass-float flex max-w-md items-center gap-3 px-4 py-3 text-subhead text-mist-dim">
        <Candle size={18} className="shrink-0 text-arcane-300" />
        {WAKE_TEXT}
      </p>
    </div>
  );
}
