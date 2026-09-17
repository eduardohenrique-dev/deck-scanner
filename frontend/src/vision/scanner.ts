/**
 * Frames → grupos → leituras. Porta de FrameSequenceProcessor (backend/app/pipeline/video.py):
 * cada carta exibida vira UMA leitura com até 3 melhores frames (recorte retificado + contexto ampliado),
 * enviada ao servidor em POST /sessions/{id}/sightings.
 */
import { release, toRaw, type CV, type Mat, type RawImage } from "./cv.ts";
import { detectPrimaryCard, warpCard, type CardKind } from "./detect.ts";
import { type Quad } from "./geometry.ts";
import { Group, TemporalGrouper, type FrameObs, type Gap, type GrouperOptions, type Transition } from "./grouper.ts";
import { artSignatures } from "./hash.ts";
import { cardness } from "./cardness.ts";
import { frameQuality, type FrameQuality } from "./quality.ts";

export const PROCESS_MAX_SIDE = 1280;
export const CONTEXT_W = 620;
export const CONTEXT_H = 864;
export const CONTEXT_EXPAND = 0.12;

export interface SightingMeta {
  group: number;
  frame_count: number;
  t_start: number;
  t_end: number;
  gap_before: Gap;
  angles: number[];
  quality: FrameQuality;
  quad: number[][];
  frame_w: number;
  frame_h: number;
}

export interface Sighting {
  meta: SightingMeta;
  frames: { card: RawImage; context: RawImage }[];
  /** assinatura da arte do melhor frame (a página compara leituras seguidas da mesma carta) */
  sig: number[];
}

/** O que a câmera está vendo agora (para o contorno e as dicas na tela). */
export interface FrameReport {
  idx: number;
  t: number;
  /** quadrilátero normalizado (0–1) na imagem */
  quad: Quad | null;
  kind: CardKind | null;
  quality: FrameQuality | null;
  /** frame aceito como estável (entra na leitura da carta atual) */
  stable: boolean;
  /** a carta no quadro já virou leitura (ao vivo) */
  emitted: boolean;
  group: number | null;
  groupFrames: number;
  groups: number;
  transition: Transition;
  ms: number;
}

interface Payload {
  frame: Mat;
  warped: Mat;
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

export class FrameProcessor {
  private readonly cv: CV;
  private readonly grouper: TemporalGrouper<Payload>;
  private readonly onSighting: (s: Sighting) => void;
  private readonly detectMaxDim: number;
  private readonly checkCardness: boolean;
  private framesSeen = 0;

  constructor(cv: CV, onSighting: (s: Sighting) => void, detectMaxDim = 960, options: GrouperOptions = {}) {
    this.cv = cv;
    this.onSighting = onSighting;
    this.detectMaxDim = detectMaxDim;
    this.checkCardness = !!options.minCardness;
    this.grouper = new TemporalGrouper<Payload>(
      (g) => this.closed(g),
      (obs) => this.releasePayload(obs),
      options,
    );
  }

  get groups(): number {
    return this.grouper.seq;
  }

  /** Ao vivo: tenta ler de novo a carta que continua no quadro. */
  rearm(seq: number): boolean {
    return this.grouper.rearm(seq);
  }

  /** Recebe a posse do Mat RGBA (liberado aqui quando não for mais necessário). */
  push(input: Mat, t: number): FrameReport {
    const started = performance.now();
    const { cv } = this;
    let frame = input;
    const side = Math.max(frame.rows, frame.cols);
    if (side > PROCESS_MAX_SIDE) {
      const s = PROCESS_MAX_SIDE / side;
      const resized = new cv.Mat();
      cv.resize(frame, resized, new cv.Size(Math.trunc(frame.cols * s), Math.trunc(frame.rows * s)), 0, 0, cv.INTER_AREA);
      release(frame);
      frame = resized;
    }
    const obs: FrameObs<Payload> = { t, idx: this.framesSeen++, pts: null };
    const card = detectPrimaryCard(cv, frame, this.detectMaxDim, this.grouper.lastStablePts);
    if (card) {
      const warped = warpCard(cv, frame, card.pts);
      obs.pts = card.pts;
      obs.edge = card.kind === "edge";
      obs.payload = { frame, warped };
      [obs.sig, obs.sig180] = artSignatures(cv, warped);
      obs.q = frameQuality(cv, warped, card.pts, frame.cols, frame.rows);
      if (this.checkCardness) obs.q.card = cardness(cv, warped).score;
      // carta saindo do quadro: vale para agrupar, mas não como melhor frame
      if (card.kind === "edge") obs.q.score = round(obs.q.score * 0.6, 4);
    }
    // lidos antes: ao vivo o próprio frame pode virar leitura (e ser liberado) dentro do push
    const w = frame.cols;
    const h = frame.rows;
    this.grouper.push(obs);
    // todo caminho que recusa o frame marca uma transição
    const stable = !!card && this.grouper.transitionFrames === 0;
    if (!obs.retained) {
      if (obs.payload) this.releasePayload(obs);
      else release(frame);
    }
    const current = this.grouper.current;
    return {
      idx: obs.idx,
      t,
      quad: card ? (card.pts.map(([x, y]) => [x / w, y / h]) as Quad) : null,
      kind: card?.kind ?? null,
      quality: obs.q ?? null,
      stable,
      emitted: !!current?.emitted,
      group: current?.seq || null,
      groupFrames: current?.frames.length ?? 0,
      groups: this.grouper.seq,
      transition: this.grouper.transition,
      ms: Math.round(performance.now() - started),
    };
  }

  /** Fecha a carta em exibição (fim da captura). */
  flush(): void {
    this.grouper.flush();
  }

  dispose(): void {
    const current = this.grouper.current;
    current?.best.forEach((obs) => this.releasePayload(obs));
  }

  private releasePayload(obs: FrameObs<Payload>) {
    if (!obs.payload) return;
    release(obs.payload.frame, obs.payload.warped);
    obs.payload = undefined;
  }

  private closed(group: Group<Payload>) {
    const { cv } = this;
    const best = group.ref;
    const fw = best.payload!.frame.cols;
    const fh = best.payload!.frame.rows;
    const frames = group.best.map((obs) => {
      const ctx = warpCard(cv, obs.payload!.frame, obs.pts!, CONTEXT_W, CONTEXT_H, CONTEXT_EXPAND);
      const out = { card: toRaw(obs.payload!.warped), context: toRaw(ctx) };
      release(ctx);
      return out;
    });
    const q = best.q!;
    const meta: SightingMeta = {
      group: group.seq,
      frame_count: group.frames.length,
      t_start: group.frames[0].t,
      t_end: group.frames[group.frames.length - 1].t,
      gap_before: group.gapBefore,
      angles: group.angles.map((a) => round(a, 2)),
      quality: { sharpness: q.sharpness, glare: q.glare, frontal: q.frontal, size: q.size, score: q.score },
      quad: best.pts!.map(([x, y]) => [round(x / fw, 5), round(y / fh, 5)]),
      frame_w: fw,
      frame_h: fh,
    };
    group.best.forEach((obs) => {
      obs.retained = false;
      this.releasePayload(obs);
    });
    this.onSighting({ meta, frames, sig: Array.from(best.sig ?? []) });
  }
}
