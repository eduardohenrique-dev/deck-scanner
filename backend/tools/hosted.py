"""Prepara a hospedagem (Neon + Cloudflare R2 + Vercel) a partir desta máquina, sem segredos no código ou no terminal.

  python -m tools.hosted check        # confere variáveis e conexões (nunca imprime os valores)
  python -m tools.hosted init         # tabelas no Postgres da Neon
  python -m tools.hosted catalog      # copia o catálogo local (SQLite) para o Postgres, só com o que o app lê
  python -m tools.hosted index        # envia o índice de hashes (data/hashindex.npz) para o bucket
  python -m tools.hosted all          # init + catalog + index
  python -m tools.hosted vercel-env   # grava as variáveis no projeto da Vercel (precisa de `vercel login`)

De onde vêm as credenciais (arquivos fora do git):
  .env.local            gerado por `neon link` / `neon config apply` na raiz: DATABASE_URL, DATABASE_URL_UNPOOLED,
                        NEON_AUTH_BASE_URL, NEON_AUTH_JWKS_URL
  backend/.env.hosted   bucket compatível com S3 (Cloudflare R2): S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID,
                        S3_SECRET_ACCESS_KEY (+ opcionais: ANTHROPIC_API_KEY, DECKSCANNER_AUTH_PROVIDERS ...)
"""
from __future__ import annotations

import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
NEON_ENV = ROOT / ".env.local"
HOSTED_ENV = BACKEND / ".env.hosted"
LOCAL_CATALOG = BACKEND / "data" / "catalog.db"
LOCAL_INDEX = BACKEND / "data" / "hashindex.npz"

NEON_VARS = ("DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_AUTH_BASE_URL", "NEON_AUTH_JWKS_URL")
S3_VARS = ("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY")
OPTIONAL = ("S3_REGION", "ANTHROPIC_API_KEY", "AI_GATEWAY_API_KEY", "DECKSCANNER_AUTH_PROVIDERS", "DECKSCANNER_VLM",
            "DECKSCANNER_MEDIA_SECRET")
# o que a função da Vercel precisa (DATABASE_URL é o endereço com pooler, próprio para serverless)
VERCEL_VARS = ("DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_JWKS_URL") + S3_VARS + OPTIONAL

# colunas de card_refs que o app não lê no servidor (vêm de oracle_cards ou só servem para gerar o índice)
BLANK_REF_COLUMNS = {"oracle_text", "legalities", "keywords", "produced_mana", "image_large", "highres"}
# nomes para a busca: português, inglês e espanhol cobrem quem digita no Brasil
NAME_LANGS = ("en", "pt", "es")


def load_env(require_s3: bool = True) -> dict[str, str]:
    values: dict[str, str] = {}
    for path in (NEON_ENV, HOSTED_ENV):
        if path.exists():
            values.update({k: v.strip() for k, v in dotenv_values(path).items() if v and v.strip()})
    missing = [k for k in NEON_VARS if not values.get(k)]
    if missing:
        sys.exit(f"Faltam variáveis da Neon ({', '.join(missing)}). Rode `neon link` e `neon config apply` na raiz.")
    if require_s3:
        missing = [k for k in S3_VARS if not values.get(k)]
        if missing:
            sys.exit(f"Faltam em backend/{HOSTED_ENV.name}: {', '.join(missing)}")
    os.environ.update(values)
    os.environ.setdefault("DECKSCANNER_DATA", str(BACKEND / "data" / "_hosted"))  # caches desta execução
    return values


def step(msg: str) -> float:
    print(f"· {msg}", flush=True)
    return time.time()


def check(values: dict[str, str]) -> None:
    import httpx
    import psycopg

    for k in NEON_VARS + S3_VARS + OPTIONAL:
        print(f"  {k:28s} {'definida' if values.get(k) else '—'}")
    t = step("Postgres (Neon)")
    with psycopg.connect(values["DATABASE_URL_UNPOOLED"], connect_timeout=20) as conn:
        version = conn.execute("SHOW server_version").fetchone()[0]
        size = conn.execute("SELECT pg_size_pretty(pg_database_size(current_database()))").fetchone()[0]
        tables = conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'").fetchone()[0]
    print(f"  ok: Postgres {version}, {tables} tabelas, banco com {size} ({time.time() - t:.1f}s, inclui acordar o banco)")
    step("Neon Auth")
    r = httpx.get(values["NEON_AUTH_JWKS_URL"], timeout=15)
    r.raise_for_status()
    print(f"  ok: {len(r.json().get('keys', []))} chave(s) públicas para verificar o login")
    if all(values.get(k) for k in S3_VARS):
        step("Bucket S3 (R2)")
        from app.storage import get_storage
        from app.vision.hashindex import INDEX_STORAGE_KEY

        storage = get_storage()
        storage.list_keys("system/")
        print(f"  ok: bucket acessível; índice de hashes enviado: {'sim' if storage.exists(INDEX_STORAGE_KEY) else 'não'}")


def init() -> None:
    from app import db

    t = step("Criando tabelas (app + catálogo)")
    db.init_all()
    print(f"  ok ({time.time() - t:.1f}s)")


