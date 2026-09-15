/**
 * Agrupamento temporal dos frames — porta de TemporalGrouper (backend/app/pipeline/video.py).
 *
 * - frame estável: carta detectada, nítida e quase parada desde o frame anterior;
 * - frames instáveis formam uma transição que guarda o evento mais forte:
 *   "empty" (carta sumiu) > "fast" (carta sendo tirada) > "unstable" (tremida/foco);
 * - depois de "empty"/"fast" começa OUTRA carta física, mesmo com a mesma arte (básicos seguidos);
 * - depois de transição leve continua a mesma carta se a assinatura e a posição conferem;
 * - com a carta parada, assinatura muito diferente = carta trocada no lugar.
 */
import { dist, longAxisAngle, median, pointInPolygon, polygonArea, quadIou, quadWidth, centroid, type Quad } from "./geometry.ts";
import { hamming } from "./hash.ts";
import type { FrameQuality } from "./quality.ts";

export const SAME_THRESH = 100;
export const STABLE_MOTION = 0.1;
export const FAST_MOTION = 0.25;
export const MIN_SHARPNESS = 22;
export const MAX_BEST_FRAMES = 3;

export type Transition = "unstable" | "fast" | "empty" | null;
const STRENGTH: Record<string, number> = { null: 0, unstable: 1, fast: 2, empty: 3 };

export interface FrameObs<P> {
  t: number;
  idx: number;
  pts: Quad | null;
  sig?: Uint8Array;
  sig180?: Uint8Array;
  q?: FrameQuality;
  payload?: P;
  /** entre os melhores frames de um grupo aberto (a imagem precisa ser mantida) */
  retained?: boolean;
}

export interface Gap {
  event: Transition;
  frames: number;
}

export class Group<P> {
  frames: FrameObs<P>[] = [];
  best: FrameObs<P>[] = [];
  readonly seq: number;
  readonly gapBefore: Gap;
  readonly prevLastPts: Quad | null;
  constructor(seq: number, gapBefore: Gap, prevLastPts: Quad | null) {
    this.seq = seq;
    this.gapBefore = gapBefore;
    this.prevLastPts = prevLastPts;
  }

  get ref(): FrameObs<P> {
    return this.best[0];
  }

  get angles(): number[] {
    return this.frames.map((f) => longAxisAngle(f.pts!));
  }

  /** Retorna os frames que saíram da lista dos melhores (a imagem deles pode ser liberada). */
  add(obs: FrameObs<P>): FrameObs<P>[] {
    this.frames.push(obs);
    obs.retained = true;
    this.best.push(obs);
    this.best.sort((a, b) => b.q!.score - a.q!.score);
    const dropped = this.best.slice(MAX_BEST_FRAMES);
    this.best = this.best.slice(0, MAX_BEST_FRAMES);
    for (const d of dropped) d.retained = false;
    return dropped;
  }
}

const sigDist = <P>(a: FrameObs<P>, b: FrameObs<P>) => Math.min(hamming(a.sig!, b.sig!), hamming(a.sig!, b.sig180!));

export class TemporalGrouper<P> {
  current: Group<P> | null = null;
  seq = 0;
  transition: Transition = null;
  transitionFrames = 0;
  lastStablePts: Quad | null = null;
  private prevPts: Quad | null = null;
  private lastClosedPts: Quad | null = null;
  private areas: number[] = [];
  private sharps: number[] = [];
  private readonly onClose: (g: Group<P>) => void;
  private readonly onDrop: (obs: FrameObs<P>) => void;

  constructor(onClose: (g: Group<P>) => void, onDrop: (obs: FrameObs<P>) => void) {
    this.onClose = onClose;
    this.onDrop = onDrop;
  }

  private mark(kind: Exclude<Transition, null>) {
    if (STRENGTH[kind] > STRENGTH[String(this.transition)]) this.transition = kind;
    this.transitionFrames += 1;
  }

  push(obs: FrameObs<P>): void {
    if (!obs.pts) {
      this.prevPts = null;
      this.mark("empty");
      if (this.current && this.transitionFrames >= 2) this.close();
      return;
    }
    const area = polygonArea(obs.pts);
    const center = centroid(obs.pts);
    const width = quadWidth(obs.pts);
    const sharpness = obs.q?.sharpness ?? 0;
    const refSharp = this.current && this.sharps.length >= 2 ? median(this.sharps.slice(-15)) : null;
    if (this.current && this.areas.length >= 2) {
      const refArea = median(this.areas.slice(-15));
      if (!(area >= 0.65 * refArea && area <= 1.5 * refArea)) {
        const inside = this.lastStablePts !== null && pointInPolygon(center, this.lastStablePts);
        // contorno menor dentro da carta parada = falha do detector (caixa de arte, reflexo);
        // contorno maior ou deslocado = carta saindo junto com a mão (evidência de troca)
        this.mark(area < 0.65 * refArea && inside ? "unstable" : "fast");
        return;
      }
    }
    let motion = 0;
    if (this.prevPts) motion = dist(center, centroid(this.prevPts)) / Math.max(width, 1);
    this.prevPts = obs.pts;
    const sharpOk = sharpness >= MIN_SHARPNESS && (refSharp === null || sharpness >= 0.2 * refSharp);
    if (motion > STABLE_MOTION || !sharpOk) {
      this.mark(motion > FAST_MOTION ? "fast" : "unstable");
      return;
    }

    const gap: Gap = { event: this.transition, frames: this.transitionFrames };
    if (!this.current) {
      this.open(obs, gap);
    } else if (this.transition === "empty" || this.transition === "fast") {
      this.close();
      this.open(obs, gap);
    } else if (sigDist(obs, this.current.ref) > SAME_THRESH) {
      this.close(); // carta trocada sem sair do lugar
      this.open(obs, gap);
    } else if (this.transition === "unstable" && this.lastStablePts && quadIou(obs.pts, this.lastStablePts) < 0.7) {
      this.close();
      this.open(obs, gap);
    } else {
      this.current.add(obs).forEach(this.onDrop);
    }
    this.areas.push(area);
    this.sharps.push(sharpness);
    this.transition = null;
    this.transitionFrames = 0;
    this.lastStablePts = obs.pts;
  }

  private open(obs: FrameObs<P>, gap: Gap) {
    this.seq += 1;
    this.current = new Group<P>(this.seq, gap, this.lastClosedPts);
    this.current.add(obs);
    this.areas = [];
    this.sharps = [];
  }

  private close() {
    const g = this.current;
    this.current = null;
    if (!g) return;
    this.lastClosedPts = g.frames[g.frames.length - 1].pts;
    this.onClose(g);
  }

  flush(): void {
    this.close();
  }
}
