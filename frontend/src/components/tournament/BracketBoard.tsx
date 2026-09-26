import { useLayoutEffect, useRef, useState } from "react";
import { roundName } from "../../tournament/bracket.ts";
import type { BracketSlot, BracketView, Player, Score, Seat } from "../../tournament/types.ts";
import { Crown } from "../icons";
import { IdentityPips } from "../mtg";
import { Button, cx, Modal, Segmented } from "../ui";
import { quickScores, ScoreSheet, scoreLabel } from "./MatchCard";

const BOUNCE =
  "linear(0, 0.112 4.2%, 0.359 8.3%, 0.634 12.5%, 0.869 16.7%, 1.032 20.8%, 1.121 25%, 1.148 29.2%, 1.133 33.3%, 1.097 37.5%, 1.056 41.7%, 1.021 45.8%, 0.996 50%, 0.983 54.2%, 0.978 58.3%, 0.98 62.5%, 0.985 66.7%, 0.991 70.8%, 0.997 75%, 1 79.2%, 1.002 83.3%, 1.003 87.5%, 1.003 91.7%, 1.002 95.8%, 1)";

type Props = {
  view: BracketView;
  players: Map<string, Player>;
  bestOf: 1 | 3;
  onScore?: (key: string, score: Score | null) => void;
  /** acabou de sortear: as cartas dos classificados voam do centro para os lugares */
  deal?: boolean;
  onDealt?: () => void;
  large?: boolean;
};

/** A chave inteira: colunas por fase com as linhas ligando cada par; no celular, uma fase por vez. */
export default function BracketBoard(props: Props) {
  const { view } = props;
  const [phase, setPhase] = useState(() => String(Math.max(0, view.rounds.findIndex((r) => r.some((s) => !s.bye && !s.winner)))));
  return (
    <>
      <div className="max-lg:hidden">
        <Columns {...props} />
      </div>
      <div className="space-y-4 lg:hidden">
        {view.rounds.length > 1 && (
          <Segmented
            size="sm"
            value={phase}
            onChange={setPhase}
            className="w-full"
            options={view.rounds.map((r, i) => ({ value: String(i), label: roundName(r.length, i).replace(" de final", "") }))}
          />
        )}
        <div className="space-y-3">
          {view.rounds[Number(phase)]?.map((slot) => (
            <SlotCard key={slot.key} slot={slot} {...props} />
          ))}
        </div>
      </div>
    </>
  );
}

