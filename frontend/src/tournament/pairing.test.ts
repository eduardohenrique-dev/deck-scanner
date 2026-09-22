import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, currentRound } from "./engine.ts";
import { meetings, pairKey, suggestRounds } from "./pairing.ts";
import { standings } from "./standings.ts";
import { AT, byStrength, make, opponentsOf, playRound, playSwiss, randomScores, seeded } from "./testkit.ts";
import type { Tournament } from "./types.ts";

const allPaired = (t: Tournament) => {
  for (const r of t.rounds) {
    const seen = r.matches.flatMap((m) => [m.a, m.b].filter(Boolean));
    assert.equal(new Set(seen).size, seen.length, `rodada ${r.number}: alguém em duas mesas`);
  }
};

test("rodadas sugeridas seguem a tabela da MTR", () => {
  assert.equal(suggestRounds(1), 0);
  assert.equal(suggestRounds(2), 1);
  assert.equal(suggestRounds(4), 2);
  assert.equal(suggestRounds(8), 3);
  assert.equal(suggestRounds(9), 4);
  assert.equal(suggestRounds(12, 4), 5); // 9–16 com top 4
  assert.equal(suggestRounds(16, 8), 4);
  assert.equal(suggestRounds(17), 5);
  assert.equal(suggestRounds(32), 5);
  assert.equal(suggestRounds(33), 6);
  assert.equal(suggestRounds(128), 7);
  assert.equal(suggestRounds(200), 8);
  assert.equal(suggestRounds(300), 9);
  assert.equal(suggestRounds(500), 10);
});

test("número ímpar: uma folga por rodada, nunca duas para o mesmo jogador", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    let t = make(7, { kind: "swiss", rounds: 5, cut: null }, seed);
    t = playSwiss(t, randomScores(seeded(seed)), 5);
    allPaired(t);
    const byes = t.rounds.map((r) => r.matches.filter((m) => m.b === null));
    byes.forEach((b) => assert.equal(b.length, 1, "uma folga por rodada"));
    const who = byes.flat().map((m) => m.a);
    assert.equal(new Set(who).size, who.length, `semente ${seed}: folga repetida (${who.join(", ")})`);
  }
});

test("a folga vai para quem tem menos pontos", () => {
  let t = make(5, { kind: "swiss", rounds: 3, cut: null }, 11);
  t = apply(t, { type: "start", at: AT });
  t = playRound(t, byStrength);
  t = apply(t, { type: "pairNext" });
  const table = standings({ ...t, rounds: t.rounds.slice(0, 1) });
  const bye = currentRound(t)!.matches.find((m) => m.b === null)!;
  const had = t.rounds[0].matches.find((m) => m.b === null)!.a;
  const minPts = Math.min(...table.filter((s) => s.playerId !== had).map((s) => s.points));
  assert.equal(table.find((s) => s.playerId === bye.a)!.points, minPts);
  assert.notEqual(bye.a, had, "não repete a folga");
});

test("sem revanche quando dá para evitar (16 jogadores, 4 rodadas, várias sementes)", () => {
  for (const seed of [1, 7, 13, 21, 34]) {
    let t = make(16, { kind: "swiss", rounds: 4, cut: null }, seed);
    t = playSwiss(t, randomScores(seeded(seed * 3)), 4);
    allPaired(t);
    const { pairs } = meetings(t.rounds);
    for (const [k, n] of pairs) assert.equal(n, 1, `semente ${seed}: revanche ${k}`);
  }
});

test("revanche só quando é impossível evitar (4 jogadores, 4 rodadas)", () => {
  let t = make(4, { kind: "swiss", rounds: 4, cut: null }, 3);
  t = playSwiss(t, byStrength, 4);
  allPaired(t);
  const { pairs } = meetings(t.rounds);
  // nas 3 primeiras rodadas todo mundo se enfrenta uma vez; a 4ª repete (não há outra saída)
  const firstThree = meetings(t.rounds.slice(0, 3)).pairs;
  for (const n of firstThree.values()) assert.equal(n, 1);
  assert.equal([...pairs.values()].filter((n) => n === 2).length, 2);
});

test("agrupa por pontos: depois da 1ª rodada, vencedores enfrentam vencedores", () => {
  let t = make(8, { kind: "swiss", rounds: 3, cut: null }, 5);
  t = apply(t, { type: "start", at: AT });
  t = playRound(t, byStrength);
  t = apply(t, { type: "pairNext" });
  const pts = new Map(standings({ ...t, rounds: t.rounds.slice(0, 1) }).map((s) => [s.playerId, s.points]));
  for (const m of currentRound(t)!.matches) assert.equal(pts.get(m.a), pts.get(m.b!), `mesa ${m.table}: ${m.a} × ${m.b}`);
});

test("a mesa 1 é a do topo da tabela", () => {
  let t = make(8, { kind: "swiss", rounds: 3, cut: null }, 9);
  t = apply(t, { type: "start", at: AT });
  t = playRound(t, byStrength);
  t = apply(t, { type: "pairNext" });
  const table = standings({ ...t, rounds: t.rounds.slice(0, 1) });
  const top = currentRound(t)!.matches.find((m) => m.table === 1)!;
  assert.ok([top.a, top.b].includes(table[0].playerId));
});

test("na última rodada o emparelhamento segue a classificação (1º × 2º)", () => {
  let t = make(8, { kind: "swiss", rounds: 3, cut: null }, 17);
  t = apply(t, { type: "start", at: AT });
  t = playRound(t, byStrength);
  t = apply(t, { type: "pairNext" });
  t = playRound(t, byStrength);
  t = apply(t, { type: "pairNext" }); // rodada 3 = última
  const table = standings({ ...t, rounds: t.rounds.slice(0, 2) });
  const firstTable = currentRound(t)!.matches.find((m) => m.table === 1)!;
  const top2 = [table[0].playerId, table[1].playerId].sort();
  // os dois primeiros têm 6 pontos e não se enfrentaram: jogam a mesa 1
  if (!opponentsOf({ ...t, rounds: t.rounds.slice(0, 2) }, top2[0]).includes(top2[1])) assert.deepEqual([firstTable.a, firstTable.b].sort(), top2);
});

test("sementes diferentes, emparelhamentos diferentes (sorteio dentro do grupo)", () => {
  const firsts = new Set<string>();
  for (let seed = 1; seed <= 8; seed++) {
    const t = apply(make(12, { kind: "swiss", rounds: 4, cut: null }, seed), { type: "start", at: AT });
    firsts.add(
      t.rounds[0].matches
        .map((m) => pairKey(m.a, m.b ?? "-"))
        .sort()
        .join(","),
    );
  }
  assert.ok(firsts.size > 1);
});

test("todos contra todos: cada par uma vez; com número ímpar, cada um folga uma vez", () => {
  let t = make(5, { kind: "round-robin", cut: null }, 2);
  t = playSwiss(t, randomScores(seeded(2)), 5);
  assert.equal(t.rounds.length, 5);
  const { pairs, byes } = meetings(t.rounds);
  assert.equal(pairs.size, 10); // 5 × 4 / 2
  for (const n of pairs.values()) assert.equal(n, 1);
  for (const p of t.players) assert.equal(byes.get(p.id), 1);
});

test("todos contra todos com número par: n−1 rodadas, sem folga", () => {
  let t = make(6, { kind: "round-robin", cut: null }, 4);
  t = playSwiss(t, byStrength, 5);
  const { pairs, byes } = meetings(t.rounds);
  assert.equal(pairs.size, 15);
  assert.equal(byes.size, 0);
});
