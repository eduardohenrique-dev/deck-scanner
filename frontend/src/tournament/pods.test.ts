import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, champion, champions, currentRound, finalists, inverse, leaders, needsFinal, nextRoundBlocker, plannedRounds, stage, stages, startBlocker, TournamentError, type Command } from "./engine.ts";
import { finalText, matchesCsv, pairingsText, standingsText } from "./export.ts";
import { podMeetings, podRematches, podSizes } from "./pods.ts";
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
  assert.deepEqual(stages(t), ["setup", "players", "rounds", "final", "champion"]);
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

test("pontuação do cEDH: vitória 7 (também na mesa de 3); empate 1 para quem a lista marca; derrota 0", () => {
  let t = run(mesao(4, 1), { type: "start", at: AT });
  assert.deepEqual(t.settings.points, { win: 7, draw: 1, loss: 0 });
  const pod = currentRound(t)!.pods![0];
  const [w, x, y, z] = pod.players;
  const pts = () => {
    const m = new Map(standings(t).map((s) => [s.playerId, s.points]));
    return [m.get(w), m.get(x), m.get(y), m.get(z)];
  };
  // sem vencedor: todos da mesa pontuam
  t = apply(t, { type: "podResult", round: 1, pod: pod.id, result: { kind: "draw", survivors: pod.players }, at: AT });
  assert.deepEqual(pts(), [1, 1, 1, 1]);
  // quem concedeu fica fora da lista e não pontua
  t = apply(t, { type: "podResult", round: 1, pod: pod.id, result: { kind: "draw", survivors: [x, y, z] }, at: AT });
  assert.deepEqual(pts(), [0, 1, 1, 1]);
  t = apply(t, { type: "podResult", round: 1, pod: pod.id, result: { kind: "win", winner: z }, at: AT });
  assert.deepEqual(pts(), [0, 0, 0, 7]);

  // mesa de 3 vale o mesmo que a de 4
  let three = run(mesao(3, 1), { type: "start", at: AT });
  const p3 = currentRound(three)!.pods![0];
  three = apply(three, { type: "podResult", round: 1, pod: p3.id, result: { kind: "win", winner: p3.players[0] }, at: AT });
  assert.equal(standings(three).find((s) => s.playerId === p3.players[0])!.points, 7);
});

test("mesão novo nasce com 7, 1, 0; voltar para o 1 × 1 devolve 3, 1, 0; pontuação mexida à mão fica", () => {
  let t = make(8, { kind: "swiss", rounds: 3, cut: null });
  assert.deepEqual(t.settings.points, { win: 3, draw: 1, loss: 0 });
  t = apply(t, { type: "setStructure", structure: { kind: "pods", rounds: 0 } });
  assert.deepEqual(t.settings.points, { win: 7, draw: 1, loss: 0 });
  assert.equal(t.settings.roundMinutes, 75);
  t = apply(t, { type: "setStructure", structure: { kind: "swiss", rounds: 3, cut: null } });
  assert.deepEqual(t.settings.points, { win: 3, draw: 1, loss: 0 });
  assert.equal(t.settings.roundMinutes, 50);
  t = apply(t, { type: "setSettings", settings: { points: { win: 5, draw: 1, loss: 0 } } });
  t = apply(t, { type: "setStructure", structure: { kind: "pods", rounds: 0 } });
  assert.deepEqual(t.settings.points, { win: 5, draw: 1, loss: 0 });
});

test("resultados que não fecham com a regra são recusados", () => {
  const t = run(mesao(4, 1), { type: "start", at: AT });
  const pod = currentRound(t)!.pods![0];
  const at = (result: PodResult): Command => ({ type: "podResult", round: 1, pod: pod.id, result, at: AT });
  throws(() => apply(t, at({ kind: "draw", survivors: [pod.players[0]] })), /um só jogador pontuando/);
  throws(() => apply(t, at({ kind: "win", winner: "p99" })), /precisa estar na mesa/);
  throws(() => apply(t, at({ kind: "split", players: pod.players.slice(0, 2) })), /só vale na final/);
});

