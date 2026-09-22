import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "./engine.ts";
import { FLOOR, history, standings } from "./standings.ts";
import type { Match, Player, Round, Score } from "./types.ts";

const P = (id: string, lot = 0, droppedAfter: number | null = null): Player => ({ id, name: id, deck: null, droppedAfter, lot });
const M = (id: string, a: string, b: string | null, score: Score | null, table: number | null = 1): Match => ({ id, table: b ? table : null, a, b, result: score });
const R = (number: number, matches: Match[]): Round => ({ number, matches, timer: { startedAt: null, pausedAt: null, pausedMs: 0 } });
const s = (a: number, b: number, draws = 0): Score => ({ a, b, draws });
const close = (x: number, y: number) => assert.ok(Math.abs(x - y) < 1e-9, `${x} ≠ ${y}`);

test("desempates conferidos à mão: pontos → OMW → GW → OGW, com piso de 33%", () => {
  const players = ["A", "B", "C", "D"].map((id) => P(id));
  const rounds = [R(1, [M("1", "A", "B", s(2, 0)), M("2", "C", "D", s(2, 1), 2)]), R(2, [M("3", "A", "C", s(2, 1)), M("4", "B", "D", s(1, 1, 1), 2)])];
  const table = standings({ players, rounds, settings: DEFAULT_SETTINGS });
  assert.deepEqual(
    table.map((r) => r.playerId),
    ["A", "C", "B", "D"],
  );
  const by = new Map(table.map((r) => [r.playerId, r]));
  const A = by.get("A")!;
  const B = by.get("B")!;
  const C = by.get("C")!;
  const D = by.get("D")!;
  assert.equal(A.points, 6);
  close(A.mwp, 1);
  close(A.gwp, 12 / 15);
  close(A.omw, (FLOOR + 0.5) / 2);
  close(A.ogw, (FLOOR + 0.5) / 2);
  // B tem 1/6 de aproveitamento e 4/15 em games: os dois sobem para o piso
  close(B.mwp, FLOOR);
  close(B.gwp, FLOOR);
  close(B.omw, (1 + FLOOR) / 2);
  close(B.ogw, (0.8 + 7 / 18) / 2);
  close(C.omw, (FLOOR + 1) / 2);
  close(C.gwp, 0.5);
  close(D.gwp, 7 / 18);
  // B e D empatam em pontos; B passa pelo OMW
  assert.equal(B.points, D.points);
  assert.ok(B.omw > D.omw);
  assert.deepEqual([A.wins, A.losses, A.draws], [2, 0, 0]);
  assert.deepEqual([B.wins, B.losses, B.draws], [0, 1, 1]);
});

test("folga: vale 2 a 0 para o próprio jogador e fica fora da média dos oponentes", () => {
  const players = ["P1", "P2", "P3"].map((id) => P(id));
  const rounds = [R(1, [M("1", "P2", "P3", s(2, 0)), M("b1", "P1", null, s(2, 0))]), R(2, [M("2", "P1", "P2", s(2, 1)), M("b2", "P3", null, s(2, 0))])];
  const table = standings({ players, rounds, settings: DEFAULT_SETTINGS });
  const by = new Map(table.map((r) => [r.playerId, r]));
  assert.deepEqual(
    table.map((r) => r.playerId),
    ["P1", "P2", "P3"],
  );
  const p1 = by.get("P1")!;
  assert.equal(p1.points, 6);
  assert.equal(p1.byes, 1);
  close(p1.gwp, 12 / 15); // 4 games ganhos (2 da folga) em 5
  close(p1.omw, 0.5); // só o P2 conta
  close(by.get("P2")!.omw, (0.5 + 1) / 2);
  close(by.get("P3")!.omw, 0.5);
});

test("quem saiu continua contando no desempate de quem jogou com ele", () => {
  const players = [P("A"), P("B"), P("C", 0, 1), P("D")];
  const rounds = [R(1, [M("1", "A", "C", s(2, 0)), M("2", "B", "D", s(2, 0), 2)]), R(2, [M("3", "A", "B", s(2, 0)), M("b", "D", null, s(2, 0))])];
  const table = standings({ players, rounds, settings: DEFAULT_SETTINGS });
  const by = new Map(table.map((r) => [r.playerId, r]));
  assert.equal(by.get("C")!.dropped, true);
  // C perdeu a única partida: 0/3, sobe para o piso e entra na média do A
  close(by.get("A")!.omw, (FLOOR + 0.5) / 2);
});

test("pontuação configurável muda os pontos e o aproveitamento", () => {
  const players = ["A", "B"].map((id) => P(id));
  const rounds = [R(1, [M("1", "A", "B", s(1, 1, 1))])];
  const table = standings({ players, rounds, settings: { ...DEFAULT_SETTINGS, points: { win: 2, draw: 1, loss: 0 } } });
  assert.equal(table[0].points, 1);
  close(table[0].mwp, 0.5);
});

test("empate total cai no sorteio fixo (lot), sempre na mesma ordem", () => {
  const players = [P("X", 0.9), P("Y", 0.1)];
  const table = standings({ players, rounds: [], settings: DEFAULT_SETTINGS });
  assert.deepEqual(
    table.map((r) => r.playerId),
    ["Y", "X"],
  );
});

test("histórico por jogador, com o placar do ponto de vista dele", () => {
  const players = ["A", "B"].map((id) => P(id));
  const rounds = [R(1, [M("1", "A", "B", s(2, 1))])];
  const games = history({ players, rounds, settings: DEFAULT_SETTINGS }, "B");
  assert.equal(games.length, 1);
  assert.equal(games[0].outcome, "loss");
  assert.deepEqual(games[0].score, s(1, 2));
  assert.equal(games[0].opponent, "A");
});
