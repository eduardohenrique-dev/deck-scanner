/** Exportar e compartilhar: texto pronto para colar no WhatsApp e CSV para planilha. */
import { bracketView, playoffPlacing, roundName } from "./bracket.ts";
import { champion, plannedRounds } from "./engine.ts";
import { standings } from "./standings.ts";
import type { ID, Score, Structure, Tournament } from "./types.ts";

export const pct = (x: number) => `${(x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const record = (w: number, l: number, d: number) => `${w}-${l}-${d}`;
export const scoreText = (s: Score) => (s.draws ? `${s.a}-${s.b}-${s.draws}` : `${s.a}-${s.b}`);

export function structureLabel(s: Structure, rounds: number): string {
  if (s.kind === "single-elimination") return "Eliminação simples";
  const base = s.kind === "round-robin" ? "Todos contra todos" : rounds > 0 ? `Suíço, ${rounds} ${rounds === 1 ? "rodada" : "rodadas"}` : "Suíço";
  return s.cut !== null ? `${base} + Top ${s.cut}` : base;
}

export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function names(t: Tournament) {
  const map = new Map<ID, string>(t.players.map((p) => [p.id, p.name]));
  return (id: ID | null) => (id ? (map.get(id) ?? "?") : "folga");
}

function header(t: Tournament): string[] {
  const lines = [`*${t.name}*`];
  const bits = [dateLabel(t.date), t.gameFormat, `${t.players.length} jogadores`, structureLabel(t.structure, plannedRounds(t))].filter(Boolean);
  lines.push(bits.join(" · "));
  return lines;
}

/** Emparelhamentos da rodada, na ordem das mesas (a folga no fim). */
export function pairingsText(t: Tournament, roundNo: number): string {
  const r = t.rounds.find((x) => x.number === roundNo);
  if (!r) return "";
  const name = names(t);
  const lines = [...header(t), "", `*Rodada ${r.number}*`];
  for (const m of r.matches) {
    if (m.b === null) lines.push(`Folga: ${name(m.a)}`);
    else lines.push(`Mesa ${m.table}: ${name(m.a)} × ${name(m.b)}${m.result ? ` (${scoreText(m.result)})` : ""}`);
  }
  return lines.join("\n");
}

/** Classificação atual com os desempates. */
export function standingsText(t: Tournament): string {
  const name = names(t);
  const played = t.rounds.filter((r) => r.matches.every((m) => m.result)).length;
  const lines = [...header(t), "", played ? `*Classificação após a rodada ${played}*` : "*Classificação*"];
  for (const s of standings(t)) {
    lines.push(`${s.rank}. ${name(s.playerId)} — ${s.points} pts (${record(s.wins, s.losses, s.draws)}) · OMW ${pct(s.omw)} · GW ${pct(s.gwp)}${s.dropped ? " · saiu" : ""}`);
  }
  return lines.join("\n");
}

/** Resultado final: campeão, mata-mata e a classificação do suíço. */
export function finalText(t: Tournament): string {
  const name = names(t);
  const lines = [...header(t), ""];
  const champ = champion(t);
  if (champ) lines.push(`Campeão: *${name(champ)}*`);
  if (t.playoff) {
    const view = bracketView(t.playoff);
    for (let r = view.rounds.length - 1; r >= 0; r--) {
      const matches = view.rounds[r].filter((s) => !s.bye && s.a && s.b);
      if (!matches.length) continue;
      lines.push("", `*${roundName(view.rounds[r].length, r)}*`);
      for (const s of matches) lines.push(`${name(s.a!.playerId)} × ${name(s.b!.playerId)}${s.result ? ` (${scoreText(s.result.score)})` : ""}`);
    }
  }
  if (t.rounds.length) {
    lines.push("", "*Classificação do suíço*");
    for (const s of standings(t)) lines.push(`${s.rank}. ${name(s.playerId)} — ${s.points} pts (${record(s.wins, s.losses, s.draws)})`);
  }
  return lines.join("\n");
}

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number)[][]) => BOM + rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
const ratio = (x: number) => x.toFixed(4);
/** marca de ordem de bytes: faz o Excel abrir o CSV como UTF-8 (acentos dos nomes) */
const BOM = String.fromCharCode(0xfeff);

/** Classificação em CSV (percentuais como fração, com ponto decimal, que toda planilha entende). */
export function standingsCsv(t: Tournament): string {
  const name = names(t);
  const deck = new Map(t.players.map((p) => [p.id, p.deck?.name ?? ""]));
  const placing = t.playoff ? new Map(playoffPlacing(bracketView(t.playoff)).map((x) => [x.playerId, x.place])) : new Map<ID, number>();
  const rows: (string | number)[][] = [["posicao", "jogador", "deck", "pontos", "vitorias", "derrotas", "empates", "folgas", "omw", "gw", "ogw", "saiu", "mata_mata"]];
  for (const s of standings(t)) {
    rows.push([s.rank, name(s.playerId), deck.get(s.playerId) ?? "", s.points, s.wins, s.losses, s.draws, s.byes, ratio(s.omw), ratio(s.gwp), ratio(s.ogw), s.dropped ? "sim" : "", placing.get(s.playerId) ?? ""]);
  }
  return csv(rows);
}

/** Todas as partidas (suíço e mata-mata) em CSV. */
export function matchesCsv(t: Tournament): string {
  const name = names(t);
  const rows: (string | number)[][] = [["fase", "rodada", "mesa", "jogador_a", "jogador_b", "games_a", "games_b", "empates"]];
  for (const r of t.rounds) {
    for (const m of r.matches) rows.push(["suico", r.number, m.table ?? "", name(m.a), m.b ? name(m.b) : "folga", m.result?.a ?? "", m.result?.b ?? "", m.result?.draws ?? ""]);
  }
  if (t.playoff) {
    const view = bracketView(t.playoff);
    view.rounds.forEach((round, r) => {
      for (const s of round) {
        if (s.bye || !s.a || !s.b) continue;
        rows.push([roundName(round.length, r), r + 1, s.index + 1, name(s.a.playerId), name(s.b.playerId), s.result?.score.a ?? "", s.result?.score.b ?? "", s.result?.score.draws ?? ""]);
      }
    });
  }
  return csv(rows);
}
