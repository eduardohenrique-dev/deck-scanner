import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, champion, champions, currentRound, inverse, leaders, needsFinal, nextRoundBlocker, plannedRounds, stage, stages, startBlocker, summary, TournamentError, type Command } from "./engine.ts";
import { finalText, matchesCsv, pairingsText, standingsText } from "./export.ts";
import { podMeetings, podSizes } from "./pods.ts";
import { standings } from "./standings.ts";
import { AT, make, run } from "./testkit.ts";
import type { Pod, PodResult, Tournament } from "./types.ts";

const throws = (fn: () => unknown, message: RegExp) => assert.throws(fn, (e: unknown) => e instanceof TournamentError && message.test(e.message));
const mesao = (n: number, rounds = 0, seed = 1) => make(n, { kind: "pods", rounds }, seed);
const num = (id: string) => Number(id.slice(1));

/** Vence o mais forte da mesa (p1 é o mais forte). */
const strongest = (pod: Pod): PodResult => ({ kind: "win", winner: [...pod.players].sort((a, b) => num(a) - num(b))[0] });

function playPods(t: Tournament, decide: (pod: Pod) => PodResult): Tournament {
  const r = currentRound(t)!;
  for (const pod of r.pods ?? []) if (!pod.result) t = apply(t, { type: "podResult", round: r.number, pod: pod.id, result: decide(pod), at: AT });
  return t;
}

function playAll(t: Tournament, decide: (pod: Pod) => PodResult): Tournament {
  if (!t.startedAt) t = apply(t, { type: "start", at: AT });
  for (let r = 1; r <= plannedRounds(t); r++) {
    t = playPods(t, decide);
    if (r < plannedRounds(t)) t = apply(t, { type: "pairNext" });
  }
  return t;
}

const repeats = (pods: Pod[], before: Tournament["rounds"]) => {
  const met = podMeetings(before);
  let n = 0;
  for (const p of pods) for (let i = 0; i < p.players.length; i++) for (let j = i + 1; j < p.players.length; j++) n += met.has([p.players[i], p.players[j]].sort().join("|")) ? 1 : 0;
  return n;
};

test("tamanhos das mesas: 4, com mesas de 3 completando (e uma de 5 com 5 jogadores)", () => {
  const cases: [number, number[]][] = [
    [3, [3]],
    [4, [4]],
    [5, [5]],
    [6, [3, 3]],
    [7, [4, 3]],
    [8, [4, 4]],
    [9, [3, 3, 3]],
    [10, [4, 3, 3]],
    [11, [4, 4, 3]],
    [12, [4, 4, 4]],
    [13, [4, 3, 3, 3]],
    [17, [4, 4, 3, 3, 3]],
  ];
  for (const [n, sizes] of cases) assert.deepEqual(podSizes(n), sizes, `${n} jogadores`);
});

test("8 jogadores: 3 rodadas, 2 mesas de 4, todo mundo joga as 3", () => {
  let t = mesao(8, 0, 4);
  assert.equal(plannedRounds(t), 3);
  assert.deepEqual(stages(t), ["setup", "players", "rounds", "champion"]);
  t = playAll(t, strongest);
  for (const r of t.rounds) {
    assert.deepEqual(r.pods!.map((p) => p.players.length), [4, 4]);
    assert.equal(new Set(r.pods!.flatMap((p) => p.players)).size, 8);
  }
  for (const s of standings(t)) assert.equal(s.matchesPlayed, 3);
});

test("da 2ª rodada em diante: o mínimo de adversários repetidos e, entre as opções, quem tem pontos parecidos junto", () => {
  let t = run(mesao(8, 3, 9), { type: "start", at: AT });
  t = playPods(t, strongest);
  const [a, b] = t.rounds[0].pods!;
  t = apply(t, { type: "pairNext" });
  const r2 = t.rounds[1].pods!;
  // cada mesa nova tem 2 de cada mesa antiga: 2 repetições por mesa, o mínimo possível com 8
  for (const pod of r2) {
    assert.equal(pod.players.filter((id) => a.players.includes(id)).length, 2);
    assert.equal(pod.players.filter((id) => b.players.includes(id)).length, 2);
  }
  assert.equal(repeats(r2, t.rounds.slice(0, 1)), 4);
  // os dois vencedores (3 pontos) caem juntos na mesa 1
  const winners = [a, b].map((p) => (p.result as { winner: string }).winner);
  assert.ok(winners.every((w) => r2[0].players.includes(w)));
});

