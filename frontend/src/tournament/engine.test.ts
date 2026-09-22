import assert from "node:assert/strict";
import { test } from "node:test";
import { bracketView } from "./bracket.ts";
import {
  apply,
  champion,
  currentRound,
  inverse,
  nextRoundBlocker,
  parsePlayerList,
  plannedRounds,
  remainingMs,
  scoreProblem,
  stage,
  startBlocker,
  summary,
  TournamentError,
  type Command,
} from "./engine.ts";
import { standings } from "./standings.ts";
import { AT, byStrength, make, playRound, playSwiss, randomScores, run, seeded } from "./testkit.ts";
import type { Tournament } from "./types.ts";

const throws = (fn: () => unknown, message: RegExp) => assert.throws(fn, (e: unknown) => e instanceof TournamentError && message.test(e.message));

test("suíço + Top 4, do começo ao campeão", () => {
  let t = make(9, { kind: "swiss", rounds: 0, cut: 4 }, 3);
  assert.equal(stage(t), "setup");
  assert.equal(plannedRounds(t), 5); // 9 jogadores com top 4 → 5 rodadas (MTR)
  t = playSwiss(t, byStrength, 5);
  assert.equal(stage(t), "cut");
  assert.equal(nextRoundBlocker(t), "Todas as rodadas planejadas já foram jogadas.");
  t = apply(t, { type: "cut", seeding: "standings", at: AT });
  assert.equal(stage(t), "bracket");
  const top = standings(t).slice(0, 4).map((s) => s.playerId);
  assert.deepEqual(t.playoff!.seeds, top);
  // semifinais 1 × 4 e 2 × 3; vence o mais forte
  const semis = bracketView(t.playoff!).rounds[0];
  assert.deepEqual([semis[0].a!.seed, semis[0].b!.seed], [1, 4]);
  assert.deepEqual([semis[1].a!.seed, semis[1].b!.seed], [2, 3]);
  for (const s of semis) {
    const aWins = Number(s.a!.playerId.slice(1)) < Number(s.b!.playerId.slice(1));
    t = apply(t, { type: "bracketResult", key: s.key, score: aWins ? { a: 2, b: 0, draws: 0 } : { a: 1, b: 2, draws: 0 }, at: AT });
  }
  const final = bracketView(t.playoff!).rounds[1][0];
  t = apply(t, { type: "bracketResult", key: final.key, score: { a: 2, b: 1, draws: 0 }, at: AT });
  assert.equal(stage(t), "champion");
  assert.ok(t.finishedAt);
  assert.equal(champion(t), final.a!.playerId);
  assert.equal(summary(t).status, "finished");
});

test("gerar a próxima rodada só com todos os placares, e a explicação diz quais mesas faltam", () => {
  let t = make(8, { kind: "swiss", rounds: 3, cut: null }, 1);
  t = apply(t, { type: "start", at: AT });
  assert.equal(nextRoundBlocker(t), "Faltam os placares das mesas 1, 2, 3 e 4.");
  throws(() => apply(t, { type: "pairNext" }), /Faltam os placares/);
  const r = currentRound(t)!;
  for (const m of r.matches.slice(0, 3)) t = apply(t, { type: "result", round: 1, match: m.id, score: byStrength(m), at: AT });
  assert.equal(nextRoundBlocker(t), "Falta o placar da mesa 4.");
  t = playRound(t, byStrength);
  assert.equal(nextRoundBlocker(t), null);
});

test("editar um placar antigo recalcula a classificação", () => {
  let t = make(8, { kind: "swiss", rounds: 3, cut: null }, 2);
  t = playSwiss(t, byStrength, 2);
  const m = t.rounds[0].matches[0];
  const before = standings(t).find((s) => s.playerId === m.a)!;
  const flipped = byStrength(m).a === 2 ? { a: 0, b: 2, draws: 0 } : { a: 2, b: 0, draws: 0 };
  t = apply(t, { type: "result", round: 1, match: m.id, score: flipped, at: AT });
  const after = standings(t).find((s) => s.playerId === m.a)!;
  assert.notEqual(after.points, before.points);
  assert.equal(Math.abs(after.points - before.points), 3);
});

