import { Check } from "lucide-react";
import { useId, useMemo, type ReactNode } from "react";
import { useResource } from "../../lib/hooks";
import { api } from "../../lib/api";
import { cutOf, isDraft, listPt, plannedRounds } from "../../tournament/engine.ts";
import { suggestRounds } from "../../tournament/pairing.ts";
import { podSizes, suggestPodRounds } from "../../tournament/pods.ts";
import type { Settings, Structure, Tournament } from "../../tournament/types.ts";
import { Board, cx, Field, Input, Segmented, Stepper, Switch, Textarea } from "../ui";
import { choiceOf, STRUCTURES, type StructureChoice } from "./labels";
import type { Dispatch } from "./useTournament";

function structureFor(choice: StructureChoice, current: Structure): Structure {
  // o número de rodadas escolhido para o suíço vale para o mesão e vice-versa (0 = sugestão)
  const rounds = current.kind === "swiss" || current.kind === "pods" ? current.rounds : 0;
  const cut = cutOf(current) ?? 8;
  switch (choice) {
    case "swiss":
      return { kind: "swiss", rounds, cut: null };
    case "swiss-cut":
      return { kind: "swiss", rounds, cut };
    case "round-robin":
      return { kind: "round-robin", cut: null };
    case "single-elimination":
      return { kind: "single-elimination" };
    case "pods":
      return { kind: "pods", rounds };
  }
}

/** "2 mesas de 4" · "1 mesa de 4 e 2 de 3". */
export function podsLine(n: number): string {
  const sizes = podSizes(n);
  if (!sizes.length) return "";
  const count = (size: number) => sizes.filter((s) => s === size).length;
  const parts = [5, 4, 3, 2]
    .filter((size) => count(size))
    .map((size, i) => (i === 0 ? `${count(size)} ${count(size) === 1 ? "mesa" : "mesas"} de ${size}` : `${count(size)} de ${size}`));
  return listPt(parts);
}

function Card({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <Board className="space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="font-display text-title-3 font-semibold text-cream">{title}</h2>
        {text && <p className="mt-1 text-subhead text-cream-dim">{text}</p>}
      </div>
      {children}
    </Board>
  );
}

