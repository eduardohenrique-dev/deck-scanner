import { Loader2, Minus, Plus, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
export { cx };

// ------------------------------------------------------------------ botões
type Variant = "brass" | "outline" | "ghost" | "danger" | "quiet";

const VARIANTS: Record<Variant, string> = {
  // placa de latão: gradiente curto de metal, borda escura e filete de luz no topo (sem brilho difuso)
  brass:
    "text-ink-900 border border-brass-700 bg-[linear-gradient(180deg,var(--color-brass-300),var(--color-brass-500))] shadow-[inset_0_1px_0_rgb(255_244_210/0.55),0_1px_0_rgb(0_0_0/0.5)] hover:bg-[linear-gradient(180deg,var(--color-brass-200),var(--color-brass-400))] active:translate-y-px active:shadow-[inset_0_2px_3px_rgb(0_0_0/0.25)]",
  outline:
    "text-brass-300 border border-brass-600/80 bg-oak-900/40 hover:bg-brass-400/10 hover:text-brass-200 active:translate-y-px",
  ghost: "text-cream-dim hover:text-cream hover:bg-oak-700/60",
  quiet: "text-cream-faint hover:text-cream-dim",
  danger: "text-wine-300 border border-wine-600/70 bg-wine-600/10 hover:bg-wine-600/25 active:translate-y-px",
};

const SIZES = {
  xs: "h-7 px-2 text-[13px] gap-1.5",
  sm: "h-9 px-3 text-[14px] gap-1.5",
  md: "h-11 px-4 text-[15px] gap-2",
  lg: "h-13 px-6 text-[16px] gap-2.5",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof SIZES;
  busy?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", busy, icon, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex select-none items-center justify-center rounded-[5px] font-caps font-bold tracking-[0.03em] transition-[background,color,transform] duration-150 disabled:pointer-events-none disabled:opacity-45",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children && <span className="lowercase leading-none">{children}</span>}
      {iconRight}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-[5px] text-cream-dim transition-colors hover:bg-oak-700/70 hover:text-cream disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ superfícies
export function Board({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: any } & Record<string, any>) {
  return (
    <As className={cx("board", className)} {...rest}>
      {children}
    </As>
  );
}

export function Parchment({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("parchment", className)}>{children}</div>;
}

export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-end justify-between gap-3", className)}>
      <h2 className="kicker text-[15px]">{children}</h2>
      {aside}
    </div>
  );
}

export function PageTitle({ kicker, title, children }: { kicker?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="space-y-1">
      {kicker && <p className="kicker text-[13px] text-brass-400">{kicker}</p>}
      <h1 className="font-display text-[34px] leading-[1.05] font-semibold tracking-[0.01em] text-cream sm:text-[42px]">{title}</h1>
      {children && <div className="max-w-2xl text-[15px] text-cream-dim">{children}</div>}
    </header>
  );
}

// ------------------------------------------------------------------ selos e etiquetas
export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "brass";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-cream-dim border-oak-600 bg-oak-800/70",
  ok: "text-moss-300 border-moss-600/60 bg-moss-600/12",
  warn: "text-amber-300 border-amber-600/60 bg-amber-600/12",
  bad: "text-wine-300 border-wine-600/60 bg-wine-600/14",
  info: "text-steel-300 border-steel-600/60 bg-steel-600/14",
  brass: "text-brass-200 border-brass-600/70 bg-brass-500/12",
};

export function Tag({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx("inline-flex h-6 items-center gap-1 rounded-[4px] border px-1.5 text-[13px] leading-none whitespace-nowrap", TONE_TEXT[tone], className)}
    >
      {children}
    </span>
  );
}

const WAX: Record<Tone, string> = {
  neutral: "from-oak-500 to-oak-700 text-cream",
  ok: "from-moss-400 to-moss-600 text-oak-950",
  warn: "from-amber-300 to-amber-600 text-oak-950",
  bad: "from-wine-400 to-wine-600 text-parchment-50",
  info: "from-steel-400 to-steel-600 text-oak-950",
  brass: "from-brass-300 to-brass-600 text-ink-900",
};

/** Selo de cera: número ou ícone curto num disco com borda irregular. */
export function Seal({ tone = "brass", size = 30, children, title, className }: { tone?: Tone; size?: number; children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "relative inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-b font-caps font-bold leading-none shadow-[inset_0_1px_0_rgb(255_255_255/0.3),inset_0_-2px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.6)]",
        WAX[tone],
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.46, clipPath: "polygon(50% 0%, 61% 4%, 73% 3%, 81% 11%, 92% 15%, 95% 27%, 100% 38%, 97% 50%, 100% 62%, 95% 73%, 92% 85%, 81% 89%, 73% 97%, 61% 96%, 50% 100%, 39% 96%, 27% 97%, 19% 89%, 8% 85%, 5% 73%, 0% 62%, 3% 50%, 0% 38%, 5% 27%, 8% 15%, 19% 11%, 27% 3%, 39% 4%)" }}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ formulários
export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="font-caps text-[14px] font-bold lowercase tracking-[0.04em] text-cream-dim">{children}</span>
      {hint && <span className="text-[13px] text-cream-faint">{hint}</span>}
    </label>
  );
}

const FIELD =
  "rounded-[5px] border border-oak-600 bg-oak-950/80 px-3 text-[15px] text-cream shadow-[inset_0_2px_4px_rgb(0_0_0/0.4)] outline-none transition-colors focus:border-brass-400 disabled:opacity-50";

