/**
 * Mesão (Commander multiplayer): mesas de 4, com mesas de 3 completando quando os inscritos não fecham
 * a conta (10 = 4+3+3); com 5 jogadores, uma mesa de 5.
 *
 * Montagem das mesas:
 * - 1ª rodada sorteada;
 * - depois, a rodada inteira sai de uma conta só: primeiro, o mínimo de adversários repetidos (as mesas
 *   se reorganizam para cada um enfrentar gente diferente); depois, quem tem pontos parecidos junto,
 *   como no suíço; o resto é sorteio;
 * - até 12 jogadores testa todas as divisões possíveis (no máximo 5.775); acima disso, parte de várias
 *   divisões e troca jogadores entre mesas enquanto a conta melhora.
 */
import { shuffle, type Rng } from "./rng.ts";
import { collectStats } from "./standings.ts";
import type { ID, Player, Pod, Round, Tournament } from "./types.ts";

/** Tamanhos das mesas para `n` jogadores (4 e 3; com 5, uma mesa de 5). */
export function podSizes(n: number): number[] {
  if (n <= 0) return [];
  if (n < 3) return [n];
  if (n === 5) return [5];
  const k = Math.ceil(n / 4);
  const threes = 4 * k - n;
  return [...Array<number>(k - threes).fill(4), ...Array<number>(threes).fill(3)];
}

/** Rodadas sugeridas: a regra da casa fala em 3 rodadas para 8 jogadores; mais gente, mais rodadas. */
export function suggestPodRounds(players: number): number {
  if (players < 3) return 0;
  if (players <= 12) return 3;
  if (players <= 24) return 4;
  return 5;
}

const activeIn = (p: Player, round: number) => p.droppedAfter === null || round <= p.droppedAfter;

export const podKey = (a: ID, b: ID) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Quantas vezes cada par de jogadores já dividiu mesa. */
export function podMeetings(rounds: Round[]): Map<string, number> {
  const met = new Map<string, number>();
  for (const r of rounds)
    for (const pod of r.pods ?? [])
      for (let i = 0; i < pod.players.length; i++)
        for (let j = i + 1; j < pod.players.length; j++) {
          const k = podKey(pod.players[i], pod.players[j]);
          met.set(k, (met.get(k) ?? 0) + 1);
        }
  return met;
}

type Scorer = { pod: (members: number[]) => number };

/** Todas as divisões de `0..n-1` nos tamanhos dados, cada uma uma vez só; guarda a de menor custo. */
function bestExhaustive(n: number, sizes: number[], score: Scorer): number[][] {
  let best: number[][] = [];
  let bestCost = Infinity;
  const used = new Array<boolean>(n).fill(false);
  const pods: number[][] = [];
  const remainingSizes = [...sizes];

  const recurse = (cost: number) => {
    if (cost >= bestCost) return;
    const first = used.indexOf(false);
    if (first < 0) {
      bestCost = cost;
      best = pods.map((p) => [...p]);
      return;
    }
    // o menor jogador livre abre a próxima mesa; tenta cada tamanho distinto que ainda falta
    const tried = new Set<number>();
    for (let s = 0; s < remainingSizes.length; s++) {
      const size = remainingSizes[s];
      if (tried.has(size)) continue;
      tried.add(size);
      remainingSizes.splice(s, 1);
      used[first] = true;
      const members = [first];
      const choose = (from: number) => {
        if (members.length === size) {
          const c = score.pod(members);
          pods.push([...members]);
          recurse(cost + c);
          pods.pop();
          return;
        }
        for (let v = from; v < n; v++) {
          if (used[v]) continue;
          used[v] = true;
          members.push(v);
          choose(v + 1);
          members.pop();
          used[v] = false;
        }
      };
      choose(first + 1);
      used[first] = false;
      remainingSizes.splice(s, 0, size);
    }
  };
  recurse(0);
  return best;
}

