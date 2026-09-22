/** Sorteio reproduzível: a mesma semente dá o mesmo resultado (testes, replay e "sortear de novo" com outra semente). */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semente derivada: a semente do torneio misturada com o que está sendo sorteado (rodada, tentativa). */
export function derive(seed: number, ...parts: (number | string)[]): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    }
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  }
  return h >>> 0;
}

export function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}
