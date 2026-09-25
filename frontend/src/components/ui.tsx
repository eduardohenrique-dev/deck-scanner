import { Check, Loader2, Minus, Pencil, Plus, X } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
export { cx };

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ botões
/** primary: latão polido (a ação da tela) · secondary: vidro · tertiary: texto de latão · ghost: neutro · danger: lacre. */
type Variant = "primary" | "secondary" | "tertiary" | "ghost" | "danger" | "brass" | "outline" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  tertiary: "btn-tertiary",
  ghost: "btn-ghost",
  danger: "btn-danger",
  // nomes antigos
  brass: "btn-primary",
  outline: "btn-secondary",
  quiet: "btn-ghost",
};

const SIZES = { xs: "btn-sm", sm: "btn-sm", md: "", lg: "btn-lg" };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof SIZES;
  busy?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", busy, icon, iconRight, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("btn", VARIANTS[variant], SIZES[size], !children && "btn-icon", className)}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children && <span className="inline-block first-letter:uppercase">{children}</span>}
      {iconRight}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  size = "md",
  variant = "ghost",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md"; variant?: "ghost" | "secondary" | "tertiary" }) {
  return (
    <button aria-label={label} title={label} type={type} className={cx("btn btn-icon shrink-0", VARIANTS[variant], size === "sm" && "btn-sm", className)} {...rest}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ superfícies
export function Board({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: any } & Record<string, any>) {
  return (
    <As className={cx("glass", className)} {...rest}>
      {children}
    </As>
  );
}

export function Parchment({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("parchment", className)}>{children}</div>;
}

export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-end justify-between gap-x-3 gap-y-2", className)}>
      <h2 className="font-display text-title-3 font-semibold text-cream first-letter:uppercase">{children}</h2>
      {aside}
    </div>
  );
}

export function PageTitle({ kicker, title, children, className }: { kicker?: ReactNode; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cx("space-y-2", className)}>
      {kicker && <p className="eyebrow">{kicker}</p>}
      <h1 className="font-display text-title-1 font-semibold text-cream sm:text-display">{title}</h1>
      {children && <div className="max-w-2xl text-subhead text-cream-dim">{children}</div>}
    </header>
  );
}

/** Link de texto em latão, para "ver tudo", "abrir" e afins. */
export const LINK = "rounded-xs text-subhead font-medium text-brass-300 underline-offset-4 hover:text-brass-200 hover:underline";

// ------------------------------------------------------------------ selos e etiquetas
export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "brass" | "live";

