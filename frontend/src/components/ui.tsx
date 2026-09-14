import { Loader2, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { confidenceTone } from "../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  icon,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; busy?: boolean; icon?: ReactNode }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent select-none";
  const sizes = { sm: "h-8 px-2.5 text-[13px]", md: "h-10 px-3.5 text-sm", lg: "h-12 px-5 text-[15px]" };
  const variants: Record<Variant, string> = {
    primary: "bg-accent text-accent-ink hover:bg-accent-strong",
    secondary: "bg-panel-2 text-text border border-line hover:bg-panel-3",
    ghost: "text-muted hover:text-text hover:bg-panel-2",
    danger: "bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Chip({ tone = "neutral", children, className = "" }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "accent"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-panel-3 text-muted",
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
    info: "bg-info/15 text-info",
    accent: "bg-accent/15 text-accent",
  };
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium ${tones[tone]} ${className}`}>{children}</span>;
}

export function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  const tone = confidenceTone(value);
  if (tone === "none") return <Chip>manual</Chip>;
  return (
    <Chip tone={tone} className="font-mono">
      {Math.round((value ?? 0) * 100)}%
    </Chip>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`size-4 animate-spin text-muted ${className}`} />;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        className={`animate-pop flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-panel sm:rounded-2xl ${wide ? "sm:max-w-5xl" : "sm:max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-panel-2 hover:text-text" aria-label="Fechar">
            <X className="size-5" />
          </button>
        </div>
        <div className="scrollbar-thin overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

const MANA_CLASS: Record<string, string> = {
  W: "bg-mana-w text-black",
  U: "bg-mana-u text-black",
  B: "bg-mana-b text-black",
  R: "bg-mana-r text-black",
  G: "bg-mana-g text-black",
  C: "bg-mana-c text-black",
};

export function ManaCost({ cost, className = "" }: { cost: string | null | undefined; className?: string }) {
  if (!cost) return null;
  const symbols = cost.match(/\{[^}]+\}|\/\//g) ?? [];
  return (
    <span className={`inline-flex flex-wrap items-center gap-0.5 ${className}`}>
      {symbols.map((s, i) => {
        if (s === "//") return <span key={i} className="px-0.5 text-faint">/</span>;
        const sym = s.slice(1, -1);
        const color = sym.split("/").find((p) => MANA_CLASS[p]);
        return (
          <span
            key={i}
            className={`inline-flex size-[18px] items-center justify-center rounded-full text-[10px] font-bold leading-none ${color ? MANA_CLASS[color] : "bg-panel-3 text-text"}`}
            title={sym}
          >
            {sym.length > 2 ? sym[0] : sym}
          </span>
        );
      })}
    </span>
  );
}

export function IdentityPips({ colors }: { colors: string[] }) {
  if (!colors.length) return <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-mana-c text-[10px] font-bold text-black">C</span>;
  return (
    <span className="inline-flex gap-0.5">
      {colors.map((c) => (
        <span key={c} className={`inline-flex size-[18px] items-center justify-center rounded-full text-[10px] font-bold ${MANA_CLASS[c] ?? "bg-panel-3"}`}>
          {c}
        </span>
      ))}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <div className="text-faint">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ProgressBar({ value, className = "" }: { value: number | null; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-panel-3 ${className}`}>
      <div
        className={`h-full rounded-full bg-accent transition-[width] duration-300 ${value === null ? "w-1/3 animate-pulse" : ""}`}
        style={value === null ? undefined : { width: `${Math.max(2, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}
