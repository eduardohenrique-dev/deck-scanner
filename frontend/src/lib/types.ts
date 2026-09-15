export type Prices = Partial<Record<"usd" | "usd_foil" | "usd_etched" | "eur" | "eur_foil", string | null>>;

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
  set_icon?: string | null;
  collector_number: string;
  rarity: string;
  layout: string;
  kind: string;
  type_line: string;
  front_type_line: string;
  mana_cost: string;
  color_identity?: string[];
  finishes: string[];
  games: string[];
  image_small: string | null;
  image_normal: string | null;
  faces: { name: string; image_normal: string }[];
  prices: Prices;
  frame_effects: string[];
  border_color?: string | null;
  full_art: boolean;
  promo: boolean;
  artist?: string | null;
  illustration_id?: string | null;
  released_at?: string | null;
  game_changer?: boolean;
  matched_name?: string;
  matched_lang?: string;
  prints?: CardSummary[];
};

export type AppConfig = {
  auth: "local" | "supabase";
  supabase_url: string | null;
  supabase_publishable_key: string | null;
  auth_providers?: string[];
  hosted: boolean;
  vlm: boolean;
  spellbook: boolean;
};

export type ServerStatus = {
  hash_index: { entries: number; base: number; learned: number };
  catalog: { prints: string | null; updated: string | null };
  vlm: { enabled: boolean; model: string | null; provider: string | null };
  orb_verify: boolean;
  storage: string;
  database: string;
};