export function Tag({ tone = "neutral", children, className, title, dot }: { tone?: Tone; children: ReactNode; className?: string; title?: string; dot?: boolean }) {
  return (
    <span title={title} data-tone={tone} className={cx("badge", className)}>
      {(dot || tone === "live") && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

const WAX: Record<Tone, string> = {
  neutral: "from-oak-500 to-oak-700 text-cream",
  ok: "from-moss-400 to-moss-600 text-oak-950",
  warn: "from-ember-300 to-ember-600 text-oak-950",
  bad: "from-wine-400 to-wine-600 text-parchment-50",
  info: "from-verdigris-300 to-verdigris-600 text-oak-950",
  live: "from-verdigris-300 to-verdigris-600 text-oak-950",
  brass: "from-brass-300 to-brass-600 text-ink-900",
};

/** Selo de cera: número ou ícone curto num disco com borda irregular. */
export function Seal({ tone = "brass", size = 30, children, title, className }: { tone?: Tone; size?: number; children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "relative inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-b font-sans font-bold leading-none shadow-[inset_0_1px_0_rgb(255_255_255/0.3),inset_0_-2px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.6)]",
        WAX[tone],
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.42, clipPath: "polygon(50% 0%, 61% 4%, 73% 3%, 81% 11%, 92% 15%, 95% 27%, 100% 38%, 97% 50%, 100% 62%, 95% 73%, 92% 85%, 81% 89%, 73% 97%, 61% 96%, 50% 100%, 39% 96%, 27% 97%, 19% 89%, 8% 85%, 5% 73%, 0% 62%, 3% 50%, 0% 38%, 5% 27%, 8% 15%, 19% 11%, 27% 3%, 39% 4%)" }}
    >
      {children}
    </span>
  );
}

/** Plaqueta de latão com um número curto (mesa, seed, posição). */
export function Plate({ children, className, muted }: { children: ReactNode; className?: string; muted?: boolean }) {
  return (
    <span
      className={cx(
        "tabular inline-grid h-7 min-w-8 shrink-0 place-items-center rounded-[8px] px-2 font-sans text-footnote font-bold",
        muted
          ? "bg-oak-700/70 text-cream-dim shadow-[inset_0_1px_0_rgb(255_234_200/0.1)]"
          : "bg-[linear-gradient(180deg,var(--color-brass-200),var(--color-brass-400))] text-ink-900 shadow-[inset_0_1px_0_rgb(255_252_240/0.7),inset_0_-1px_0_rgb(96_60_16/0.3),0_1px_2px_rgb(0_0_0/0.4)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ formulários
export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="inline-block text-footnote font-medium text-cream-dim first-letter:uppercase">{children}</span>
      {hint && <span className="text-footnote text-cream-faint">{hint}</span>}
    </label>
  );
}

/** Largura e altura padrão só quando quem usa não definiu as suas (utilitários iguais não se sobrepõem pela ordem). */
function fieldSize(className: string | undefined, height: string | null) {
  const own = className ?? "";
  return cx(!/(^|\s)w-/.test(own) && "w-full", height && !/(^|\s)h-/.test(own) && height, own);
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx("field", fieldSize(className, "h-11"))} {...rest} />;
});

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("field", fieldSize(className, null))} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("field", fieldSize(className, "h-11"))} {...rest}>
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

/** Setas movem a escolha em grupos de rádio (padrão da WAI-ARIA). */
function arrowKeys<T>(e: ReactKeyboardEvent, values: T[], current: T, pick: (v: T) => void) {
  const i = values.indexOf(current);
  const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!delta) return;
  e.preventDefault();
  const next = values[(i + delta + values.length) % values.length];
  pick(next);
  const group = e.currentTarget as HTMLElement;
  window.requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
}

/** Escolha entre poucas opções: um poço com a peça de vidro que desliza até a escolhida. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; hint?: string }[];
  className?: string;
  size?: "sm" | "md";
  label?: string;
}) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("seg", size === "sm" && "seg-sm", className)}
      style={{ "--n": options.length, "--i": Math.max(0, index) } as CSSProperties}
      onKeyDown={(e) =>
        arrowKeys(
          e,
          options.map((o) => o.value),
          value,
          onChange,
        )
      }
    >
      {index >= 0 && <span className="seg-thumb" aria-hidden="true" />}
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} tabIndex={value === o.value || index < 0 ? 0 : -1} title={o.hint} onClick={() => onChange(o.value)}>
          <span className="inline-block first-letter:uppercase">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full p-[2px] shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] transition-colors duration-200 disabled:opacity-45",
        checked ? "bg-moss-600" : "bg-oak-700",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "size-[27px] rounded-full bg-[linear-gradient(180deg,#fffaf0,#eadfca)] shadow-[0_2px_5px_rgb(0_0_0/0.4)] transition-transform duration-500 ease-spring",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  busy,
  label = "quantidade",
  size = "md",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  busy?: boolean;
  label?: string;
  size?: "sm" | "md";
}) {
  const btn = cx("grid place-items-center text-cream-dim transition-colors hover:text-cream disabled:opacity-30", size === "sm" ? "size-9" : "size-11");
  return (
    <div className="well inline-flex items-center" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={busy || value <= min} className={btn} aria-label="Diminuir">
        <Minus className="size-4" />
      </button>
      <span className="tabular w-9 text-center text-headline font-semibold text-cream" aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={busy || value >= max} className={btn} aria-label="Aumentar">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ abas
export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; badge?: ReactNode }[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const measure = useCallback(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    setBar(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, []);
  useLayoutEffect(measure, [measure, value, tabs.length]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);

  return (
    <div
      ref={ref}
      role="tablist"
      className={cx("tabs", className)}
      onKeyDown={(e) => {
        const values = tabs.map((t) => t.value);
        const i = values.indexOf(value);
        const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        onChange(values[(i + delta + values.length) % values.length]);
        window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
      }}
    >
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} tabIndex={value === t.value ? 0 : -1} onClick={() => onChange(t.value)} className="tab">
          <span className="inline-block first-letter:uppercase">{t.label}</span>
          {t.badge}
        </button>
      ))}
      {bar && <span className="tab-indicator" aria-hidden="true" style={{ left: bar.left, width: bar.width }} />}
    </div>
  );
}

/** Contador ao lado do nome da aba. */
export function Count({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("tabular rounded-full bg-cream/8 px-1.5 py-0.5 text-caption font-semibold text-cream-dim", className)}>{children}</span>;
}