function Columns(props: Props) {
  const { view, deal, onDealt, large } = props;
  const board = useRef<HTMLDivElement>(null);

  // sorteio: cada seat parte do centro da chave, girando, e assenta com mola (FLIP)
  useLayoutEffect(() => {
    if (!deal || !board.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seats = [...board.current.querySelectorAll<HTMLElement>("[data-seat]")];
    if (reduce || !seats.length) {
      onDealt?.();
      return;
    }
    const box = board.current.getBoundingClientRect();
    const cx0 = box.left + box.width / 2;
    const cy0 = box.top + box.height / 2;
    let last: Animation | null = null;
    seats.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dx = cx0 - (r.left + r.width / 2);
      const dy = cy0 - (r.top + r.height / 2);
      const spin = ((i * 37) % 24) - 12;
      last = el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(0.7)`, opacity: 0 },
          { transform: `translate(${dx * 0.9}px, ${dy * 0.9}px) rotate(${-spin}deg) scale(0.85)`, opacity: 1, offset: 0.25 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 900, delay: 250 + i * 70, easing: BOUNCE, fill: "backwards" },
      );
    });
    if (last) (last as Animation).onfinish = () => onDealt?.();
  }, [deal, onDealt]);

  const h = large ? 104 : 92;
  const height = (view.size / 2) * (h + 20);
  return (
    <div ref={board} className="scrollbar-thin overflow-x-auto pb-2">
      <div className="flex min-w-max gap-10" style={{ height }}>
        {view.rounds.map((round, r) => (
          <div key={r} className="flex w-64 flex-col">
            <p className="eyebrow mb-3 h-4">{roundName(round.length, r)}</p>
            <div className="flex flex-1 flex-col">
              {round.map((slot, i) => (
                <div key={slot.key} className="relative flex flex-1 items-center">
                  {/* ligações: saída para a direita e, a cada par, a haste vertical até o do lado */}
                  {r < view.rounds.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={cx("absolute -right-5 w-5 border-mist/15", i % 2 === 0 ? "top-1/2 h-1/2 rounded-tr-md border-t border-r" : "bottom-1/2 h-1/2 rounded-br-md border-r border-b")}
                    />
                  )}
                  {r > 0 && <span aria-hidden="true" className="absolute top-1/2 -left-5 w-5 border-t border-mist/15" />}
                  <div className="w-full">
                    <SlotCard slot={slot} {...props} compact />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="flex w-56 flex-col justify-center pt-7">
          <ChampionPlate id={view.champion} players={props.players} />
        </div>
      </div>
    </div>
  );
}

function ChampionPlate({ id, players }: { id: string | null; players: Map<string, Player> }) {
  const p = id ? players.get(id) : null;
  return (
    <div
      className={cx(
        "rounded-lg p-5 text-center transition-[box-shadow,background] duration-700",
        p
          ? "animate-pop bg-[radial-gradient(120%_90%_at_50%_0%,rgb(185_164_255/0.3),transparent_70%),var(--gloss),rgb(27_21_66/0.6)] shadow-[inset_0_1px_0_rgb(230_225_255/0.25),inset_0_0_0_1px_rgb(185_164_255/0.4),0_20px_50px_-20px_rgb(140_110_245/0.5)]"
          : "well",
      )}
    >
      <Crown size={34} className={cx("mx-auto", p ? "text-arcane-300 drop-shadow-[0_2px_8px_rgb(185_164_255/0.5)]" : "text-mist-faint")} />
      <p className={cx("eyebrow mt-1", p && "text-arcane-300")}>{p ? "Campeão" : "A definir"}</p>
      <p className={cx("mt-1 font-display text-title-2 font-semibold", p ? "text-mist" : "text-mist-faint")}>{p?.name ?? "—"}</p>
      {p?.deck?.name && <p className="mt-0.5 truncate text-footnote text-mist-dim">{p.deck.name}</p>}
    </div>
  );
}

function SlotCard({ slot, players, bestOf, onScore, compact }: Props & { slot: BracketSlot; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ready = !!slot.a && !!slot.b && !slot.bye;
  const clickable = ready && !!onScore;
  const seat = (s: Seat | null, side: "a" | "b") => {
    const p = s ? players.get(s.playerId) : null;
    const won = !!slot.winner && s?.playerId === slot.winner;
    const lost = !!slot.winner && !!s && s.playerId !== slot.winner;
    const games = slot.result ? (side === "a" ? slot.result.score.a : slot.result.score.b) : null;
    return (
      <div
        data-seat={s ? "" : undefined}
        className={cx(
          "flex items-center gap-2.5 rounded-sm px-3",
          compact ? "h-10" : "h-12",
          won && "bg-arcane-300/10 shadow-[inset_2px_0_0_var(--color-arcane-300)]",
          lost && "opacity-55",
        )}
      >
        <span className="tabular w-5 text-center text-caption font-semibold text-mist-faint">{s?.seed ?? ""}</span>
        <span className={cx("min-w-0 flex-1 truncate text-subhead", s ? (won ? "font-semibold text-mist" : "text-mist-dim") : "text-mist-faint italic")}>
          {p?.name ?? (slot.bye ? "Folga" : "A definir")}
        </span>
        {p?.deck?.identity?.length ? <IdentityPips colors={p.deck.identity} size={12} /> : null}
        {games !== null && <span className={cx("tabular w-4 text-right font-bold", won ? "text-arcane-200" : "text-mist-faint")}>{games}</span>}
      </div>
    );
  };
  const body = (
    <>
      {seat(slot.a, "a")}
      {seat(slot.b, "b")}
    </>
  );
  return (
    <>
      {clickable ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cx("well block w-full p-1 text-left transition-[box-shadow] duration-200 hover:shadow-[inset_0_0_0_1px_rgb(185_164_255/0.45)]", !slot.result && "shadow-[inset_0_0_0_1px_rgb(185_164_255/0.25)]")}
          aria-label={`Lançar placar: ${players.get(slot.a!.playerId)?.name} contra ${players.get(slot.b!.playerId)?.name}`}
        >
          {body}
        </button>
      ) : (
        <div className="well p-1">{body}</div>
      )}
      {open && slot.a && slot.b && onScore && (
        <BracketScore slot={slot} a={players.get(slot.a.playerId)?.name ?? "A"} b={players.get(slot.b.playerId)?.name ?? "B"} bestOf={bestOf} onClose={() => setOpen(false)} onScore={(s) => (onScore(slot.key, s), setOpen(false))} />
      )}
    </>
  );
}

function BracketScore({ slot, a, b, bestOf, onClose, onScore }: { slot: BracketSlot; a: string; b: string; bestOf: 1 | 3; onClose: () => void; onScore: (s: Score | null) => void }) {
  const [custom, setCustom] = useState(false);
  const quick = quickScores(bestOf, a, b, false);
  if (custom) return <ScoreSheet a={a} b={b} bestOf={bestOf} allowDraw={false} initial={slot.result?.score ?? null} onClose={() => setCustom(false)} onSave={onScore} />;
  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={`${a} × ${b}`}
      description={slot.result ? `Placar lançado: ${scoreLabel(slot.result.score)}. Trocar o vencedor desfaz as partidas seguintes que dependiam dele.` : "Toque no placar. No mata-mata não existe empate."}
      footer={
        <>
          {slot.result && (
            <Button variant="ghost" onClick={() => onScore(null)}>
              Limpar placar
            </Button>
          )}
          <Button variant="ghost" onClick={() => setCustom(true)}>
            Outro placar
          </Button>
        </>
      }
    >
      <div className="mb-2 flex justify-between px-1 text-caption text-mist-faint" aria-hidden="true">
        <span>← {a}</span>
        <span>{b} →</span>
      </div>
      <div className={cx("grid gap-2", quick.length === 4 ? "grid-cols-4" : "grid-cols-2")}>
        {quick.map((q) => (
          <button key={q.label} type="button" className="chip num min-h-12" title={q.hint} aria-label={q.hint} onClick={() => onScore(q.score)}>
            {q.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