export type Capture = {
  id: string;
  type: "image" | "video" | "live";
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

export type DetectionStatus = "pending" | "identified" | "unidentified" | "back" | "token" | "noise" | "edge" | "ignored";

export type Condition = {
  grade: "NM" | "SP" | "MP" | "HP";
  score: number;
  confidence: number;
  signals: Record<string, number>;
  reasons: string[];
  estimated: true;
};

export type PrintWarning = { code: string; message: string; data?: Record<string, any> };

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
  crop_url: string | null;
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
  condition: Condition | null;
  print_check: PrintWarning | null;
  raw: { name: string | null; set: string | null; number: string | null; language: string | null; finish: string | null };
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
  by_color?: { color: string; basic: string; add: number; pips: number; existing_sources: number; final_sources: number; early: boolean }[];
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
  order?: number;
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

export type GameMeta = {
  id: string;
  zones: { id: string; name: string }[];
  languages: { id: string; name: string }[];
  finishes: { id: string; name: string }[];
  conditions: string[];
  exporters: Exporter[];
  identity: { order: string[]; labels: Record<string, string> };
};

export type Session = {
  id: string;
  user_id: string;
  game_id: string;
  format_id: string;
  mode: "video" | "photo";
  purpose: "build" | "check";
  target_deck_id: string | null;
  saved_deck_id: string | null;
  name: string | null;
  status: "capturing" | "processing" | "review" | "saved" | "error";
  settings: { default_language?: string; intent?: "collection" } | null;
  deck_id: string;
  created_at: string;
  updated_at: string;
  saved_at?: string | null;
  card_count?: number;
  capture_count?: number;
  saved_deck_name?: string | null;
  target_deck_name?: string | null;
};

export type Stats = {
  detections: number;
  physical_cards: number;
  pending: number;
  unidentified: number;
  backs: number;
  tokens: number;
  noise: number;
  edge: number;
  merged_duplicates: number;
  possible_duplicates: number;
  by_source: Record<string, number>;
  vlm_calls: number;
};

export type ValuedItem = { card_ref_id: string; finish: string | null; quantity: number; unit_usd: number; unit_brl: number; total_brl: number };

export type Fx = { rate: number; quoted_at: string | null; source: string };

export type CheckCard = {
  oracle_id: string;
  card_ref_id: string;
  name: string | null;
  name_pt: string | null;
  image_small: string | null;
  type_group: string;
  cmc: number | null;
  quantity: number;
  expected?: number;
  scanned?: number;
};

export type CheckResult =
  | { available: false; reason: string }
  | {
      available: true;
      deck: { id: string; name: string; format_id: string };
      summary: { expected: number; scanned: number; ok: number; missing: number; extra: number; swapped: number };
      missing: CheckCard[];
      extra: (CheckCard & { detection_ids: string[] })[];
      swapped: (CheckCard & { kind: string; expected_prints: PrintRef[]; scanned_prints: PrintRef[] })[];
      likely_swaps: { out: CheckCard; in: CheckCard }[];
      matches: boolean;
    };

export type PrintRef = { card_ref_id: string; language: string; finish: string; quantity: number; set_code: string | null; collector_number: string | null };

export type SessionState = {
  session: Session;
  format: FormatRule;
  game: GameMeta;
  captures: Capture[];
  detections: Detection[];
  entries: Entry[];
  validation: Validation;
  stats: Stats;
  value: { total_usd: number; total_brl: number; fx: Fx; unpriced: number };
  valuable: ValuedItem[];
  owned_elsewhere: Record<string, string[]>;
  check?: CheckResult;
  print_warning?: PrintWarning | null;
};

// ------------------------------------------------------------------ Fase 2
export type Location = {
  id: string;
  type: "deck" | "binder" | "box" | "loose";
  type_label: string;
  name: string;
  deck_id: string | null;
  deck_format?: string | null;
  card_count: number;
};

export type CopyRef = {
  id: string;
  card_ref_id: string;
  language: string | null;
  finish: string | null;
  condition: string | null;
  location_id: string | null;
  location_name: string | null;
  location_type: Location["type"] | null;
  deck_id: string | null;
};

export type AllocationItem = {
  oracle_id: string;
  entry_ids: string[];
  card_ref_id: string;
  name: string;
  name_en: string | null;
  needed: number;
  here: number;
  move: number;
  conflict: number;
  buy: number;
  status: "ok" | "move" | "conflict" | "buy";
  warnings: string[];
  here_ids: string[];
  available: CopyRef[];
  in_other_decks: CopyRef[];
};

export type AllocationReport = {
  deck_id: string;
  location_id: string | null;
  items: AllocationItem[];
  totals: { needed: number; here: number; move: number; conflict: number; buy: number };
  extra: CopyRef[];
  complete: boolean;
};

export type Snapshot = { id: string; deck_id: string; source: "scan" | "check" | "manual" | "import"; session_id: string | null; note: string | null; card_count: number; created_at: string };

export type DiffItem = { oracle_id: string; name: string | null; name_pt: string | null; card_ref_id: string | null };

export type DeckDiff = {
  added: (DiffItem & { quantity: number })[];
  removed: (DiffItem & { quantity: number })[];
  changed: (DiffItem & { before: number; after: number; delta: number })[];
  reprinted: (DiffItem & { quantity: number; before: PrintRef[]; after: PrintRef[] })[];
  unchanged: number;
  count_before: number;
  count_after: number;
};

export type Valuation = { total_usd: number; total_brl: number; fx: Fx; unpriced: number; top: ValuedItem[]; items?: ValuedItem[] };

export type Deck = {
  id: string;
  user_id: string;
  game_id: string;
  format_id: string;
  format_name?: string;
  name: string;
  kind: "deck" | "draft";
  description: string | null;
  cover_card_ref_id: string | null;
  created_at: string;
  updated_at: string | null;
  card_count: number;
  physical_count?: number;
  last_snapshot?: string | null;
  identity?: string[];
  commanders?: string[];
  cover?: { image_normal: string | null; name: string | null } | null;
};

export type DeckState = {
  deck: Deck;
  format: FormatRule;
  game: GameMeta;
  entries: Entry[];
  validation: Validation;
  allocation: AllocationReport;
  value: Valuation;
  print_issues: (PrintWarning & { entry_id: string })[];
  snapshots: Snapshot[];
  sessions: { id: string; name: string | null; purpose: string; mode: string; status: string; created_at: string; card_count: number }[];
  brackets_apply: boolean;
  print_warning?: PrintWarning | null;
};

export type BracketCombo = { cards: string[]; produces: string[]; tag: string; arguable: boolean };

export type Bracket =
  | { applies: false }
  | {
      applies: true;
      bracket: number;
      name: string;
      name_en: string;
      headline: string;
      counts: Record<string, number>;
      cards: Record<string, string[]>;
      combos: { checked: boolean; two_card: BracketCombo[]; early_two_card: BracketCombo[]; attribution: string; attribution_url: string };
      reasons: string[];
      notes: string[];
      brackets: { id: number; name: string; name_en: string; fails: string[]; needs_intent: boolean }[];
    };

export type ShoppingItem = { oracle_id: string; card_ref_id: string; name: string | null; name_pt: string | null; image_small: string | null; quantity: number };

export type ShoppingList = {
  buy: (ShoppingItem & { unit_usd: number | null; unit_brl: number | null; ligamagic_url: string })[];
  decide: (ShoppingItem & { decks: string[] })[];
  fetch: (ShoppingItem & { from: string[] })[];
  fx: Fx;
  total_usd: number;
  total_brl: number;
  ligamagic_list_text: string;
  ligamagic_list_url: string;
};

export type CollectionGroup = {
  oracle_id: string;
  count: number;
  prints: { card_ref_id: string; language: string; finish: string; count: number }[];
  locations: { id: string | null; name: string; type: Location["type"]; deck_id: string | null; count: number }[];
  card_ids: string[];
  latest: string;
  card_ref_id: string;
  card: CardSummary;
  value_brl: number;
};

export type CollectionResponse = {
  items: CollectionGroup[];
  total_cards: number;
  unique: number;
  value: { total_usd: number; total_brl: number; fx: Fx; unpriced: number };
  top: ValuedItem[];
};

export type CollectionSummary = {
  total: number;
  unique: number;
  locations: Location[];
  value: { total_usd: number; total_brl: number; fx: Fx; unpriced: number };
  top: ValuedItem[];
};

export type PhysicalCopy = CopyRef & { card: CardSummary | null; created_at: string; source_session_id: string | null };

export type SavePreview = {
  physical_cards: number;
  elsewhere: {
    oracle_id: string;
    name: string | null;
    card_ref_id: string;
    detection_ids: string[];
    copies: (CopyRef & { same_print: boolean })[];
  }[];
  already_here: { oracle_id: string; name: string | null; scanned: number; in_target: number }[];
  not_scanned_in_target: { id: string; card_ref_id: string; oracle_id: string }[];
};

export type SightingResponse = { detection: Detection; physical_cards: number; merged: boolean };
