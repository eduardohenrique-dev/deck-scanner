"""Acesso SQLite: conexões por thread, schema do app (sessões, detecções, decks) e do catálogo."""
from __future__ import annotations

import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Iterable

import orjson

from . import config

_local = threading.local()


def connect(path: Path) -> sqlite3.Connection:
    """Uma conexão por (thread, arquivo). SQLite em WAL aceita leitores concorrentes."""
    conns = getattr(_local, "conns", None)
    if conns is None:
        conns = _local.conns = {}
    key = str(path)
    conn = conns.get(key)
    if conn is None:
        conn = sqlite3.connect(key, timeout=30, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=30000")
        conns[key] = conn
    return conn


def app_db() -> sqlite3.Connection:
    return connect(config.APP_DB)


def catalog_db() -> sqlite3.Connection:
    return connect(config.CATALOG_DB)


class tx:
    """Transação explícita (as conexões estão em autocommit)."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def __enter__(self) -> sqlite3.Connection:
        self.conn.execute("BEGIN IMMEDIATE")
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.conn.execute("COMMIT")
        else:
            self.conn.execute("ROLLBACK")
        return False


def new_id() -> str:
    return uuid.uuid4().hex


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def dumps(value: Any) -> str:
    return orjson.dumps(value, option=orjson.OPT_SERIALIZE_NUMPY).decode()


def loads(value: str | bytes | None, default: Any = None) -> Any:
    if value is None or value == "":
        return default
    return orjson.loads(value)


def row_to_dict(row: sqlite3.Row | None, json_fields: Iterable[str] = ()) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    for f in json_fields:
        if f in d:
            d[f] = loads(d[f], None)
    return d


APP_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS game_profiles (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, game_id TEXT NOT NULL, settings TEXT
);
CREATE TABLE IF NOT EXISTS scan_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  format_id TEXT NOT NULL,
  mode TEXT NOT NULL,              -- video | photo
  name TEXT,
  status TEXT NOT NULL,            -- capturing | processing | review | error
  settings TEXT,                   -- json (idioma padrão etc.)
  stats TEXT,                      -- json (costas, tokens, não identificadas...)
  deck_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS capture_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- image | video | video_frame
  idx INTEGER NOT NULL DEFAULT 0,
  file_path TEXT,
  original_name TEXT,
  w INTEGER, h INTEGER,
  quality_score REAL,
  quality TEXT,                    -- json
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | processing | done | error
  progress REAL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capture_session ON capture_items(session_id);
CREATE TABLE IF NOT EXISTS detections (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  bbox TEXT,                       -- json {quad:[[x,y]*4] normalizado, rect:[x0,y0,x1,y1]}
  art_phash TEXT, full_phash TEXT,
  crop_path TEXT,
  raw_name TEXT, raw_set TEXT, raw_number TEXT, raw_language TEXT, raw_finish TEXT,
  confidence REAL,
  source TEXT,                     -- phash | phash+orb | learned | vlm | user | none
  status TEXT NOT NULL,            -- identified | unidentified | back | token | noise
  card_ref_id TEXT, oracle_id TEXT, face INTEGER DEFAULT 0,
  language TEXT, finish TEXT,
  candidates TEXT,                 -- json top-k
  neighbors TEXT,                  -- json
  quality TEXT,                    -- json
  notes TEXT,                      -- json lista de avisos
  temporal_group INTEGER,
  frame_count INTEGER, t_start REAL, t_end REAL,
  physical_card_id TEXT,
  dup_of TEXT,                     -- detecção representante quando colapsada (mesma carta física)
  dup_status TEXT,                 -- possible | confirmed | rejected
  dup_candidates TEXT,             -- json [{id, score, reasons}]
  user_corrected INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_det_session ON detections(session_id);
CREATE INDEX IF NOT EXISTS idx_det_capture ON detections(capture_id);
CREATE TABLE IF NOT EXISTS physical_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL, game_id TEXT NOT NULL, session_id TEXT,
  card_ref_id TEXT, set_code TEXT, collector_number TEXT,
  language TEXT, finish TEXT, condition TEXT,
  location_type TEXT, location_id TEXT, acquired_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_phys_session ON physical_cards(session_id);
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL, game_id TEXT NOT NULL, format_id TEXT NOT NULL,
  name TEXT, session_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deck_entries (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  zone TEXT NOT NULL DEFAULT 'deck',
  card_ref_id TEXT NOT NULL,
  oracle_id TEXT,
  language TEXT, finish TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,          -- quantas entraram no deck após as regras
  quantity_detected INTEGER NOT NULL DEFAULT 0, -- quantas cartas físicas foram encontradas
  quantity_override INTEGER,                    -- ajuste manual (+/-); NULL = automático
  is_commander INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0,            -- adicionada à mão (não apareceu em foto)
  rule_warnings TEXT,
  allocated_physical_ids TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  condition TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_deck ON deck_entries(deck_id);
CREATE TABLE IF NOT EXISTS correction_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL, game_id TEXT NOT NULL,
  detection_id TEXT,
  art_phash TEXT, full_phash TEXT,
  wrong_card_ref TEXT, correct_card_ref TEXT, face INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vlm_calls (
  id TEXT PRIMARY KEY, session_id TEXT, detection_id TEXT, model TEXT,
  input_tokens INTEGER, output_tokens INTEGER, ms INTEGER, ok INTEGER, created_at TEXT
);
"""

CATALOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS card_refs (
  id TEXT PRIMARY KEY,             -- id canônico da fonte (Scryfall id)
  game_id TEXT NOT NULL,
  oracle_id TEXT,                  -- chave de normalização para regras
  name_en TEXT NOT NULL,
  printed_name TEXT,
  lang TEXT NOT NULL,
  set_code TEXT, set_name TEXT, set_type TEXT, collector_number TEXT, rarity TEXT, released_at TEXT,
  layout TEXT, kind TEXT,          -- card | token | emblem | art_series | other
  mana_cost TEXT, cmc REAL, type_line TEXT, oracle_text TEXT,
  colors TEXT, color_identity TEXT, produced_mana TEXT, keywords TEXT,
  legalities TEXT, finishes TEXT, games TEXT,
  frame TEXT, frame_effects TEXT, border_color TEXT, full_art INTEGER, promo INTEGER, oversized INTEGER,
  artist TEXT, illustration_id TEXT, highres INTEGER,
  image_small TEXT, image_normal TEXT, image_large TEXT,
  faces TEXT,                      -- json [{name, printed_name, mana_cost, type_line, oracle_text, image_small, image_normal, illustration_id}]
  prices TEXT, arena_id INTEGER, game_changer INTEGER
);
CREATE INDEX IF NOT EXISTS idx_refs_oracle ON card_refs(oracle_id);
CREATE INDEX IF NOT EXISTS idx_refs_setnum ON card_refs(set_code, collector_number, lang);
CREATE INDEX IF NOT EXISTS idx_refs_name ON card_refs(name_en);
CREATE INDEX IF NOT EXISTS idx_refs_illus ON card_refs(illustration_id);

CREATE TABLE IF NOT EXISTS oracle_cards (
  oracle_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  name_en TEXT NOT NULL,
  default_ref_id TEXT,
  kind TEXT, layout TEXT,
  mana_cost TEXT, cmc REAL, type_line TEXT, oracle_text TEXT,
  colors TEXT, color_identity TEXT, produced_mana TEXT, keywords TEXT,
  legalities TEXT, faces TEXT, game_changer INTEGER,
  names_i18n TEXT                  -- json {lang: nome}
);
CREATE INDEX IF NOT EXISTS idx_oracle_name ON oracle_cards(name_en);

CREATE TABLE IF NOT EXISTS card_names (
  game_id TEXT NOT NULL, oracle_id TEXT NOT NULL, lang TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY (game_id, oracle_id, lang, name)
);
CREATE VIRTUAL TABLE IF NOT EXISTS card_names_fts USING fts5(
  name, content='card_names', tokenize="unicode61 remove_diacritics 2"
);

CREATE TABLE IF NOT EXISTS art_hashes (
  card_ref_id TEXT NOT NULL,
  face INTEGER NOT NULL DEFAULT 0,
  art BLOB NOT NULL, full BLOB NOT NULL, color BLOB,
  created_at TEXT,
  PRIMARY KEY (card_ref_id, face)
);

CREATE TABLE IF NOT EXISTS learned_hashes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_ref_id TEXT NOT NULL, face INTEGER NOT NULL DEFAULT 0,
  art BLOB NOT NULL, full BLOB NOT NULL, color BLOB,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY, status INTEGER, body TEXT, fetched_at REAL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def init_app_db() -> None:
    conn = app_db()
    conn.executescript(APP_SCHEMA)
    if conn.execute("SELECT 1 FROM users WHERE id=?", (config.DEFAULT_USER_ID,)).fetchone() is None:
        conn.execute(
            "INSERT INTO users(id, name, created_at) VALUES (?,?,?)",
            (config.DEFAULT_USER_ID, "Local", now_iso()),
        )


def init_catalog_db() -> None:
    catalog_db().executescript(CATALOG_SCHEMA)


def meta_get(key: str, default: str | None = None) -> str | None:
    row = catalog_db().execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def meta_set(key: str, value: str) -> None:
    catalog_db().execute(
        "INSERT INTO meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