/** Altura e largura padrão só quando quem usa não definiu as suas (utilitários iguais não se sobrepõem pela ordem). */
function fieldSize(className: string | undefined, height: string | null) {
  const own = className ?? "";
  return cx(!/(^|\s)w-/.test(own) && "w-full", height && !/(^|\s)h-/.test(own) && height, own);
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(FIELD, fieldSize(className, "h-11"))} {...rest} />;
});

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, "py-2.5 leading-relaxed", fieldSize(className, null))} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        FIELD,
        "appearance-none bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1.5 6 6.5 11 1.5' fill='none' stroke='%23d3a24b' stroke-width='1.6' stroke-linecap='round'/></svg>\")] bg-[length:12px_8px] bg-[position:right_12px_center] bg-no-repeat pr-9",
        fieldSize(className, "h-11"),
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      {children(id)}
    </div>
  );
}

/** Escolha entre poucas opções, como fichas numa bandeja. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; hint?: string }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" className={cx("inline-flex rounded-[6px] border border-oak-600 bg-oak-950/70 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-[4px] font-caps font-bold lowercase tracking-[0.03em] transition-colors",
            size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-[14px]",
            value === o.value ? "bg-brass-400 text-ink-900 shadow-[inset_0_1px_0_rgb(255_244_210/0.5)]" : "text-cream-dim hover:text-cream",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 999, busy, label = "quantidade" }: { value: number; onChange: (v: number) => void; min?: number; max?: number; busy?: boolean; label?: string }) {
  return (
    <div className="inline-flex items-center rounded-[6px] border border-oak-600 bg-oak-950/70" role="group" aria-label={label}>
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={busy || value <= min}
        className="grid size-9 place-items-center rounded-l-[5px] text-cream-dim hover:bg-oak-700 hover:text-cream disabled:opacity-30"
        aria-label="Diminuir"
      >
        <Minus className="size-4" />
      </button>
      <span className="tabular w-9 text-center font-serif text-[17px] font-semibold text-cream" aria-live="polite">
        {value}
      </span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={busy || value >= max}
        className="grid size-9 place-items-center rounded-r-[5px] text-cream-dim hover:bg-oak-700 hover:text-cream disabled:opacity-30"
        aria-label="Aumentar"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ abas
export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; badge?: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("scrollbar-thin flex gap-1 overflow-x-auto border-b border-oak-600", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            "relative -mb-px flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 font-caps text-[15px] font-bold lowercase tracking-[0.04em] transition-colors",
            value === t.value ? "border-brass-300 text-brass-200" : "border-transparent text-cream-faint hover:text-cream-dim",
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ janelas
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
}) {
  useEscape(open, onClose);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  if (!open) return null;
  const widths = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-6xl" };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-oak-950/80 sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cx("board animate-rise flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-b-none outline-none sm:rounded-[6px]", widths[width])}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="font-serif text-[21px] font-semibold text-cream">{title}</h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="brass-rule opacity-70" />
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-oak-600 bg-oak-900/60 px-5 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmação para ações que não têm volta (apagar, sobrescrever). */
export function Confirm({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            cancelar
          </Button>
          <Button variant={danger ? "danger" : "brass"} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-[15px] text-cream-dim">{children}</div>
    </Modal>
  );
}

/** Título editável no lugar: clique para renomear, Enter salva, Esc desiste. */
export function InlineEdit({ value, placeholder, onSave, className, label }: { value: string; placeholder: string; onSave: (v: string) => Promise<unknown>; className?: string; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value), [value]);

  async function commit() {
    const next = draft.trim();
    if (next === value.trim()) return setEditing(false);
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (editing)
    return (
      <input
        autoFocus
        aria-label={label}
        value={draft}
        disabled={busy}
        maxLength={80}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cx("w-full rounded-[4px] border border-brass-500 bg-oak-950/80 px-2 outline-none", className)}
      />
    );
  return (
    <button onClick={() => setEditing(true)} title={`${label} (clique para mudar)`} className={cx("group -mx-1 max-w-full truncate rounded-[4px] px-1 text-left hover:bg-oak-800/70", className)}>
      {value || <span className="text-cream-faint">{placeholder}</span>}
      <span aria-hidden="true" className="ml-2 align-middle font-sans text-[13px] font-normal text-cream-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        renomear
      </span>
    </button>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-oak-950/75" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        className="board animate-rise flex h-full w-full max-w-lg flex-col rounded-none border-y-0 border-r-0"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="font-serif text-[21px] font-semibold">{title}</h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="brass-rule opacity-70" />
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ estados
export function Spinner({ className, label = "carregando" }: { className?: string; label?: string }) {
  return <Loader2 aria-label={label} className={cx("size-5 animate-spin text-brass-300", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-[4px] bg-oak-700/60", className)} />;
}

export function EmptyState({ art, title, children, action }: { art: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="text-brass-500">{art}</div>
      <p className="font-serif text-[21px] font-semibold text-cream">{title}</p>
      {children && <div className="max-w-md text-[15px] text-cream-dim">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Meter({ value, tone = "brass", className, label }: { value: number | null; tone?: Tone; className?: string; label?: string }) {
  const color = { brass: "bg-brass-400", ok: "bg-moss-400", warn: "bg-amber-400", bad: "bg-wine-400", info: "bg-steel-400", neutral: "bg-cream-faint" }[tone];
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full border border-oak-700 bg-oak-950", className)} role="progressbar" aria-label={label}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cx("h-full rounded-full transition-[width] duration-500", color, value === null && "w-1/3 animate-pulse")}
        style={value === null ? undefined : { width: `${Math.max(3, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[3px] border border-oak-600 bg-oak-950 px-1.5 py-0.5 font-mono text-[12px] text-cream-dim">{children}</kbd>;
}