// ------------------------------------------------------------------ camadas (janelas, gavetas)
/**
 * Pilha de camadas: só a de cima responde. O resto do app (e as camadas de baixo) fica `inert`,
 * o que prende o foco e esconde o fundo do leitor de tela sem truque de Tab.
 */
const layers: HTMLElement[] = [];
let scrollLocks = 0;

/** Camada por cima da página (janela, gaveta, câmera em tela cheia): o que está embaixo fica inerte. */
export function pushLayer(el: HTMLElement) {
  layers.forEach((l) => (l.inert = true));
  const root = document.getElementById("root");
  if (root) root.inert = true;
  layers.push(el);
  if (scrollLocks++ === 0) document.body.style.overflow = "hidden";
}

export function popLayer(el: HTMLElement) {
  const i = layers.indexOf(el);
  if (i >= 0) layers.splice(i, 1);
  const top = layers[layers.length - 1];
  if (top) top.inert = false;
  else {
    const root = document.getElementById("root");
    if (root) root.inert = false;
  }
  if (--scrollLocks <= 0) {
    scrollLocks = 0;
    document.body.style.overflow = "";
  }
}

const isTop = (el: HTMLElement | null) => !!el && layers[layers.length - 1] === el;

/** Mantém a janela montada durante a animação de saída. */
function usePresence(open: boolean, exitMs = 190) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<"open" | "closed">(open ? "open" : "closed");
  useEffect(() => {
    if (open) {
      setMounted(true);
      setState("open");
      return;
    }
    setState("closed");
    const t = window.setTimeout(() => setMounted(false), reducedMotion() ? 0 : exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted, state };
}

function useLayer(open: boolean, mounted: boolean, onClose: () => void, focusRef: RefObject<HTMLElement | null>) {
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = layerRef.current;
    if (!mounted || !el) return;
    const opener = document.activeElement as HTMLElement | null;
    pushLayer(el);
    return () => {
      popLayer(el);
      // devolve o foco a quem abriu, se ele ainda existe
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    const panel = focusRef.current;
    // o primeiro campo marcado com autoFocus ganha o foco; senão, a própria janela
    const t = window.setTimeout(() => {
      if (panel && !panel.contains(document.activeElement)) (panel.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ?? panel).focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTop(layerRef.current)) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, focusRef]);

  return layerRef;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "md",
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  description?: ReactNode;
}) {
  const { mounted, state } = usePresence(open);
  const panel = useRef<HTMLDivElement>(null);
  const layerRef = useLayer(open, mounted, onClose, panel);
  const titleId = useId();
  if (!mounted) return null;
  const widths = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-6xl" };
  return createPortal(
    <div ref={layerRef} className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="scrim absolute inset-0" data-state={state} onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-state={state}
        className={cx("glass-sheet sheet relative flex max-h-[92dvh] w-full flex-col overflow-hidden outline-none max-sm:rounded-b-none", widths[width])}
      >
        <div className="sheet-handle mx-auto mt-2 sm:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div className="min-w-0 pt-1.5">
            <h2 id={titleId} className="font-display text-title-3 font-semibold text-cream">
              {title}
            </h2>
            {description && <p className="mt-1 text-subhead text-cream-dim">{description}</p>}
          </div>
          <IconButton label="Fechar" onClick={onClose} className="-mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="hairline" />
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/8 bg-oak-950/30 px-5 py-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:px-6">{footer}</div>
        )}
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
            Cancelar
          </Button>
          <Button variant={danger ? "danger" : "primary"} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-body text-cream-dim">{children}</div>
    </Modal>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const { mounted, state } = usePresence(open);
  const panel = useRef<HTMLElement>(null);
  const layerRef = useLayer(open, mounted, onClose, panel);
  const titleId = useId();
  if (!mounted) return null;
  return createPortal(
    <div ref={layerRef} className="fixed inset-0 z-50 flex justify-end">
      <div className="scrim absolute inset-0" data-state={state} onMouseDown={onClose} aria-hidden="true" />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-state={state}
        className="glass-sheet drawer relative flex h-full w-full max-w-lg flex-col rounded-none outline-none sm:rounded-l-xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-[max(env(safe-area-inset-top),16px)] pb-3 sm:px-6">
          <h2 id={titleId} className="min-w-0 pt-2 font-display text-title-3 font-semibold text-cream">
            {title}
          </h2>
          <IconButton label="Fechar" onClick={onClose} className="-mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="hairline" />
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5 pb-[max(env(safe-area-inset-bottom),20px)] sm:px-6">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ menu de ações
export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; tone?: "danger"; disabled?: boolean; hint?: string };

