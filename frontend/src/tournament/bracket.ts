/**
 * Mata-mata: chave do tamanho da próxima potência de 2, seeds na posição padrão
 * (1 × último, e 1 e 2 só se cruzam na final) e folga para os melhores seeds quando o corte não fecha a chave
 * (Top 6 → chave de 8, seeds 1 e 2 folgam). O vencedor de cada partida é sempre calculado a partir dos placares.
 */
import { shuffle, type Rng } from "./rng.ts";
import type { BracketResult, BracketSlot, BracketView, ID, Playoff, Score } from "./types.ts";

export const bracketSize = (n: number) => (n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n)));

/** Ordem dos seeds nas vagas da primeira rodada: 8 → [1, 8, 4, 5, 2, 7, 3, 6]. */
export function seedPositions(size: number): number[] {
  let pos = [1];
  while (pos.length < size) {
    const m = pos.length * 2;
    pos = pos.flatMap((s) => [s, m + 1 - s]);
  }
  return pos;
}

/**
 * Ordem de seeds do corte. Pela classificação, é a própria ordem. No sorteio, quem tem folga (os melhores
 * da classificação) continua com ela e o resto é embaralhado.
 */
export function drawSeeds(qualified: ID[], seeding: "standings" | "random", rng: Rng, keepByes = true): ID[] {
  if (seeding === "standings") return [...qualified];
  const byes = keepByes ? bracketSize(qualified.length) - qualified.length : 0;
  return [...qualified.slice(0, byes), ...shuffle(qualified.slice(byes), rng)];
}

export const slotKey = (round: number, index: number) => `${round}:${index}`;

export function winnerOf(score: Score, a: ID, b: ID): ID | null {
  return score.a > score.b ? a : score.b > score.a ? b : null;
}

/** Monta a chave inteira a partir dos seeds e dos placares gravados. */
export function bracketView(playoff: Pick<Playoff, "seeds" | "results">): BracketView {
  const size = bracketSize(playoff.seeds.length);
  const positions = seedPositions(size);
  const seat = (seed: number) => (seed <= playoff.seeds.length ? { playerId: playoff.seeds[seed - 1], seed } : null);
  const rounds: BracketSlot[][] = [];
  const total = Math.log2(size);
  for (let r = 0; r < total; r++) {
    const count = size / 2 ** (r + 1);
    const slots: BracketSlot[] = [];
    for (let i = 0; i < count; i++) {
      let a;
      let b;
      if (r === 0) {
        a = seat(positions[2 * i]);
        b = seat(positions[2 * i + 1]);
      } else {
        const prevA = rounds[r - 1][2 * i];
        const prevB = rounds[r - 1][2 * i + 1];
        a = prevA.winner ? seatOf(prevA, prevA.winner) : null;
        b = prevB.winner ? seatOf(prevB, prevB.winner) : null;
      }
      const key = slotKey(r, i);
      const stored = playoff.results[key] ?? null;
      const bye = r === 0 && (!a || !b);
      let result: BracketResult | null = null;
      let stale = false;
      if (stored && a && b) {
        if (stored.a === a.playerId && stored.b === b.playerId) result = stored;
        else stale = true;
      } else if (stored) stale = true;
      let winner: ID | null = null;
      if (bye) winner = (a ?? b)?.playerId ?? null;
      else if (result && a && b) winner = winnerOf(result.score, a.playerId, b.playerId);
      slots.push({ key, round: r, index: i, a, b, bye, result, winner, stale });
    }
    rounds.push(slots);
  }
  const final = rounds[rounds.length - 1]?.[0];
  return { size, rounds, champion: final?.winner ?? (size === 1 ? playoff.seeds[0] ?? null : null) };
}

function seatOf(slot: BracketSlot, playerId: ID) {
  return slot.a?.playerId === playerId ? slot.a : slot.b;
}

/** Remove placares que ficaram velhos (outra dupla na partida), repetindo até estabilizar. */
export function pruneStale(playoff: Playoff): { playoff: Playoff; removed: string[] } {
  let current = playoff;
  const removed: string[] = [];
  for (;;) {
    const stale = bracketView(current)
      .rounds.flat()
      .filter((s) => s.stale)
      .map((s) => s.key);
    if (!stale.length) return { playoff: current, removed };
    const results = { ...current.results };
    for (const k of stale) delete results[k];
    removed.push(...stale);
    current = { ...current, results };
  }
}

/** Nome da fase pela quantidade de partidas dela. */
export function roundName(matches: number, roundIndex: number) {
  if (matches === 1) return "Final";
  if (matches === 2) return "Semifinal";
  if (matches === 4) return "Quartas de final";
  if (matches === 8) return "Oitavas de final";
  return `${roundIndex + 1}ª fase`;
}

/** Colocação final: campeão, vice, semifinalistas… por fase de eliminação (empates de fase pela ordem de seed). */
export function playoffPlacing(view: BracketView): { playerId: ID; place: number }[] {
  const out: { playerId: ID; place: number }[] = [];
  if (view.champion) out.push({ playerId: view.champion, place: 1 });
  for (let r = view.rounds.length - 1; r >= 0; r--) {
    const losers = view.rounds[r]
      .filter((s) => s.winner && s.a && s.b && !s.bye)
      .map((s) => (s.winner === s.a!.playerId ? s.b! : s.a!))
      .sort((x, y) => x.seed - y.seed);
    const place = out.length + 1;
    losers.forEach((l) => out.push({ playerId: l.playerId, place }));
  }
  return out;
}
