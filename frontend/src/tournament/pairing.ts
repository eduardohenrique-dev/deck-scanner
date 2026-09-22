/**
 * Emparelhamento suíço e todos-contra-todos.
 *
 * Suíço (como o WER/EventLink da Wizards):
 * - 1ª rodada sorteada;
 * - depois, junta pontuações iguais com sorteio dentro de cada grupo; na última rodada, pela classificação
 *   (1º × 2º, 3º × 4º…), para o corte ser justo;
 * - com número ímpar, a folga vai para alguém do grupo de menos pontos que ainda não teve folga;
 * - revanche e folga repetida só quando é impossível evitar.
 * Tudo isso vira custo numa única conta de emparelhamento ótimo (blossom), em vez de decidir mesa por mesa.
 */
import { maxWeightMatching, type Edge } from "./matching.ts";
import { mulberry32, shuffle, type Rng } from "./rng.ts";
import { collectStats, standings } from "./standings.ts";
import type { ID, Match, Player, Round, Tournament } from "./types.ts";

/** Número de rodadas sugerido pela tabela recomendada da MTR (apêndice E). */
export function suggestRounds(players: number, cut: number | null = null): number {
  if (players < 2) return 0;
  if (players <= 128) {
    const base = Math.ceil(Math.log2(players));
    // 9 a 16 jogadores com corte pequeno (top 4): a tabela pede 5 rodadas
    if (cut !== null && cut <= 4 && players >= 9 && players <= 16) return 5;
    return base;
  }
  if (players <= 226) return 8;
  if (players <= 409) return 9;
  return 10;
}

/** Joga a rodada `round`? Quem saiu depois da rodada N não é emparelhado a partir da N+1. */
export const activeIn = (p: Player, round: number) => p.droppedAfter === null || round <= p.droppedAfter;

