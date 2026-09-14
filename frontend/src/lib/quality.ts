/**
 * Análise local e barata de qualidade (roda no dispositivo, antes de aceitar a foto):
 * nitidez = variância do laplaciano; reflexo = fração de pixels estourados; brilho médio.
 */
export type FrameQuality = {
  sharpness: number;
  glare: number;
  brightness: number;
  issues: ("blur" | "glare" | "dark")[];
};

// Limiares para a imagem reduzida a 320 px de largura. Reflexo = pixels estourados
// (molduras e caixas de texto brancas ficam abaixo de ~250 e não contam).
export const QUALITY_LIMITS = { blur: 55, glare: 0.04, dark: 45 };

export function analyzeSource(source: CanvasImageSource, srcW: number, srcH: number, canvas?: HTMLCanvasElement): FrameQuality {
  const w = 320;
  const h = Math.max(1, Math.round((srcH / srcW) * w));
  const c = canvas ?? document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  let glare = 0;
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = y;
    sum += y;
    if (r > 251 && g > 251 && b > 251) glare++;
  }
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lapSum += v;
      lapSq += v * v;
      n++;
    }
  }
  const mean = lapSum / n;
  const sharpness = lapSq / n - mean * mean;
  const glareRatio = glare / (w * h);
  const brightness = sum / (w * h);
  const issues: FrameQuality["issues"] = [];
  if (sharpness < QUALITY_LIMITS.blur) issues.push("blur");
  if (glareRatio > QUALITY_LIMITS.glare) issues.push("glare");
  if (brightness < QUALITY_LIMITS.dark) issues.push("dark");
  return { sharpness, glare: glareRatio, brightness, issues };
}

export const ISSUE_TEXT: Record<FrameQuality["issues"][number], string> = {
  blur: "Imagem tremida — segure firme e tente de novo",
  glare: "Reflexo forte — incline o celular ou mude a luz",
  dark: "Pouca luz — aproxime-se de uma fonte de luz",
};
