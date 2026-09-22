import { Check, Info, TriangleAlert, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cx } from "../components/ui";

type Toast = { id: number; tone: "ok" | "bad" | "info"; text: string; action?: { label: string; run: () => void }; ttl: number; leaving?: boolean; group?: string };

let items: Toast[] = [];
const listeners = new Set<() => void>();
let seq = 1;

function emit() {
  listeners.forEach((l) => l());
}

const timers = new Map<number, number>();

/**
 * Aviso rápido. Com `group`, o aviso novo substitui o anterior do mesmo grupo em vez de empilhar
 * (ex.: só o último "Desfazer" fica na tela quando se lançam vários placares seguidos).
 */
export function toast(text: string, opts: { tone?: Toast["tone"]; action?: Toast["action"]; ttl?: number; group?: string } = {}) {
  const t: Toast = { id: seq++, tone: opts.tone ?? "ok", text, action: opts.action, ttl: opts.ttl ?? (opts.action ? 7000 : 4200), group: opts.group };
  const old = opts.group ? items.find((x) => x.group === opts.group && !x.leaving) : undefined;
  if (old) {
    window.clearTimeout(timers.get(old.id));
    timers.delete(old.id);
    items = items.map((x) => (x.id === old.id ? t : x));
  } else items = [...items.slice(-3), t];
  emit();
  timers.set(t.id, window.setTimeout(() => dismiss(t.id), t.ttl));
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { tone: "bad", ttl: 6500 });

/** Sai com animação curta e só então some da lista. */
function dismiss(id: number) {
  if (!items.some((t) => t.id === id && !t.leaving)) return;
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 190);
}

const ICON = {
  ok: { icon: Check, className: "bg-moss-600/40 text-moss-300" },
  bad: { icon: TriangleAlert, className: "bg-wine-600/40 text-wine-300" },
  info: { icon: Info, className: "bg-verdigris-600/40 text-verdigris-200" },
};

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+80px)] z-[60] flex flex-col items-center gap-2 px-3 md:bottom-6" aria-live="polite">
      {list.map((t) => {
        const { icon: Icon, className } = ICON[t.tone];
        return (
          <div
            key={t.id}
            data-state={t.leaving ? "closed" : "open"}
            className="glass-float toast pointer-events-auto flex w-full max-w-md items-center gap-3 py-2.5 pr-2 pl-3"
            role={t.tone === "bad" ? "alert" : "status"}
          >
            <span className={cx("grid size-7 shrink-0 place-items-center rounded-full", className)}>
              <Icon className="size-4 [--icon-stroke:2.2]" />
            </span>
            <p className="min-w-0 flex-1 text-subhead text-cream">{t.text}</p>
            {t.action && (
              <button
                type="button"
                className="btn btn-tertiary btn-sm"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                <span className="inline-block first-letter:uppercase">{t.action.label}</span>
              </button>
            )}
            <button type="button" onClick={() => dismiss(t.id)} className="btn btn-ghost btn-sm btn-icon" aria-label="Fechar aviso">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
