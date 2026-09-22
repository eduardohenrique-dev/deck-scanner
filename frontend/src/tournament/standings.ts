/**
 * Classificação e desempates da MTR (apêndice C):
 * pontos → OMW% → GW% → OGW%, com piso de 1/3 em cada percentual.
 * - bye vale vitória por 2 a 0 (3 pontos de partida e 6 de game);
 * - a rodada de bye não entra na média dos oponentes;
 * - quem saiu continua contando para quem jogou com ele.
 */
import type { ID, Match, Player, Points, Round, Score, Standing, Tournament } from "./types.ts";

export const FLOOR = 1 / 3;
const EPS = 1e-9;

export type Outcome = "win" | "loss" | "draw" | "bye";

export type Game = { round: number; table: number | null; opponent: ID | null; score: Score; outcome: Outcome };

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
  }
  return map;
}

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

/** Classificação completa (dropados incluídos, marcados). `upto` limita a rodadas já jogadas. */
export function standings(t: Pick<Tournament, "players" | "rounds" | "settings">, upto = Infinity): Standing[] {
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