/** Configurar: estrutura, partidas, pontuação, relógio e os dados do evento. */
export default function SetupStage({ t, dispatch }: { t: Tournament; dispatch: Dispatch }) {
  const draft = isDraft(t);
  const s = t.structure;
  const choice = choiceOf(s);
  const n = t.players.length;
  const games = useResource(() => api.games(), []);
  const formats = useMemo(() => (games.data?.find((g) => g.id === "mtg")?.formats ?? []).filter((f) => f.id !== "collection").map((f) => f.name), [games.data]);
  const listId = useId();
  const setSettings = (settings: Partial<Settings>) => dispatch({ type: "setSettings", settings });
  const setStructure = (structure: Structure) => dispatch({ type: "setStructure", structure });
  const pods = s.kind === "pods";
  const cut = cutOf(s);
  const suggested = s.kind === "swiss" ? suggestRounds(Math.max(n, 2), s.cut) : pods ? suggestPodRounds(Math.max(n, 3)) : 0;
  function choose(id: StructureChoice) {
    setStructure(structureFor(id, s));
    // a partida de mesão é longa: começa com 1 hora (dá para mudar logo abaixo)
    if (id === "pods" && t.settings.roundMinutes === 50) setSettings({ roundMinutes: 60 });
    if (id !== "pods" && s.kind === "pods" && t.settings.roundMinutes === 60) setSettings({ roundMinutes: 50 });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card title="Estrutura" text={draft ? "Dá para mudar até o torneio começar." : "A estrutura ficou fixa quando o torneio começou."}>
          <div role="radiogroup" aria-label="Estrutura do torneio" className="grid gap-3 sm:grid-cols-2">
            {STRUCTURES.map((o) => {
              const on = choice === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!draft && !on}
                  onClick={() => choose(o.id)}
                  className={cx(
                    "well relative flex min-h-24 flex-col items-start gap-1 px-4 py-4 text-left transition-[box-shadow,transform] duration-500 ease-spring active:scale-[0.98] active:duration-100 disabled:opacity-40",
                    on && "bg-brass-300/8 shadow-[inset_0_0_0_1.5px_var(--color-brass-400),0_10px_24px_-14px_rgb(216_166_76/0.5)]",
                  )}
                >
                  <span className={cx("text-headline font-semibold", on ? "text-brass-100" : "text-cream")}>{o.title}</span>
                  <span className="pr-6 text-footnote text-cream-dim">{o.text}</span>
                  {on && (
                    <span aria-hidden="true" className="animate-pop absolute top-3 right-3 grid size-6 place-items-center rounded-full bg-brass-400 text-ink-900">
                      <Check className="size-4 [--icon-stroke:2.4]" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {s.kind === "swiss" && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-footnote font-medium text-cream-dim">Rodadas</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Stepper value={s.rounds || suggested} min={Math.max(1, t.rounds.length)} max={20} label="Rodadas do suíço" onChange={(v) => setStructure({ ...s, rounds: v })} />
                  {s.rounds !== 0 && s.rounds !== suggested && n >= 2 && draft && (
                    <button type="button" className="text-footnote font-semibold text-brass-300 hover:underline" onClick={() => setStructure({ ...s, rounds: 0 })}>
                      Usar a sugestão ({suggested})
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-footnote text-cream-faint">
                  {s.rounds === 0 ? `Automático: ${suggested} para ${Math.max(n, 2)} jogadores, pela tabela da MTR.` : `A tabela da MTR sugere ${suggested} para ${Math.max(n, 2)} jogadores.`}
                </p>
              </div>
              {s.cut !== null && (
                <div>
                  <p className="mb-1.5 text-footnote font-medium text-cream-dim">Corte para o mata-mata</p>
                  <div className="flex items-center gap-3">
                    <span className="text-headline font-semibold text-cream">Top</span>
                    <Stepper value={s.cut} min={2} max={Math.max(2, n || 64)} label="Tamanho do corte" onChange={(v) => setStructure({ ...s, cut: v })} />
                  </div>
                  <p className="mt-1.5 text-footnote text-cream-faint">
                    {(s.cut & (s.cut - 1)) === 0 ? "Chave completa, sem folgas." : `Não fecha uma chave: os ${2 ** Math.ceil(Math.log2(s.cut)) - s.cut} melhores seeds folgam na primeira fase.`}
                  </p>
                </div>
              )}
            </div>
          )}
          {pods && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-footnote font-medium text-cream-dim">Rodadas</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Stepper value={s.rounds || suggested} min={Math.max(1, t.rounds.length)} max={20} label="Rodadas do mesão" onChange={(v) => setStructure({ ...s, rounds: v })} />
                  {s.rounds !== 0 && s.rounds !== suggested && n >= 3 && draft && (
                    <button type="button" className="text-footnote font-semibold text-brass-300 hover:underline" onClick={() => setStructure({ ...s, rounds: 0 })}>
                      Usar a sugestão ({suggested})
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-footnote text-cream-faint">
                  {n >= 3 ? `${n} jogadores: ${podsLine(n)} por rodada, remontadas a cada rodada.` : "As mesas saem da lista de inscritos (mínimo 3)."}
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-footnote font-medium text-cream-dim">Empate na liderança</p>
                <p className="text-footnote text-cream-faint">
                  Os empatados em 1º jogam uma final só entre eles, sem tempo limite. Quem vencer é o campeão; os finalistas também podem combinar dividir o prêmio.
                </p>
              </div>
            </div>
          )}
          {s.kind === "round-robin" && <p className="text-footnote text-cream-faint">{n >= 2 ? `${plannedRounds(t)} rodadas para ${n} jogadores${n % 2 ? ", cada um com uma folga" : ""}.` : "O número de rodadas sai da lista de inscritos."}</p>}
          {s.kind === "single-elimination" && <p className="text-footnote text-cream-faint">Com um número de jogadores que não fecha a chave, os primeiros da lista (ou do sorteio) folgam na primeira fase.</p>}
        </Card>

        <Card title="Partidas">
          {!pods && (
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-footnote font-medium text-cream-dim">{s.kind === "single-elimination" ? "Cada partida" : "Rodadas"}</p>
              <Segmented
                label="Melhor de"
                value={String(s.kind === "single-elimination" ? t.settings.playoffBestOf : t.settings.bestOf) as "1" | "3"}
                onChange={(v) => setSettings(s.kind === "single-elimination" ? { playoffBestOf: Number(v) as 1 | 3, bestOf: Number(v) as 1 | 3 } : { bestOf: Number(v) as 1 | 3 })}
                options={[
                  { value: "1", label: "Melhor de 1" },
                  { value: "3", label: "Melhor de 3" },
                ]}
              />
            </div>
            {cut !== null && (
              <div>
                <p className="mb-1.5 text-footnote font-medium text-cream-dim">Mata-mata</p>
                <Segmented
                  label="Mata-mata em melhor de"
                  value={String(t.settings.playoffBestOf) as "1" | "3"}
                  onChange={(v) => setSettings({ playoffBestOf: Number(v) as 1 | 3 })}
                  options={[
                    { value: "1", label: "Melhor de 1" },
                    { value: "3", label: "Melhor de 3" },
                  ]}
                />
              </div>
            )}
          </div>
          )}
          {s.kind !== "single-elimination" && (
            <div>
              <p className="mb-2 text-footnote font-medium text-cream-dim">{pods ? "Pontos por mesa" : "Pontos por partida"}</p>
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    ["win", pods ? "Venceu" : "Vitória"],
                    ["draw", pods ? "Vivo no fim do tempo" : "Empate"],
                    ["loss", pods ? "Eliminado" : "Derrota"],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className={cx("text-subhead text-cream", pods ? "min-w-16" : "w-16")}>{label}</span>
                    <Stepper size="sm" value={t.settings.points[k]} min={0} max={10} label={`Pontos: ${label.toLowerCase()}`} busy={!draft} onChange={(v) => setSettings({ points: { ...t.settings.points, [k]: v } })} />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-footnote text-cream-faint">
                {pods ? "Regra da casa: 3 para quem vence; sem vencedor no fim do tempo, 1 para cada jogador ainda vivo e 0 para quem já tinha saído." : "Padrão da Wizards: 3, 1 e 0. A folga vale uma vitória."}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-subhead font-medium text-cream">{pods ? "Tempo da partida" : "Relógio da rodada"}</p>
              <p className="text-footnote text-cream-faint">
                {pods
                  ? "Quando acaba, o turno em andamento termina e cada jogador vivo que ainda não jogou faz mais 1 turno. A final não tem tempo."
                  : "Aparece nas mesas e no telão; passa a contar o acréscimo quando o tempo acaba."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {t.settings.roundMinutes !== null && <Stepper size="sm" value={t.settings.roundMinutes} min={5} max={600} label="Minutos por rodada" onChange={(v) => setSettings({ roundMinutes: v })} />}
              <Switch checked={t.settings.roundMinutes !== null} label="Usar relógio" onChange={(on) => setSettings({ roundMinutes: on ? (pods ? 60 : 50) : null })} />
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        {(s.kind === "single-elimination" || cut !== null) && (
          <Card title="Montagem do bracket">
            <Segmented
              label="Montagem do bracket"
              value={t.settings.seeding}
              onChange={(v) => setSettings({ seeding: v })}
              options={[
                { value: "standings", label: s.kind === "single-elimination" ? "Pela ordem" : "Pela classificação" },
                { value: "random", label: "Sorteio" },
              ]}
            />
            <p className="text-footnote text-cream-faint">
              {t.settings.seeding === "standings"
                ? s.kind === "single-elimination"
                  ? "Seeds na ordem da lista de inscritos: 1º × último, e 1º e 2º só se cruzam na final."
                  : "1º × último do corte, e 1º e 2º só se cruzam na final."
                : "A chave é sorteada na hora do corte; quem ganhou folga pela classificação continua com ela."}
            </p>
          </Card>
        )}
        <Card title="Sobre o evento">
          <Field label="Data">{(id) => <Input id={id} type="date" value={t.date} onChange={(e) => e.target.value && dispatch({ type: "setInfo", date: e.target.value })} />}</Field>
          <Field label="Formato do jogo" hint="aparece nas mesas e no telão">
            {(id) => (
              <>
                <Input id={id} list={listId} value={t.gameFormat} maxLength={60} placeholder="Ex.: Commander, Pauper, Draft" onChange={(e) => dispatch({ type: "setInfo", gameFormat: e.target.value })} />
                <datalist id={listId}>
                  {formats.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Observações" hint="opcional">
            {(id) => <Textarea id={id} rows={3} value={t.notes} maxLength={2000} placeholder="Premiação, horário, regras da casa…" onChange={(e) => dispatch({ type: "setInfo", notes: e.target.value })} />}
          </Field>
        </Card>
      </div>
    </div>
  );
}
