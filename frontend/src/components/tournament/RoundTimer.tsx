import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { remainingMs } from "../../tournament/engine.ts";
import type { Round } from "../../tournament/types.ts";
import { cx, IconButton } from "../ui";

export function clock(ms: number) {
  const total = Math.ceil(Math.abs(ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${ms < 0 ? "+" : ""}${m}:${String(s).padStart(2, "0")}`;
}

/** Re-renderiza a cada segundo enquanto o relógio corre. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** Relógio da rodada: anel que esvazia, pausa e retoma; passado o tempo, conta em brasa o acréscimo. */
export default function RoundTimer({
  round,
  minutes,
  onAction,
  size = "md",
  overNote = "Tempo esgotado",
}: {
  round: Round;
  minutes: number | null;
  onAction?: (action: "start" | "pause" | "resume" | "reset") => void;
  size?: "md" | "xl";
  /** o que dizer quando o tempo acaba (no mesão: os turnos extras) */
  overNote?: string;
}) {
  const running = !!round.timer.startedAt && !round.timer.pausedAt;
  const now = useNow(running);
  const left = remainingMs(round, minutes, now);
  const buzzed = useRef(false);
  useEffect(() => {
    if (left !== null && left <= 0 && running && !buzzed.current) {
      buzzed.current = true;
      navigator.vibrate?.([120, 80, 120]);
    }
    if (left !== null && left > 0) buzzed.current = false;
  }, [left, running]);
  if (!minutes) return null;

  const total = minutes * 60_000;
  const share = left === null ? 1 : Math.max(0, Math.min(1, left / total));
  const over = left !== null && left < 0;
  const big = size === "xl";
  const R = big ? 54 : 19;
  const stroke = big ? 8 : 4;
  const box = (R + stroke) * 2;
  const circ = 2 * Math.PI * R;

  return (
    <div className={cx("flex items-center", big ? "gap-6" : "gap-3")}>
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true" className="shrink-0">
        <circle cx={box / 2} cy={box / 2} r={R} fill="none" stroke="rgb(255 226 184 / 0.1)" strokeWidth={stroke} />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={R}
          fill="none"
          stroke={over ? "var(--color-ember-400)" : "var(--color-verdigris-300)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={over ? 0 : circ * (1 - share)}
          transform={`rotate(-90 ${box / 2} ${box / 2})`}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <div className="min-w-0">
        <p className={cx("tabular font-semibold tracking-[-0.02em]", big ? "text-[5rem] leading-none" : "text-title-2", over ? "text-ember-300" : "text-cream")} role="timer" aria-live="off">
          {left === null ? `${minutes}:00` : clock(left)}
        </p>
        <p className={cx(big ? "mt-2 text-title-3" : "text-caption", over ? "text-ember-300" : "text-cream-faint")}>
          {left === null ? `${minutes} min · parado` : over ? overNote : round.timer.pausedAt ? "Pausado" : `de ${minutes} min`}
        </p>
      </div>
      {onAction && (
        <div className="flex items-center gap-1">
          {!round.timer.startedAt ? (
            <IconButton label="Iniciar o relógio" variant="secondary" onClick={() => onAction("start")}>
              <Play className="size-4 fill-current" />
            </IconButton>
          ) : round.timer.pausedAt ? (
            <IconButton label="Retomar o relógio" variant="secondary" onClick={() => onAction("resume")}>
              <Play className="size-4 fill-current" />
            </IconButton>
          ) : (
            <IconButton label="Pausar o relógio" variant="secondary" onClick={() => onAction("pause")}>
              <Pause className="size-4 fill-current" />
            </IconButton>
          )}
          {round.timer.startedAt && (
            <IconButton label="Zerar o relógio" onClick={() => onAction("reset")}>
              <RotateCcw className="size-4" />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
