import { accessToken } from "./auth";
import type {
  AllocationReport,
  Bracket,
  CardSummary,
  CollectionResponse,
  CollectionSummary,
  Deck,
  DeckDiff,
  DeckState,
  GameInfo,
  Location,
  PhysicalCopy,
  PrintWarning,
  SavePreview,
  ServerStatus,
  Session,
  SessionState,
  ShoppingList,
  SightingResponse,
  Snapshot,
  CheckResult,
} from "./types";

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function authHeaders(extra?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extra);
  const token = await accessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

// Depois de minutos parado, servidor e banco "dormem": a primeira requisição leva alguns segundos.
// Se ela demorar, a tela avisa em vez de parecer travada (uploads ficam de fora: demoram por natureza).
const IDLE_MS = 4 * 60_000;
const SLOW_MS = 1500;
let lastResponseAt = 0;

/** 503 é o banco acordando: uma segunda chance evita mostrar erro para quem só chegou primeiro. */
async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await attempt(path, init);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 503 || init.body instanceof FormData) throw e;
    await new Promise((r) => window.setTimeout(r, 2500));
    return attempt(path, init);
  }
}

async function attempt(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = await authHeaders(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const mayBeWaking = !(init.body instanceof FormData) && Date.now() - lastResponseAt > IDLE_MS;
  const slowTimer = mayBeWaking ? window.setTimeout(() => window.dispatchEvent(new CustomEvent("server:waking", { detail: true })), SLOW_MS) : 0;
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor. Confira a internet e tente de novo.");
  } finally {
    if (slowTimer) {
      window.clearTimeout(slowTimer);
      window.dispatchEvent(new CustomEvent("server:waking", { detail: false }));
    }
  }
  lastResponseAt = Date.now();
  if (!res.ok) {
    let message = res.statusText || "Algo deu errado";
    let body: any = null;
    try {
      body = await res.json();
      message = typeof body.detail === "string" ? body.detail : message;
    } catch {
      /* corpo não é JSON */
    }
    if (res.status === 401) window.dispatchEvent(new CustomEvent("auth:expired"));
    throw new ApiError(res.status, message, body);
  }
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await raw(path, init)).json() as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);
const q = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && s.set(k, String(v)));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export type StreamEvent =
  | { type: "capture"; capture: import("./types").Capture }
  | { type: "detection"; detection: import("./types").Detection }
  | { type: "deck_updated" }
  | { type: "session"; status: string }
  | { type: "error"; message: string }
  | { type: "done"; capture: import("./types").Capture }
  | { type: "ping" };

