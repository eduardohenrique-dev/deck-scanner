import type { ServerSummary } from "../../lib/api";
import { plannedRounds, summary } from "../../tournament/engine.ts";
import { structureLabel } from "../../tournament/export.ts";
import type { Tone } from "../ui";
import type { StageId, Status, Structure, Summary, Tournament } from "../../tournament/types.ts";

export const STATUS_LABEL: Record<Status, string> = { draft: "Rascunho", running: "Em andamento", finished: "Finalizado" };
export const STATUS_TONE: Record<Status, Tone> = { draft: "neutral", running: "live", finished: "brass" };

export const STAGE_LABEL: Record<StageId, string> = {
  setup: "Configurar",
  players: "Inscrições",
  rounds: "Rodadas",
  cut: "Corte",
  bracket: "Bracket",
  champion: "Campeão",
};

export type StructureChoice = "swiss" | "swiss-cut" | "single-elimination" | "round-robin";

export const STRUCTURES: { id: StructureChoice; title: string; text: string }[] = [
  { id: "swiss", title: "Suíço", text: "Todos jogam todas as rodadas; vence quem somar mais pontos." },
  { id: "swiss-cut", title: "Suíço + corte", text: "Rodadas suíças e depois mata-mata com os melhores." },
  { id: "single-elimination", title: "Eliminação simples", text: "Perdeu, saiu. A chave sai na hora." },
  { id: "round-robin", title: "Todos contra todos", text: "Cada um enfrenta todos os outros uma vez." },
];

export function choiceOf(s: Structure): StructureChoice {
  if (s.kind === "single-elimination") return "single-elimination";
  if (s.kind === "round-robin") return "round-robin";
  return s.cut !== null ? "swiss-cut" : "swiss";
}

/** Frase curta do andamento, para listas e cabeçalhos. */
export function progressLine(s: Partial<Summary>): string {
  if (s.status === "finished") return s.champion ? `Campeão: ${s.champion}` : "Finalizado";
  if (s.status === "draft") return s.players ? `Inscrições abertas · ${s.players} ${s.players === 1 ? "jogador" : "jogadores"}` : "Inscrições abertas";
  if (s.stage === "cut") return "Hora do corte";
  if (s.stage === "bracket") return "Mata-mata";
  if (s.round) return s.rounds ? `Rodada ${s.round} de ${s.rounds}` : `Rodada ${s.round}`;
  return "Em andamento";
}

export const firstName = (name: string) => name.split(" ")[0] ?? name;

export const playerName = (t: Tournament) => {
  const map = new Map(t.players.map((p) => [p.id, p.name]));
  return (id: string | null | undefined) => (id ? (map.get(id) ?? "?") : "Folga");
};

export function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const newId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, "");

/** Resumo para a lista de torneios (o servidor só guarda, não calcula). */
export function serverSummary(t: Tournament): ServerSummary {
  return { ...summary(t), format: t.gameFormat || undefined, structure: structureLabel(t.structure, plannedRounds(t)) };
}
