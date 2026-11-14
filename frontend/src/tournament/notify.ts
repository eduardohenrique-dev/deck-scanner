/**
 * Aviso de rodada para o Telegram: o que mudou (rodada nova ou mesa final), o título e a posição de cada um.
 * As mesas o servidor tira do torneio salvo; daqui vão só a classificação e o texto do cabeçalho, porque as
 * regras (desempates) moram no cliente.
 */
import { plannedRounds, type Command } from "./engine.ts";
import { standings } from "./standings.ts";
import type { Tournament } from "./types.ts";

export type Announcement = {
  notice: string;
  heading: string;
  standings: Record<string, { rank: number | null; points: number | null }>;
};

/** Qual aviso um comando gera, olhando o torneio depois dele (null = nenhum). */
export function noticeFor(cmd: Command, after: Tournament): string | null {
  if (cmd.type === "makeFinal") return after.tiebreak ? "final" : null;
  if (cmd.type === "start" || cmd.type === "pairNext") return after.rounds.length ? `r${after.rounds.length}` : null;
  return null;
}

/**
 * Monta o aviso. A posição é a de antes da rodada (na 1ª rodada não há posição) e, na mesa final, a das
 * rodadas, que também é a ordem de jogo.
 */
export function announcement(t: Tournament, notice: string): Announcement | null {
  const final = notice === "final";
  const number = final ? null : Number(notice.slice(1));
  if (final ? !t.tiebreak : !t.rounds.some((r) => r.number === number)) return null;
  const before = final ? t.rounds.length : (number ?? 1) - 1;
  const table = before > 0 ? standings(t, before) : [];
  const ranks: Announcement["standings"] = {};
  for (const s of table) ranks[s.playerId] = { rank: s.rank, points: s.points };
  const heading = final ? "Mesa final" : `Rodada ${number} de ${Math.max(plannedRounds(t), number ?? 1)}`;
  return { notice, heading, standings: ranks };
}