/** Busca local: divide, troca pares de jogadores entre mesas enquanto melhora; várias partidas. */
function bestLocal(n: number, sizes: number[], score: Scorer, initial: number[], rng: Rng): number[][] {
  const fill = (order: number[]) => {
    const pods: number[][] = [];
    let at = 0;
    for (const s of sizes) {
      pods.push(order.slice(at, at + s));
      at += s;
    }
    return pods;
  };
  const total = (pods: number[][]) => pods.reduce((acc, p) => acc + score.pod(p), 0);
  const improve = (pods: number[][]) => {
    let costs = pods.map((p) => score.pod(p));
    for (let changed = true; changed; ) {
      changed = false;
      for (let a = 0; a < pods.length; a++)
        for (let b = a + 1; b < pods.length; b++)
          for (let i = 0; i < pods[a].length; i++)
            for (let j = 0; j < pods[b].length; j++) {
              const pa = [...pods[a]];
              const pb = [...pods[b]];
              [pa[i], pb[j]] = [pb[j], pa[i]];
              const ca = score.pod(pa);
              const cb = score.pod(pb);
              if (ca + cb < costs[a] + costs[b] - 1e-9) {
                pods[a] = pa;
                pods[b] = pb;
                costs = [...costs];
                costs[a] = ca;
                costs[b] = cb;
                changed = true;
              }
            }
    }
    return pods;
  };
  let best = improve(fill(initial));
  let bestCost = total(best);
  for (let restart = 0; restart < 8; restart++) {
    const candidate = improve(fill(shuffle([...initial], rng)));
    const c = total(candidate);
    if (c < bestCost - 1e-9) {
      best = candidate;
      bestCost = c;
    }
  }
  return best;
}

export type PodPairingOptions = { rng: Rng };

/** Mesas da rodada `roundNo` a partir das rodadas anteriores (que precisam estar completas). */
export function pairPods(t: Pick<Tournament, "players" | "rounds" | "settings">, roundNo: number, opts: PodPairingOptions): Pod[] {
  const previous = t.rounds.filter((r) => r.number < roundNo);
  const ids = t.players.filter((p) => activeIn(p, roundNo)).map((p) => p.id);
  const sizes = podSizes(ids.length);
  const toPods = (groups: ID[][]): Pod[] => groups.map((players, i) => ({ id: `r${roundNo}p${i + 1}`, table: i + 1, players, result: null }));

  if (!previous.length) {
    const order = shuffle(ids, opts.rng);
    const groups: ID[][] = [];
    let at = 0;
    for (const s of sizes) {
      groups.push(order.slice(at, at + s));
      at += s;
    }
    return toPods(groups);
  }

  const stats = collectStats(t.players, previous, t.settings.points);
  const pts = ids.map((id) => stats.get(id)?.points ?? 0);
  const met = podMeetings(previous);
  const n = ids.length;
  // sorteio fixo por par: desempata divisões iguais sem mudar de uma conta para outra
  const jitter = Array.from({ length: n }, () => Array.from({ length: n }, () => opts.rng()));
  const totalPairs = sizes.reduce((acc, s) => acc + (s * (s - 1)) / 2, 0);
  // escalas: o sorteio nunca vence 1 ponto de diferença, e uma repetição a menos vence qualquer arranjo de pontos
  const S = totalPairs + 1;
  const maxDelta = Math.max(0, ...pts) - Math.min(0, ...pts);
  const R = S * (totalPairs * maxDelta * maxDelta + 1);
  const score: Scorer = {
    pod(members) {
      let c = 0;
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++) {
          const u = members[i];
          const v = members[j];
          c += (met.get(podKey(ids[u], ids[v])) ?? 0) * R + (pts[u] - pts[v]) ** 2 * S + jitter[Math.min(u, v)][Math.max(u, v)];
        }
      return c;
    },
  };
  // começa por pontos (do maior para o menor, com sorteio entre iguais)
  const byPoints = shuffle(
    ids.map((_, i) => i),
    opts.rng,
  ).sort((a, b) => pts[b] - pts[a]);
  const groups = n <= 12 ? bestExhaustive(n, sizes, score) : bestLocal(n, sizes, score, byPoints, opts.rng);

  // mesa 1 é a de mais pontos; dentro da mesa, quem tem mais pontos primeiro
  const avg = (g: number[]) => g.reduce((acc, v) => acc + pts[v], 0) / g.length;
  const ordered = groups
    .map((g) => [...g].sort((a, b) => pts[b] - pts[a] || a - b))
    .sort((x, y) => avg(y) - avg(x) || Math.min(...x) - Math.min(...y));
  return toPods(ordered.map((g) => g.map((v) => ids[v])));
}
