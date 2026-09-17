/**
 * "Isso é mesmo uma carta?" — olha o LAYOUT da imagem já retificada, não a arte.
 *
 * O detector acha qualquer retângulo com proporção de carta: a caixa de arte da própria carta, a tela do
 * celular, um envelope, a borda da mesa. Todos passam pela geometria. O que só uma carta de Magic tem é a
 * estrutura interna: faixa do nome no topo, arte, linha de tipo, caixa de texto e uma borda lisa em volta.
 *
 * Três sinais, todos baratos (gradiente vertical numa imagem pequena):
 *  - linhas: as bordas horizontais fortes caem onde a moldura da carta separa nome/arte/tipo/texto;
 *  - texto: a caixa de regras tem várias linhas de texto, que viram picos regulares de gradiente;
 *  - detalhe: mesa lisa, parede ou tela apagada não têm textura nenhuma.
 *
 * Medido no vídeo sintético (tools-js/cardness-eval.mjs): no corte 0,70 passam 98,3% dos frames de carta
 * bem apresentada e só 1,9% dos recortes de fundo (mesa, mão, tapete).
 *
 * Cartas de arte completa e sem borda perdem parte dos sinais de propósito: por isso quem decide é a
 * combinação, e o chamador ainda tem uma faixa "talvez" (ver LIVE_* em grouper.ts) em vez de um corte seco.
 */
import { release, type CV, type Mat } from "./cv.ts";

const W = 122;
const H = 170;

/** Onde a moldura da carta desenha linhas horizontais (fração da altura). */
const LAYOUT_ROWS = [0.093, 0.548, 0.617, 0.905];
const ROW_TOLERANCE = 0.022;
const TEXT_BAND: [number, number] = [0.63, 0.9];

export interface Cardness {
  /** linhas da moldura nos lugares certos (0–1) */
  layout: number;
  /** linhas de texto na caixa de regras (0–1) */
  text: number;
  /** quanto detalhe a imagem tem: separa carta de superfície lisa */
  detail: number;
  /** combinação usada para decidir (0–1) */
  score: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Energia de borda horizontal de cada linha da imagem (média de |dI/dy|). */
function rowEnergy(cv: CV, gray: Mat): number[] {
  const sobel = new cv.Mat();
  const abs = new cv.Mat();
  cv.Sobel(gray, sobel, cv.CV_32F, 0, 1, 3, 1, 0, cv.BORDER_REPLICATE);
  cv.convertScaleAbs(sobel, abs);
  const data = abs.data;
  const rows: number[] = [];
  for (let y = 0; y < H; y++) {
    let sum = 0;
    const off = y * W;
    // as colunas das pontas pegam a sombra da mesa: ficam de fora
    for (let x = 6; x < W - 6; x++) sum += data[off + x];
    rows.push(sum / (W - 12));
  }
  release(sobel, abs);
  return rows;
}

/** Recebe a carta já retificada (RGBA, proporção de carta). */
export function cardness(cv: CV, card: Mat): Cardness {
  const gray = new cv.Mat();
  const small = new cv.Mat();
  cv.cvtColor(card, gray, cv.COLOR_RGBA2GRAY);
  cv.resize(gray, small, new cv.Size(W, H), 0, 0, cv.INTER_AREA);

  const rows = rowEnergy(cv, small);
  const base = Math.max(median(rows), 1);
  const norm = rows.map((v) => v / base);

  // 1. as linhas da moldura: o pico mais forte perto de cada altura esperada
  const peaks = LAYOUT_ROWS.map((frac) => {
    const from = Math.max(0, Math.round((frac - ROW_TOLERANCE) * H));
    const to = Math.min(H - 1, Math.round((frac + ROW_TOLERANCE) * H));
    let best = 0;
    for (let y = from; y <= to; y++) best = Math.max(best, norm[y]);
    return best;
  });
  // duas linhas fortes já bastam (carta sem borda perde as outras)
  const strongest = [...peaks].sort((a, b) => b - a);
  const layout = clamp01(((strongest[0] + strongest[1]) / 2 - 1.4) / 2.2);

  // 2. linhas de texto na caixa de regras
  const from = Math.round(TEXT_BAND[0] * H);
  const to = Math.round(TEXT_BAND[1] * H);
  let lines = 0;
  for (let y = from + 1; y < to; y++) if (norm[y] > 1.35 && norm[y] >= norm[y - 1] && norm[y] > norm[y + 1]) lines++;
  const text = clamp01((lines - 1) / 7);

  // 3. detalhe geral: mesa lisa, parede ou tela apagada não chegam perto
  const detail = clamp01((base - 4) / 14);

  release(gray, small);
  const score = clamp01(0.75 * layout + 0.15 * text + 0.1 * detail);
  return { layout: round(layout), text: round(text), detail: round(detail), score: round(score) };
}
