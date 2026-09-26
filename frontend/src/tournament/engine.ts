/**
 * O torneio como uma sequência de comandos puros: cada comando recebe o torneio e devolve um novo.
 * Comandos carregam tudo o que precisam (ids, horários, sementes), então aplicar de novo a mesma lista dá
 * o mesmo resultado. É isso que permite juntar ações de dois aparelhos (replay) e desfazer (comando inverso).
 */
import { bracketView, drawSeeds, pruneStale } from "./bracket.ts";
import { activeIn, BYE_SCORE, pairRoundRobin, pairSwiss, roundRobinCount, suggestRounds } from "./pairing.ts";
import { pairPods, suggestPodRounds } from "./pods.ts";
import { derive, mulberry32 } from "./rng.ts";
import { standings } from "./standings.ts";
import type { DeckRef, ID, Match, Player, Playoff, Pod, PodResult, Round, Score, Settings, StageId, Status, Structure, Summary, Tournament } from "./types.ts";

export class TournamentError extends Error {}

// declaração de função (e não const): assim o TypeScript entende que o código depois dela não roda
function fail(message: string): never {
  throw new TournamentError(message);
}

export const DEFAULT_SETTINGS: Settings = { bestOf: 3, playoffBestOf: 3, points: { win: 3, draw: 1, loss: 0 }, roundMinutes: 50, seeding: "standings" };

export function createTournament(input: { id: ID; name: string; date: string; gameFormat?: string; notes?: string; seed: number; at: string }): Tournament {
  return {
    schema: 1,
    id: input.id,
    name: cleanName(input.name) || "Torneio",
    date: input.date,
    gameFormat: (input.gameFormat ?? "").trim().slice(0, 60),
    notes: input.notes ?? "",
    structure: { kind: "swiss", rounds: 0, cut: null },
    settings: DEFAULT_SETTINGS,
    seed: input.seed >>> 0,
    players: [],
    rounds: [],
    playoff: null,
    startedAt: null,
    finishedAt: null,
    createdAt: input.at,
    updatedAt: input.at,
  };
}

// ------------------------------------------------------------------ leitura
export const isDraft = (t: Tournament) => t.startedAt === null;
export const isPods = (s: Structure) => s.kind === "pods";
/** Corte do suíço ou do todos contra todos (null: sem corte, ou estrutura sem corte). */
export const cutOf = (s: Structure): number | null => (s.kind === "swiss" || s.kind === "round-robin" ? s.cut : null);
export const hasPlayoff = (s: Structure) => s.kind === "single-elimination" || cutOf(s) !== null;

export function status(t: Tournament): Status {
  return t.startedAt === null ? "draft" : t.finishedAt ? "finished" : "running";
}

/** Rodadas planejadas da fase classificatória (suíço ou todos contra todos). */
export function plannedRounds(t: Tournament): number {
  const s = t.structure;
  if (s.kind === "single-elimination") return 0;
  if (s.kind === "round-robin") return roundRobinCount(t.players.length);
  if (s.kind === "pods") return s.rounds > 0 ? s.rounds : suggestPodRounds(t.players.length);
  return s.rounds > 0 ? s.rounds : suggestRounds(t.players.length, s.cut);
}

export const roundComplete = (r: Round) => r.matches.every((m) => m.result !== null) && (r.pods ?? []).every((p) => p.result !== null);
export const currentRound = (t: Tournament): Round | null => t.rounds[t.rounds.length - 1] ?? null;
export const pendingTables = (r: Round) =>
  [...r.matches.filter((m) => m.b !== null && m.result === null).map((m) => m.table!), ...(r.pods ?? []).filter((p) => !p.result).map((p) => p.table)].sort((a, b) => a - b);

/** A fase classificatória terminou (todas as rodadas planejadas completas). */
export function roundsDone(t: Tournament): boolean {
  return t.rounds.length >= plannedRounds(t) && t.rounds.every(roundComplete);
}

/** Mesão: quem está na frente em pontos, sem contar quem saiu (mais de um = empate na liderança). */
export function leaders(t: Tournament): ID[] {
  const table = standings(t).filter((s) => !s.dropped);
  if (!table.length) return [];
  const top = table[0].points;
  return table.filter((s) => s.points === top).map((s) => s.playerId);
}

/** Mesão com as rodadas completas e empate na liderança: o campeão sai de uma final entre os empatados. */
export const needsFinal = (t: Tournament) => isPods(t.structure) && roundsDone(t) && leaders(t).length > 1;

export function stages(t: Tournament): StageId[] {
  const s = t.structure;
  if (s.kind === "single-elimination") return ["setup", "players", "bracket", "champion"];
  if (s.kind === "pods") return ["setup", "players", "rounds", ...(t.tiebreak || needsFinal(t) ? (["final"] as const) : []), "champion"];
  return s.cut !== null ? ["setup", "players", "rounds", "cut", "bracket", "champion"] : ["setup", "players", "rounds", "champion"];
}

