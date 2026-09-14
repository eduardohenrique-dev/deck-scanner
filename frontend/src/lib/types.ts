export type CardSummary = {
  id: string;
  oracle_id: string;
  name_en: string;
  front_name_en?: string | null;
  name_pt?: string | null;
  name_display: string;
  printed_name?: string | null;
  lang: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  layout: string;
  kind: string;
  type_line: string;
  front_type_line: string;
  mana_cost: string;
  finishes: string[];
  games: string[];
  image_small: string | null;
  image_normal: string | null;
  faces: { name: string; image_normal: string }[];
  prices: Record<string, string | null>;
  frame_effects: string[];
  full_art: boolean;
  promo: boolean;
  artist?: string | null;
  matched_name?: string;
  matched_lang?: string;
  prints?: CardSummary[];
};

export type Capture = {
  id: string;
  type: "image" | "video";
  idx: number;
  status: "queued" | "processing" | "done" | "error";
  progress: number | null;
  w: number | null;
  h: number | null;
  quality: Record<string, any> | null;
  error: string | null;
  original_name: string | null;
  image_url: string | null;
};

export type DetectionStatus =
  | "pending"
  | "identified"
  | "unidentified"
  | "back"
  | "token"
  | "noise"
  | "edge"
  | "ignored";

export type Detection = {
  id: string;
  capture_id: string;
  seq: number;
  status: DetectionStatus;
  confidence: number;
  source: string | null;
  card_ref_id: string | null;
  oracle_id: string | null;
  face: number;
  language: string | null;
  finish: string | null;
  bbox: { quad: number[][]; rect: number[] } | null;
  crop_url: string;
  card: CardSummary | null;
  candidates: { card_ref_id: string; score: number; card: CardSummary }[];
  notes: string[];
  quality: Record<string, any> | null;
  dup_of: string | null;
  dup_status: string | null;
  dup_candidates: {
    possible?: { id: string; reasons: string[] }[];
    merged_reasons?: string[];
    forced?: string[];
    blocked?: string[];
  } | null;
  temporal_group: number | null;
  frame_count: number | null;
  t_start: number | null;
  t_end: number | null;
  physical_card_id: string | null;
  user_corrected: boolean;
};

export type Entry = {
  id: string;
  zone: string;
  card_ref_id: string;
  oracle_id: string;
  language: string | null;
  finish: string | null;
  quantity: number;
  quantity_detected: number;
  quantity_override: number | null;
  quantity_auto: number | null;
  limit: number | null;
  exception: { reason: string; limit: number | null; restricted?: boolean } | null;
  is_commander: boolean;
  manual: boolean;
  position: number;
  warnings: string[];
  detection_ids: string[];
  confidence: number | null;
  card: CardSummary | null;
  condition: string | null;
};

export type Issue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  entry_ids: string[];
  data: Record<string, any>;
};

export type LandSuggestion = {
  applicable: boolean;
  reason?: string;
  deficit?: number;
  basics_to_add?: number;
  remaining_nonland?: number;
  land_target?: number;
  lands_now?: number;
  by_color?: {
    color: string;
    basic: string;
    add: number;
    pips: number;
    share: number;
    existing_sources: number;
    target_sources: number;
    final_sources: number;
    early: boolean;
  }[];
  summary?: string;
  reasoning?: string[];
};

export type Validation = {
  format_id: string;
  format_name: string;
  valid: boolean;
  totals: {
    count: number;
    by_zone: Record<string, number>;
    size: { exact?: number; min?: number; max?: number; zones?: string[] } | null;
    missing: number;
    excess: number;
  };
  issues: Issue[];
  commander: { entry_ids: string[]; valid: boolean; pairing: string | null; identity: string[] } | null;
  suggestions: Record<string, LandSuggestion>;
};

export type FormatRule = {
  id: string;
  name: string;
  group?: string;
  description?: string;
  deck_size?: { exact?: number; min?: number; zones?: string[] } | null;
  zones?: string[];
  zone_labels?: Record<string, string>;
  copy_limit?: number | null;
  requires_commander?: boolean;
  enforces_color_identity?: boolean;
};

export type Exporter = {
  id: string;
  name: string;
  extension: string;
  supports_grouping: boolean;
  example?: string;
  options?: Record<string, string[]>;
};

export type GameInfo = {
  id: string;
  name: string;
  enabled: boolean;
  note?: string;
  zones?: { id: string; name: string }[];
  formats?: FormatRule[];
  exporters?: Exporter[];
};

export type Session = {
  id: string;
  game_id: string;
  format_id: string;
  mode: "video" | "photo";
  name: string | null;
  status: "capturing" | "processing" | "review" | "error";
  settings: { default_language?: string } | null;
  created_at: string;
  updated_at: string;
  card_count?: number;
  capture_count?: number;
};

export type Stats = {
  detections: number;
  physical_cards: number;
  pending: number;
  unidentified: number;
  backs: number;
  tokens: number;
  noise: number;
  merged_duplicates: number;
  possible_duplicates: number;
  by_source: Record<string, number>;
  vlm_calls: number;
};

export type SessionState = {
  session: Session;
  format: FormatRule;
  game: {
    id: string;
    zones: { id: string; name: string }[];
    languages: { id: string; name: string }[];
    finishes: { id: string; name: string }[];
    exporters: Exporter[];
    identity: { order: string[]; labels: Record<string, string> };
  };
  captures: Capture[];
  detections: Detection[];
  entries: Entry[];
  validation: Omit<Validation, "entries">;
  stats: Stats;
};

export type ServerStatus = {
  hash_index: { entries: number; base: number; learned: number };
  catalog: { prints: string | null; updated: string | null };
  vlm: { enabled: boolean; model: string | null };
  orb_verify: boolean;
};

export type FrameState = {
  type: "frame_state";
  t: number;
  tracking: boolean;
  quad: number[][] | null;
  group_frames: number;
  sharpness: number | null;
  glare: number | null;
  cards_closed: number;
  dropped?: number;
};