/** Botão "…" que abre uma lista de ações em vidro flutuante (setas, Enter e Esc funcionam). */
export function Menu({ items, label = "Mais ações", align = "right", trigger }: { items: MenuItem[]; label?: string; align?: "left" | "right"; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus());
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function move(e: ReactKeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
  }

  return (
    <div className="relative" ref={wrap}>
      <IconButton label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {trigger ?? (
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        )}
      </IconButton>
      {open && (
        <div
          ref={list}
          role="menu"
          onKeyDown={move}
          data-state="open"
          style={{ "--origin": align === "right" ? "top right" : "top left" } as CSSProperties}
          className={cx("glass-float popover absolute z-40 mt-2 min-w-56 p-1.5", align === "right" ? "right-0" : "left-0")}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              title={it.hint}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={cx(
                "flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-subhead font-medium outline-none transition-colors disabled:opacity-40",
                it.tone === "danger" ? "text-wine-300 hover:bg-wine-600/20 focus-visible:bg-wine-600/20" : "text-cream hover:bg-cream/8 focus-visible:bg-cream/8",
              )}
            >
              <span className={cx("grid size-5 place-items-center", it.tone === "danger" ? "text-wine-300" : "text-cream-dim")}>{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Título editável no lugar: toque para renomear, Enter salva, Esc desiste. */
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
        className={cx("w-full rounded-sm bg-oak-950/60 px-2 outline-none shadow-[inset_0_0_0_1px_var(--color-brass-400),var(--ring)]", className)}
      />
    );
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={`${label}: toque para mudar`}
      className={cx("group -mx-1.5 inline-flex max-w-full items-center gap-2 rounded-sm px-1.5 text-left transition-colors hover:bg-cream/6", className)}
    >
      <span className={cx("min-w-0 truncate", !value && "text-cream-dim")}>{value || placeholder}</span>
      <Pencil aria-hidden="true" className="size-[0.45em] min-h-4 min-w-4 shrink-0 text-cream-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-60" />
    </button>
  );
}

// ------------------------------------------------------------------ estados
export function Spinner({ className, label = "carregando" }: { className?: string; label?: string }) {
  return <Loader2 aria-label={label} className={cx("size-5 animate-spin text-brass-300", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden="true" />;
}

export function EmptyState({ art, title, children, action }: { art: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="relative grid size-20 place-items-center text-brass-300">
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgb(235_198_116/0.18),transparent_68%)]" />
        <span className="relative">{art}</span>
      </div>
      <p className="font-display text-title-3 font-semibold text-cream">{title}</p>
      {children && <div className="max-w-md text-subhead text-cream-dim">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Meter({ value, tone = "brass", className, label }: { value: number | null; tone?: Tone; className?: string; label?: string }) {
  const color = {
    brass: "bg-[linear-gradient(180deg,var(--color-brass-200),var(--color-brass-400))]",
    ok: "bg-moss-400",
    warn: "bg-ember-400",
    bad: "bg-wine-400",
    info: "bg-verdigris-400",
    live: "bg-verdigris-400",
    neutral: "bg-cream-faint",
  }[tone];
  return (
    <div
      className={cx("well h-2 w-full overflow-hidden rounded-full", className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cx("h-full rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] transition-[width] duration-700 ease-spring", color, value === null && "w-1/3 animate-pulse")}
        style={value === null ? undefined : { width: `${Math.max(3, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-xs bg-oak-950/70 px-1.5 py-0.5 font-mono text-caption text-cream-dim shadow-[inset_0_0_0_1px_rgb(255_226_184/0.12)]">{children}</kbd>;
}

// ------------------------------------------------------------------ etapas
export type Step = { id: string; label: string; state: "done" | "now" | "todo" };

/** Indicador de etapas: feitas com visto, a atual em destaque; as já alcançadas podem ser revisitadas. */
export function StepIndicator({ steps, onSelect, current, className }: { steps: Step[]; onSelect?: (id: string) => void; current?: string; className?: string }) {
  const now = steps.findIndex((s) => s.state === "now");
  return (
    <nav aria-label="Etapas" className={cx("glass px-3 py-3 sm:px-4", className)}>
      <ol className="flex items-center">
        {steps.map((s, i) => {
          const reachable = s.state !== "todo" && !!onSelect;
          const viewing = current ? current === s.id : s.state === "now";
          return (
            <li key={s.id} className={cx("flex min-w-0 items-center", i < steps.length - 1 && "flex-1")}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onSelect?.(s.id)}
                aria-current={s.state === "now" ? "step" : undefined}
                className={cx("group flex min-h-11 min-w-0 items-center gap-2.5 rounded-full pr-2 text-left disabled:cursor-default", reachable && "hover:text-cream")}
              >
                <span
                  className={cx(
                    "tabular grid size-7 shrink-0 place-items-center rounded-full text-footnote font-semibold transition-shadow",
                    s.state === "done" && "bg-brass-400 text-ink-900 shadow-[inset_0_1px_0_rgb(255_250_235/0.5)]",
                    s.state === "now" && "bg-brass-300/14 text-brass-200 shadow-[inset_0_0_0_1.5px_var(--color-brass-300),0_0_0_5px_rgb(235_198_116/0.12)]",
                    s.state === "todo" && "bg-oak-950/45 text-cream-faint shadow-[inset_0_0_0_1px_rgb(255_226_184/0.12)]",
                    viewing && s.state === "done" && "shadow-[0_0_0_3px_rgb(235_198_116/0.35)]",
                  )}
                >
                  {s.state === "done" ? <Check className="size-4 [--icon-stroke:2.4]" /> : i + 1}
                </span>
                <span
                  className={cx(
                    "truncate text-subhead",
                    s.state === "now" ? "font-semibold text-cream" : s.state === "done" ? "text-cream-dim" : "text-cream-faint",
                    "max-sm:hidden",
                  )}
                >
                  {s.label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <span aria-hidden="true" className={cx("mx-1 h-px min-w-3 flex-1 sm:mx-2", i < now ? "bg-[linear-gradient(90deg,var(--color-brass-500),rgb(216_166_76/0.3))]" : "bg-cream/12")} />
              )}
            </li>
          );
        })}
      </ol>
      {/* no celular os nomes somem dos pontos; a etapa atual aparece por extenso embaixo */}
      {now >= 0 && (
        <p className="mt-1 px-1 text-footnote text-cream-dim sm:hidden">
          Etapa {now + 1} de {steps.length} · <span className="font-semibold text-cream">{steps.find((s) => s.id === current)?.label ?? steps[now].label}</span>
        </p>
      )}
    </nav>
  );
}
