/** Mensagens entre a página e o worker de visão. */
import type { FrameReport, SightingMeta } from "./scanner.ts";

export type WorkerIn =
  | { type: "init" }
  | { type: "start"; detectMaxDim: number; live?: boolean }
  | { type: "frame"; t: number; bitmap: ImageBitmap }
  | { type: "rearm"; group: number }
  | { type: "flush" };

export type WorkerOut =
  | { type: "ready"; ms: number }
  | { type: "error"; message: string }
  | { type: "frame"; report: FrameReport }
  | { type: "sighting"; meta: SightingMeta; cards: Blob[]; contexts: Blob[]; sig: number[] }
  | { type: "flushed"; groups: number };

export type { FrameReport, SightingMeta };