test("drop entre rodadas: fica fora dos próximos emparelhamentos e do corte", () => {
  let t = make(8, { kind: "swiss", rounds: 3, cut: 4 }, 4);
  t = playSwiss(t, byStrength, 1);
  t = apply(t, { type: "drop", player: "p1" }); // o mais forte sai depois da rodada 1
  assert.equal(t.players.find((p) => p.id === "p1")!.droppedAfter, 1);
  t = apply(t, { type: "pairNext" });
  assert.ok(!currentRound(t)!.matches.some((m) => m.a === "p1" || m.b === "p1"));
  // 7 ativos: alguém folga
  assert.equal(currentRound(t)!.matches.filter((m) => m.b === null).length, 1);
  t = playRound(t, byStrength);
  t = apply(t, { type: "pairNext" });
  t = playRound(t, byStrength);
  t = apply(t, { type: "cut", seeding: "standings", at: AT });
  assert.ok(!t.playoff!.seeds.includes("p1"));
  assert.ok(standings(t).find((s) => s.playerId === "p1")!.dropped);
});

test("drop de quem ainda não jogou a rodada atual: o oponente fica de folga, e não há volta simples", () => {
  let t = make(8, { kind: "swiss", rounds: 3, cut: null }, 5);
  t = playSwiss(t, byStrength, 1);
  t = apply(t, { type: "pairNext" });
  const m = currentRound(t)!.matches.find((x) => x.b !== null)!;
  const cmd: Command = { type: "drop", player: m.a };
  assert.equal(inverse(t, cmd), null);
  t = apply(t, cmd);
  const bye = currentRound(t)!.matches.find((x) => x.b === null)!;
  assert.equal(bye.a, m.b);
  assert.deepEqual(bye.result, { a: 2, b: 0, draws: 0 });
  assert.equal(t.players.find((p) => p.id === m.a)!.droppedAfter, 1);
  throws(() => apply(t, { type: "undrop", player: m.a }), /volta só vale/);
});

test("desfazer: cada ação crítica tem comando inverso que devolve o estado", () => {
  let t = make(6, { kind: "swiss", rounds: 3, cut: 2 }, 6);
  t = playSwiss(t, byStrength, 1);
  const check = (cmd: Command) => {
    const inv = inverse(t, cmd)!;
    assert.ok(inv, `sem inverso para ${cmd.type}`);
    const back = apply(apply(t, cmd), inv);
    assert.deepEqual(back.rounds, t.rounds, `${cmd.type}: rodadas`);
    assert.deepEqual(back.players, t.players, `${cmd.type}: jogadores`);
    assert.deepEqual(back.playoff, t.playoff, `${cmd.type}: mata-mata`);
  };
  const m = t.rounds[0].matches.find((x) => x.b)!;
  check({ type: "result", round: 1, match: m.id, score: { a: 1, b: 1, draws: 1 }, at: AT });
  check({ type: "pairNext" });
  check({ type: "drop", player: "p3" });
  t = playSwiss({ ...t }, byStrength, 0);
  t = run(t, { type: "pairNext" });
  t = playRound(t, byStrength);
  t = run(t, { type: "pairNext" });
  t = playRound(t, byStrength);
  check({ type: "cut", seeding: "random", at: AT, nonce: 3 });
});

test("repetir os mesmos comandos dá exatamente o mesmo torneio (replay entre aparelhos)", () => {
  const cmds: Command[] = [{ type: "start", at: AT }];
  let t = make(11, { kind: "swiss", rounds: 4, cut: 8 }, 9);
  const base = t;
  const score = randomScores(seeded(9));
  t = apply(t, cmds[0]);
  for (let r = 1; r <= 4; r++) {
    for (const m of currentRound(t)!.matches) {
      if (!m.b || m.result) continue;
      const c: Command = { type: "result", round: r, match: m.id, score: score(), at: AT };
      cmds.push(c);
      t = apply(t, c);
    }
    const next: Command = r < 4 ? { type: "pairNext" } : { type: "cut", seeding: "random", at: AT };
    cmds.push(next);
    t = apply(t, next);
  }
  const again = cmds.reduce(apply, base);
  assert.equal(JSON.stringify(again), JSON.stringify(t));
});

test("eliminação simples com 5 jogadores: chave de 8 e 3 folgas", () => {
  let t = make(5, { kind: "single-elimination" }, 12);
  assert.equal(stage(t), "setup");
  t = apply(t, { type: "start", at: AT });
  assert.equal(stage(t), "bracket");
  const view = bracketView(t.playoff!);
  assert.equal(view.size, 8);
  assert.equal(view.rounds[0].filter((s) => s.bye).length, 3);
  throws(() => apply(t, { type: "bracketResult", key: view.rounds[0].find((s) => !s.bye)!.key, score: { a: 1, b: 1, draws: 1 }, at: AT }), /não existe empate/);
});

