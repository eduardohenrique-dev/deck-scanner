import assert from "node:assert/strict";
import { test } from "node:test";
import { maxWeightMatching, type Edge } from "./matching.ts";
import { mulberry32 } from "./rng.ts";

/** Força bruta: o melhor emparelhamento possível (peso total e, se pedido, só os de cardinalidade máxima). */
function brute(n: number, edges: Edge[], maxCardinality: boolean): { weight: number; size: number } {
  const w = new Map<string, number>();
  for (const [i, j, x] of edges) w.set(`${Math.min(i, j)}-${Math.max(i, j)}`, x);
  let best = { weight: -Infinity, size: -1 };
  const used = new Array<boolean>(n).fill(false);
  function go(i: number, weight: number, size: number) {
    while (i < n && used[i]) i++;
    if (i >= n) {
      const better = maxCardinality ? size > best.size || (size === best.size && weight > best.weight) : weight > best.weight;
      if (better) best = { weight, size };
      return;
    }
    used[i] = true;
    go(i + 1, weight, size); // i fica sem par
    for (let j = i + 1; j < n; j++) {
      const x = w.get(`${i}-${j}`);
      if (used[j] || x === undefined) continue;
      used[j] = true;
      go(i + 1, weight + x, size + 1);
      used[j] = false;
    }
    used[i] = false;
  }
  go(0, 0, 0);
  return best;
}

function evaluate(mate: number[], edges: Edge[]) {
  const w = new Map<string, number>();
  for (const [i, j, x] of edges) w.set(`${Math.min(i, j)}-${Math.max(i, j)}`, x);
  let weight = 0;
  let size = 0;
  mate.forEach((u, v) => {
    if (u > v) {
      const x = w.get(`${v}-${u}`);
      assert.ok(x !== undefined, "pareou vértices sem aresta");
      weight += x;
      size++;
    }
  });
  return { weight, size };
}

test("o blossom acha o ótimo em centenas de grafos pequenos (conferido por força bruta)", () => {
  const rng = mulberry32(42);
  for (let trial = 0; trial < 400; trial++) {
    const n = 2 + Math.floor(rng() * 9);
    const density = 0.3 + rng() * 0.7;
    const edges: Edge[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rng() < density) edges.push([i, j, 1 + Math.floor(rng() * 40)]);
    if (!edges.length) continue;
    const maxCard = trial % 2 === 0;
    const mate = maxWeightMatching(edges, maxCard);
    // o emparelhamento é simétrico
    mate.forEach((u, v) => u >= 0 && assert.equal(mate[u], v));
    const got = evaluate(mate, edges);
    const want = brute(Math.max(...edges.flatMap((e) => [e[0], e[1]])) + 1, edges, maxCard);
    if (maxCard) assert.equal(got.size, want.size, `cardinalidade (tentativa ${trial})`);
    assert.equal(got.weight, want.weight, `peso (tentativa ${trial})`);
  }
});

test("casos clássicos do mwmatching", () => {
  assert.deepEqual(maxWeightMatching([]), []);
  assert.deepEqual(maxWeightMatching([[0, 1, 1]]), [1, 0]);
  assert.deepEqual(maxWeightMatching([[1, 2, 10], [2, 3, 11]]), [-1, -1, 3, 2]);
  assert.deepEqual(maxWeightMatching([[1, 2, 5], [2, 3, 11], [3, 4, 5]]), [-1, -1, 3, 2, -1]);
  assert.deepEqual(maxWeightMatching([[1, 2, 5], [2, 3, 11], [3, 4, 5]], true), [-1, 2, 1, 4, 3]);
  // blossom com S-blossom criado e usado
  assert.deepEqual(maxWeightMatching([[1, 2, 8], [1, 3, 9], [2, 3, 10], [3, 4, 7]]), [-1, 2, 1, 4, 3]);
  // expansão de T-blossom
  assert.deepEqual(
    maxWeightMatching([[1, 2, 23], [1, 5, 22], [1, 6, 15], [2, 3, 25], [3, 4, 22], [4, 5, 25], [4, 8, 14], [5, 7, 13]]),
    [-1, 6, 3, 2, 8, 7, 1, 5, 4],
  );
  // blossom aninhado, com relabel
  assert.deepEqual(
    maxWeightMatching([[1, 2, 45], [1, 5, 45], [2, 3, 50], [3, 4, 45], [4, 5, 50], [1, 6, 30], [3, 9, 35], [4, 8, 28], [5, 7, 26], [9, 10, 5]]),
    [-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9],
  );
});

test("dá conta de uma rodada de 128 jogadores rapidamente", () => {
  const rng = mulberry32(7);
  const n = 128;
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([i, j, 1 + Math.floor(rng() * 1e6)]);
  const t0 = performance.now();
  const mate = maxWeightMatching(edges, true);
  const ms = performance.now() - t0;
  assert.ok(mate.every((u) => u >= 0), "todos pareados");
  assert.ok(ms < 5000, `levou ${ms.toFixed(0)} ms`);
});
