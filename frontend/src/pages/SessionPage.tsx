import { ArrowLeft, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import CapturePanel from "../components/capture/CapturePanel";
import ExportPanel from "../components/ExportPanel";
import PhotoOverlay from "../components/review/PhotoOverlay";
import ReviewPanel from "../components/review/ReviewPanel";
import { Chip, Spinner } from "../components/ui";
import ValidationPanel from "../components/ValidationPanel";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { Capture, GameInfo } from "../lib/types";
import { useSession } from "../lib/useSession";
import { StatusChip } from "./Home";

export default function SessionPage({ id }: { id: string }) {
  const { state, error, connected, refresh, apply, subscribe } = useSession(id);
  const [games, setGames] = useState<GameInfo[]>([]);
  const [overlay, setOverlay] = useState<{ capture: Capture; focus?: string } | null>(null);
  const [name, setName] = useState("");
  const [tab, setTab] = useState<"cards" | "validation" | "export">("cards");

  useEffect(() => {
    api.games().then(setGames).catch(() => null);
  }, []);
  useEffect(() => {
    if (state) setName(state.session.name ?? "");
  }, [state?.session.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !state) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div className="space-y-2">
          <p className="text-bad">{error}</p>
          <button className="text-accent" onClick={() => navigate("/")}>
            voltar
          </button>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  const formats = games.find((g) => g.id === state.session.game_id)?.formats ?? [];
  const cardCount = state.validation.totals.count;

  return (
    <div className="min-h-screen pb-24 lg:pb-10">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6">
          <button onClick={() => navigate("/")} className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-text" aria-label="Voltar">
            <ArrowLeft className="size-5" />
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={async () => name !== (state.session.name ?? "") && apply(await api.patchSession(id, { name }))}
            placeholder="Deck sem nome"
            className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[15px] font-semibold outline-none placeholder:text-faint hover:bg-panel-2 focus:bg-panel-2 sm:flex-none sm:w-64"
          />
          <select
            value={state.session.format_id}
            onChange={async (e) => apply(await api.patchSession(id, { format_id: e.target.value }))}
            className="h-9 rounded-lg border border-line bg-panel-2 px-2 text-sm outline-none"
            aria-label="Formato"
          >
            {(formats.length ? formats : [state.format]).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <StatusChip status={state.session.status} />
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-faint" title={connected ? "atualização ao vivo conectada" : "reconectando…"}>
            {connected ? <Wifi className="size-4 text-ok" /> : <WifiOff className="size-4 text-warn" />}
            <Chip tone="accent">{cardCount} cartas</Chip>
          </span>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 pt-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <main className={`space-y-5 ${tab !== "cards" ? "hidden lg:block" : ""}`}>
          <CapturePanel state={state} subscribe={subscribe} onChanged={refresh} onOpenCapture={(c) => setOverlay({ capture: c })} />
          <ReviewPanel state={state} apply={apply} onShowCapture={(c, focus) => setOverlay({ capture: c, focus })} />
        </main>
        <aside className="space-y-5 lg:sticky lg:top-[68px] lg:max-h-[calc(100vh-84px)] lg:self-start lg:overflow-y-auto lg:pb-4 scrollbar-thin">
          <div className={tab === "validation" ? "" : "hidden lg:block"}>
            <ValidationPanel state={state} apply={apply} />
          </div>
          <div className={tab === "export" ? "" : "hidden lg:block"}>
            <ExportPanel state={state} />
          </div>
        </aside>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {(
          [
            ["cards", `Cartas (${cardCount})`],
            ["validation", state.validation.valid ? "Validação ✓" : `Validação (${state.validation.issues.filter((i) => i.severity === "error").length})`],
            ["export", "Exportar"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`py-3 text-sm ${tab === key ? "font-semibold text-accent" : "text-muted"}`}>
            {label}
          </button>
        ))}
      </nav>

      <PhotoOverlay capture={overlay?.capture ?? null} focusId={overlay?.focus} detections={state.detections} onClose={() => setOverlay(null)} />
    </div>
  );
}
