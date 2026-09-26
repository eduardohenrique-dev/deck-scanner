import { Check, Handshake, Hourglass, Pencil, Repeat2 } from "lucide-react";
import { useState } from "react";
import { podResultProblem } from "../../tournament/engine.ts";
import { podOutcome } from "../../tournament/standings.ts";
import type { Player, Points, Pod, PodResult } from "../../tournament/types.ts";
import { Crown } from "../icons";
import { IdentityPips } from "../mtg";
import { Button, cx, Plate, Tag } from "../ui";

type Mode = "entry" | "survivors";

/**
 * Uma mesa do mesão: quem senta nela e como terminou. Lançar é um toque em "venceu" ao lado de quem
 * ganhou; sem vencedor no fim do tempo, marca quem ainda estava vivo (esses pontuam). Na final não há
 * tempo: em vez do empate, os finalistas podem dividir o prêmio.
 */
export default function PodCard({
  pod,
  players,
  points,
  scoring,
  final = false,
  repeats = 0,
  onResult,
  swap,
  title,
}: {
  pod: Pod;
  players: Map<string, Player>;
  /** pontos de cada um antes desta mesa */
  points?: Map<string, number>;
  scoring: Points;
  final?: boolean;
  /** pares desta mesa que já dividiram mesa antes */
  repeats?: number;
  onResult?: (result: PodResult | null) => void;
  swap?: { picked: string | null; onPick: (id: string) => void };
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>("entry");
  const [marked, setMarked] = useState<string[]>(pod.players);
  const result = pod.result;
  const entering = !!onResult && !swap && (!result || editing);
  const name = (id: string) => players.get(id)?.name ?? "?";

  function send(r: PodResult | null) {
    onResult?.(r);
    setEditing(false);
    setMode("entry");
    navigator.vibrate?.(8);
  }

  function startMarking() {
    const was = result && (result.kind === "draw" ? result.survivors : result.kind === "split" ? result.players : null);
    setMarked(was ?? pod.players);
    setMode("survivors");
  }

  const pending: PodResult = final ? { kind: "split", players: marked } : { kind: "draw", survivors: marked };
  const problem = mode === "survivors" ? podResultProblem(pending, pod.players, final) : null;
  const gained = (id: string) => {
    if (!result) return null;
    const o = podOutcome(result, id);
    if (result.kind === "split") return o === "win" ? "dividiu" : "—";
    return o === "win" ? `+${scoring.win}` : o === "draw" ? `+${scoring.draw}` : `${scoring.loss ? `+${scoring.loss}` : "0"}`;
  };

  return (
    <article className={cx("glass flex flex-col overflow-hidden", result && !editing && "shadow-[inset_0_0_0_1px_rgb(95_207_138/0.18),var(--shadow-raised)]")} aria-label={title ?? `Mesa ${pod.table}`}>
      <header className="flex items-center gap-3 px-4 pt-4 pb-2">
        <Plate>{final ? <Crown size={16} /> : pod.table}</Plate>
        <h3 className="text-headline font-semibold text-mist">{title ?? `Mesa ${pod.table}`}</h3>
        <span className="ml-auto flex items-center gap-2">
          {repeats > 0 && (
            <Tag tone="warn" title="Pares desta mesa que já jogaram juntos: com poucos jogadores é inevitável repetir">
              <Repeat2 className="size-3.5" /> {repeats === 1 ? "1 reencontro" : `${repeats} reencontros`}
            </Tag>
          )}
          {pod.manual && <Tag>Trocada</Tag>}
          {result && !editing ? (
            <Tag tone="ok">
              <Check className="size-3.5 [--icon-stroke:2.4]" /> Lançada
            </Tag>
          ) : (
            !repeats && !pod.manual && <span className="text-footnote text-mist-faint">{pod.players.length} jogadores</span>
          )}
        </span>
      </header>

      <ul className="px-1 pb-1">
        {pod.players.map((id) => {
          const p = players.get(id);
          const outcome = result && !editing ? podOutcome(result, id) : null;
          const on = marked.includes(id);
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className={cx("flex items-center gap-1.5 truncate text-headline font-semibold", outcome === "loss" ? "text-mist-dim" : "text-mist")}>
                  <span className="truncate">{p?.name ?? "?"}</span>
                  {outcome === "win" && <Crown size={16} className="shrink-0 text-arcane-300" aria-label="venceu" />}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-2 text-footnote text-mist-faint">
                  {p?.deck?.identity?.length ? <IdentityPips colors={p.deck.identity} size={13} /> : null}
                  <span className="truncate">{[p?.deck?.name, points?.get(id) !== undefined ? `${points.get(id)} pts` : null].filter(Boolean).join(" · ")}</span>
                </span>
              </span>
              {outcome && <span className={cx("tabular shrink-0 text-headline font-bold", outcome === "loss" ? "text-mist-faint" : outcome === "win" ? "text-arcane-200" : "text-mist")}>{gained(id)}</span>}
            </>
          );
          if (swap)
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => swap.onPick(id)}
                  aria-pressed={swap.picked === id}
                  className={cx("flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left transition-colors", swap.picked === id ? "bg-arcane-300/15 shadow-[inset_0_0_0_1.5px_var(--color-arcane-300)]" : "hover:bg-mist/5")}
                >
                  {body}
                </button>
              </li>
            );
          if (entering && mode === "survivors")
            return (
              <li key={id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => setMarked((m) => (on ? m.filter((x) => x !== id) : pod.players.filter((x) => x === id || m.includes(x))))}
                  className={cx("flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left transition-colors", on ? "bg-mist/6" : "opacity-60 hover:bg-mist/5")}
                >
                  <span className={cx("grid size-6 shrink-0 place-items-center rounded-full border-2", on ? "border-arcane-300 bg-arcane-400 text-ink-900" : "border-mist-faint")}>{on && <Check className="size-4 [--icon-stroke:3]" />}</span>
                  {body}
                </button>
              </li>
            );
          return (
            <li key={id} className="flex min-h-14 items-center gap-3 px-3">
              {body}
              {entering && (
                <Button size="sm" variant="tertiary" icon={<Crown size={15} />} onClick={() => send({ kind: "win", winner: id })} aria-label={`${name(id)} venceu`}>
                  Venceu
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {entering ? (
        <div className="mt-auto space-y-2 px-3 pt-1 pb-4">
          {mode === "survivors" ? (
            <>
              <p className="px-1 text-footnote text-mist-dim">
                {final ? "Marque quem divide o prêmio." : `Sem vencedor no fim do tempo: marque quem ainda estava vivo. Cada um leva ${scoring.draw} ${scoring.draw === 1 ? "ponto" : "pontos"}.`}
              </p>
              {problem && marked.length > 0 && <p className="px-1 text-footnote text-ember-300">{problem}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setMode("entry")}>
                  Voltar
                </Button>
                <Button size="sm" variant="primary" disabled={!!problem} onClick={() => send(pending)}>
                  {final ? `Dividir entre ${marked.length}` : `Empate: ${marked.length} ${marked.length === 1 ? "vivo" : "vivos"}`}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="ghost" icon={final ? <Handshake className="size-4" /> : <Hourglass className="size-4" />} onClick={startMarking}>
                {final ? "Dividir o prêmio" : "Empate no tempo"}
              </Button>
              {editing && (
                <div className="flex gap-1">
                  {result && (
                    <Button size="sm" variant="ghost" onClick={() => send(null)}>
                      Limpar
                    </Button>
                  )}
                  <Button size="sm" variant="tertiary" onClick={() => setEditing(false)}>
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        result &&
        onResult &&
        !swap && (
          <div className="mt-auto flex items-center justify-between gap-3 px-4 pt-1 pb-3">
            <span className="min-w-0 text-footnote text-mist-faint">
              {result.kind === "win" ? `${name(result.winner)} venceu` : result.kind === "draw" ? `Empate no tempo · ${result.survivors.length} vivos pontuam` : `Prêmio dividido entre ${result.players.length}`}
            </span>
            <Button size="sm" variant="tertiary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Editar
            </Button>
          </div>
        )
      )}
    </article>
  );
}
