import assert from "node:assert/strict";
import { test } from "node:test";
import { apply } from "./engine.ts";
import { finalText, matchesCsv, pairingsText, pct, standingsCsv, standingsText } from "./export.ts";
import { AT, byStrength, make, playSwiss } from "./testkit.ts";

test("texto para o WhatsApp e CSV da classificação e das partidas", () => {
  let t = make(5, { kind: "swiss", rounds: 3, cut: 2 }, 8);
  t = playSwiss(t, byStrength, 3);
  t = apply(t, { type: "cut", seeding: "standings", at: AT });
  const pairings = pairingsText(t, 1);
  assert.match(pairings, /^\*Teste\*/);
  assert.match(pairings, /Mesa 1: Jogador \d × Jogador \d/);
  assert.match(pairings, /Folga: Jogador \d/);
  assert.match(standingsText(t), /1\. Jogador 1 — 9 pts \(3-0-0\)/);
  assert.match(finalText(t), /\*Final\*/);
  const raw = standingsCsv(t);
  assert.equal(raw.charCodeAt(0), 0xfeff, "começa com BOM para o Excel");
  const table = raw.slice(1).split(String.fromCharCode(10));
  assert.equal(table[0], "posicao,jogador,deck,pontos,vitorias,derrotas,empates,folgas,omw,gw,ogw,saiu,mata_mata");
  assert.equal(table.filter(Boolean).length, 6);
  assert.match(matchesCsv(t), /suico,1,,Jogador \d,folga,2,0,0/);
  assert.equal(pct(2 / 3), "66,67%");
});
