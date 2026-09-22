/** Ajudantes dos testes: monta torneios e joga rodadas com um critério de vitória. */
import { apply, createTournament, currentRound, type Command } from "./engine.ts";
import { mulberry32, type Rng } from "./rng.ts";
import type { ID, Match, Score, Structure, Tournament } from "./types.ts";

export const AT = "2026-09-26T19:00:00.000Z";

export function make(n: number, structure: Structure, seed = 1): Tournament {
  let t = createTournament({ id: "t1", name: "Teste", date: "2026-09-26", seed, at: AT });
  t = apply(t, { type: "setStructure", structure });
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Jogador ${i + 1}`, lot: i / n }));
  if (n) t = apply(t, { type: "addPlayers", players });
  return t;
}

export function run(t: Tournament, ...cmds: Command[]): Tournament {
  return cmds.reduce(apply, t);
}

/** Força de cada jogador: p1 é o mais forte. Quem é mais forte vence por 2 a 0 (ou 2 a 1 se `close`). */
export const byStrength = (m: Match): Score => {
  const a = Number(m.a.slice(1));
  const b = Number(m.b!.slice(1));
  return a < b ? { a: 2, b: 0, draws: 0 } : { a: 0, b: 2, draws: 0 };
};

export function randomScores(rng: Rng) {
  return (): Score => {
    const x = rng();
    if (x < 0.4) return { a: 2, b: rng() < 0.5 ? 0 : 1, draws: 0 };
    if (x < 0.8) return { a: rng() < 0.5 ? 0 : 1, b: 2, draws: 0 };
    return { a: 1, b: 1, draws: 1 };
  };
}

/** Lança o placar de todas as mesas pendentes da rodada atual. */
export function playRound(t: Tournament, decide: (m: Match) => Score): Tournament {
  const r = currentRound(t)!;
  for (const m of r.matches) {
    if (m.b === null || m.result) continue;
    t = apply(t, { type: "result", round: r.number, match: m.id, score: decide(m), at: AT });
  }
  return t;
}

/** Joga o suíço inteiro: começa, lança todas as rodadas e emparelha a seguinte. */
export function playSwiss(t: Tournament, decide: (m: Match) => Score, rounds: number): Tournament {
  if (!t.startedAt) t = apply(t, { type: "start", at: AT });
  for (let r = 1; r <= rounds; r++) {
    t = playRound(t, decide);
    if (r < rounds) t = apply(t, { type: "pairNext" });
  }
  return t;
}

export const opponentsOf = (t: Tournament, id: ID) =>
  t.rounds.flatMap((r) => r.matches.filter((m) => m.a === id || m.b === id).map((m) => (m.a === id ? m.b : m.a)));

export const seeded = (seed: number) => mulberry32(seed);