/** Etapa em que o torneio está (a tela pode mostrar outra já alcançada). Em rascunho, "setup". */
export function stage(t: Tournament): StageId {
  if (isDraft(t)) return "setup";
  if (t.finishedAt) return "champion";
  const s = t.structure;
  if (s.kind === "single-elimination") return "bracket";
  if (s.kind === "pods") return roundsDone(t) && (t.tiebreak || needsFinal(t)) ? "final" : "rounds";
  if (!roundsDone(t) || s.cut === null) return "rounds";
  return t.playoff ? "bracket" : "cut";
}

/** Campeões: um só, ou os finalistas que dividiram o prêmio no mesão. Vazio enquanto não houver. */
export function champions(t: Tournament): ID[] {
  if (isPods(t.structure)) {
    const r = t.tiebreak?.result;
    if (r) return r.kind === "win" ? [r.winner] : r.kind === "split" ? r.players : [];
    if (t.finishedAt && !t.tiebreak) {
      const top = leaders(t);
      return top.length === 1 ? top : [];
    }
    return [];
  }
  if (t.playoff) {
    const c = bracketView(t.playoff).champion;
    return c ? [c] : [];
  }
  if (!hasPlayoff(t.structure) && t.finishedAt) {
    const c = standings(t)[0]?.playerId;
    return c ? [c] : [];
  }
  return [];
}

export const champion = (t: Tournament): ID | null => champions(t)[0] ?? null;

export function summary(t: Tournament): Summary {
  const name = (id: ID | null) => (id ? (t.players.find((p) => p.id === id)?.name ?? null) : null);
  const table = t.rounds.length ? standings(t) : [];
  const won = champions(t)
    .map(name)
    .filter((x): x is string => !!x);
  return {
    status: status(t),
    stage: stage(t),
    players: t.players.length,
    round: t.rounds.length,
    rounds: plannedRounds(t),
    champion: won.length ? listPt(won) : null,
    leader: table.length ? name(table[0].playerId) : null,
  };
}

