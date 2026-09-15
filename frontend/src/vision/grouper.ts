/**
 * Agrupamento temporal dos frames — porta de TemporalGrouper (backend/app/pipeline/video.py).
 *
 * - frame estável: carta detectada, nítida e quase parada desde o frame anterior;
 * - frames instáveis formam uma transição que guarda o evento mais forte:
 *   "empty" (carta sumiu) > "fast" (carta sendo tirada) > "unstable" (tremida/foco);
 * - depois de "empty"/"fast" começa OUTRA carta física, mesmo com a mesma arte (básicos seguidos);
 * - depois de transição leve continua a mesma carta se a assinatura e a posição conferem;
 * - com a carta parada, assinatura muito diferente = carta trocada no lugar.
 *
 * Modo ao vivo (opções `live`), no estilo dos apps de scanner de celular: a leitura sai assim que a carta
 * fica parada alguns frames, sem esperar ela sair; tremida, reposicionamento e falhas curtas do detector
 * NÃO abrem outra carta — só a carta sumir do quadro por um tempo ou uma arte diferente no lugar.
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

export interface GrouperOptions {
  /** emite a leitura quando a carta completa N frames estáveis, com ela ainda no quadro */
  emitAfter?: number;
  /** frames seguidos sem carta para considerar que ela saiu (padrão 2) */
  emptyToClose?: number;
  /** movimento rápido/instável separa cartas (vídeo); ao vivo só a assinatura ou a saída separam */
  splitOnMotion?: boolean;
  /** grupos com menos frames estáveis são descartados sem virar leitura */
  minFrames?: number;
}

export const LIVE_OPTIONS: GrouperOptions = { emitAfter: 4, emptyToClose: 6, splitOnMotion: false, minFrames: 4 };

export class Group<P> {
  frames: FrameObs<P>[] = [];
  best: FrameObs<P>[] = [];
  /** número da leitura (definido ao emitir, para não deixar buracos quando um grupo é descartado) */
  seq = 0;
  /** já virou leitura: os frames seguintes só acompanham a carta */
  emitted = false;
  /** frames contados a partir de quando a leitura foi (re)armada */
  armedAt = 0;
  retries = 0;
  readonly gapBefore: Gap;
  readonly prevLastPts: Quad | null;
  constructor(gapBefore: Gap, prevLastPts: Quad | null) {
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
    if (this.emitted) return []; // só acompanha: a imagem do frame pode ser liberada
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
  /** ao vivo: frame com arte diferente esperando confirmação */
  private candidate: FrameObs<P> | null = null;
  private areas: number[] = [];
  private sharps: number[] = [];
  private readonly onClose: (g: Group<P>) => void;
  private readonly onDrop: (obs: FrameObs<P>) => void;
  private readonly emitAfter: number | null;
  private readonly emptyToClose: number;
  private readonly splitOnMotion: boolean;
  private readonly minFrames: number;

  /** `onClose` recebe cada grupo que vira leitura (no fechamento ou, ao vivo, ao completar `emitAfter`). */
  constructor(onClose: (g: Group<P>) => void, onDrop: (obs: FrameObs<P>) => void, options: GrouperOptions = {}) {
    this.onClose = onClose;
    this.onDrop = onDrop;
    this.emitAfter = options.emitAfter ?? null;
    this.emptyToClose = options.emptyToClose ?? 2;
    this.splitOnMotion = options.splitOnMotion ?? true;
    this.minFrames = options.minFrames ?? 1;
  }

  /**
   * Ao vivo: pede outra leitura da carta que continua no quadro (a leitura `seq` não foi reconhecida).
   * Não faz nada se ela já saiu, se outra carta tomou o lugar ou se as tentativas acabaram.
   */
  rearm(seq: number, maxRetries = 1): boolean {
    const g = this.current;
    if (!g || !g.emitted || g.seq !== seq || g.retries >= maxRetries) return false;
    g.retries += 1;
    g.emitted = false;
    g.best = [];
    g.armedAt = g.frames.length;
    return true;
  }

  private mark(kind: Exclude<Transition, null>) {
    if (STRENGTH[kind] > STRENGTH[String(this.transition)]) this.transition = kind;
    this.transitionFrames += 1;
  }

  push(obs: FrameObs<P>): void {
    if (!obs.pts) {
      this.prevPts = null;
      this.mark("empty");
      if (this.current && this.transitionFrames >= this.emptyToClose) this.close();
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
    const ref = this.current ? this.current.ref ?? this.current.frames[this.current.frames.length - 1] : null;
    if (!this.current) {
      this.open(obs, gap);
    } else if (this.splitOnMotion && (this.transition === "empty" || this.transition === "fast")) {
      this.close();
      this.open(obs, gap);
    } else if (ref?.sig && sigDist(obs, ref) > SAME_THRESH && (this.splitOnMotion || !this.matchesRecent(obs))) {
      // ao vivo um frame só (borrado, carta entrando) não troca a carta: o seguinte precisa confirmar
      if (!this.splitOnMotion && !(this.candidate?.sig && sigDist(obs, this.candidate) <= SAME_THRESH)) {
        this.candidate = obs;
        this.mark("unstable");
        return;
      }
      this.candidate = null;
      this.close(); // carta trocada sem sair do lugar
      this.open(obs, gap);
    } else if (this.splitOnMotion && this.transition === "unstable" && this.lastStablePts && quadIou(obs.pts, this.lastStablePts) < 0.7) {
      this.close();
      this.open(obs, gap);
    } else {
      this.candidate = null;
      this.current.add(obs).forEach(this.onDrop);
      this.maybeEmit();
    }
    this.areas.push(area);
    this.sharps.push(sharpness);
    this.transition = null;
    this.transitionFrames = 0;
    this.lastStablePts = obs.pts;
  }

  /** Ao vivo: a assinatura oscila entre frames da mesma carta (reflexo, foco); vale qualquer frame recente. */
  private matchesRecent(obs: FrameObs<P>): boolean {
    const frames = this.current?.frames ?? [];
    return frames.slice(-8).some((f) => f.sig && sigDist(obs, f) <= SAME_THRESH);
  }

  private open(obs: FrameObs<P>, gap: Gap) {
    this.current = new Group<P>(gap, this.lastClosedPts);
    this.current.add(obs);
    this.areas = [];
    this.sharps = [];
    this.maybeEmit();
  }

  private maybeEmit() {
    const g = this.current;
    if (this.emitAfter === null || !g || g.emitted || g.frames.length - g.armedAt < this.emitAfter) return;
    this.emit(g);
  }

  private emit(g: Group<P>) {
    this.seq += 1;
    g.seq = this.seq;
    g.emitted = true;
    this.onClose(g);
  }

  private close() {
    const g = this.current;
    this.current = null;
    if (!g) return;
    this.lastClosedPts = g.frames[g.frames.length - 1].pts;
    if (g.emitted) return;
    if (g.frames.length - g.armedAt < this.minFrames || !g.best.length) {
      // passou rápido demais para ser uma carta mostrada de propósito
      g.best.forEach((obs) => {
        obs.retained = false;
        this.onDrop(obs);
      });
      g.best = [];
      return;
    }
    this.emit(g);
  }

  flush(): void {
    this.close();
  }
}