test("mesa final sempre com os 4 primeiros, sem tempo, com vencedor ou prêmio dividido", () => {
  // 8 jogadores, todas as mesas empatam: todo mundo com 3 pontos, a final leva os 4 primeiros da lista
  let t = playAll(mesao(8, 3, 2), (pod) => ({ kind: "draw", survivors: pod.players }));
  const top4 = standings(t).slice(0, 4).map((s) => s.playerId);
  assert.deepEqual(finalists(t), top4);
  assert.ok(needsFinal(t));
  assert.equal(stage(t), "final");
  assert.deepEqual(stages(t), ["setup", "players", "rounds", "final", "champion"]);
  assert.equal(nextRoundBlocker(t), "Todas as rodadas planejadas já foram jogadas.");
  throws(() => apply(t, { type: "finish", at: AT }), /A final decide o campeão/);

  t = apply(t, { type: "makeFinal", at: AT });
  // a ordem da mesa é a da classificação: o 1º começa
  assert.deepEqual(t.tiebreak!.players, top4);
  // rodadas travam enquanto a final existe
  const pod = t.rounds[0].pods![0];
  throws(() => apply(t, { type: "podResult", round: 1, pod: pod.id, result: null, at: AT }), /travadas/);
  // a final não tem tempo: não aceita empate
  throws(() => apply(t, { type: "finalResult", result: { kind: "draw", survivors: top4.slice(0, 2) }, at: AT }), /não tem tempo limite/);

  const [w, x, y] = top4;
  const won = apply(t, { type: "finalResult", result: { kind: "win", winner: y }, at: AT });
  assert.equal(champion(won), y);
  assert.equal(stage(won), "champion");

  const split = apply(t, { type: "finalResult", result: { kind: "split", players: [x, w] }, at: AT });
  assert.deepEqual(champions(split), [w, x]); // na ordem da mesa
  assert.match(finalText(split), /dividiram o prêmio/);

  // desfazer: tirar o resultado reabre, desmontar a final devolve as rodadas
  const undo = inverse(t, { type: "finalResult", result: { kind: "win", winner: y }, at: AT })!;
  assert.equal(apply(won, undo).finishedAt, null);
  const unmade = apply(t, { type: "unmakeFinal" });
  assert.equal(unmade.tiebreak, null);
  assert.equal(apply(unmade, inverse(t, { type: "unmakeFinal" })!).tiebreak!.players.length, 4);
});

test("líder isolado também joga a final: a classificação vale a vaga e a ordem de jogo, não o título", () => {
  let t = playAll(mesao(8, 3, 7), strongest);
  assert.equal(leaders(t).length, 1);
  assert.ok(needsFinal(t));
  throws(() => apply(t, { type: "finish", at: AT }), /A final decide o campeão/);
  t = apply(t, { type: "makeFinal", at: AT });
  const [first, , , fourth] = t.tiebreak!.players;
  assert.equal(first, leaders(t)[0]);
  // o 4º das rodadas vence a final e é o campeão
  t = apply(t, { type: "finalResult", result: { kind: "win", winner: fourth }, at: AT });
  assert.equal(champion(t), fourth);
});

test("final: quem saiu não entra; com 3 jogadores a final é de 3; torneio antigo encerrado sem final continua valendo", () => {
  let t = run(mesao(6, 1, 3), { type: "start", at: AT });
  t = playPods(t, strongest);
  const leader = standings(t)[0].playerId;
  t = apply(t, { type: "drop", player: leader });
  assert.ok(!finalists(t).includes(leader));
  assert.equal(finalists(t).length, 4);

  const three = playAll(mesao(3, 2, 1), strongest);
  assert.equal(finalists(three).length, 3);

  // encerrado antes da regra nova (sem final): o campeão é o líder e não aparece etapa de final
  const old = { ...playAll(mesao(8, 3, 7), strongest), finishedAt: AT };
  assert.equal(champion(old), leaders(old)[0]);
  assert.deepEqual(stages(old), ["setup", "players", "rounds", "champion"]);
  assert.equal(needsFinal(old), false);
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

test("8 jogadores em 3 rodadas: nenhuma dupla divide mesa nas três", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const t = playAll(mesao(8, 3, seed), strongest);
    const met = podMeetings(t.rounds);
    assert.ok(Math.max(...met.values()) <= 2, `semente ${seed}: uma dupla jogou junta ${Math.max(...met.values())} vezes`);
    // 2ª rodada: cada mesa nova é metade de cada mesa antiga (4 duplas repetidas é o mínimo possível)
    assert.equal(podRematches(t.rounds, 2).pairs, 4, `semente ${seed}`);
    const tables = t.rounds.map((r) => (r.pods ?? []).map((p) => [...p.players].sort().join(",")).sort().join(" / "));
    assert.equal(new Set(tables).size, 3, `semente ${seed}: rodada com as mesmas mesas`);
  }
});

test("16 jogadores em 4 rodadas: ninguém repete adversário enquanto dá", () => {
  for (let seed = 1; seed <= 6; seed++) {
    const t = playAll(mesao(16, 4, seed), strongest);
    // 16 em mesas de 4 fecha 4 rodadas sem ninguém se reencontrar (plano afim de ordem 4)
    for (const r of [2, 3]) assert.equal(podRematches(t.rounds, r).pairs, 0, `semente ${seed}, rodada ${r}`);
    assert.ok(Math.max(...podMeetings(t.rounds).values()) <= 2, `semente ${seed}`);
  }
});

test("24 jogadores: as três primeiras rodadas saem sem reencontro e rápido", () => {
  const started = Date.now();
  for (let seed = 1; seed <= 4; seed++) {
    const t = playAll(mesao(24, 3, seed), strongest);
    for (const r of [2, 3]) assert.equal(podRematches(t.rounds, r).pairs, 0, `semente ${seed}, rodada ${r}`);
  }
  assert.ok(Date.now() - started < 8000, "montar as mesas demorou demais");
});

test("4 jogadores: a mesma mesa volta porque não existe outra", () => {
  const t = playAll(mesao(4, 3, 2), strongest);
  const re = podRematches(t.rounds, 3);
  assert.deepEqual([re.pairs, re.worst, re.exact], [6, 2, true]);
});