export function listPt(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** Por que não dá para começar (null = pode). */
export function startBlocker(t: Tournament): string | null {
  const n = t.players.length;
  const s = t.structure;
  if (s.kind === "pods") return n < 3 ? "O mesão precisa de pelo menos 3 jogadores." : null;
  if (n < 2) return "Inscreva pelo menos 2 jogadores.";
  if (s.kind !== "single-elimination" && s.cut !== null) {
    if (s.cut < 2) return "O corte precisa de pelo menos 2 jogadores.";
    if (s.cut > n) return `O corte Top ${s.cut} precisa de pelo menos ${s.cut} jogadores (há ${n}).`;
  }
  return null;
}

/** Por que não dá para gerar a próxima rodada (null = pode). */
export function nextRoundBlocker(t: Tournament): string | null {
  if (isDraft(t)) return "O torneio ainda não começou.";
  if (t.structure.kind === "single-elimination") return "Eliminação simples não tem rodadas suíças.";
  if (t.playoff) return "O corte já foi feito.";
  if (t.tiebreak) return "A final já foi montada.";
  const r = currentRound(t);
  if (r && !roundComplete(r)) return pendingReason(r);
  if (t.rounds.length >= plannedRounds(t)) return "Todas as rodadas planejadas já foram jogadas.";
  const active = t.players.filter((p) => activeIn(p, t.rounds.length + 1)).length;
  if (isPods(t.structure) && active < 3) return "Faltam jogadores ativos para montar as mesas (mínimo 3).";
  if (active < 2) return "Faltam jogadores ativos para emparelhar.";
  return null;
}

/** "Falta o placar da mesa 3." / "Faltam os resultados das mesas 1 e 2." */
export function pendingReason(r: Round): string {
  const tables = pendingTables(r);
  const what = r.pods?.length ? ["o resultado", "os resultados"] : ["o placar", "os placares"];
  return tables.length === 1 ? `Falta ${what[0]} da mesa ${tables[0]}.` : `Faltam ${what[1]} das mesas ${listPt(tables.map(String))}.`;
}

// ------------------------------------------------------------------ comandos
export type Command =
  | { type: "rename"; name: string }
  | { type: "setInfo"; date?: string; gameFormat?: string; notes?: string }
  | { type: "setStructure"; structure: Structure }
  | { type: "setSettings"; settings: Partial<Settings> }
  | { type: "addPlayers"; players: { id: ID; name: string; deck?: DeckRef | null; lot: number }[] }
  | { type: "updatePlayer"; id: ID; name?: string; deck?: DeckRef | null }
  | { type: "removePlayer"; id: ID }
  | { type: "restorePlayer"; player: Player; index: number }
  | { type: "start"; at: string }
  | { type: "unstart" }
  | { type: "pairNext"; nonce?: number }
  | { type: "repair"; round: number; nonce: number }
  | { type: "deleteRound"; round: number }
  | { type: "restoreRound"; round: Round }
  | { type: "result"; round: number; match: ID; score: Score | null; at: string }
  | { type: "swap"; round: number; x: ID; y: ID }
  | { type: "drop"; player: ID }
  | { type: "undrop"; player: ID }
  | { type: "timer"; round: number; action: "start" | "pause" | "resume" | "reset"; at: string }
  | { type: "cut"; seeding: "standings" | "random"; at: string; nonce?: number }
  | { type: "uncut" }
  | { type: "restorePlayoff"; playoff: Playoff | null }
  | { type: "bracketResult"; key: string; score: Score | null; at: string }
  | { type: "podResult"; round: number; pod: ID; result: PodResult | null; at: string }
  | { type: "makeFinal"; at: string }
  | { type: "unmakeFinal" }
  | { type: "restoreFinal"; pod: Pod | null }
  | { type: "finalResult"; result: PodResult | null; at: string }
  | { type: "finish"; at: string }
  | { type: "reopen" };

function cleanName(s: string) {
  return s.replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Placar coerente com o formato (melhor de 1 ou 3); no mata-mata não há empate. */
export function scoreProblem(score: Score, bestOf: 1 | 3, allowDraw: boolean): string | null {
  const vals = [score.a, score.b, score.draws];
  if (vals.some((v) => !Number.isInteger(v) || v < 0 || v > 5)) return "Placar inválido.";
  const need = bestOf === 3 ? 2 : 1;
  if (score.a > need || score.b > need) return `Numa melhor de ${bestOf}, ninguém passa de ${need} vitória${need > 1 ? "s" : ""}.`;
  if (score.a === need && score.b === need) return "Os dois não podem ter vencido a partida.";
  if (score.a + score.b + score.draws > bestOf + 2) return "Games demais para uma partida.";
  if (!allowDraw && score.a === score.b) return "No mata-mata não existe empate: alguém precisa vencer.";
  return null;
}

/**
 * Resultado coerente com a mesa. Nas rodadas há tempo: sem vencedor, quem estava vivo empata (pelo menos
 * 2; com um só vivo, ele venceu). A final não tem tempo: termina com um vencedor ou com o prêmio dividido.
 */
export function podResultProblem(r: PodResult, players: ID[], final: boolean): string | null {
  const inPod = (ids: ID[]) => ids.every((id) => players.includes(id));
  const unique = (ids: ID[]) => new Set(ids).size === ids.length;
  switch (r.kind) {
    case "win":
      return players.includes(r.winner) ? null : "Quem venceu precisa estar na mesa.";
    case "draw":
      if (final) return "A final não tem tempo limite: termina com um vencedor ou com o prêmio dividido.";
      if (!inPod(r.survivors) || !unique(r.survivors)) return "Os sobreviventes precisam estar na mesa.";
      return r.survivors.length < 2 ? "Com um só jogador vivo no fim do tempo, ele é o vencedor." : null;
    case "split":
      if (!final) return "Dividir o prêmio só vale na final.";
      if (!inPod(r.players) || !unique(r.players)) return "Quem divide o prêmio precisa estar na final.";
      return r.players.length < 2 ? "Para dividir o prêmio, marque pelo menos 2 finalistas." : null;
  }
}

/** Guarda os ids na ordem da mesa (o mesmo resultado sempre grava igual). */
function normalizeResult(r: PodResult, players: ID[]): PodResult {
  const order = (ids: ID[]) => players.filter((id) => ids.includes(id));
  if (r.kind === "draw") return { kind: "draw", survivors: order(r.survivors) };
  if (r.kind === "split") return { kind: "split", players: order(r.players) };
  return { kind: "win", winner: r.winner };
}

function mapRound(t: Tournament, roundNo: number, fn: (r: Round) => Round): Tournament {
  const idx = t.rounds.findIndex((r) => r.number === roundNo);
  if (idx < 0) fail("Rodada não encontrada.");
  const rounds = [...t.rounds];
  rounds[idx] = fn(rounds[idx]);
  return { ...t, rounds };
}

function newRound(t: Tournament, roundNo: number, nonce = 0): Round {
  const timer = { startedAt: null, pausedAt: null, pausedMs: 0 };
  if (isPods(t.structure)) return { number: roundNo, matches: [], pods: pairPods(t, roundNo, { rng: mulberry32(derive(t.seed, "pods", roundNo, nonce)) }), timer };
  const planned = plannedRounds(t);
  const matches =
    t.structure.kind === "round-robin"
      ? pairRoundRobin(t, roundNo)
      : pairSwiss(t, roundNo, { rng: mulberry32(derive(t.seed, "round", roundNo, nonce)), final: roundNo === planned && planned > 1 });
  return { number: roundNo, matches, timer: { startedAt: null, pausedAt: null, pausedMs: 0 } };
}

/** Classificados para o mata-mata: todos (eliminação direta) ou o top X da classificação, sem quem saiu. */
export function qualified(t: Tournament): ID[] {
  if (t.structure.kind === "single-elimination") return t.players.filter((p) => p.droppedAfter === null).map((p) => p.id);
  const cut = cutOf(t.structure) ?? 0;
  return standings(t)
    .filter((s) => !s.dropped)
    .slice(0, cut)
    .map((s) => s.playerId);
}

function makePlayoff(t: Tournament, seeding: "standings" | "random", at: string, nonce = 0): Playoff {
  const ids = qualified(t);
  if (ids.length < 2) fail("O mata-mata precisa de pelo menos 2 jogadores ativos.");
  const rng = mulberry32(derive(t.seed, "bracket", nonce));
  // no mata-mata direto sorteado, até as folgas são sorteadas (não há classificação para premiar)
  const seeds = drawSeeds(ids, seeding, rng, t.structure.kind !== "single-elimination");
  return { cut: ids.length, seeding, seeds, results: {}, drawnAt: at };
}

const hasPlayed = (r: Round) => r.matches.some((m) => m.result && m.b !== null) || (r.pods ?? []).some((p) => p.result);

/** A mesa que o jogador abandona se sair agora: a dele na rodada atual, ainda sem placar (folga não conta). */
export function leavesMatch(r: Round, player: ID): Match | null {
  const m = r.matches.find((x) => x.a === player || x.b === player);
  return m && m.b !== null && !m.result ? m : null;
}

/** Mesão: a mesa que o jogador deixa se sair agora (a da rodada atual, ainda sem resultado). */
export function leavesPod(r: Round, player: ID): Pod | null {
  const p = (r.pods ?? []).find((x) => x.players.includes(player));
  return p && !p.result ? p : null;
}

const FINAL_LOCK = "Depois de montar a final, as rodadas ficam travadas. Desfaça a final para corrigir.";

/** Aplica um comando. Lança TournamentError com a explicação quando ele não cabe no estado atual. */
export function apply(t: Tournament, cmd: Command): Tournament {
  switch (cmd.type) {
    case "rename":
      return { ...t, name: cleanName(cmd.name) || t.name };

    case "setInfo":
      return {
        ...t,
        date: cmd.date ?? t.date,
        gameFormat: cmd.gameFormat !== undefined ? cmd.gameFormat.trim().slice(0, 60) : t.gameFormat,
        notes: cmd.notes !== undefined ? cmd.notes.slice(0, 2000) : t.notes,
      };

    case "setStructure": {
      const s = cmd.structure;
      const cut = cutOf(s);
      if (cut !== null && (!Number.isInteger(cut) || cut < 2)) fail("O corte precisa ser de pelo menos 2 jogadores.");
      if ((s.kind === "swiss" || s.kind === "pods") && (!Number.isInteger(s.rounds) || s.rounds < 0 || s.rounds > 20)) fail("Número de rodadas inválido.");
      if (!isDraft(t)) {
        // em andamento, só o número de rodadas (e o corte do suíço, antes de ser feito) mudam
        const was = t.structure;
        if (s.kind === "swiss" && was.kind === "swiss") {
          if (s.cut !== was.cut && t.playoff) fail("O corte já foi feito.");
        } else if (!(s.kind === "pods" && was.kind === "pods")) fail("A estrutura não muda depois que o torneio começa.");
        if (s.kind === "pods" && t.tiebreak) fail("A final já foi montada.");
        if ((s.kind === "swiss" || s.kind === "pods") && s.rounds < t.rounds.length) fail(`Já foram geradas ${t.rounds.length} rodadas.`);
      }
      return { ...t, structure: s };
    }

    case "setSettings": {
      const settings: Settings = { ...t.settings, ...cmd.settings, points: { ...t.settings.points, ...(cmd.settings.points ?? {}) } };
      const p = settings.points;
      if ([p.win, p.draw, p.loss].some((v) => !Number.isFinite(v) || v < 0 || v > 100)) fail("Pontuação inválida.");
      if (p.win <= p.draw || p.draw < p.loss) fail("A vitória precisa valer mais que o empate, e o empate não menos que a derrota.");
      if (settings.roundMinutes !== null && (settings.roundMinutes < 1 || settings.roundMinutes > 600)) fail("Tempo de rodada inválido.");
      if (!isDraft(t) && (settings.bestOf !== t.settings.bestOf || settings.points.win !== t.settings.points.win || settings.points.draw !== t.settings.points.draw || settings.points.loss !== t.settings.points.loss))
        fail("Formato de partida e pontuação não mudam depois que o torneio começa.");
      return { ...t, settings };
    }

    case "addPlayers": {
      if (!isDraft(t)) fail("As inscrições fecharam quando o torneio começou.");
      const names = new Set(t.players.map((p) => p.name.toLocaleLowerCase("pt-BR")));
      const fresh: Player[] = [];
      for (const p of cmd.players) {
        const name = cleanName(p.name);
        const key = name.toLocaleLowerCase("pt-BR");
        if (!name || names.has(key)) continue;
        names.add(key);
        fresh.push({ id: p.id, name, deck: p.deck ?? null, droppedAfter: null, lot: p.lot });
      }
      if (!fresh.length) fail(cmd.players.length === 1 ? "Esse nome já está na lista." : "Nenhum nome novo para inscrever.");
      return { ...t, players: [...t.players, ...fresh] };
    }

    case "updatePlayer": {
      const idx = t.players.findIndex((p) => p.id === cmd.id);
      if (idx < 0) fail("Jogador não encontrado.");
      const players = [...t.players];
      const name = cmd.name !== undefined ? cleanName(cmd.name) : players[idx].name;
      if (!name) fail("O nome não pode ficar vazio.");
      if (players.some((p, i) => i !== idx && p.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) fail("Já existe um jogador com esse nome.");
      players[idx] = { ...players[idx], name, deck: cmd.deck !== undefined ? cmd.deck : players[idx].deck };
      return { ...t, players };
    }

    case "removePlayer": {
      if (!isDraft(t)) fail("Depois do início, use “saiu do torneio” em vez de remover.");
      if (!t.players.some((p) => p.id === cmd.id)) fail("Jogador não encontrado.");
      return { ...t, players: t.players.filter((p) => p.id !== cmd.id) };
    }

    case "restorePlayer": {
      if (!isDraft(t) || t.players.some((p) => p.id === cmd.player.id)) return t;
      const players = [...t.players];
      players.splice(Math.min(cmd.index, players.length), 0, cmd.player);
      return { ...t, players };
    }

    case "start": {
      if (!isDraft(t)) fail("O torneio já começou.");
      const blocker = startBlocker(t);
      if (blocker) fail(blocker);
      let s = t.structure;
      if (s.kind === "swiss" && s.rounds <= 0) s = { ...s, rounds: suggestRounds(t.players.length, s.cut) };
      if (s.kind === "pods" && s.rounds <= 0) s = { ...s, rounds: suggestPodRounds(t.players.length) };
      const started: Tournament = { ...t, structure: s, startedAt: cmd.at };
      if (s.kind === "single-elimination") return { ...started, playoff: makePlayoff(started, t.settings.seeding, cmd.at) };
      return { ...started, rounds: [newRound(started, 1)] };
    }

    case "unstart": {
      if (isDraft(t)) return t;
      if (t.rounds.some(hasPlayed) || (t.playoff && Object.keys(t.playoff.results).length)) fail("Já há placares lançados.");
      return { ...t, startedAt: null, rounds: [], playoff: null, tiebreak: null, finishedAt: null };
    }

    case "pairNext": {
      const blocker = nextRoundBlocker(t);
      if (blocker) fail(blocker);
      return { ...t, rounds: [...t.rounds, newRound(t, t.rounds.length + 1, cmd.nonce ?? 0)] };
    }

    case "repair": {
      const r = currentRound(t);
      if (!r || r.number !== cmd.round) fail("Só a rodada atual pode ser emparelhada de novo.");
      if (hasPlayed(r!)) fail("Esta rodada já tem placar lançado.");
      if (t.playoff) fail("O corte já foi feito.");
      if (t.tiebreak) fail(FINAL_LOCK);
      const base = { ...t, rounds: t.rounds.slice(0, -1) };
      return { ...t, rounds: [...base.rounds, newRound(base, cmd.round, cmd.nonce)] };
    }

    case "deleteRound": {
      const r = currentRound(t);
      if (!r || r.number !== cmd.round) fail("Só a última rodada pode ser desfeita.");
      if (hasPlayed(r!)) fail("Esta rodada já tem placar lançado.");
      if (t.tiebreak) fail(FINAL_LOCK);
      if (t.rounds.length === 1) fail("A primeira rodada só sai junto com o início do torneio.");
      return { ...t, rounds: t.rounds.slice(0, -1) };
    }

    case "restoreRound": {
      if (t.rounds.some((r) => r.number === cmd.round.number)) return t;
      return { ...t, rounds: [...t.rounds, cmd.round].sort((a, b) => a.number - b.number) };
    }

    case "result": {
      const round = t.rounds.find((r) => r.number === cmd.round);
      if (!round) fail("Rodada não encontrada.");
      const match = round!.matches.find((m) => m.id === cmd.match);
      if (!match) fail("Mesa não encontrada.");
      if (match!.b === null) fail("Folga não tem placar para lançar.");
      if (t.playoff) fail("Depois do corte, os placares do suíço ficam travados. Desfaça o corte para corrigir.");
      if (cmd.score) {
        const problem = scoreProblem(cmd.score, t.settings.bestOf, true);
        if (problem) fail(problem);
      }
      return mapRound(t, cmd.round, (r) => ({
        ...r,
        matches: r.matches.map((m) => (m.id === cmd.match ? { ...m, result: cmd.score, at: cmd.score ? cmd.at : null } : m)),
      }));
    }

    case "swap": {
      const r = currentRound(t);
      if (!r || r.number !== cmd.round) fail("Só dá para trocar jogadores na rodada atual.");
      if (t.playoff) fail("O corte já foi feito.");
      if (t.tiebreak) fail(FINAL_LOCK);
      if (cmd.x === cmd.y) return t;
      if (r!.pods?.length) {
        const pods = r!.pods;
        const px = pods.findIndex((p) => p.players.includes(cmd.x));
        const py = pods.findIndex((p) => p.players.includes(cmd.y));
        if (px < 0 || py < 0) fail("Jogador fora desta rodada.");
        if (px === py) return t; // mesma mesa: no mesão não há lado
        if (pods[px].result || pods[py].result) fail("Tire o resultado da mesa antes de trocar os jogadores.");
        const put = (p: Pod, from: ID, to: ID): Pod => ({ ...p, players: p.players.map((id) => (id === from ? to : id)), manual: true });
        const next = [...pods];
        next[px] = put(pods[px], cmd.x, cmd.y);
        next[py] = put(pods[py], cmd.y, cmd.x);
        return mapRound(t, cmd.round, (x) => ({ ...x, pods: next }));
      }
      const where = (id: ID) => r!.matches.findIndex((m) => m.a === id || m.b === id);
      const ix = where(cmd.x);
      const iy = where(cmd.y);
      if (ix < 0 || iy < 0) fail("Jogador fora desta rodada.");
      const touched = [r!.matches[ix], r!.matches[iy]];
      if (touched.some((m) => m.b !== null && m.result)) fail("Tire o placar da mesa antes de trocar os jogadores.");
      const matches = [...r!.matches];
      if (ix === iy) {
        // os dois na mesma mesa: só inverte os lados
        const m = matches[ix];
        if (m.b) matches[ix] = { ...m, a: m.b, b: m.a, manual: true };
      } else {
        const put = (m: Match, from: ID, to: ID): Match => ({ ...m, a: m.a === from ? to : m.a, b: m.b === from ? to : m.b, manual: true });
        matches[ix] = put(matches[ix], cmd.x, cmd.y);
        matches[iy] = put(matches[iy], cmd.y, cmd.x);
      }
      return mapRound(t, cmd.round, (x) => ({ ...x, matches }));
    }

    case "drop": {
      const p = t.players.find((x) => x.id === cmd.player);
      if (!p) fail("Jogador não encontrado.");
      if (isDraft(t)) fail("Antes do início, é só remover da lista.");
      if (p!.droppedAfter !== null) return t;
      if (t.playoff) fail("Depois do corte, quem saiu fica só fora do mata-mata.");
      if (t.tiebreak) fail(FINAL_LOCK);
      const r = currentRound(t);
      const pod = r ? leavesPod(r, cmd.player) : null;
      if (r && pod) {
        // ainda não jogou a mesa atual: sai dela também e a mesa segue com os outros
        const pods = r.pods!.map((x) => (x === pod ? { ...x, players: x.players.filter((id) => id !== cmd.player) } : x));
        return {
          ...t,
          rounds: t.rounds.map((x) => (x === r ? { ...x, pods } : x)),
          players: t.players.map((x) => (x.id === cmd.player ? { ...x, droppedAfter: r.number - 1 } : x)),
        };
      }
      const m = r ? leavesMatch(r, cmd.player) : null;
      let rounds = t.rounds;
      let after = t.rounds.length;
      if (r && m) {
        // ainda não jogou a rodada atual: sai dela também e o oponente fica de folga
        after = r.number - 1;
        const other = m.a === cmd.player ? m.b! : m.a;
        const matches = [...r.matches.filter((x) => x !== m), { ...m, a: other, b: null, table: null, result: { ...BYE_SCORE }, id: `${m.id}x` }];
        rounds = t.rounds.map((x) => (x === r ? { ...x, matches } : x));
      }
      // com placar (ou folga) na rodada atual, ele termina esta e sai a partir da próxima
      return { ...t, rounds, players: t.players.map((x) => (x.id === cmd.player ? { ...x, droppedAfter: after } : x)) };
    }

    case "undrop": {
      const p = t.players.find((x) => x.id === cmd.player);
      if (!p) fail("Jogador não encontrado.");
      if (p!.droppedAfter === null) return t;
      if (t.rounds.length > p!.droppedAfter) fail("Já saiu emparelhamento sem ele; a volta só vale antes da próxima rodada.");
      if (t.playoff) fail("O corte já foi feito.");
      if (t.tiebreak) fail(FINAL_LOCK);
      return { ...t, players: t.players.map((x) => (x.id === cmd.player ? { ...x, droppedAfter: null } : x)) };
    }

    case "timer":
      return mapRound(t, cmd.round, (r) => {
        const tm = r.timer;
        switch (cmd.action) {
          case "start":
            return { ...r, timer: { startedAt: cmd.at, pausedAt: null, pausedMs: 0 } };
          case "pause":
            return tm.startedAt && !tm.pausedAt ? { ...r, timer: { ...tm, pausedAt: cmd.at } } : r;
          case "resume":
            return tm.pausedAt ? { ...r, timer: { ...tm, pausedAt: null, pausedMs: tm.pausedMs + Math.max(0, Date.parse(cmd.at) - Date.parse(tm.pausedAt)) } } : r;
          case "reset":
            return { ...r, timer: { startedAt: null, pausedAt: null, pausedMs: 0 } };
        }
      });

    case "cut": {
      if (cutOf(t.structure) === null) fail("Este torneio não tem corte.");
      if (!roundsDone(t)) fail("O corte só sai depois da última rodada completa.");
      if (t.playoff && Object.keys(t.playoff.results).length) fail("O mata-mata já tem placar; desfaça os placares antes de sortear de novo.");
      return { ...t, playoff: makePlayoff(t, cmd.seeding, cmd.at, cmd.nonce ?? 0) };
    }

    case "uncut": {
      if (!t.playoff) return t;
      if (t.structure.kind === "single-elimination") fail("No mata-mata direto a chave é o torneio.");
      if (Object.keys(t.playoff.results).length) fail("O mata-mata já tem placar lançado.");
      return { ...t, playoff: null, finishedAt: null };
    }

    case "restorePlayoff":
      return { ...t, playoff: cmd.playoff, finishedAt: cmd.playoff && bracketView(cmd.playoff).champion ? t.finishedAt : null };

    case "bracketResult": {
      if (!t.playoff) fail("O mata-mata ainda não foi montado.");
      const slot = bracketView(t.playoff!)
        .rounds.flat()
        .find((s) => s.key === cmd.key);
      if (!slot) fail("Partida não encontrada.");
      if (slot!.bye) fail("Folga não tem placar.");
      if (!slot!.a || !slot!.b) fail("Os dois lados desta partida ainda não estão definidos.");
      const results = { ...t.playoff!.results };
      if (cmd.score) {
        const problem = scoreProblem(cmd.score, t.settings.playoffBestOf, false);
        if (problem) fail(problem);
        results[cmd.key] = { score: { ...cmd.score }, a: slot!.a!.playerId, b: slot!.b!.playerId, at: cmd.at };
      } else delete results[cmd.key];
      const { playoff } = pruneStale({ ...t.playoff!, results });
      const decided = bracketView(playoff).champion;
      return { ...t, playoff, finishedAt: decided ? (t.finishedAt ?? cmd.at) : null };
    }

    case "podResult": {
      const round = t.rounds.find((r) => r.number === cmd.round);
      if (!round) fail("Rodada não encontrada.");
      const pod = round!.pods?.find((p) => p.id === cmd.pod);
      if (!pod) fail("Mesa não encontrada.");
      if (t.tiebreak) fail(FINAL_LOCK);
      let result: PodResult | null = null;
      if (cmd.result) {
        const problem = podResultProblem(cmd.result, pod!.players, false);
        if (problem) fail(problem);
        result = normalizeResult(cmd.result, pod!.players);
      }
      return mapRound(t, cmd.round, (r) => ({
        ...r,
        pods: r.pods!.map((p) => (p.id === cmd.pod ? { ...p, result, at: result ? cmd.at : null } : p)),
      }));
    }

    case "makeFinal": {
      if (!isPods(t.structure)) fail("Só o mesão tem final de desempate.");
      if (t.tiebreak) return t;
      if (!roundsDone(t)) fail("A final só sai depois da última rodada completa.");
      const ids = leaders(t);
      if (ids.length < 2) fail("Não há empate na liderança: o campeão já está definido.");
      return { ...t, tiebreak: { id: "final", table: 1, players: ids, result: null }, finishedAt: null };
    }

    case "unmakeFinal": {
      if (!t.tiebreak) return t;
      if (t.tiebreak.result) fail("A final já tem resultado; tire o resultado antes.");
      return { ...t, tiebreak: null, finishedAt: null };
    }

    case "restoreFinal":
      return { ...t, tiebreak: cmd.pod, finishedAt: cmd.pod?.result ? t.finishedAt : null };

    case "finalResult": {
      const pod = t.tiebreak;
      if (!pod) fail("A final ainda não foi montada.");
      let result: PodResult | null = null;
      if (cmd.result) {
        const problem = podResultProblem(cmd.result, pod!.players, true);
        if (problem) fail(problem);
        result = normalizeResult(cmd.result, pod!.players);
      }
      return { ...t, tiebreak: { ...pod!, result, at: result ? cmd.at : null }, finishedAt: result ? (t.finishedAt ?? cmd.at) : null };
    }

    case "finish": {
      if (isDraft(t)) fail("O torneio ainda não começou.");
      if (isPods(t.structure)) {
        if (!roundsDone(t)) fail("Faltam rodadas ou resultados.");
        if (needsFinal(t) && !t.tiebreak?.result) fail("Empate na liderança: a final decide o campeão.");
      } else if (hasPlayoff(t.structure)) {
        if (!t.playoff || !bracketView(t.playoff).champion) fail("Falta decidir a final.");
      } else if (!roundsDone(t)) fail("Faltam rodadas ou placares.");
      return { ...t, finishedAt: t.finishedAt ?? cmd.at };
    }

    case "reopen":
      return { ...t, finishedAt: null };
  }
}

/**
 * Comando que desfaz `cmd`, calculado no estado de antes. null quando a ação não tem volta simples
 * (nesses casos a tela pede confirmação antes).
 */
export function inverse(t: Tournament, cmd: Command): Command | null {
  switch (cmd.type) {
    case "result": {
      const m = t.rounds.find((r) => r.number === cmd.round)?.matches.find((x) => x.id === cmd.match);
      return m ? { type: "result", round: cmd.round, match: cmd.match, score: m.result, at: m.at ?? cmd.at } : null;
    }
    case "podResult": {
      const p = t.rounds.find((r) => r.number === cmd.round)?.pods?.find((x) => x.id === cmd.pod);
      return p ? { type: "podResult", round: cmd.round, pod: cmd.pod, result: p.result, at: p.at ?? cmd.at } : null;
    }
    case "makeFinal":
      return t.tiebreak ? null : { type: "unmakeFinal" };
    case "unmakeFinal":
      return t.tiebreak ? { type: "restoreFinal", pod: t.tiebreak } : null;
    case "finalResult":
      return t.tiebreak ? { type: "finalResult", result: t.tiebreak.result, at: t.tiebreak.at ?? cmd.at } : null;
    case "bracketResult":
      // o placar novo pode ter derrubado placares seguintes: volta a chave inteira
      return t.playoff ? { type: "restorePlayoff", playoff: t.playoff } : null;
    case "pairNext":
      return { type: "deleteRound", round: t.rounds.length + 1 };
    case "deleteRound": {
      const r = t.rounds.find((x) => x.number === cmd.round);
      return r ? { type: "restoreRound", round: r } : null;
    }
    case "drop": {
      const r = currentRound(t);
      // se ele saiu de uma mesa já montada, ela mudou (virou folga do oponente, ou ficou sem ele): sem volta simples
      return r && (leavesMatch(r, cmd.player) || leavesPod(r, cmd.player)) ? null : { type: "undrop", player: cmd.player };
    }
    case "swap":
      return { type: "swap", round: cmd.round, x: cmd.x, y: cmd.y };
    case "removePlayer": {
      const index = t.players.findIndex((p) => p.id === cmd.id);
      return index >= 0 ? { type: "restorePlayer", player: t.players[index], index } : null;
    }
    case "cut":
    case "uncut":
      return { type: "restorePlayoff", playoff: t.playoff };
    case "start":
      return { type: "unstart" };
    case "finish":
      return t.finishedAt ? null : { type: "reopen" };
    default:
      return null;
  }
}

/** Uma linha por jogador (colar a lista do grupo): tira numeração, marcadores, vazios e repetidos. */
export function parsePlayerList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n|;/)) {
    const name = cleanName(raw.replace(/^\s*(?:\d+\s*[.)\-–:]\s*|[-*•·]\s+)/, ""));
    if (!name) continue;
    const key = name.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Tempo restante da rodada em ms (negativo = passou do tempo); null sem relógio ou antes de começar. */
export function remainingMs(r: Round, minutes: number | null, now: number): number | null {
  if (!minutes || !r.timer.startedAt) return null;
  const end = r.timer.pausedAt ? Date.parse(r.timer.pausedAt) : now;
  const elapsed = end - Date.parse(r.timer.startedAt) - r.timer.pausedMs;
  return minutes * 60_000 - elapsed;
}
