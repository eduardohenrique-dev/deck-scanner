import type * as CvNs from "@techstark/opencv-js";

/** Módulo do OpenCV.js já inicializado (as constantes numéricas nem todas estão tipadas). */
export type CV = typeof CvNs & Record<string, any>;
export type Mat = CvNs.Mat;

/** O pacote exporta ora uma Promise, ora o módulo do Emscripten ainda inicializando. */
export async function resolveCv(mod: any): Promise<{ cv: CV }> {
  if (mod instanceof Promise) return { cv: await mod };
  if (mod.Mat) return { cv: mod };
  await new Promise<void>((resolve) => {
    mod.onRuntimeInitialized = () => resolve();
  });
  return { cv: mod };
}

/** Libera Mats sem estourar se algum já foi liberado ou nem chegou a existir. */
export function release(...mats: (Mat | null | undefined)[]) {
  for (const m of mats) {
    try {
      if (m && !m.isDeleted()) m.delete();
    } catch {
      /* já liberado */
    }
  }
}

/** Imagem RGBA fora do heap do WASM (copiada), pronta para codificar ou transferir. */
export interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function toRaw(mat: Mat): RawImage {
  return { data: new Uint8ClampedArray(mat.data), width: mat.cols, height: mat.rows };
}