def _copy(src: sqlite3.Connection, pg, table: str, columns: list[str], where: str = "", params: tuple = (),
          blank: set[str] | None = None) -> int:
    blank = blank or set()
    select = ", ".join("NULL" if c in blank else c for c in columns)
    count = 0
    with pg.cursor() as cur:
        with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as cp:
            for row in src.execute(f"SELECT {select} FROM {table} {where}", params):
                cp.write_row(tuple(row))
                count += 1
    return count


def catalog() -> None:
    import psycopg

    from app.games.mtg.scryfall_import import CARD_COLUMNS

    if not LOCAL_CATALOG.exists():
        sys.exit("Catálogo local não encontrado (rode python -m app.indexer all antes).")
    src = sqlite3.connect(f"file:{LOCAL_CATALOG}?mode=ro", uri=True)
    direct = os.environ["DATABASE_URL_UNPOOLED"]  # COPY longo: conexão direta, sem pooler
    started = step("Copiando catálogo para o Postgres (substitui o que houver, numa transação)")
    with psycopg.connect(direct) as pg:
        pg.execute("SET statement_timeout = 0")
        for table in ("card_names", "card_refs", "oracle_cards", "sets"):
            pg.execute(f"TRUNCATE {table}")
        oracle_cols = [r[1] for r in src.execute("PRAGMA table_info(oracle_cards)")]
        set_cols = [r[1] for r in src.execute("PRAGMA table_info(sets)")]
        t = time.time()
        n = _copy(src, pg, "card_refs", list(CARD_COLUMNS), blank=BLANK_REF_COLUMNS)
        print(f"  card_refs: {n} impressões ({time.time() - t:.0f}s)")
        print(f"  oracle_cards: {_copy(src, pg, 'oracle_cards', oracle_cols)}")
        n = _copy(src, pg, "card_names", ["game_id", "oracle_id", "lang", "name", "name_norm"],
                  f"WHERE lang IN ({', '.join('?' for _ in NAME_LANGS)})", NAME_LANGS)
        print(f"  card_names: {n} nomes ({'/'.join(NAME_LANGS)})")
        print(f"  sets: {_copy(src, pg, 'sets', set_cols)}")
        for key, value in src.execute("SELECT key, value FROM meta"):
            if not key.startswith("schema."):
                pg.execute("INSERT INTO meta(key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                           (key, value))
        pg.commit()
    with psycopg.connect(direct, autocommit=True) as pg:
        pg.execute("ANALYZE")
        rows = pg.execute(
            "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables "
            "ORDER BY pg_total_relation_size(relid) DESC LIMIT 6").fetchall()
        total = pg.execute("SELECT pg_size_pretty(pg_database_size(current_database()))").fetchone()[0]
    print("  maiores tabelas: " + ", ".join(f"{name} {size}" for name, size in rows))
    print(f"  banco inteiro: {total} (limite do plano gratuito: 0,5 GB) · {time.time() - started:.0f}s")


def index() -> None:
    from app.storage import get_storage
    from app.vision.hashindex import INDEX_STORAGE_KEY

    if not LOCAL_INDEX.exists():
        sys.exit("Índice local não encontrado (rode python -m app.indexer index antes).")
    data = LOCAL_INDEX.read_bytes()
    t = step(f"Enviando índice de hashes ({len(data) / 1e6:.1f} MB)")
    get_storage().put(INDEX_STORAGE_KEY, data, "application/octet-stream")
    print(f"  ok ({time.time() - t:.0f}s)")


def vercel_env(values: dict[str, str]) -> None:
    exe = shutil.which("vercel") or shutil.which("vercel.cmd")
    if not exe:
        sys.exit("Vercel CLI não encontrada (npm i -g vercel).")
    # segredo das URLs de mídia locais: gerado uma vez e guardado no .env.hosted
    if not values.get("DECKSCANNER_MEDIA_SECRET"):
        values["DECKSCANNER_MEDIA_SECRET"] = secrets.token_urlsafe(32)
        with HOSTED_ENV.open("a", encoding="utf-8") as f:
            f.write(f"\nDECKSCANNER_MEDIA_SECRET={values['DECKSCANNER_MEDIA_SECRET']}\n")
    env = {k: values[k] for k in VERCEL_VARS if values.get(k)}
    for target in ("production", "preview"):
        for name, value in env.items():
            subprocess.run([exe, "env", "rm", name, target, "--yes"], cwd=ROOT, capture_output=True)
            r = subprocess.run([exe, "env", "add", name, target], cwd=ROOT, input=value, text=True, capture_output=True)
            last = (r.stderr.strip().splitlines() or [str(r.returncode)])[-1]
            print(f"  {target:10s} {name:28s} {'ok' if r.returncode == 0 else 'falhou: ' + last}")


def main() -> None:
    commands = ("check", "init", "catalog", "index", "all", "vercel-env")
    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    values = load_env(require_s3=cmd in ("index", "all", "vercel-env"))
    if cmd == "check":
        check(values)
    elif cmd == "init":
        init()
    elif cmd == "catalog":
        catalog()
    elif cmd == "index":
        index()
    elif cmd == "vercel-env":
        vercel_env(values)
    else:
        init()
        catalog()
        index()


if __name__ == "__main__":
    main()
