import { AlertTriangle, Check, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cx } from "../components/ui";

type Toast = { id: number; tone: "ok" | "bad" | "info"; text: string; action?: { label: string; run: () => void }; ttl: number };

let items: Toast[] = [];
const listeners = new Set<() => void>();
let seq = 1;

function emit() {
  listeners.forEach((l) => l());
}

export function toast(text: string, opts: { tone?: Toast["tone"]; action?: Toast["action"]; ttl?: number } = {}) {
  const t: Toast = { id: seq++, tone: opts.tone ?? "ok", text, action: opts.action, ttl: opts.ttl ?? (opts.action ? 7000 : 4200) };
  items = [...items.slice(-3), t];
  emit();
  window.setTimeout(() => dismiss(t.id), t.ttl);
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { tone: "bad", ttl: 6500 });

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-[60] flex flex-col items-center gap-2 px-3 sm:bottom-6" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className="parchment animate-rise pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-[4px] px-3.5 py-3 text-[15px]"
          role={t.tone === "bad" ? "alert" : "status"}
        >
          <span className={cx("mt-0.5", t.tone === "ok" ? "text-moss-600" : t.tone === "bad" ? "text-wine-600" : "text-steel-600")}>
            {t.tone === "ok" ? <Check className="size-4" /> : t.tone === "bad" ? <AlertTriangle className="size-4" /> : <Info className="size-4" />}
          </span>
          <p className="min-w-0 flex-1 text-ink-900">{t.text}</p>
          {t.action && (
            <button
              className="font-caps text-[14px] font-bold lowercase text-brass-700 underline-offset-2 hover:underline"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} className="text-ink-500 hover:text-ink-900" aria-label="Fechar aviso">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
