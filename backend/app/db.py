"""Acesso a dados com o MESMO SQL em dois dialetos.

- SQLite (local): arquivos app.db (dados do usuário) e catalog.db (cartas), conexão por thread, WAL.
- Postgres (hospedado, DATABASE_URL): um banco só para app + catálogo, pool de conexões.

O SQL do código usa placeholders `?`, `ON CONFLICT ... DO UPDATE/NOTHING` e tipos simples
(TEXT, INTEGER, REAL, BLOB); a tradução para o Postgres acontece aqui.
"""
from __future__ import annotations

import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

import orjson

from . import config

POSTGRES = bool(config.DATABASE_URL)
DIALECT = "postgres" if POSTGRES else "sqlite"


# ====================================================================== linhas e resultados
class Row:
    """Linha acessível por índice e por nome (mesmo contrato do sqlite3.Row)."""

    __slots__ = ("_values", "_index")

    def __init__(self, values: Sequence[Any], index: dict[str, int]):
        self._values = values
        self._index = index

    def __getitem__(self, key):
        if isinstance(key, (int, slice)):
            return self._values[key]
        return self._values[self._index[key]]

    def keys(self):
        return list(self._index)

    def __iter__(self):
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __repr__(self) -> str:
        return f"Row({dict(zip(self._index, self._values))})"


class Result:
    """Resultado já materializado: a conexão volta para o pool antes da leitura."""

    __slots__ = ("rows", "rowcount")

    def __init__(self, rows: list, rowcount: int):
        self.rows = rows
        self.rowcount = rowcount

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self) -> list:
        return self.rows

    def __iter__(self) -> Iterator:
        return iter(self.rows)


def _adapt(params: Iterable[Any] | None) -> tuple:
    if not params:
        return ()
    out = []
    for p in params:
        if isinstance(p, bool):
            p = int(p)
        elif isinstance(p, memoryview):
            p = p.tobytes()
        out.append(p)
    return tuple(out)


# ====================================================================== SQLite
class SqliteDatabase:
    dialect = "sqlite"

    def __init__(self, path: Path):
        self.path = path
        self._local = threading.local()

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(str(self.path), timeout=30, check_same_thread=False, isolation_level=None)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=30000")
            self._local.conn = conn
            self._local.depth = 0
        return conn

    def execute(self, sql: str, params: Iterable[Any] | None = ()) -> Result:
        cur = self._conn().execute(sql, _adapt(params))
        rows = cur.fetchall() if cur.description else []
        return Result(rows, cur.rowcount)

    def executemany(self, sql: str, seq: Iterable[Iterable[Any]]) -> None:
        self._conn().executemany(sql, (_adapt(p) for p in seq))

    def script(self, ddl: str) -> None:
        for stmt in split_statements(ddl):
            self._conn().execute(stmt)

    @contextmanager
    def tx(self):
        conn = self._conn()
        depth = self._local.depth
        if depth == 0:
            conn.execute("BEGIN IMMEDIATE")
        self._local.depth = depth + 1
        try:
            yield self
        except BaseException:
            self._local.depth = depth
            if depth == 0:
                conn.execute("ROLLBACK")
            raise
        else:
            self._local.depth = depth
            if depth == 0:
                conn.execute("COMMIT")

    def columns(self, table: str) -> set[str]:
        return {r[1] for r in self._conn().execute(f"PRAGMA table_info({table})").fetchall()}


# ====================================================================== Postgres
_QMARK = re.compile(r"'(?:[^']|'')*'|\?|%")


def to_pyformat(sql: str) -> str:
    """`?` → `%s` e `%` literal → `%%`, sem mexer no conteúdo de strings entre aspas."""
    def repl(m: re.Match) -> str:
        tok = m.group(0)
        if tok == "?":
            return "%s"
        if tok == "%":
            return "%%"
        return tok.replace("%", "%%")
    return _QMARK.sub(repl, sql)