/** Quantas vezes cada par já se enfrentou e quantas folgas cada um já teve. */
export function meetings(rounds: Round[]) {
  const pairs = new Map<string, number>();
  const byes = new Map<ID, number>();
  for (const r of rounds) {
    for (const m of r.matches) {
      if (m.b === null) byes.set(m.a, (byes.get(m.a) ?? 0) + 1);
      else {
        const k = pairKey(m.a, m.b);
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
    }
  }
  return { pairs, byes };
}

export const BYE_SCORE = { a: 2, b: 0, draws: 0 } as const;

export const pairKey = (a: ID, b: ID) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Numera as mesas: a mesa 1 é a do topo (mais pontos); a folga fica por último, sem mesa. */
function toMatches(pairs: [ID, ID | null][], roundNo: number, order: Map<ID, number>): Match[] {
  const real = pairs.filter((p) => p[1] !== null) as [ID, ID][];
  const byes = pairs.filter((p) => p[1] === null);
  real.sort((x, y) => Math.min(order.get(x[0])!, order.get(x[1])!) - Math.min(order.get(y[0])!, order.get(y[1])!));
  const out: Match[] = real.map(([a, b], i) => {
    // quem está melhor colocado fica do lado A
    const [first, second] = order.get(a)! <= order.get(b)! ? [a, b] : [b, a];
    return { id: `r${roundNo}m${i + 1}`, table: i + 1, a: first, b: second, result: null };
  });
  // folga já nasce com o placar dela (vitória por 2 a 0), como no WER
  byes.forEach(([a], i) => out.push({ id: `r${roundNo}bye${i + 1}`, table: null, a, b: null, result: { ...BYE_SCORE } }));
  return out;
}

export type PairingOptions = { rng: Rng; /** última rodada suíça: emparelha pela classificação */ final?: boolean };

/** Emparelhamento suíço da rodada `roundNo` a partir das rodadas anteriores (que precisam estar completas). */
export function pairSwiss(t: Pick<Tournament, "players" | "rounds" | "settings">, roundNo: number, opts: PairingOptions): Match[] {
  const previous = t.rounds.filter((r) => r.number < roundNo);
  const active = t.players.filter((p) => activeIn(p, roundNo));
  if (active.length < 2) return active.map((p, i) => ({ id: `r${roundNo}bye${i + 1}`, table: null, a: p.id, b: null, result: { ...BYE_SCORE } }));
  const table = standings({ ...t, rounds: previous });
  const rank = new Map(table.map((s) => [s.playerId, s.rank]));

  if (!previous.length) {
    // primeira rodada: sorteio puro
    const order = shuffle(active.map((p) => p.id), opts.rng);
    const pairs: [ID, ID | null][] = [];
    for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
    if (order.length % 2) pairs.push([order[order.length - 1], null]);
    const pos = new Map(order.map((id, i) => [id, i]));
    return toMatches(pairs, roundNo, pos);
  }

  const stats = collectStats(t.players, previous, t.settings.points);
  const { pairs: met, byes } = meetings(previous);
  const ids = active.map((p) => p.id);
  const pts = ids.map((id) => stats.get(id)!.points);
  const withBye = ids.length % 2 === 1;
  const n = ids.length + (withBye ? 1 : 0);
  const BYE = ids.length;
  const minPts = Math.min(...pts);
  // a folga "tem" menos pontos que o último grupo: puxa quem está no fundo
  const byePts = minPts - Math.max(1, t.settings.points.win);
  const ptsOf = (v: number) => (v === BYE ? byePts : pts[v]);
  const rankOf = (v: number) => (v === BYE ? n + 1 : rank.get(ids[v]) ?? n);

  // escala: o desempate (sorteio ou distância na tabela) nunca vence 1 ponto de diferença,
  // e uma revanche custa mais do que qualquer combinação sem revanche
  const S = n * n + n + 1;
  let maxBase = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) maxBase = Math.max(maxBase, (ptsOf(i) - ptsOf(j)) ** 2);
  const R = (Math.floor(n / 2) + 1) * (maxBase + 1) * S;
  const tieRange = Math.max(1, Math.floor(S / (Math.floor(n / 2) + 1)) - 1);

  const cost = (i: number, j: number) => {
    let c = (ptsOf(i) - ptsOf(j)) ** 2 * S;
    c += opts.final ? Math.abs(rankOf(i) - rankOf(j)) : Math.floor(opts.rng() * tieRange);
    if (i === BYE || j === BYE) c += (byes.get(ids[i === BYE ? j : i]) ?? 0) * R;
    else c += (met.get(pairKey(ids[i], ids[j])) ?? 0) * R;
    return c;
  };
  const costs: [number, number, number][] = [];
  let maxCost = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = cost(i, j);
      costs.push([i, j, c]);
      maxCost = Math.max(maxCost, c);
    }
  }
  const edges: Edge[] = costs.map(([i, j, c]) => [i, j, maxCost + 1 - c]);
  const mate = maxWeightMatching(edges, true);
  const pairs: [ID, ID | null][] = [];
  for (let v = 0; v < ids.length; v++) {
    const u = mate[v];
    if (u === BYE) pairs.push([ids[v], null]);
    else if (u > v) pairs.push([ids[v], ids[u]]);
  }
  const order = new Map(ids.map((id) => [id, rank.get(id) ?? 0]));
  return toMatches(pairs, roundNo, order);
}

/**
 * Todos contra todos pelo método do círculo: a ordem (sorteada uma vez, na semente do torneio) fica fixa
 * e cada rodada gira os lugares. Com número ímpar, cada um folga uma vez. Quem saiu vira folga do oponente.
 */
export function roundRobinCount(players: number) {
  return players < 2 ? 0 : players % 2 ? players : players - 1;
}

export function pairRoundRobin(t: Pick<Tournament, "players" | "seed">, roundNo: number): Match[] {
  const order = shuffle(
    t.players.map((p) => p.id),
    mulberry32(t.seed ^ 0x5eed),
  );
  const list: (ID | null)[] = order.length % 2 ? [...order, null] : [...order];
  const n = list.length;
  const r = (roundNo - 1) % (n - 1);
  const fixed = list[0];
  const rest = list.slice(1);
  const rotated = [...rest.slice(rest.length - r), ...rest.slice(0, rest.length - r)];
  const seats = [fixed, ...rotated];
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const alive = (id: ID | null) => (id && activeIn(byId.get(id)!, roundNo) ? id : null);
  const pairs: [ID, ID | null][] = [];
  for (let i = 0; i < n / 2; i++) {
    const a = alive(seats[i]);
    const b = alive(seats[n - 1 - i]);
    if (a && b) pairs.push([a, b]);
    else if (a || b) pairs.push([(a ?? b)!, null]);
  }
  const pos = new Map(order.map((id, i) => [id, i]));
  return toMatches(pairs, roundNo, pos);
}