export const api = {
  status: () => request<ServerStatus>("/api/status"),
  games: () => request<GameInfo[]>("/api/games"),

  // ---------------------------------------------------------------- sessões de scan
  sessions: (purpose?: string) => request<Session[]>(`/api/sessions${q({ purpose })}`),
  createSession: (body: {
    game_id: string;
    format_id: string;
    mode: string;
    name?: string;
    settings?: Record<string, unknown>;
    purpose?: "build" | "check";
    target_deck_id?: string;
  }) => request<Session>("/api/sessions", { method: "POST", body: json(body) }),
  session: (id: string) => request<SessionState>(`/api/sessions/${id}`),
  sets: (text?: string, limit = 40) => request<import("./types").SetSummary[]>(`/api/sets${q({ q: text, limit })}`),
  patchSession: (id: string, body: { format_id?: string; name?: string; settings?: Record<string, unknown> }) =>
    request<SessionState>(`/api/sessions/${id}`, { method: "PATCH", body: json(body) }),
  deleteSession: (id: string) => request<{ ok: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),

  /** Uma foto por requisição; os eventos chegam em streaming (NDJSON) conforme as cartas são lidas. */
  async uploadPhoto(sessionId: string, file: Blob, name: string, onEvent: (ev: StreamEvent) => void): Promise<void> {
    const form = new FormData();
    form.append("file", file, name);
    const res = await raw(`/api/sessions/${sessionId}/photos`, { method: "POST", body: form });
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            onEvent(JSON.parse(line));
          } catch {
            /* linha incompleta */
          }
        }
        nl = buffer.indexOf("\n");
      }
    }
  },

  createCapture: (sessionId: string, type: "live" | "video", original_name?: string) =>
    request<import("./types").Capture>(`/api/sessions/${sessionId}/captures`, { method: "POST", body: json({ type, original_name }) }),
  postSighting: (sessionId: string, meta: Record<string, unknown>, frames: { card: Blob; context: Blob | null }[]) => {
    const form = new FormData();
    form.append("meta", JSON.stringify(meta));
    frames.forEach((f, i) => {
      form.append("cards", f.card, `card-${i}.jpg`);
      if (f.context) form.append("contexts", f.context, `context-${i}.jpg`);
    });
    return request<SightingResponse>(`/api/sessions/${sessionId}/sightings`, { method: "POST", body: form });
  },
  finishCapture: (sessionId: string, captureId: string) =>
    request<SessionState>(`/api/sessions/${sessionId}/captures/${captureId}/finish`, { method: "POST" }),

  identify: (detectionId: string, cardRefId: string, extra?: { language?: string; finish?: string }) =>
    request<SessionState>(`/api/detections/${detectionId}/identify`, { method: "POST", body: json({ card_ref_id: cardRefId, ...extra }) }),
  setStatus: (detectionId: string, status: string) =>
    request<SessionState>(`/api/detections/${detectionId}/status`, { method: "POST", body: json({ status }) }),
  duplicate: (detectionId: string, otherId: string, same: boolean) =>
    request<SessionState>(`/api/detections/${detectionId}/duplicate`, { method: "POST", body: json({ other_id: otherId, same }) }),

  addSessionEntry: (sessionId: string, body: { card_ref_id: string; quantity?: number; zone?: string; language?: string; finish?: string }) =>
    request<SessionState>(`/api/sessions/${sessionId}/entries`, { method: "POST", body: json(body) }),
  patchEntry: <T = SessionState | DeckState>(entryId: string, body: Record<string, unknown>) =>
    request<T>(`/api/entries/${entryId}`, { method: "PATCH", body: json(body) }),
  deleteEntry: <T = SessionState | DeckState>(entryId: string) => request<T>(`/api/entries/${entryId}`, { method: "DELETE" }),
  applySessionSuggestion: (sessionId: string, type: string) =>
    request<SessionState>(`/api/sessions/${sessionId}/suggestions/${type}/apply`, { method: "POST" }),

  savePreview: (sessionId: string, params: { target_deck_id?: string; location_id?: string }) =>
    request<SavePreview>(`/api/sessions/${sessionId}/save-preview${q(params)}`),
  saveSession: (
    sessionId: string,
    body: {
      target: "new_deck" | "existing_deck" | "collection";
      deck_name?: string;
      deck_id?: string;
      location_id?: string;
      add_to_collection?: boolean;
      moves?: Record<string, string>;
      unscanned_action?: "keep" | "loose";
    },
  ) => request<{ result: { deck_id: string | null; created: number; moved: number; matched: number; released: number }; state: SessionState }>(
    `/api/sessions/${sessionId}/save`,
    { method: "POST", body: json(body) },
  ),
  check: (sessionId: string) => request<CheckResult>(`/api/sessions/${sessionId}/check`),
  sessionBracket: (sessionId: string) => request<Bracket>(`/api/sessions/${sessionId}/bracket`),
  applyCheck: (sessionId: string) => request<{ deck_id: string; snapshot_id: string }>(`/api/sessions/${sessionId}/check/apply`, { method: "POST" }),

  // ---------------------------------------------------------------- cartas
  search: (text: string, lang = "pt", limit = 10) => request<CardSummary[]>(`/api/cards/search${q({ q: text, lang, limit })}`),
  card: (id: string) => request<CardSummary>(`/api/cards/${id}`),
  checkPrint: (body: { set_code: string; collector_number: string; language?: string; finish?: string; name?: string }) =>
    request<{ ok: boolean; warning: PrintWarning | null }>("/api/cards/check-print", { method: "POST", body: json(body) }),

  // ---------------------------------------------------------------- decks salvos
  decks: () => request<Deck[]>("/api/decks"),
  createDeck: (body: { name: string; format_id: string; game_id?: string; description?: string; text?: string }) =>
    request<{ deck_id: string; import: ImportResult | null; state: DeckState }>("/api/decks", { method: "POST", body: json(body) }),
  deck: (id: string) => request<DeckState>(`/api/decks/${id}`),
  patchDeck: (id: string, body: { name?: string; format_id?: string; description?: string }) =>
    request<DeckState>(`/api/decks/${id}`, { method: "PATCH", body: json(body) }),
  deleteDeck: (id: string) => request<{ moved_to_loose: number }>(`/api/decks/${id}`, { method: "DELETE" }),
  addDeckEntry: (id: string, body: { card_ref_id: string; quantity?: number; zone?: string; language?: string; finish?: string }) =>
    request<DeckState>(`/api/decks/${id}/entries`, { method: "POST", body: json(body) }),
  importDeck: (id: string, body: { text: string; replace: boolean; default_language?: string }) =>
    request<{ import: ImportResult; state: DeckState }>(`/api/decks/${id}/import`, { method: "POST", body: json(body) }),
  bracket: (id: string) => request<Bracket>(`/api/decks/${id}/bracket`),
  shoppingList: (id: string, refresh = false) => request<ShoppingList>(`/api/decks/${id}/shopping-list${q({ refresh: refresh || undefined })}`),
  allocate: (id: string, physical_card_id: string, force = false) =>
    request<{ result: unknown; state: DeckState }>(`/api/decks/${id}/allocate`, { method: "POST", body: json({ physical_card_id, force }) }),
  autoAllocate: (id: string) => request<{ result: { moved: number }; state: DeckState }>(`/api/decks/${id}/allocate/auto`, { method: "POST" }),
  releaseExtra: (id: string) => request<{ result: { moved: number }; state: DeckState }>(`/api/decks/${id}/release-extra`, { method: "POST" }),
  snapshots: (id: string) => request<Snapshot[]>(`/api/decks/${id}/snapshots`),
  saveSnapshot: (id: string, note?: string) => request<Snapshot>(`/api/decks/${id}/snapshots`, { method: "POST", body: json({ note }) }),
  diff: (id: string, from_id: string, to_id = "current") =>
    request<{ from: { id: string; created_at: string; source: string }; to: { id: string; created_at: string | null }; diff: DeckDiff }>(
      `/api/decks/${id}/diff${q({ from_id, to_id })}`,
    ),
  applyDeckSuggestion: (id: string, type: string) => request<DeckState>(`/api/decks/${id}/suggestions/${type}/apply`, { method: "POST" }),

  // ---------------------------------------------------------------- coleção
  locations: () => request<Location[]>("/api/locations"),
  createLocation: (type: "binder" | "box", name: string) => request<Location>("/api/locations", { method: "POST", body: json({ type, name }) }),
  renameLocation: (id: string, name: string) => request<Location>(`/api/locations/${id}`, { method: "PATCH", body: json({ name }) }),
  deleteLocation: (id: string) => request<{ moved_to_loose: number }>(`/api/locations/${id}`, { method: "DELETE" }),
  collection: (params: { location_id?: string; q?: string; sort?: string }) => request<CollectionResponse>(`/api/collection${q(params)}`),
  collectionSummary: () => request<CollectionSummary>("/api/collection/summary"),
  whereIs: (oracleId: string) => request<PhysicalCopy[]>(`/api/collection/cards/${oracleId}`),
  addPhysical: (body: { card_ref_id: string; quantity?: number; location_id?: string; language?: string; finish?: string; condition?: string }) =>
    request<{ ids: string[] }>("/api/physical-cards", { method: "POST", body: json(body) }),
  patchPhysical: (id: string, body: Record<string, unknown>) =>
    request<{ card: PhysicalCopy; print_warning: PrintWarning | null }>(`/api/physical-cards/${id}`, { method: "PATCH", body: json(body) }),
  movePhysical: (ids: string[], location_id: string) => request<{ moved: number }>("/api/physical-cards/move", { method: "POST", body: json({ ids, location_id }) }),
  deletePhysical: (ids: string[]) => request<{ deleted: number }>("/api/physical-cards/delete", { method: "POST", body: json({ ids }) }),
  fx: () => request<import("./types").Fx>("/api/prices/fx"),

  /** Exportação como texto (com o token de login; link direto não levaria o cabeçalho). */
  exportText: async (kind: "sessions" | "decks", id: string, opts: { format: string; group?: boolean; lang?: string }) => {
    const res = await raw(`/api/${kind}/${id}/export${q({ format: opts.format, group: opts.group ? "true" : "false", lang: opts.lang ?? "en" })}`);
    return res.text();
  },
};

export type ImportResult = {
  imported: number;
  lines: number;
  unresolved: { line: number; text: string }[];
  print_warnings: ({ line: number; text: string } & PrintWarning)[];
};

export type { AllocationReport };
