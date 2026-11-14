import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, currentRound } from "./engine.ts";
import { announcement, noticeFor } from "./notify.ts";
import { AT, make, run } from "./testkit.ts";

test("aviso: rodada nova e mesa final geram aviso; lançar resultado não", () => {
  let t = make(8, { kind: "pods", rounds: 2 });
  const start = { type: "start" as const, at: AT };
  t = apply(t, start);
  assert.equal(noticeFor(start, t), "r1");
  const pod = currentRound(t)!.pods![0];
  const result = { type: "podResult" as const, round: 1, pod: pod.id, result: { kind: "win" as const, winner: pod.players[0] }, at: AT };
  t = apply(t, result);
  assert.equal(noticeFor(result, t), null);
});

test("aviso da 1ª rodada não tem posição; da 2ª em diante, a posição de antes da rodada", () => {
  let t = run(make(8, { kind: "pods", rounds: 2 }, 3), { type: "start", at: AT });
  const first = announcement(t, "r1")!;
  assert.equal(first.heading, "Rodada 1 de 2");
  assert.deepEqual(first.standings, {});
  for (const pod of currentRound(t)!.pods!) t = apply(t, { type: "podResult", round: 1, pod: pod.id, result: { kind: "win", winner: pod.players[0] }, at: AT });
  t = apply(t, { type: "pairNext" });
  const second = announcement(t, "r2")!;
  const winners = t.rounds[0].pods!.map((p) => p.players[0]);
  for (const w of winners) assert.equal(second.standings[w].points, 7);
  assert.ok(winners.every((w) => (second.standings[w].rank ?? 99) <= 2));
  assert.equal(announcement(t, "r3"), null); // rodada que não existe
});
