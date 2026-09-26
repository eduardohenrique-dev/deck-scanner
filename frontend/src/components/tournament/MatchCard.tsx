import { Check, Pencil, Repeat2 } from "lucide-react";
import { useState } from "react";
import { outcomeFor } from "../../tournament/standings.ts";
import type { Match, Player, Score } from "../../tournament/types.ts";
import { scoreProblem } from "../../tournament/engine.ts";
import { Tankard } from "../icons";
import { IdentityPips } from "../mtg";
import { Button, cx, Modal, Plate, Stepper, Tag } from "../ui";
import { firstName } from "./labels";

type QuickScore = { label: string; score: Score; hint: string };

/** Placar de um toque: orientado da esquerda (jogador A) para a direita (jogador B). */
export function quickScores(bestOf: 1 | 3, a: string, b: string, allowDraw: boolean): QuickScore[] {
  if (bestOf === 1) {
    const list: QuickScore[] = [
      { label: `${firstName(a)} venceu`, score: { a: 1, b: 0, draws: 0 }, hint: `${a} venceu` },
      { label: "Empate", score: { a: 0, b: 0, draws: 1 }, hint: "Empate" },
      { label: `${firstName(b)} venceu`, score: { a: 0, b: 1, draws: 0 }, hint: `${b} venceu` },
    ];
    return allowDraw ? list : [list[0], list[2]];
  }
  const list: QuickScore[] = [
    { label: "2–0", score: { a: 2, b: 0, draws: 0 }, hint: `${a} venceu por 2 a 0` },
    { label: "2–1", score: { a: 2, b: 1, draws: 0 }, hint: `${a} venceu por 2 a 1` },
    { label: "Empate", score: { a: 1, b: 1, draws: 0 }, hint: "Empate (1 a 1)" },
    { label: "1–2", score: { a: 1, b: 2, draws: 0 }, hint: `${b} venceu por 2 a 1` },
    { label: "0–2", score: { a: 0, b: 2, draws: 0 }, hint: `${b} venceu por 2 a 0` },
  ];
  return allowDraw ? list : list.filter((q) => q.label !== "Empate");
}

const same = (x: Score | null, y: Score) => !!x && x.a === y.a && x.b === y.b && x.draws === y.draws;

export function scoreLabel(s: Score) {
  return s.draws ? `${s.a}–${s.b}–${s.draws}` : `${s.a}–${s.b}`;
}

function Side({ player, points, won, lost, picked, onPick }: { player: Player | undefined; points?: number; won: boolean; lost: boolean; picked: boolean; onPick?: () => void }) {
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cx("flex items-center gap-1.5 truncate text-headline font-semibold", won ? "text-mist" : lost ? "text-mist-dim" : "text-mist")}>
          <span className="truncate">{player?.name ?? "?"}</span>
          {won && <Check className="size-4 shrink-0 text-moss-300 [--icon-stroke:2.4]" aria-label="venceu" />}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-footnote text-mist-faint">
          {player?.deck?.identity?.length ? <IdentityPips colors={player.deck.identity} size={13} /> : null}
          <span className="truncate">{[player?.deck?.name, points !== undefined ? `${points} pts` : null].filter(Boolean).join(" · ")}</span>
        </span>
      </span>
    </>
  );
  if (onPick)
    return (
      <button
        type="button"
        onClick={onPick}
        aria-pressed={picked}
        className={cx("flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left transition-colors", picked ? "bg-arcane-300/15 shadow-[inset_0_0_0_1.5px_var(--color-arcane-300)]" : "hover:bg-mist/5")}
      >
        {content}
      </button>
    );
  return <div className={cx("flex min-h-14 items-center gap-3 px-3", lost && "opacity-60")}>{content}</div>;
}

