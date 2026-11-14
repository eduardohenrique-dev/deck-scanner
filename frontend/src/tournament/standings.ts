/**
 * Classificação e desempates da MTR (apêndice C):
 * pontos → OMW% → GW% → OGW%, com piso de 1/3 em cada percentual.
 * - bye vale vitória por 2 a 0 (3 pontos de partida e 6 de game);
 * - a rodada de bye não entra na média dos oponentes;
 * - quem saiu continua contando para quem jogou com ele.
 */
import type { ID, Match, Player, Points, PodResult, Round, Score, Standing, Tournament } from "./types.ts";

export const FLOOR = 1 / 3;
const EPS = 1e-9;

export type Outcome = "win" | "loss" | "draw" | "bye";

export type Game = {
  round: number;
  table: number | null;
  opponent: ID | null;
  score: Score;
  outcome: Outcome;
  /** mesão: quem estava na mesa e como ela terminou */
  pod?: { players: ID[]; result: PodResult };
};

/**
 * Como a mesa do mesão terminou para um jogador: vitória, empate (marcado na lista do empate: pela regra do
 * cEDH, todos da mesa menos quem concedeu) ou derrota. Dividir o prêmio só existe na final e conta como título.
 */
export function podOutcome(r: PodResult, id: ID): "win" | "draw" | "loss" {
  switch (r.kind) {
    case "win":
      return r.winner === id ? "win" : "loss";
    case "draw":
      return r.survivors.includes(id) ? "draw" : "loss";
    case "split":
      return r.players.includes(id) ? "win" : "loss";
  }
}

export type PlayerStats = {
  playerId: ID;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  roundsPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gamesDrawn: number;
  opponents: ID[];
  games: Game[];
};

export function outcomeFor(score: Score, side: "a" | "b"): Exclude<Outcome, "bye"> {
  const mine = side === "a" ? score.a : score.b;
  const theirs = side === "a" ? score.b : score.a;
  return mine > theirs ? "win" : mine < theirs ? "loss" : "draw";
}

/** Placar visto do lado de B (o que o jogador B vê como "seu" placar). */
export const flip = (s: Score): Score => ({ a: s.b, b: s.a, draws: s.draws });

function empty(playerId: ID): PlayerStats {
  return { playerId, points: 0, wins: 0, losses: 0, draws: 0, byes: 0, roundsPlayed: 0, gamesWon: 0, gamesLost: 0, gamesDrawn: 0, opponents: [], games: [] };
}

function add(stats: PlayerStats, m: Match, round: number, side: "a" | "b", points: Points) {
  const score = side === "a" ? m.result! : flip(m.result!);
  if (m.b === null) {
    // folga: vitória por 2 a 0
    stats.points += points.win;
    stats.wins++;
    stats.byes++;
    stats.roundsPlayed++;
    stats.gamesWon += 2;
    stats.games.push({ round, table: null, opponent: null, score: { a: 2, b: 0, draws: 0 }, outcome: "bye" });
    return;
  }
  const outcome = outcomeFor(score, "a");
  stats.points += outcome === "win" ? points.win : outcome === "draw" ? points.draw : points.loss;
  if (outcome === "win") stats.wins++;
  else if (outcome === "loss") stats.losses++;
  else stats.draws++;
  stats.roundsPlayed++;
  stats.gamesWon += score.a;
  stats.gamesLost += score.b;
  stats.gamesDrawn += score.draws;
  const opponent = side === "a" ? m.b : m.a;
  stats.opponents.push(opponent);
  stats.games.push({ round, table: m.table, opponent, score, outcome });
}

/** Números de cada jogador somando as partidas com placar (até a rodada `upto`, inclusive). */
export function collectStats(players: Player[], rounds: Round[], points: Points, upto = Infinity): Map<ID, PlayerStats> {
  const map = new Map<ID, PlayerStats>(players.map((p) => [p.id, empty(p.id)]));
  for (const round of rounds) {
    if (round.number > upto) continue;
    for (const m of round.matches) {
      if (!m.result) continue;
      const a = map.get(m.a);
      if (a) add(a, m, round.number, "a", points);
      if (m.b) {
        const b = map.get(m.b);
        if (b) add(b, m, round.number, "b", points);
      }
    }
    for (const pod of round.pods ?? []) {
      if (!pod.result) continue;
      for (const id of pod.players) {
        const s = map.get(id);
        if (!s) continue;
        const outcome = podOutcome(pod.result, id);
        s.points += outcome === "win" ? points.win : outcome === "draw" ? points.draw : points.loss;
        if (outcome === "win") s.wins++;
        else if (outcome === "draw") s.draws++;
        else s.losses++;
        s.roundsPlayed++;
        s.opponents.push(...pod.players.filter((x) => x !== id));
        s.games.push({ round: round.number, table: pod.table, opponent: null, score: { a: 0, b: 0, draws: 0 }, outcome, pod: { players: pod.players, result: pod.result } });
      }
    }
  }
  return map;
}

/** Torneio de mesão: as rodadas têm mesas em vez de partidas 1 × 1. */
export const isPodTournament = (t: Pick<Tournament, "rounds">) => t.rounds.some((r) => (r.pods?.length ?? 0) > 0);

export function matchWinPct(s: PlayerStats, points: Points): number {
  if (!s.roundsPlayed || points.win <= 0) return FLOOR;
  return Math.max(FLOOR, s.points / (points.win * s.roundsPlayed));
}