test("troca manual na rodada atual (e bloqueio depois do placar)", () => {
  let t = make(4, { kind: "swiss", rounds: 2, cut: null }, 13);
  t = apply(t, { type: "start", at: AT });
  const [m1, m2] = currentRound(t)!.matches;
  t = apply(t, { type: "swap", round: 1, x: m1.a, y: m2.a });
  const [n1, n2] = currentRound(t)!.matches;
  assert.equal(n1.a, m2.a);
  assert.equal(n2.a, m1.a);
  assert.ok(n1.manual && n2.manual);
  t = apply(t, { type: "result", round: 1, match: n1.id, score: { a: 2, b: 0, draws: 0 }, at: AT });
  throws(() => apply(t, { type: "swap", round: 1, x: n1.a, y: n2.b! }), /Tire o placar/);
});

test("inscrições: colar lista com numeração, repetidos e linhas vazias", () => {
  assert.deepEqual(parsePlayerList("1. Ana\n2) Bruno\n\n- Carla\nana\n  Diego  Ramos \n• Eduarda"), ["Ana", "Bruno", "Carla", "Diego Ramos", "Eduarda"]);
  let t = make(0, { kind: "swiss", rounds: 0, cut: null });
  t = apply(t, { type: "addPlayers", players: parsePlayerList("Ana\nBruno").map((name, i) => ({ id: `x${i}`, name, lot: i })) });
  throws(() => apply(t, { type: "addPlayers", players: [{ id: "y", name: "ANA", lot: 0 }] }), /já está na lista/);
  assert.equal(startBlocker(t), null);
  throws(() => apply(t, { type: "setStructure", structure: { kind: "swiss", rounds: 0, cut: 1 } }), /pelo menos 2/);
  t = apply(t, { type: "setStructure", structure: { kind: "swiss", rounds: 0, cut: 4 } });
  assert.equal(startBlocker(t), "O corte Top 4 precisa de pelo menos 4 jogadores (há 2).");
});

test("placares válidos para melhor de 1 e de 3", () => {
  assert.equal(scoreProblem({ a: 2, b: 1, draws: 0 }, 3, true), null);
  assert.equal(scoreProblem({ a: 1, b: 1, draws: 1 }, 3, true), null);
  assert.match(scoreProblem({ a: 3, b: 0, draws: 0 }, 3, true)!, /ninguém passa de 2/);
  assert.match(scoreProblem({ a: 2, b: 2, draws: 0 }, 3, true)!, /não podem ter vencido/);
  assert.equal(scoreProblem({ a: 0, b: 0, draws: 1 }, 1, true), null);
  assert.match(scoreProblem({ a: 2, b: 0, draws: 0 }, 1, true)!, /ninguém passa de 1/);
  assert.match(scoreProblem({ a: 1, b: 1, draws: 0 }, 3, false)!, /não existe empate/);
});

test("relógio da rodada: pausa não conta", () => {
  let t = make(4, { kind: "swiss", rounds: 2, cut: null });
  t = apply(t, { type: "start", at: AT });
  const start = Date.parse(AT);
  const iso = (ms: number) => new Date(start + ms).toISOString();
  t = run(
    t,
    { type: "timer", round: 1, action: "start", at: iso(0) },
    { type: "timer", round: 1, action: "pause", at: iso(10 * 60_000) },
    { type: "timer", round: 1, action: "resume", at: iso(15 * 60_000) },
  );
  const r = currentRound(t)!;
  assert.equal(remainingMs(r, 50, start + 20 * 60_000), 35 * 60_000); // 15 de jogo, 5 pausados
  assert.equal(remainingMs(r, null, start), null);
});

test("depois do corte os placares do suíço travam; desfazer o corte libera", () => {
  let t: Tournament = make(4, { kind: "swiss", rounds: 2, cut: 2 }, 14);
  t = playSwiss(t, byStrength, 2);
  t = apply(t, { type: "cut", seeding: "standings", at: AT });
  const m = t.rounds[0].matches.find((x) => x.b)!;
  throws(() => apply(t, { type: "result", round: 1, match: m.id, score: { a: 0, b: 2, draws: 0 }, at: AT }), /travados/);
  t = apply(t, { type: "uncut" });
  t = apply(t, { type: "result", round: 1, match: m.id, score: { a: 0, b: 2, draws: 0 }, at: AT });
  assert.equal(stage(t), "cut");
});