/** Uma mesa da rodada: quem joga com quem, o placar em um toque e o estado (aguardando, lançada, folga). */
export default function MatchCard({
  match,
  players,
  points,
  bestOf,
  onScore,
  rematch,
  swap,
}: {
  match: Match;
  players: Map<string, Player>;
  points?: Map<string, number>;
  bestOf: 1 | 3;
  onScore?: (score: Score | null) => void;
  rematch?: boolean;
  /** modo de troca manual: toque em dois jogadores para trocá-los de mesa */
  swap?: { picked: string | null; onPick: (id: string) => void };
}) {
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState(false);
  const a = players.get(match.a);
  const b = match.b ? players.get(match.b) : undefined;

  if (match.b === null)
    return (
      <article className="glass flex flex-col p-4">
        <header className="flex items-center gap-3">
          <Plate muted>—</Plate>
          <h3 className="text-headline font-semibold text-mist">Folga</h3>
          <Tag tone="ok" className="ml-auto">
            Vitória 2–0
          </Tag>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
          <Tankard size={28} className="text-arcane-300" />
          {swap ? (
            <Side player={a} won={false} lost={false} picked={swap.picked === match.a} onPick={() => swap.onPick(match.a)} />
          ) : (
            <p className="text-headline font-semibold text-mist">{a?.name}</p>
          )}
          <p className="max-w-60 text-footnote text-mist-faint">Sem adversário nesta rodada: conta como vitória por 2 a 0.</p>
        </div>
      </article>
    );

  const result = match.result;
  const outcome = result ? outcomeFor(result, "a") : null;
  const showChips = !!onScore && !swap && (!result || editing);
  const quick = quickScores(bestOf, a?.name ?? "A", b?.name ?? "B", true);

  function pick(score: Score | null) {
    onScore?.(score);
    setEditing(false);
    navigator.vibrate?.(8);
  }

  return (
    <article className={cx("glass flex flex-col overflow-hidden", result && !editing && "shadow-[inset_0_0_0_1px_rgb(95_207_138/0.18),var(--shadow-raised)]")} aria-label={`Mesa ${match.table}`}>
      <header className="flex items-center gap-3 px-4 pt-4 pb-2">
        <Plate>{match.table}</Plate>
        <h3 className="text-headline font-semibold text-mist">Mesa {match.table}</h3>
        <span className="ml-auto flex items-center gap-2">
          {rematch && (
            <Tag tone="warn" title="Os dois já se enfrentaram: não havia outro emparelhamento possível">
              <Repeat2 className="size-3.5" /> Revanche
            </Tag>
          )}
          {match.manual && <Tag>Trocada</Tag>}
          {result && !editing ? (
            <Tag tone="ok">
              <Check className="size-3.5 [--icon-stroke:2.4]" /> Lançada
            </Tag>
          ) : (
            !rematch && !match.manual && <span className="text-footnote text-mist-faint">Aguardando placar</span>
          )}
        </span>
      </header>

      <div className="px-1">
        <div className="flex items-center">
          <div className="min-w-0 flex-1">
            <Side player={a} points={points?.get(match.a)} won={outcome === "win" && !editing} lost={outcome === "loss" && !editing} picked={swap?.picked === match.a} onPick={swap ? () => swap.onPick(match.a) : undefined} />
          </div>
          {result && !editing && <span className={cx("tabular w-10 pr-3 text-right text-title-2 font-bold", outcome === "win" ? "text-mist" : "text-mist-faint")}>{result.a}</span>}
        </div>
        <div className="flex items-center gap-3 px-3 py-0.5 text-caption font-semibold tracking-[0.1em] text-mist-faint uppercase" aria-hidden="true">
          <span className="h-px flex-1 bg-mist/8" /> contra <span className="h-px flex-1 bg-mist/8" />
        </div>
        <div className="flex items-center">
          <div className="min-w-0 flex-1">
            <Side player={b} points={points?.get(match.b)} won={outcome === "loss" && !editing} lost={outcome === "win" && !editing} picked={swap?.picked === match.b} onPick={swap ? () => swap.onPick(match.b!) : undefined} />
          </div>
          {result && !editing && <span className={cx("tabular w-10 pr-3 text-right text-title-2 font-bold", outcome === "loss" ? "text-mist" : "text-mist-faint")}>{result.b}</span>}
        </div>
      </div>

      {showChips ? (
        <div className="mt-auto px-3 pt-3 pb-4">
          <div className="mb-2 flex justify-between px-1 text-caption text-mist-faint" aria-hidden="true">
            <span>← {firstName(a?.name ?? "A")}</span>
            <span>{firstName(b?.name ?? "B")} →</span>
          </div>
          <div className={cx("grid gap-1.5", bestOf === 3 ? "grid-cols-5" : "grid-cols-3")} role="group" aria-label={`Placar da mesa ${match.table}`}>
            {quick.map((q) => (
              <button key={q.label} type="button" className={cx("chip num px-1", (bestOf === 1 || q.label === "Empate") && "text-footnote")} aria-pressed={same(result, q.score)} title={q.hint} aria-label={q.hint} onClick={() => pick(q.score)}>
                <span className="truncate">{q.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={() => setCustom(true)}>
              Outro placar
            </Button>
            {editing && (
              <div className="flex gap-1">
                {result && (
                  <Button size="sm" variant="ghost" onClick={() => pick(null)}>
                    Limpar
                  </Button>
                )}
                <Button size="sm" variant="tertiary" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        result &&
        onScore &&
        !swap && (
          <div className="mt-auto flex items-center justify-between px-4 pt-2 pb-3">
            <span className="text-footnote text-mist-faint">{outcome === "draw" ? `Empate · ${scoreLabel(result)}` : `${outcome === "win" ? a?.name : b?.name} venceu · ${scoreLabel(outcome === "win" ? result : { a: result.b, b: result.a, draws: result.draws })}`}</span>
            <Button size="sm" variant="tertiary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Editar
            </Button>
          </div>
        )
      )}
      {custom && <ScoreSheet a={a?.name ?? "A"} b={b?.name ?? "B"} bestOf={bestOf} allowDraw initial={result} onClose={() => setCustom(false)} onSave={(s) => (pick(s), setCustom(false))} />}
    </article>
  );
}

/** Placar detalhado: games de cada lado e empatados (ex.: 1–0–1, ou 0–0–3 num empate combinado). */
export function ScoreSheet({
  a,
  b,
  bestOf,
  allowDraw,
  initial,
  onClose,
  onSave,
}: {
  a: string;
  b: string;
  bestOf: 1 | 3;
  allowDraw: boolean;
  initial: Score | null;
  onClose: () => void;
  onSave: (s: Score) => void;
}) {
  const [s, setS] = useState<Score>(initial ?? { a: 0, b: 0, draws: 0 });
  const problem = scoreProblem(s, bestOf, allowDraw);
  const need = bestOf === 3 ? 2 : 1;
  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title="Outro placar"
      description={`Melhor de ${bestOf}: conte os games de cada um e os empatados.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!!problem} onClick={() => onSave(s)}>
            Lançar placar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {[
          { key: "a" as const, label: a, max: need },
          { key: "b" as const, label: b, max: need },
          { key: "draws" as const, label: "Games empatados", max: 3 },
        ].map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <span className="min-w-0 truncate text-headline text-mist">{row.label}</span>
            <Stepper value={s[row.key]} max={row.max} label={row.label} onChange={(v) => setS((x) => ({ ...x, [row.key]: v }))} />
          </div>
        ))}
        {problem && s.a + s.b + s.draws > 0 && <p className="text-footnote text-ember-300">{problem}</p>}
      </div>
    </Modal>
  );
}