test("16 jogadores: a 2ª rodada sai sem nenhum adversário repetido (busca por trocas)", () => {
  let t = run(mesao(16, 3, 5), { type: "start", at: AT });
  t = playPods(t, strongest);
  t = apply(t, { type: "pairNext" });
  assert.deepEqual(t.rounds[1].pods!.map((p) => p.players.length), [4, 4, 4, 4]);
  assert.equal(repeats(t.rounds[1].pods!, t.rounds.slice(0, 1)), 0);
});

test("pontuação: vitória 3; empate no tempo, 1 para cada vivo; eliminado 0", () => {
  let t = run(mesao(4, 1), { type: "start", at: AT });
  const pod = currentRound(t)!.pods![0];
  const [w, x, y, z] = pod.players;
  t = apply(t, { type: "podResult", round: 1, pod: pod.id, result: { kind: "draw", survivors: [x, y] }, at: AT });
  const pts = new Map(standings(t).map((s) => [s.playerId, s.points]));
  assert.deepEqual([pts.get(w), pts.get(x), pts.get(y), pts.get(z)], [0, 1, 1, 0]);
  t = apply(t, { type: "podResult", round: 1, pod: pod.id, result: { kind: "win", winner: z }, at: AT });
  const again = new Map(standings(t).map((s) => [s.playerId, s.points]));
  assert.deepEqual([again.get(w), again.get(x), again.get(y), again.get(z)], [0, 0, 0, 3]);
});

test("resultados que não fecham com a regra são recusados", () => {
  const t = run(mesao(4, 1), { type: "start", at: AT });
  const pod = currentRound(t)!.pods![0];
  const at = (result: PodResult): Command => ({ type: "podResult", round: 1, pod: pod.id, result, at: AT });
  throws(() => apply(t, at({ kind: "draw", survivors: [pod.players[0]] })), /um só jogador vivo/);
  throws(() => apply(t, at({ kind: "win", winner: "p99" })), /precisa estar na mesa/);
  throws(() => apply(t, at({ kind: "split", players: pod.players.slice(0, 2) })), /só vale na final/);
});

test("empate na liderança: final entre os empatados, sem tempo, com vencedor ou prêmio dividido", () => {
  // 8 jogadores, todas as mesas empatam com todos vivos: todo mundo termina com 3 pontos
  let t = playAll(mesao(8, 3, 2), (pod) => ({ kind: "draw", survivors: pod.players }));
  assert.equal(leaders(t).length, 8);
  assert.ok(needsFinal(t));
  assert.equal(stage(t), "final");
  assert.deepEqual(stages(t), ["setup", "players", "rounds", "final", "champion"]);
  assert.equal(nextRoundBlocker(t), "Todas as rodadas planejadas já foram jogadas.");
  throws(() => apply(t, { type: "finish", at: AT }), /a final decide/);

  t = apply(t, { type: "makeFinal", at: AT });
  assert.equal(t.tiebreak!.players.length, 8);
  // rodadas travam enquanto a final existe
  const pod = t.rounds[0].pods![0];
  throws(() => apply(t, { type: "podResult", round: 1, pod: pod.id, result: null, at: AT }), /travadas/);
  // a final não tem tempo: não aceita empate
  throws(() => apply(t, { type: "finalResult", result: { kind: "draw", survivors: t.tiebreak!.players.slice(0, 2) }, at: AT }), /não tem tempo limite/);

  const won = apply(t, { type: "finalResult", result: { kind: "win", winner: "p3" }, at: AT });
  assert.equal(champion(won), "p3");
  assert.equal(stage(won), "champion");
  assert.equal(summary(won).champion, "Jogador 3");

  const split = apply(t, { type: "finalResult", result: { kind: "split", players: ["p5", "p2"] }, at: AT });
  assert.deepEqual(champions(split), ["p2", "p5"]); // na ordem da mesa
  assert.equal(summary(split).champion, "Jogador 2 e Jogador 5");
  assert.match(finalText(split), /Campeões \(dividiram o prêmio\): \*Jogador 2 e Jogador 5\*/);

  // desfazer: tirar o resultado reabre, desmontar a final devolve as rodadas
  const undo = inverse(t, { type: "finalResult", result: { kind: "win", winner: "p3" }, at: AT })!;
  assert.equal(apply(won, undo).finishedAt, null);
  const unmade = apply(t, { type: "unmakeFinal" });
  assert.equal(unmade.tiebreak, null);
  assert.equal(apply(unmade, inverse(t, { type: "unmakeFinal" })!).tiebreak!.players.length, 8);
});

