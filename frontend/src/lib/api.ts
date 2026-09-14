import type { CardSummary, Capture, GameInfo, ServerStatus, Session, SessionState } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* corpo não-JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  status: () => request<ServerStatus>("/api/status"),
  games: () => request<GameInfo[]>("/api/games"),
  sessions: () => request<Session[]>("/api/sessions"),
  createSession: (body: { game_id: string; format_id: string; mode: string; name?: string; settings?: Record<string, unknown> }) =>
    request<Session>("/api/sessions", { method: "POST", body: json(body) }),
  session: (id: string) => request<SessionState>(`/api/sessions/${id}`),
  patchSession: (id: string, body: { format_id?: string; name?: string; settings?: Record<string, unknown> }) =>
    request<SessionState>(`/api/sessions/${id}`, { method: "PATCH", body: json(body) }),
  deleteSession: (id: string) => request<{ ok: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),

  identify: (detectionId: string, cardRefId: string, extra?: { language?: string; finish?: string }) =>
    request<SessionState>(`/api/detections/${detectionId}/identify`, {
      method: "POST",
      body: json({ card_ref_id: cardRefId, ...extra }),
    }),
  setStatus: (detectionId: string, status: string) =>
    request<SessionState>(`/api/detections/${detectionId}/status`, { method: "POST", body: json({ status }) }),
  duplicate: (detectionId: string, otherId: string, same: boolean) =>
    request<SessionState>(`/api/detections/${detectionId}/duplicate`, {
      method: "POST",
      body: json({ other_id: otherId, same }),
    }),

  search: (q: string, lang = "pt", limit = 10) =>
    request<CardSummary[]>(`/api/cards/search?q=${encodeURIComponent(q)}&lang=${lang}&limit=${limit}`),
  card: (id: string) => request<CardSummary>(`/api/cards/${id}`),

  addEntry: (sessionId: string, body: { card_ref_id: string; quantity?: number; zone?: string; language?: string; finish?: string }) =>
    request<SessionState>(`/api/sessions/${sessionId}/entries`, { method: "POST", body: json(body) }),
  patchEntry: (entryId: string, body: Record<string, unknown>) =>
    request<SessionState>(`/api/entries/${entryId}`, { method: "PATCH", body: json(body) }),
  deleteEntry: (entryId: string) => request<SessionState>(`/api/entries/${entryId}`, { method: "DELETE" }),
  applySuggestion: (sessionId: string, type: string) =>
    request<SessionState>(`/api/sessions/${sessionId}/suggestions/${type}/apply`, { method: "POST" }),

  exportUrl: (sessionId: string, format: string, opts: { group?: boolean; lang?: string; download?: boolean }) =>
    `/api/sessions/${sessionId}/export?format=${format}&group=${opts.group ? "true" : "false"}&lang=${opts.lang ?? "en"}${opts.download ? "&download=true" : ""}`,
};

/** Upload multipart com progresso (fetch ainda não expõe progresso de envio). */
export function upload<T = Capture[]>(url: string, files: File[] | Blob[], field: string, onProgress?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((f, i) => form.append(field, f, f instanceof File ? f.name : `captura-${i + 1}.jpg`));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (ev) => ev.lengthComputable && onProgress?.(ev.loaded / ev.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let msg = xhr.statusText;
        try {
          msg = JSON.parse(xhr.responseText).detail ?? msg;
        } catch {
          /* ignore */
        }
        reject(new ApiError(xhr.status, msg));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "falha de rede no envio"));
    xhr.send(form);
  });
}
