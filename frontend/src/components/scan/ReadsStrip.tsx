import { Check, HelpCircle, Loader2, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { cardName } from "../../lib/format";
import { Seal, type Tone } from "../ui";
import type { ReadItem } from "./useScanner";

function describe(r: ReadItem): { label: string; tone: Tone; icon: ReactNode } {
  if (r.status === "sending") return { label: "lendo…", tone: "neutral", icon: <Loader2 className="size-3 animate-spin" /> };
  if (r.status === "failed") return { label: "não enviada", tone: "bad", icon: <X className="size-3" /> };
  const d = r.detection!;
  switch (d.status) {
    case "identified":
      return { label: cardName(d.card), tone: "ok", icon: <Check className="size-3" strokeWidth={3} /> };
    case "unidentified":
      return { label: "não reconhecida", tone: "warn", icon: <HelpCircle className="size-3" strokeWidth={2.5} /> };
    case "back":
      return { label: "verso", tone: "info", icon: <RotateCcw className="size-3" /> };
    case "token":
      return { label: "token", tone: "info", icon: "T" };
    default:
      return { label: "descartada", tone: "neutral", icon: <X className="size-3" /> };
  }
}

/** Fita com as últimas cartas lidas (a leitura repetida da mesma carta some da fita). */
export default function ReadsStrip({ reads, className }: { reads: ReadItem[]; className?: string }) {
  const visible = reads.filter((r) => !r.merged && !r.replaced && r.detection?.status !== "noise");
  if (!visible.length) return null;
  return (
    <div className={className}>
      <p className="mb-1.5 text-[13px] text-cream-faint">últimas leituras</p>
      <ol className="scrollbar-thin flex gap-2.5 overflow-x-auto pt-1.5 pr-1 pb-1" aria-live="polite">
        {visible.map((r) => {
          const d = describe(r);
          return (
            <li key={r.key} className="animate-rise w-[74px] shrink-0">
              <div className="relative">
                <img src={r.preview} alt="" className="card-img aspect-[488/680] w-full border border-oak-600 object-cover" />
                <Seal size={22} tone={d.tone} className="animate-stamp absolute -top-1.5 -right-1.5">
                  {d.icon}
                </Seal>
              </div>
              <p className="mt-1 truncate text-[12px] leading-tight text-cream-dim" title={d.label}>
                {d.label}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
