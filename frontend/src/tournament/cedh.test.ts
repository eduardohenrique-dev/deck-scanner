/**
 * Regras do cEDH Europa no mesão (adendo multijogador da MTR): pontos, os quatro desempates na ordem,
 * piso de 1/7 com adversário fantasma nas mesas de 3, final só com empate total na liderança,
 * mesa de 3 no máximo uma vez por jogador e ordem de jogo sorteada.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, currentRound, leaders, needsFinal, plannedRounds } from "./engine.ts";
import { pairPods } from "./pods.ts";
import { mulberry32 } from "./rng.ts";
import { standings } from "./standings.ts";
import { AT, make, run } from "./testkit.ts";
import type { Pod, PodResult, Tournament } from "./types.ts";

const CEDH = { win: 7, draw: 1, loss: 0 };
const close = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} ${a} ≠ ${b}`);

/**
 * "Friday night" (13/11/2026): 12 jogadores, 4 rodadas, mesas de 4, todas com vencedor.
 * Cinco terminaram com 2 vitórias; é o caso que motivou a troca para as regras do cEDH.
 */
function fridayNight(points = CEDH): Tournament {
  const names = ["Peixoto", "Dudu", "Carlos", "Olívio", "Guilherme", "Vitor", "Renato", "Leo", "Pedro", "Gianluca", "Wilian", "Lucas"];
  const lots = [0.3704, 0.1548, 0.7484, 0.5967, 0.6168, 0.2957, 0.5174, 0.3135, 0.4985, 0.5394, 0.9431, 0.5675];
  const pod = (round: number, table: number, players: string[], winner: string): Pod => ({ id: `r${round}p${table}`, table, players, result: { kind: "win", winner } });
  const rounds = [
    [
      ["Gianluca", "Wilian", "Pedro", "Lucas", "Pedro"],
      ["Guilherme", "Vitor", "Leo", "Peixoto", "Leo"],
      ["Dudu", "Renato", "Carlos", "Olívio", "Dudu"],
    ],
    [
      ["Dudu", "Leo", "Pedro", "Guilherme", "Guilherme"],
      ["Peixoto", "Olívio", "Renato", "Gianluca", "Olívio"],
      ["Carlos", "Vitor", "Wilian", "Lucas", "Lucas"],
    ],
    [
      ["Olívio", "Guilherme", "Pedro", "Lucas", "Guilherme"],
      ["Dudu", "Peixoto", "Vitor", "Gianluca", "Dudu"],
      ["Leo", "Carlos", "Renato", "Wilian", "Leo"],
    ],
    [
      ["Dudu", "Leo", "Olívio", "Lucas", "Olívio"],
      ["Guilherme", "Carlos", "Vitor", "Gianluca", "Carlos"],
      ["Pedro", "Peixoto", "Renato", "Wilian", "Pedro"],
    ],
  ];
  return {
    ...make(12, { kind: "pods", rounds: 4 }),
    players: names.map((name, i) => ({ id: name, name, deck: null, droppedAfter: null, lot: lots[i] })),
    settings: { bestOf: 3, playoffBestOf: 3, points, roundMinutes: 75, seeding: "standings" },
    startedAt: AT,
    rounds: rounds.map((r, i) => ({ number: i + 1, matches: [], pods: r.map((p, j) => pod(i + 1, j + 1, p.slice(0, 4), p[4])), timer: { startedAt: null, pausedAt: null, pausedMs: 0 } })),
  };
}

test("Friday night pelas regras do cEDH: os quatro critérios, na ordem, com os números à mão", () => {
  const t = fridayNight();
  const table = standings(t);
  const row = (id: string) => table.find((s) => s.playerId === id)!;

  // 1. pontos: 2 vitórias × 7
  for (const id of ["Dudu", "Leo", "Guilherme", "Olívio", "Pedro"]) assert.equal(row(id).points, 14, id);
  assert.equal(row("Lucas").points, 7);
  assert.equal(row("Renato").points, 0);
  // 2. MW%: 14 ÷ (4 mesas × 7) = 50% para os cinco
  for (const id of ["Dudu", "Leo", "Guilherme", "Olívio", "Pedro"]) close(row(id).mwp, 0.5, id);
  // 3. pontos médios dos 12 adversários: Dudu, Leo e Guilherme 98 ÷ 12; Olívio 91 ÷ 12; Pedro 84 ÷ 12
  close(row("Dudu").oamp!, 98 / 12);
  close(row("Leo").oamp!, 98 / 12);
  close(row("Guilherme").oamp!, 98 / 12);
  close(row("Olívio").oamp!, 91 / 12);
  close(row("Pedro").oamp!, 84 / 12);
  // 4. OMW%: adversário com 0 pontos entra com o piso de 1/7. Dudu: 3,5 + 4 × 1/7, sobre 12
  close(row("Dudu").omw, (3.5 + 4 / 7) / 12);
  close(row("Pedro").omw, (3 + 5 / 7) / 12);

  // Olívio e Pedro saem pelo 3º critério; Dudu, Leo e Guilherme empatam em tudo e ficam na ordem do sorteio
  assert.deepEqual(
    table.slice(0, 5).map((s) => s.playerId),
    ["Dudu", "Leo", "Guilherme", "Olívio", "Pedro"],
  );
  assert.deepEqual(leaders(t), ["Dudu", "Leo", "Guilherme"]);
  assert.ok(needsFinal(t));
});

