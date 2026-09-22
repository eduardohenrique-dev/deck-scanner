import { createElement, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

/** Roteador mínimo por History API: poucas telas, sem dependência extra. */
export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (location.pathname + location.search === path) return;
  if (opts.replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const onPop = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return { path: loc.path, query: new URLSearchParams(loc.search) };
}

export type Route =
  | { name: "home" }
  | { name: "scan-new" }
  | { name: "session"; id: string }
  | { name: "decks" }
  | { name: "deck"; id: string }
  | { name: "collection" }
  | { name: "tournaments" }
  | { name: "tournament"; id: string }
  | { name: "tournament-display"; id: string }
  | { name: "not-found" };

export function matchRoute(path: string): Route {
  if (path === "/" || path === "") return { name: "home" };
  if (path === "/escanear") return { name: "scan-new" };
  let m = path.match(/^\/s\/([a-f0-9]{8,})\/?$/);
  if (m) return { name: "session", id: m[1] };
  if (path === "/decks") return { name: "decks" };
  m = path.match(/^\/decks\/([a-f0-9]{8,})\/?$/);
  if (m) return { name: "deck", id: m[1] };
  if (path === "/colecao") return { name: "collection" };
  if (path === "/torneios") return { name: "tournaments" };
  m = path.match(/^\/torneios\/([a-f0-9]{8,})\/?$/);
  if (m) return { name: "tournament", id: m[1] };
  m = path.match(/^\/torneios\/([a-f0-9]{8,})\/telao\/?$/);
  if (m) return { name: "tournament-display", id: m[1] };
  return { name: "not-found" };
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return createElement("a", {
    href: to,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
    ...rest,
  });
}