class PostgresDatabase:
    dialect = "postgres"

    def __init__(self, url: str):
        from psycopg_pool import ConnectionPool

        self._local = threading.local()
        self._sql_cache: dict[str, str] = {}
        self.pool = ConnectionPool(
            url, min_size=0, max_size=max(1, config.DB_POOL_MAX), open=True, timeout=30,
            # prepare_threshold=None: compatível com o pooler em modo transação (Supabase/PgBouncer)
            kwargs={"autocommit": True, "prepare_threshold": None, "row_factory": _pg_row_factory},
        )

    def _sql(self, sql: str) -> str:
        hit = self._sql_cache.get(sql)
        if hit is None:
            hit = self._sql_cache[sql] = to_pyformat(sql)
        return hit

    @contextmanager
    def _connection(self):
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            yield conn
            return
        with self.pool.connection() as conn:
            yield conn

    def execute(self, sql: str, params: Iterable[Any] | None = ()) -> Result:
        with self._connection() as conn:
            cur = conn.execute(self._sql(sql), _adapt(params))
            rows = cur.fetchall() if cur.description else []
            return Result(rows, cur.rowcount)

    def executemany(self, sql: str, seq: Iterable[Iterable[Any]]) -> None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.executemany(self._sql(sql), [_adapt(p) for p in seq])

    def script(self, ddl: str) -> None:
        with self._connection() as conn:
            for stmt in split_statements(ddl):
                conn.execute(stmt)

    @contextmanager
    def tx(self):
        if getattr(self._local, "conn", None) is not None:  # reentrante
            yield self
            return
        with self.pool.connection() as conn:
            self._local.conn = conn
            try:
                with conn.transaction():
                    yield self
            finally:
                self._local.conn = None

    def columns(self, table: str) -> set[str]:
        rows = self.execute("SELECT column_name FROM information_schema.columns WHERE table_name = ?", (table,))
        return {r[0] for r in rows}


def _pg_row_factory(cursor):
    names = [c.name for c in cursor.description] if cursor.description else []
    index = {n: i for i, n in enumerate(names)}
    return lambda values: Row(values, index)


# ====================================================================== instâncias
_lock = threading.Lock()
_app: SqliteDatabase | PostgresDatabase | None = None
_catalog: SqliteDatabase | PostgresDatabase | None = None


def app_db():
    global _app
    if _app is None:
        with _lock:
            if _app is None:
                _app = PostgresDatabase(config.DATABASE_URL) if POSTGRES else SqliteDatabase(config.APP_DB)
    return _app


def catalog_db():
    """No Postgres, catálogo e dados do app ficam no mesmo banco (mesma conexão numa transação)."""
    global _catalog
    if POSTGRES:
        return app_db()
    if _catalog is None:
        with _lock:
            if _catalog is None:
                _catalog = SqliteDatabase(config.CATALOG_DB)
    return _catalog


def tx(database):
    """Transação explícita (fora dela cada comando é autocommit)."""
    return database.tx()


# ====================================================================== utilitários
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


def row_to_dict(row, json_fields: Iterable[str] = ()) -> dict | None:
    if row is None:
        return None
    d = {k: row[k] for k in row.keys()}
    for f in json_fields:
        if f in d:
            d[f] = loads(d[f], None)
    return d


def placeholders(n: int) -> str:
    return ", ".join("?" for _ in range(n))


def chunks(seq: Sequence, size: int = 500) -> Iterator[Sequence]:
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def split_statements(ddl: str) -> list[str]:
    no_comments = re.sub(r"--[^\n]*", "", ddl)
    return [s.strip() for s in no_comments.split(";") if s.strip()]


def _for_dialect(ddl: str, dialect: str) -> str:
    if dialect != "postgres":
        return ddl
    out = []
    for stmt in split_statements(ddl):
        if stmt.upper().startswith("CREATE VIRTUAL TABLE"):
            continue
        stmt = re.sub(r"\bBLOB\b", "BYTEA", stmt)
        stmt = re.sub(r"\bREAL\b", "DOUBLE PRECISION", stmt)
        out.append(stmt)
    return ";\n".join(out)


# ====================================================================== locks entre instâncias
@contextmanager
def lease_lock(name: str, ttl: float = 60.0, wait: float = 45.0):
    """Exclusão mútua que funciona entre processos/instâncias serverless (tabela `locks` com prazo)."""
    database = app_db()
    owner = new_id()
    deadline = time.time() + wait
    delay = 0.02
    while True:
        now = time.time()
        res = database.execute(
            "INSERT INTO locks (name, owner, expires_at) VALUES (?,?,?) "
            "ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at "
            "WHERE locks.expires_at < ?", (name, owner, now + ttl, now))
        if res.rowcount == 1:
            break
        if time.time() > deadline:  # dono travado há muito tempo: segue sem o lock em vez de travar o usuário
            owner = None
            break
        time.sleep(delay)
        delay = min(delay * 1.6, 0.25)
    try:
        yield
    finally:
        if owner:
            database.execute("DELETE FROM locks WHERE name=? AND owner=?", (name, owner))


