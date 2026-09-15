import type { CardSummary, Detection, Entry } from "./types";

export const CONFIDENCE_REVIEW = 0.9;

export function confidenceTone(c: number | null | undefined): "ok" | "warn" | "bad" | "neutral" {
  if (c === null || c === undefined) return "neutral";
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

export function artCrop(card: CardSummary | null | undefined): string | null {
  const url = card?.image_normal || card?.faces?.[0]?.image_normal;
  return url ? url.replace("/normal/", "/art_crop/") : null;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const BRL_SHORT = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function brl(value: number | null | undefined, short = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return (short && Math.abs(value) >= 100 ? BRL_SHORT : BRL).format(value);
}

export function usdPrice(card: CardSummary | null | undefined, finish?: string | null): number | null {
  if (!card) return null;
  const key = finish === "foil" ? "usd_foil" : finish === "etched" ? "usd_etched" : "usd";
  const v = card.prices?.[key] ?? card.prices?.usd ?? card.prices?.usd_foil;
  return v ? Number(v) : null;
}

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function dateLabel(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (withTime ? DATE_TIME : DATE).format(d).replace(".", "");
}

export function relativeDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  return dateLabel(iso);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function entryNeedsReview(e: Entry): boolean {
  return (e.confidence !== null && e.confidence < CONFIDENCE_REVIEW) || e.warnings.length > 0;
}

export function positionLabel(det: Detection, captureIdx: number | undefined, isVideo: boolean): string {
  if (isVideo && det.t_start !== null) return `no vídeo, em ${formatTime(det.t_start)}`;
  const rect = det.bbox?.rect;
  if (!rect) return captureIdx ? `na foto ${captureIdx}` : "";
  const x = (rect[0] + rect[2]) / 2;
  const y = (rect[1] + rect[3]) / 2;
  const col = x < 0.34 ? "à esquerda" : x > 0.66 ? "à direita" : "no centro";
  const row = y < 0.34 ? "em cima" : y > 0.66 ? "embaixo" : "no meio";
  return `${captureIdx ? `foto ${captureIdx}, ` : ""}${row} ${col}`;
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
  phash: "pela arte",
  "phash+orb": "pela arte, conferida",
  learned: "aprendida com você",
  vlm: "leitura por IA",
  user: "escolhida por você",
  none: "—",
};

export const LANGUAGE_NAME: Record<string, string> = {
  en: "inglês",
  pt: "português",
  es: "espanhol",
  ja: "japonês",
  de: "alemão",
  fr: "francês",
  it: "italiano",
  ko: "coreano",
  ru: "russo",
  zhs: "chinês simp.",
  zht: "chinês trad.",
  ph: "phyrexiano",
};

export const FINISH_NAME: Record<string, string> = { nonfoil: "normal", foil: "foil", etched: "etched" };

export const CONDITION_NAME: Record<string, string> = {
  NM: "quase nova",
  SP: "pouco usada",
  MP: "usada",
  HP: "muito usada",
  D: "danificada",
};

export const RARITY_COLOR: Record<string, string> = {
  common: "#d9ccb4",
  uncommon: "#b9c7cf",
  rare: "#e0b75c",
  mythic: "#e5763a",
  special: "#b28bd6",
  bonus: "#b28bd6",
};

export const LOCATION_LABEL: Record<string, string> = { deck: "Deck", binder: "Pasta", box: "Caixa", loose: "Solto" };