test("com a pontuação antiga (3, 1, 0) a ordem dos critérios é a mesma: o desempate não depende da escala", () => {
  const order = (t: Tournament) => standings(t).map((s) => s.playerId);
  assert.deepEqual(order(fridayNight({ win: 3, draw: 1, loss: 0 })), order(fridayNight()));
});

test("mesa de 3: adversário fantasma com o piso de 1/7 no OMW% (não entra nos pontos médios)", () => {
  // 7 jogadores: uma mesa de 4 e uma de 3, uma rodada
  let t = run(make(7, { kind: "pods", rounds: 1 }), { type: "start", at: AT });
  const [four, three] = currentRound(t)!.pods!;
  assert.deepEqual([four.players.length, three.players.length], [4, 3]);
  t = apply(t, { type: "podResult", round: 1, pod: four.id, result: { kind: "win", winner: four.players[0] }, at: AT });
  const [e, f, g] = three.players;
  t = apply(t, { type: "podResult", round: 1, pod: three.id, result: { kind: "win", winner: e }, at: AT });
  const f_ = standings(t).find((s) => s.playerId === f)!;
  // adversários de F: E (100%), G (0 → 1/7) e o fantasma (1/7)
  close(f_.omw, (1 + 1 / 7 + 1 / 7) / 3);
  // pontos médios: só os dois de verdade
  close(f_.oamp!, 7 / 2);
  assert.ok(g);
});

test("empate total na liderança: final só entre quem empata em todos os critérios", () => {
  const t = fridayNight();
  const final = apply(t, { type: "makeFinal", at: AT });
  assert.deepEqual(final.tiebreak!.players, ["Dudu", "Leo", "Guilherme"]);
});

/** Vence o primeiro da mesa pelo número do jogador (p1 é o mais forte). */
const strongest = (pod: Pod): PodResult => ({ kind: "win", winner: [...pod.players].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))[0] });

function playAll(t: Tournament, decide: (pod: Pod) => PodResult): Tournament {
  t = apply(t, { type: "start", at: AT });
  for (let r = 1; r <= plannedRounds(t); r++) {
    const round = currentRound(t)!;
    for (const pod of round.pods!) t = apply(t, { type: "podResult", round: round.number, pod: pod.id, result: decide(pod), at: AT });
    if (r < plannedRounds(t)) t = apply(t, { type: "pairNext" });
  }
  return t;
}

// Evitar reencontro vem antes (no cEDH ele é obrigatório; a mesa de 3 repetida, só "desejável"). Num torneio
// normal o mínimo de reencontros quase sempre já decide quem vai para a mesa de 3; aqui o histórico só tem a
// mesa de 3 da rodada 1 (15 jogadores: os três cabem em mesas de 4 diferentes), então há divisão sem reencontro
// com e sem eles na mesa de 3, e a regra é o que decide.
test("mesa de 3 no máximo uma vez por jogador quando não custa reencontro", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const base = make(15, { kind: "pods", rounds: 2 }, seed);
    const t = { ...base, rounds: [{ number: 1, matches: [], pods: [{ id: "r1p1", table: 1, players: ["p13", "p14", "p15"], result: { kind: "draw" as const, survivors: ["p13", "p14", "p15"] } }], timer: { startedAt: null, pausedAt: null, pausedMs: 0 } }] };
    const pods = pairPods(t, 2, { rng: mulberry32(seed) });
    const small = pods.find((p) => p.players.length === 3)!;
    assert.ok(!small.players.some((id) => ["p13", "p14", "p15"].includes(id)), `sorteio ${seed}: ${small.players}`);
  }
});

test("a ordem de jogo na mesa é sorteada, não segue os pontos", () => {
  let leaderFirst = 0;
  let total = 0;
  for (let seed = 1; seed <= 30; seed++) {
    let t = run(make(8, { kind: "pods", rounds: 2 }, seed), { type: "start", at: AT });
    for (const pod of currentRound(t)!.pods!) t = apply(t, { type: "podResult", round: 1, pod: pod.id, result: strongest(pod), at: AT });
    t = apply(t, { type: "pairNext" });
    const pts = new Map(standings(t, 1).map((s) => [s.playerId, s.points]));
    for (const pod of currentRound(t)!.pods!) {
      const best = Math.max(...pod.players.map((id) => pts.get(id)!));
      total++;
      if (pts.get(pod.players[0]) === best) leaderFirst++;
    }
  }
  // com a ordem por pontos seria 100%; sorteada, fica bem abaixo
  assert.ok(leaderFirst < total * 0.8, `${leaderFirst} de ${total}`);
});