# ====================================================================== schema
APP_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT, email TEXT, settings TEXT, created_at TEXT
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
  purpose TEXT NOT NULL DEFAULT 'build',  -- build (montar lista) | check (conferir deck salvo)
  target_deck_id TEXT,             -- deck conferido (purpose=check)
  name TEXT,
  status TEXT NOT NULL,            -- capturing | processing | review | saved | error
  settings TEXT,                   -- json (idioma padrão etc.)
  stats TEXT,                      -- json
  deck_id TEXT,                    -- lista de trabalho (rascunho) desta sessão
  saved_deck_id TEXT,              -- deck onde o resultado foi salvo
  seq_counter INTEGER NOT NULL DEFAULT 0,      -- próximo seq de detecção (atômico)
  capture_counter INTEGER NOT NULL DEFAULT 0,  -- próximo índice de captura (atômico)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  saved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON scan_sessions(user_id, updated_at);
CREATE TABLE IF NOT EXISTS capture_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- image | video | live
  idx INTEGER NOT NULL DEFAULT 0,
  file_path TEXT,                  -- chave no storage
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
  crop_path TEXT,                  -- chave no storage
  raw_name TEXT, raw_set TEXT, raw_number TEXT, raw_language TEXT, raw_finish TEXT,
  confidence REAL,
  source TEXT,                     -- phash | phash+orb | learned | vlm | user | none
  status TEXT NOT NULL,            -- identified | unidentified | back | token | noise | edge | pending
  card_ref_id TEXT, oracle_id TEXT, face INTEGER DEFAULT 0,
  language TEXT, finish TEXT,
  candidates TEXT,                 -- json top-k
  neighbors TEXT,                  -- json
  quality TEXT,                    -- json
  notes TEXT,                      -- json lista de avisos
  temporal_group INTEGER,
  frame_count INTEGER, t_start REAL, t_end REAL,
  physical_card_id TEXT,
  dup_of TEXT,
  dup_status TEXT,
  dup_candidates TEXT,
  user_corrected INTEGER DEFAULT 0,
  condition TEXT,                  -- json estimativa de condição {grade, score, confidence, signals}
  print_check TEXT,                -- json aviso de impressão impossível
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_det_session ON detections(session_id);
CREATE INDEX IF NOT EXISTS idx_det_capture ON detections(capture_id);
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL, game_id TEXT NOT NULL, format_id TEXT NOT NULL,
  name TEXT,
  kind TEXT NOT NULL DEFAULT 'draft',   -- draft (lista de uma sessão) | deck (salvo)
  session_id TEXT,
  description TEXT,
  cover_card_ref_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id, kind);
