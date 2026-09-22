import assert from "node:assert/strict";
import { test } from "node:test";
import { bracketSize, bracketView, drawSeeds, playoffPlacing, pruneStale, seedPositions } from "./bracket.ts";
import { mulberry32 } from "./rng.ts";
import type { Playoff } from "./types.ts";

const seeds = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
const po = (n: number, results: Playoff["results"] = {}): Playoff => ({ cut: n, seeding: "standings", seeds: seeds(n), results, drawnAt: "" });
const win = (a: string, b: string, first = true) => ({ score: first ? { a: 2, b: 1, draws: 0 } : { a: 0, b: 2, draws: 0 }, a, b });

test("posições padrão dos seeds: 1 × último e 1 e 2 em lados opostos", () => {
  assert.deepEqual(seedPositions(2), [1, 2]);
  assert.deepEqual(seedPositions(4), [1, 4, 2, 3]);
  assert.deepEqual(seedPositions(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.deepEqual(seedPositions(16), [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  assert.equal(bracketSize(6), 8);
  assert.equal(bracketSize(8), 8);
  assert.equal(bracketSize(12), 16);
});

test("Top 6: chave de 8 e os seeds 1 e 2 folgam", () => {
  const view = bracketView(po(6));
  assert.equal(view.size, 8);
  const first = view.rounds[0];
  const byes = first.filter((s) => s.bye).map((s) => (s.a ?? s.b)!.seed);
  assert.deepEqual(byes.sort(), [1, 2]);
  // folga já avança: a semifinal do seed 1 espera o vencedor de 4 × 5
  assert.equal(view.rounds[1][0].a?.seed, 1);
  assert.equal(view.rounds[1][0].b, null);
  assert.deepEqual([first[1].a?.seed, first[1].b?.seed], [4, 5]);
  assert.deepEqual([first[3].a?.seed, first[3].b?.seed], [3, 6]);
});

test("Top 12: chave de 16 e os 4 melhores seeds folgam", () => {
  const view = bracketView(po(12));
  assert.equal(view.size, 16);
  const byes = view.rounds[0].filter((s) => s.bye).map((s) => (s.a ?? s.b)!.seed);
  assert.deepEqual(byes.sort((x, y) => x - y), [1, 2, 3, 4]);
  assert.equal(view.rounds[0].filter((s) => !s.bye).length, 4);
});

test("vencedores avançam e o campeão sai da final", () => {
  let p = po(4);
  p = { ...p, results: { "0:0": win("s1", "s4"), "0:1": win("s2", "s3", false) } };
  let view = bracketView(p);
  assert.deepEqual([view.rounds[1][0].a?.playerId, view.rounds[1][0].b?.playerId], ["s1", "s3"]);
  assert.equal(view.champion, null);
  p = { ...p, results: { ...p.results, "1:0": win("s1", "s3", false) } };
  view = bracketView(p);
  assert.equal(view.champion, "s3");
  assert.deepEqual(
    playoffPlacing(view).map((x) => [x.playerId, x.place]),
    [
      ["s3", 1],
      ["s1", 2],
      ["s2", 3],
      ["s4", 3],
    ],
  );
});

test("mudar um resultado antigo derruba os placares que dependiam dele", () => {
  const p = po(4, { "0:0": win("s1", "s4"), "0:1": win("s2", "s3"), "1:0": win("s1", "s2") });
  assert.equal(bracketView(p).champion, "s1");
  // a semifinal de cima passa a ser do s4: a final gravada (s1 × s2) fica velha
  const changed = { ...p, results: { ...p.results, "0:0": win("s1", "s4", false) } };
  const view = bracketView(changed);
  assert.equal(view.rounds[1][0].stale, true);
  assert.equal(view.champion, null);
  const { playoff, removed } = pruneStale(changed);
  assert.deepEqual(removed, ["1:0"]);
  assert.equal(bracketView(playoff).rounds[1][0].stale, false);
});

test("sorteio do bracket mantém as folgas com os melhores da classificação", () => {
  const ids = seeds(6);
  for (let seed = 1; seed < 20; seed++) {
    const drawn = drawSeeds(ids, "random", mulberry32(seed));
    assert.deepEqual(drawn.slice(0, 2), ["s1", "s2"]);
    assert.deepEqual([...drawn].sort(), [...ids].sort());
  }
  const shuffled = new Set(Array.from({ length: 10 }, (_, i) => drawSeeds(ids, "random", mulberry32(i)).join(",")));
  assert.ok(shuffled.size > 1, "o resto é embaralhado");
});
