/**
 * Mesão (Commander multiplayer): mesas de 4, com mesas de 3 completando quando os inscritos não fecham
 * a conta (10 = 4+3+3); com 5 jogadores, uma mesa de 5.
 *
 * Montagem das mesas:
 * - 1ª rodada sorteada;
 * - depois, a rodada inteira sai de uma conta só: primeiro, o mínimo de adversários repetidos (as mesas
 *   se reorganizam para cada um enfrentar gente diferente); depois, quem tem pontos parecidos junto,
 *   como no suíço; o resto é sorteio;
 * - repetir pesa cada vez mais: a conta primeiro evita que uma dupla se encontre pela 3ª vez, depois
 *   pela 2ª, e só então olha quantas duplas se repetem. Sem isso, "a mesma dupla junta três rodadas"
 *   empatava com "duas duplas juntas duas rodadas" e a mesma mesa voltava sem precisar;
 * - até 16 jogadores a divisão é a melhor que existe (todas são consideradas): se sobrou reencontro,
 *   é porque não há divisão sem ele. Acima disso, parte de várias divisões e troca jogadores entre
 *   mesas enquanto a conta melhora;
 * - como pede o cEDH (adendo da MTR, 10.4A), ninguém cai numa mesa de 3 pela segunda vez se der para
 *   evitar: isso vem logo depois dos reencontros e antes da proximidade em pontos;
 * - a ordem dos jogadores na mesa é a ordem de jogo e é sorteada (x.3A): quem aparece em cima começa.
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

/** Até este número de jogadores a divisão escolhida é comprovadamente a de menos reencontros. */
export const POD_EXACT_LIMIT = 16;

/**
 * Custo de uma mesa: [reencontros (pesados), mesa menor repetida, pontos + sorteio]. Compara-se na ordem:
 * cada um só desempata o anterior.
 */
type Cost = [number, number, number];
type Scorer = { pod: (members: number[]) => Cost };

const less = (a: Cost, b: Cost) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2] - 1e-9)));
const plus = (a: Cost, b: Cost): Cost => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const NONE: Cost = [0, 0, 0];

/**
 * Todas as divisões de `0..n-1` nos tamanhos dados, cada uma uma vez só; guarda a de menor custo.
 * `start` é uma divisão já conhecida: o que não for melhor do que ela é cortado cedo.
 */
function bestExhaustive(n: number, sizes: number[], score: Scorer, start?: number[][]): number[][] {
  let best: number[][] = start ?? [];
  let bestCost: Cost = start ? start.reduce<Cost>((acc, p) => plus(acc, score.pod(p)), NONE) : [Infinity, Infinity, Infinity];
  const used = new Array<boolean>(n).fill(false);
  const pods: number[][] = [];
  const remainingSizes = [...sizes];

  const recurse = (cost: Cost) => {
    if (!less(cost, bestCost)) return;
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
          recurse(plus(cost, c));
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
  recurse(NONE);
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
  const total = (pods: number[][]) => pods.reduce<Cost>((acc, p) => plus(acc, score.pod(p)), NONE);
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
              if (less(plus(ca, cb), plus(costs[a], costs[b]))) {
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
  for (let restart = 0; restart < 48; restart++) {
    const candidate = improve(fill(shuffle([...initial], rng)));
    const c = total(candidate);
    if (less(c, bestCost)) {
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
  // o sorteio nunca vence 1 ponto de diferença
  const S = totalPairs + 1;
  // uma dupla que já se encontrou m vezes pesa B^(m-1): um encontro a mais de quem já repetiu vale mais
  // do que todas as duplas da rodada se encontrando uma vez a menos (o expoente para em 6 para caber no número)
  const B = totalPairs + 1;
  const weight = (m: number) => (m <= 0 ? 0 : B ** Math.min(m - 1, 6));
  // quantas vezes cada um já jogou numa mesa menor que a padrão desta rodada
  const standard = Math.max(...sizes);
  const smallBefore = ids.map((id) => previous.reduce((acc, r) => acc + ((r.pods ?? []).some((p) => p.players.length < standard && p.players.includes(id)) ? 1 : 0), 0));
  const score: Scorer = {
    pod(members) {
      let rep = 0;
      let rest = 0;
      const small = members.length < standard ? members.reduce((acc, v) => acc + smallBefore[v], 0) : 0;
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++) {
          const u = members[i];
          const v = members[j];
          rep += weight(met.get(podKey(ids[u], ids[v])) ?? 0);
          rest += (pts[u] - pts[v]) ** 2 * S + jitter[Math.min(u, v)][Math.max(u, v)];
        }
      return [rep, small, rest];
    },
  };
  // começa por pontos (do maior para o menor, com sorteio entre iguais)
  const byPoints = shuffle(
    ids.map((_, i) => i),
    opts.rng,
  ).sort((a, b) => pts[b] - pts[a]);
  const local = bestLocal(n, sizes, score, byPoints, opts.rng);
  const groups = n <= POD_EXACT_LIMIT ? bestExhaustive(n, sizes, score, local) : local;

  // mesa 1 é a de mais pontos; dentro da mesa, a ordem de jogo é sorteada
  const avg = (g: number[]) => g.reduce((acc, v) => acc + pts[v], 0) / g.length;
  const ordered = groups.map((g) => [...g].sort((a, b) => a - b)).sort((x, y) => avg(y) - avg(x) || Math.min(...x) - Math.min(...y));
  return toPods(ordered.map((g) => shuffle(g, opts.rng).map((v) => ids[v])));
}

/**
 * Reencontros das mesas de uma rodada: quantas duplas já tinham dividido mesa antes (`pairs`) e o maior
 * número de encontros anteriores entre elas (`worst`). `exact` diz se a divisão é comprovadamente a de
 * menos reencontros (então o que sobrou era inevitável).
 */
export function podRematches(rounds: Round[], roundNo: number): { pairs: number; worst: number; exact: boolean } {
  const round = rounds.find((r) => r.number === roundNo);
  const met = podMeetings(rounds.filter((r) => r.number < roundNo));
  let pairs = 0;
  let worst = 0;
  let players = 0;
  for (const pod of round?.pods ?? []) {
    players += pod.players.length;
    for (let i = 0; i < pod.players.length; i++)
      for (let j = i + 1; j < pod.players.length; j++) {
        const m = met.get(podKey(pod.players[i], pod.players[j])) ?? 0;
        if (m > 0) pairs++;
        worst = Math.max(worst, m);
      }
  }
  return { pairs, worst, exact: players <= POD_EXACT_LIMIT };
}