test("sem empate na liderança não há final: encerrar coroa o líder", () => {
  let t = playAll(mesao(8, 3, 7), strongest);
  const top = leaders(t);
  assert.equal(top.length, 1);
  assert.equal(needsFinal(t), false);
  throws(() => apply(t, { type: "makeFinal", at: AT }), /Não há empate/);
  t = apply(t, { type: "finish", at: AT });
  assert.equal(champion(t), top[0]);
});

test("10 jogadores: mesas de 4, 3 e 3, e ninguém fica de fora", () => {
  let t = run(mesao(10, 3, 3), { type: "start", at: AT });
  for (let r = 1; r <= 3; r++) {
    assert.deepEqual(currentRound(t)!.pods!.map((p) => p.players.length).sort(), [3, 3, 4]);
    assert.equal(new Set(currentRound(t)!.pods!.flatMap((p) => p.players)).size, 10);
    t = playPods(t, strongest);
    if (r < 3) t = apply(t, { type: "pairNext" });
  }
});

test("saiu no meio: deixa a mesa atual e não entra nas próximas", () => {
  let t = run(mesao(9, 3, 6), { type: "start", at: AT });
  const pod = currentRound(t)!.pods![0];
  const quitter = pod.players[0];
  t = apply(t, { type: "drop", player: quitter });
  assert.ok(!currentRound(t)!.pods![0].players.includes(quitter));
  t = playPods(t, strongest);
  t = apply(t, { type: "pairNext" });
  assert.ok(!currentRound(t)!.pods!.some((p) => p.players.includes(quitter)));
  assert.equal(currentRound(t)!.pods!.flatMap((p) => p.players).length, 8);
});

test("troca manual entre mesas e mínimo de 3 inscritos", () => {
  throws(() => apply(mesao(2), { type: "start", at: AT }), /pelo menos 3/);
  assert.equal(startBlocker(mesao(3)), null);
  let t = run(mesao(8, 3, 1), { type: "start", at: AT });
  const [a, b] = currentRound(t)!.pods!;
  t = apply(t, { type: "swap", round: 1, x: a.players[0], y: b.players[0] });
  const [a2, b2] = currentRound(t)!.pods!;
  assert.ok(a2.players.includes(b.players[0]) && b2.players.includes(a.players[0]));
  assert.ok(a2.manual && b2.manual);
});

test("texto e CSV do mesão", () => {
  let t = run(mesao(8, 3, 4), { type: "start", at: AT });
  const pod = currentRound(t)!.pods![0];
  t = apply(t, { type: "podResult", round: 1, pod: pod.id, result: { kind: "win", winner: pod.players[1] }, at: AT });
  const text = pairingsText(t, 1);
  assert.match(text, /Mesão, 3 rodadas/);
  assert.match(text, /Mesa 1: .+ \(venceu Jogador \d\)/);
  assert.match(standingsText(t), /pts \(1V 0E 0D\)/);
  assert.match(matchesCsv(t), /rodada,1,1,.+,vitoria,Jogador \d,Jogador \d/);
});