CREATE TABLE IF NOT EXISTS deck_entries (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  zone TEXT NOT NULL DEFAULT 'deck',
  card_ref_id TEXT NOT NULL,
  oracle_id TEXT,
  language TEXT, finish TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  quantity_detected INTEGER NOT NULL DEFAULT 0,
  quantity_override INTEGER,
  is_commander INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0,
  rule_warnings TEXT,
  allocated_physical_ids TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  condition TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_deck ON deck_entries(deck_id);
CREATE TABLE IF NOT EXISTS deck_snapshots (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,            -- scan | check | manual | import
  session_id TEXT,
  note TEXT,
  card_count INTEGER NOT NULL DEFAULT 0,
  entries TEXT NOT NULL,           -- json [{oracle_id, card_ref_id, name, zone, quantity, language, finish, is_commander}]
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_deck ON deck_snapshots(deck_id, created_at);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- deck | binder | box | loose
  name TEXT NOT NULL,
  deck_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_locations_user ON locations(user_id);
CREATE TABLE IF NOT EXISTS physical_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL, game_id TEXT NOT NULL,
  card_ref_id TEXT, oracle_id TEXT, set_code TEXT, collector_number TEXT,
  language TEXT, finish TEXT,
  condition TEXT, condition_source TEXT,   -- user | estimate
  location_id TEXT,
  source_session_id TEXT, source_detection_id TEXT,
  acquired_at TEXT, created_at TEXT, updated_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_phys_user_oracle ON physical_cards(user_id, oracle_id);
CREATE INDEX IF NOT EXISTS idx_phys_location ON physical_cards(location_id);
CREATE TABLE IF NOT EXISTS correction_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL, game_id TEXT NOT NULL,
  detection_id TEXT,
  art_phash TEXT, full_phash TEXT,
  wrong_card_ref TEXT, correct_card_ref TEXT, face INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learned_hashes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_ref_id TEXT NOT NULL, face INTEGER NOT NULL DEFAULT 0, oracle_id TEXT,
  art BLOB NOT NULL, full_hash BLOB NOT NULL, color BLOB,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_learned_user ON learned_hashes(user_id);
CREATE TABLE IF NOT EXISTS vlm_calls (
  id TEXT PRIMARY KEY, session_id TEXT, detection_id TEXT, model TEXT,
  input_tokens INTEGER, output_tokens INTEGER, ms INTEGER, ok INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY, status INTEGER, body TEXT, fetched_at REAL
);
CREATE TABLE IF NOT EXISTS price_cache (
  card_ref_id TEXT PRIMARY KEY, prices TEXT, fetched_at REAL
);
CREATE TABLE IF NOT EXISTS fx_rates (
  pair TEXT PRIMARY KEY, rate REAL, quoted_at TEXT, fetched_at REAL
);
CREATE TABLE IF NOT EXISTS locks (
  name TEXT PRIMARY KEY, owner TEXT, expires_at REAL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
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
CREATE INDEX IF NOT EXISTS idx_oracle_name_lower ON oracle_cards(lower(name_en));

CREATE TABLE IF NOT EXISTS card_names (
  game_id TEXT NOT NULL, oracle_id TEXT NOT NULL, lang TEXT NOT NULL, name TEXT NOT NULL,
  name_norm TEXT,                  -- sem acentos, casefold (busca no Postgres)
  PRIMARY KEY (game_id, oracle_id, lang, name)
);
CREATE INDEX IF NOT EXISTS idx_names_lower ON card_names(lower(name));
CREATE VIRTUAL TABLE IF NOT EXISTS card_names_fts USING fts5(
  name, content='card_names', tokenize="unicode61 remove_diacritics 2"
);

CREATE TABLE IF NOT EXISTS sets (
  code TEXT PRIMARY KEY, game_id TEXT NOT NULL, name TEXT, set_type TEXT, released_at TEXT,
  card_count INTEGER, printed_size INTEGER, icon_svg_uri TEXT
);

CREATE TABLE IF NOT EXISTS art_hashes (
  card_ref_id TEXT NOT NULL,
  face INTEGER NOT NULL DEFAULT 0,
  art BLOB NOT NULL, full BLOB NOT NULL, color BLOB,
  created_at TEXT,
  PRIMARY KEY (card_ref_id, face)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""

# extras que só existem no Postgres (busca por trigramas)
POSTGRES_EXTRAS = """
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_names_trgm ON card_names USING gin (name_norm gin_trgm_ops);
"""

SCHEMA_VERSION = "2"

# colunas adicionadas depois da versão 1 (bancos SQLite já existentes)
APP_MIGRATIONS: dict[str, dict[str, str]] = {
    "users": {"email": "TEXT", "settings": "TEXT"},
    "scan_sessions": {"purpose": "TEXT NOT NULL DEFAULT 'build'", "target_deck_id": "TEXT", "saved_deck_id": "TEXT",
                      "saved_at": "TEXT", "seq_counter": "INTEGER NOT NULL DEFAULT 0",
                      "capture_counter": "INTEGER NOT NULL DEFAULT 0"},
    "detections": {"condition": "TEXT", "print_check": "TEXT"},
    "decks": {"kind": "TEXT NOT NULL DEFAULT 'draft'", "description": "TEXT", "cover_card_ref_id": "TEXT",
              "updated_at": "TEXT"},
    "physical_cards": {"oracle_id": "TEXT", "condition_source": "TEXT", "source_session_id": "TEXT",
                       "source_detection_id": "TEXT", "created_at": "TEXT", "updated_at": "TEXT", "notes": "TEXT"},
}
CATALOG_MIGRATIONS: dict[str, dict[str, str]] = {
    "card_names": {"name_norm": "TEXT"},
}


def _migrate_columns(database, migrations: dict[str, dict[str, str]]) -> set[str]:
    added: set[str] = set()
    for table, cols in migrations.items():
        existing = database.columns(table)
        if not existing:
            continue
        for col, decl in cols.items():
            if col not in existing:
                database.execute(f"ALTER TABLE {table} ADD COLUMN {col} {_for_dialect(decl, database.dialect)}")
                added.add(f"{table}.{col}")
    return added


def _migrate_legacy_sqlite(app, catalog) -> None:
    """v1 → v2: physical_cards deixou de ser derivada por sessão; hashes aprendidos e cache de API vão para o app."""
    cols = app.columns("physical_cards")
    if "session_id" in cols:
        app.execute("DROP TABLE physical_cards")
    if isinstance(catalog, SqliteDatabase) and catalog is not app:
        if "user_id" in catalog.columns("learned_hashes"):
            rows = catalog.execute("SELECT l.id, l.user_id, l.card_ref_id, l.face, r.oracle_id, l.art, l.full, l.color, "
                                   "l.created_at FROM learned_hashes l LEFT JOIN card_refs r ON r.id = l.card_ref_id")
            app.executemany("INSERT INTO learned_hashes (id, user_id, card_ref_id, face, oracle_id, art, full_hash, color, "
                            "created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING", [tuple(r) for r in rows])
            catalog.execute("DROP TABLE learned_hashes")
        if catalog.columns("api_cache"):
            catalog.execute("DROP TABLE api_cache")


def init_app_db() -> None:
    database = app_db()
    if POSTGRES and meta_get("schema.app") == SCHEMA_VERSION:
        return
    if not POSTGRES:
        # a tabela antiga precisa sair antes do CREATE (o schema novo tem outras colunas)
        if "session_id" in database.columns("physical_cards"):
            database.execute("DROP TABLE physical_cards")
    # colunas novas antes do schema: os índices do schema podem usar essas colunas
    added = _migrate_columns(database, APP_MIGRATIONS)
    database.script(_for_dialect(APP_SCHEMA, database.dialect))
    if "scan_sessions.seq_counter" in added:
        database.execute("UPDATE scan_sessions SET seq_counter = (SELECT COALESCE(MAX(seq), 0) FROM detections d "
                         "WHERE d.session_id = scan_sessions.id)")
    if "scan_sessions.capture_counter" in added:
        database.execute("UPDATE scan_sessions SET capture_counter = (SELECT COALESCE(MAX(idx), 0) FROM capture_items c "
                         "WHERE c.session_id = scan_sessions.id)")
    if "decks.kind" in added:
        database.execute("UPDATE decks SET kind = 'draft' WHERE session_id IS NOT NULL")
    if database.execute("SELECT 1 FROM users WHERE id=?", (config.DEFAULT_USER_ID,)).fetchone() is None:
        database.execute("INSERT INTO users (id, name, created_at) VALUES (?,?,?) ON CONFLICT (id) DO NOTHING",
                         (config.DEFAULT_USER_ID, "Local", now_iso()))
    meta_set("schema.app", SCHEMA_VERSION)


def init_catalog_db() -> None:
    database = catalog_db()
    if POSTGRES:
        if meta_get("schema.catalog") == SCHEMA_VERSION:
            return
        _migrate_columns(database, CATALOG_MIGRATIONS)
        database.script(_for_dialect(CATALOG_SCHEMA, "postgres"))
        database.script(POSTGRES_EXTRAS)
    else:
        _migrate_columns(database, CATALOG_MIGRATIONS)
        database.script(CATALOG_SCHEMA)
        _migrate_legacy_sqlite(app_db(), database)
    meta_set("schema.catalog", SCHEMA_VERSION)


def init_all() -> None:
    init_app_db()
    init_catalog_db()


def meta_get(key: str, default: str | None = None) -> str | None:
    database = app_db()
    try:
        row = database.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    except Exception:  # noqa: BLE001 — tabela ainda não criada
        return default
    return row["value"] if row else default


def meta_set(key: str, value: str) -> None:
    app_db().execute(
        "INSERT INTO meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def catalog_meta_get(key: str, default: str | None = None) -> str | None:
    row = catalog_db().execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def catalog_meta_set(key: str, value: str) -> None:
    catalog_db().execute(
        "INSERT INTO meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