export function gameWinPct(s: PlayerStats): number {
  const played = s.gamesWon + s.gamesLost + s.gamesDrawn;
  if (!played) return FLOOR;
  return Math.max(FLOOR, (3 * s.gamesWon + s.gamesDrawn) / (3 * played));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function cmp(a: number, b: number) {
  return Math.abs(a - b) < EPS ? 0 : a > b ? -1 : 1;
}

/** Tamanho padrão da mesa do mesão: mesas menores contam um adversário "fantasma" a mais no OMW%. */
export const POD_STANDARD = 4;

/**
 * Pontuação do cEDH (adendo multijogador da MTR, apêndice C): vitória vale 2n − 1, com n = tamanho padrão
 * da mesa (7 com mesas de 4, inclusive nas mesas de 3); empate, 1 para cada jogador da mesa; derrota, 0.
 */
export const CEDH_POINTS: Points = { win: 2 * POD_STANDARD - 1, draw: 1, loss: 0 };

/**
 * Mesão, desempates do cEDH Europa (adendo multijogador da MTR, 3.1A e apêndice C), nesta ordem:
 * 1. pontos;
 * 2. MW% (aproveitamento): pontos ÷ (mesas jogadas × pontos da vitória);
 * 3. pontos médios dos adversários: soma dos pontos de cada adversário ÷ número de adversários
 *    (quem dividiu mesa duas vezes conta duas vezes);
 * 4. OMW%: média do MW% dos adversários, cada um com piso de 1 ÷ pontos da vitória (1/7), e não 1/3 como
 *    no 1 × 1; quem jogou numa mesa de 3 soma um adversário fantasma com esse piso.
 * Depois disso, o sorteio feito na inscrição. Quem saiu continua contando para quem jogou com ele.
 * Os 4 primeiros jogam a mesa final, que decide o campeão (ver `finalists` no engine).
 */
function podStandings(t: Pick<Tournament, "players" | "rounds" | "settings">, upto: number): Standing[] {
  const points = t.settings.points;
  const stats = collectStats(t.players, t.rounds, points, upto);
  const floor = points.win > 0 ? 1 / points.win : 0;
  const share = (s: PlayerStats) => (s.roundsPlayed && points.win > 0 ? s.points / (points.win * s.roundsPlayed) : 0);
  const rows = t.players.map((p) => {
    const s = stats.get(p.id)!;
    const opp = s.opponents.filter((o) => stats.has(o));
    const ghosts = s.games.reduce((n, g) => n + (g.pod ? Math.max(0, POD_STANDARD - g.pod.players.length) : 0), 0);
    const oppShares = [...opp.map((o) => Math.max(floor, share(stats.get(o)!))), ...Array<number>(ghosts).fill(floor)];
    return { player: p, s, mwp: share(s), oamp: mean(opp.map((o) => stats.get(o)!.points)), omw: mean(oppShares) };
  });
  rows.sort((x, y) => comparePodRows(x, y) || x.player.lot - y.player.lot);
  return rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.player.id,
    points: r.s.points,
    wins: r.s.wins,
    losses: r.s.losses,
    draws: r.s.draws,
    byes: 0,
    matchesPlayed: r.s.roundsPlayed,
    mwp: r.mwp,
    omw: r.omw,
    oamp: r.oamp,
    gwp: 0,
    ogw: 0,
    dropped: r.player.droppedAfter !== null,
  }));
}

type PodRow = { s: { points: number }; mwp: number; oamp: number; omw: number };
const comparePodRows = (x: PodRow, y: PodRow) => cmp(x.s.points, y.s.points) || cmp(x.mwp, y.mwp) || cmp(x.oamp, y.oamp) || cmp(x.omw, y.omw);

/** Dois jogadores do mesão empatados em todos os critérios (só o sorteio os separaria). */
export const podTied = (a: Standing, b: Standing) => comparePodRows({ s: a, mwp: a.mwp, oamp: a.oamp ?? 0, omw: a.omw }, { s: b, mwp: b.mwp, oamp: b.oamp ?? 0, omw: b.omw }) === 0;

/** Classificação completa (dropados incluídos, marcados). `upto` limita a rodadas já jogadas. */
export function standings(t: Pick<Tournament, "players" | "rounds" | "settings">, upto = Infinity): Standing[] {
  if (isPodTournament(t)) return podStandings(t, upto);
  const points = t.settings.points;
  const stats = collectStats(t.players, t.rounds, points, upto);
  const mwp = new Map<ID, number>();
  const gwp = new Map<ID, number>();
  for (const s of stats.values()) {
    mwp.set(s.playerId, matchWinPct(s, points));
    gwp.set(s.playerId, gameWinPct(s));
  }
  const rows = t.players.map((p) => {
    const s = stats.get(p.id)!;
    const opp = s.opponents.filter((o) => stats.has(o));
    return {
      player: p,
      s,
      mwp: mwp.get(p.id)!,
      omw: mean(opp.map((o) => mwp.get(o)!)),
      gwp: gwp.get(p.id)!,
      ogw: mean(opp.map((o) => gwp.get(o)!)),
    };
  });
  rows.sort((x, y) => cmp(x.s.points, y.s.points) || cmp(x.omw, y.omw) || cmp(x.gwp, y.gwp) || cmp(x.ogw, y.ogw) || x.player.lot - y.player.lot);
  return rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.player.id,
    points: r.s.points,
    wins: r.s.wins,
    losses: r.s.losses,
    draws: r.s.draws,
    byes: r.s.byes,
    matchesPlayed: r.s.roundsPlayed,
    mwp: r.mwp,
    omw: r.omw,
    gwp: r.gwp,
    ogw: r.ogw,
    dropped: r.player.droppedAfter !== null,
  }));
}

/** Histórico de partidas de um jogador, rodada a rodada. */
export function history(t: Pick<Tournament, "players" | "rounds" | "settings">, playerId: ID): Game[] {
  return collectStats(t.players, t.rounds, t.settings.points).get(playerId)?.games ?? [];
}
