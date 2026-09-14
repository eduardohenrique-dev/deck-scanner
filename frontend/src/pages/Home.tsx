import { Camera, ChevronRight, Film, Images, Layers, ScanLine, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Chip, EmptyState, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { GameInfo, ServerStatus, Session } from "../lib/types";

export default function Home() {
  const [games, setGames] = useState<GameInfo[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [gameId, setGameId] = useState("mtg");
  const [formatId, setFormatId] = useState<string | null>(null);
  const [mode, setMode] = useState<"video" | "photo">("video");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.games().then(setGames).catch((e) => setError(e.message));
    api.sessions().then(setSessions).catch(() => setSessions([]));
    api.status().then(setStatus).catch(() => null);
  }, []);

  const game = games?.find((g) => g.id === gameId);
  const groups = useMemo(() => {
    const out: Record<string, NonNullable<GameInfo["formats"]>> = {};
    for (const f of game?.formats ?? []) (out[f.group ?? "Outros"] ??= []).push(f);
    return Object.entries(out);
  }, [game]);
  const format = game?.formats?.find((f) => f.id === formatId);

  async function start() {
    if (!formatId) return;
    setCreating(true);
    setError(null);
    try {
      const s = await api.createSession({
        game_id: gameId,
        format_id: formatId,
        mode,
        name: name.trim() || undefined,
        settings: { default_language: language },
      });
      navigate(`/s/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  async function remove(id: string) {
    await api.deleteSession(id);
    setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-ink">
            <ScanLine className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Deck Scanner</h1>
            <p className="text-sm text-muted">Aponte a câmera para as cartas e receba a lista pronta para importar.</p>
          </div>
        </div>
        {status && (
          <div className="flex flex-wrap gap-2 text-[12px]">
            <Chip tone="ok">{status.hash_index.base.toLocaleString("pt-BR")} artes no banco local</Chip>
            {status.hash_index.learned > 0 && <Chip tone="accent">{status.hash_index.learned} aprendidas com correções</Chip>}
            <Chip tone={status.vlm.enabled ? "info" : "neutral"}>
              <Sparkles className="size-3" />
              {status.vlm.enabled ? `modelo multimodal: ${status.vlm.model}` : "modelo multimodal desligado"}
            </Chip>
          </div>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border border-line bg-panel p-4 sm:p-6">
          <h2 className="mb-5 text-lg font-semibold">Novo scan</h2>

          <Step n={1} title="Jogo">
            <div className="flex flex-wrap gap-2">
              {(games ?? []).map((g) => (
                <button
                  key={g.id}
                  disabled={!g.enabled}
                  onClick={() => {
                    setGameId(g.id);
                    setFormatId(null);
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    g.id === gameId ? "border-accent bg-accent/10 text-text" : "border-line bg-panel-2 text-muted hover:text-text"
                  } disabled:opacity-40`}
                >
                  {g.name}
                  {!g.enabled && <span className="ml-1.5 text-[11px] text-faint">{g.note ?? "em breve"}</span>}
                </button>
              ))}
              {!games && <Spinner />}
            </div>
          </Step>

          <Step n={2} title="Formato" hint="obrigatório — define limites de cópias, tamanho e legalidade">
            <div className="flex flex-col gap-3">
              {groups.map(([group, formats]) => (
                <div key={group}>
                  <p className="mb-1.5 text-[12px] uppercase tracking-wide text-faint">{group}</p>
                  <div className="flex flex-wrap gap-2">
                    {formats.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFormatId(f.id)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                          f.id === formatId ? "border-accent bg-accent text-accent-ink" : "border-line bg-panel-2 text-text hover:bg-panel-3"
                        }`}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {format?.description && <p className="text-sm text-muted">{format.description}</p>}
            </div>
          </Step>

          <Step n={3} title="Como capturar">
            <div className="grid gap-2 sm:grid-cols-2">
              <ModeCard
                active={mode === "video"}
                onClick={() => setMode("video")}
                icon={<Film className="size-5" />}
                title="Vídeo"
                badge="recomendado"
                text="Folheie o baralho devagar, uma carta por vez. Cada carta é lida no melhor frame e contada uma vez."
              />
              <ModeCard
                active={mode === "photo"}
                onClick={() => setMode("photo")}
                icon={<Images className="size-5" />}
                title="Fotos da mesa"
                text="De 1 a 30 fotos com cartas espalhadas. Cartas repetidas entre fotos são unificadas."
              />
            </div>
          </Step>

          <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do deck (opcional)"
              className="h-11 rounded-lg border border-line bg-panel-2 px-3 text-sm outline-none placeholder:text-faint focus:border-accent"
            />
            <label className="flex h-11 items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 text-sm text-muted">
              Idioma das cartas
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="bg-transparent text-text outline-none">
                <option value="en">Inglês</option>
                <option value="pt">Português</option>
                <option value="es">Espanhol</option>
                <option value="ja">Japonês</option>
              </select>
            </label>
          </div>

          {error && <p className="mt-3 text-sm text-bad">{error}</p>}
          <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!formatId} busy={creating} onClick={start} icon={<Camera className="size-5" />}>
            {formatId ? "Começar a capturar" : "Escolha o formato"}
          </Button>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Sessões recentes</h2>
          {!sessions && <Spinner />}
          {sessions?.length === 0 && (
            <EmptyState icon={<Layers className="size-8" />} title="Nenhum scan ainda">
              Os scans ficam salvos aqui para você voltar, revisar e exportar depois.
            </EmptyState>
          )}
          {sessions?.map((s) => {
            const f = games?.find((g) => g.id === s.game_id)?.formats?.find((x) => x.id === s.format_id);
            return (
              <div key={s.id} className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-3 transition-colors hover:border-panel-3">
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => navigate(`/s/${s.id}`)}>
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-panel-2 text-muted">
                    {s.mode === "video" ? <Film className="size-5" /> : <Images className="size-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.name || f?.name || s.format_id}</p>
                    <p className="text-[13px] text-muted">
                      {f?.name ?? s.format_id} · {s.card_count ?? 0} cartas · {new Date(s.updated_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </p>
                  </div>
                  <StatusChip status={s.status} />
                  <ChevronRight className="size-4 text-faint" />
                </button>
                <button
                  onClick={() => confirm("Apagar esta sessão e as capturas dela?") && remove(s.id)}
                  className="rounded-md p-1.5 text-faint opacity-0 transition-opacity hover:bg-bad/15 hover:text-bad group-hover:opacity-100"
                  aria-label="Apagar sessão"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 grid grid-cols-[28px_1fr] gap-3">
      <div className="grid size-7 place-items-center rounded-full bg-panel-3 text-[13px] font-semibold text-muted">{n}</div>
      <div>
        <p className="mb-2.5 font-medium">
          {title} {hint && <span className="text-[13px] font-normal text-faint">— {hint}</span>}
        </p>
        {children}
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, icon, title, text, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; text: string; badge?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors ${active ? "border-accent bg-accent/10" : "border-line bg-panel-2 hover:bg-panel-3"}`}
    >
      <span className="flex items-center gap-2 font-medium">
        <span className={active ? "text-accent" : "text-muted"}>{icon}</span>
        {title}
        {badge && <Chip tone="accent">{badge}</Chip>}
      </span>
      <span className="text-[13px] leading-snug text-muted">{text}</span>
    </button>
  );
}

export function StatusChip({ status }: { status: Session["status"] }) {
  const map = {
    capturing: { tone: "neutral", label: "capturando" },
    processing: { tone: "info", label: "processando" },
    review: { tone: "ok", label: "revisão" },
    error: { tone: "bad", label: "erro" },
  } as const;
  const s = map[status] ?? map.capturing;
  return <Chip tone={s.tone}>{s.label}</Chip>;
}
