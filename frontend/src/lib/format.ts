import type { CardSummary, Detection, Entry } from "./types";

export const CONFIDENCE_REVIEW = 0.9;

export function confidenceTone(c: number | null | undefined): "ok" | "warn" | "bad" | "none" {
  if (c === null || c === undefined) return "none";
  if (c >= CONFIDENCE_REVIEW) return "ok";
  if (c >= 0.6) return "warn";
  return "bad";
}

export function cardName(card: CardSummary | null | undefined, lang: "pt" | "en" = "pt"): string {
  if (!card) return "—";
  if (lang === "pt" && card.name_pt) return card.name_pt;
  return card.front_name_en || card.name_en;
}

export function secondaryName(card: CardSummary | null | undefined): string | null {
  if (!card) return null;
  const en = card.front_name_en || card.name_en;
  return card.name_pt && card.name_pt !== en ? en : null;
}

export function price(card: CardSummary | null | undefined, finish?: string | null): string | null {
  if (!card) return null;
  const key = finish === "foil" ? "usd_foil" : finish === "etched" ? "usd_etched" : "usd";
  const v = card.prices?.[key] ?? card.prices?.usd;
  return v ? `US$ ${Number(v).toFixed(2)}` : null;
}

export function entryNeedsReview(e: Entry): boolean {
  return (e.confidence !== null && e.confidence < CONFIDENCE_REVIEW) || e.warnings.length > 0;
}

export function positionLabel(det: Detection, captureIdx: number | undefined, isVideo: boolean): string {
  if (isVideo && det.t_start !== null) return `vídeo em ${formatTime(det.t_start)}`;
  const rect = det.bbox?.rect;
  const pos = rect ? `posição ${Math.round(((rect[0] + rect[2]) / 2) * 100)}% × ${Math.round(((rect[1] + rect[3]) / 2) * 100)}%` : "";
  return `${pos}${captureIdx ? ` da foto ${captureIdx}` : ""}`;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"];
export const TYPE_LABEL: Record<string, string> = {
  Creature: "Criaturas",
  Planeswalker: "Planeswalkers",
  Battle: "Batalhas",
  Instant: "Mágicas instantâneas",
  Sorcery: "Feitiços",
  Artifact: "Artefatos",
  Enchantment: "Encantamentos",
  Land: "Terrenos",
  Other: "Outros",
};

export function typeGroup(typeLine: string | undefined): string {
  const t = typeLine || "";
  if (t.includes("Land")) return "Land";
  for (const k of ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment"]) {
    if (t.includes(k)) return k;
  }
  return "Other";
}

export const SOURCE_LABEL: Record<string, string> = {
  phash: "hash local",
  "phash+orb": "hash + verificação",
  learned: "aprendido",
  vlm: "modelo multimodal",
  user: "você",
  none: "—",
};

export function languageLabel(code: string | null | undefined): string {
  return (code || "en").toUpperCase();
}
