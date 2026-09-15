"""Prepara a hospedagem (Supabase + Vercel) a partir desta máquina, sem segredos no código ou no terminal.

  python -m tools.hosted check        # confere variáveis e conexões (nunca imprime os valores)
  python -m tools.hosted init         # tabelas no Postgres com RLS ligado e bucket privado no Storage
  python -m tools.hosted catalog      # copia o catálogo local (SQLite) para o Postgres, só com o que o app lê
  python -m tools.hosted index        # envia o índice de hashes (data/hashindex.npz) para o Storage
  python -m tools.hosted all          # init + catalog + index
  python -m tools.hosted vercel-env   # grava as variáveis no projeto da Vercel (precisa de `vercel login` e `vercel link`)

As credenciais ficam em backend/.env.hosted (fora do git):
  DATABASE_URL=postgresql://postgres.<ref>:<senha>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
  SUPABASE_URL=https://<ref>.supabase.co
  SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
  SUPABASE_SECRET_KEY=sb_secret_...
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
from urllib.parse import urlparse, urlunparse

from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND / ".env.hosted"
LOCAL_CATALOG = BACKEND / "data" / "catalog.db"
LOCAL_INDEX = BACKEND / "data" / "hashindex.npz"
REQUIRED = ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY")
OPTIONAL = ("SUPABASE_JWT_SECRET", "ANTHROPIC_API_KEY", "AI_GATEWAY_API_KEY", "DECKSCANNER_AUTH_PROVIDERS", "DECKSCANNER_VLM")

# colunas de card_refs que o app não lê no servidor (vêm de oracle_cards ou só servem para gerar o índice)
BLANK_REF_COLUMNS = {"oracle_text", "legalities", "keywords", "produced_mana", "image_large", "highres"}
# nomes para a busca: português, inglês e espanhol cobrem quem digita no Brasil
NAME_LANGS = ("en", "pt", "es")


def load_env() -> dict[str, str]:
    if not ENV_FILE.exists():
        sys.exit(f"Crie {ENV_FILE.name} em backend/ com: {', '.join(REQUIRED)} (veja o topo deste arquivo).")
    values = {k: v.strip() for k, v in dotenv_values(ENV_FILE).items() if v and v.strip()}
    missing = [k for k in REQUIRED if not values.get(k)]
    if missing:
        sys.exit(f"Faltam em {ENV_FILE.name}: {', '.join(missing)}")
    os.environ.update(values)
    # caches desta execução ficam fora de data/ (o catálogo local é só lido)
    os.environ.setdefault("DECKSCANNER_DATA", str(BACKEND / "data" / "_hosted"))
    return values


def session_url(url: str) -> str:
    """Pooler do Supabase em modo sessão (porta 5432): COPY e DDL longos sem as restrições do modo transação."""
    parts = urlparse(url)
    if parts.hostname and "pooler.supabase.com" in parts.hostname and parts.port == 6543:
        netloc = parts.netloc.rsplit(":", 1)[0] + ":5432"
        return urlunparse(parts._replace(netloc=netloc))
    return url


def step(msg: str) -> float:
    print(f"· {msg}", flush=True)
    return time.time()


def check(values: dict[str, str]) -> None:
    import httpx
    import psycopg

    for k in REQUIRED + OPTIONAL:
        print(f"  {k:28s} {'definida' if values.get(k) else '—'}")
    t = step("Postgres")
    with psycopg.connect(session_url(values["DATABASE_URL"]), connect_timeout=15) as conn:
        version = conn.execute("SHOW server_version").fetchone()[0]
        size = conn.execute("SELECT pg_size_pretty(pg_database_size(current_database()))").fetchone()[0]
    print(f"  ok: Postgres {version}, banco com {size} ({time.time() - t:.1f}s)")
    base = values["SUPABASE_URL"].rstrip("/")
    step("Auth")
    r = httpx.get(f"{base}/auth/v1/settings", headers={"apikey": values["SUPABASE_PUBLISHABLE_KEY"]}, timeout=15)
    r.raise_for_status()
    settings = r.json()
    external = settings.get("external") or {}
    enabled = ["email"] if external.get("email") else []
    enabled += [p for p in ("google", "github", "discord") if external.get(p)]
    if external.get("anonymous_users") or settings.get("anonymous_users"):
        enabled.append("anonymous")
    print(f"  provedores ativos no Supabase: {', '.join(enabled) or 'nenhum'}")
    step("Storage")
    from app.storage import get_storage

    storage = get_storage()
    print(f"  backend: {storage.backend}; índice no bucket: {'sim' if storage.exists('system/hashindex-v1.npz') else 'não'}")


def init() -> None:
    import psycopg

    from app import db
    from app.storage import get_storage

    t = step("Criando tabelas (app + catálogo)")
    db.init_all()
    print(f"  ok ({time.time() - t:.1f}s)")
    step("Ligando RLS em todas as tabelas (a API do Supabase não expõe nada; o servidor usa conexão direta)")
    with psycopg.connect(session_url(os.environ["DATABASE_URL"]), autocommit=True) as conn:
        tables = [r[0] for r in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'").fetchall()]
        for name in tables:
            conn.execute(f'ALTER TABLE public."{name}" ENABLE ROW LEVEL SECURITY')
    print(f"  {len(tables)} tabelas protegidas")
    step("Bucket privado do Storage")
    storage = get_storage()
    storage._ensure_bucket()  # noqa: SLF001 — cria se não existir
    print(f"  bucket: {os.environ.get('DECKSCANNER_BUCKET', 'deck-scanner')}")


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
    started = step("Copiando catálogo para o Postgres (substitui o que houver, numa transação)")
    with psycopg.connect(session_url(os.environ["DATABASE_URL"])) as pg:
        pg.execute("SET statement_timeout = 0")
        for table in ("card_names", "card_refs", "oracle_cards", "sets"):
            pg.execute(f"TRUNCATE {table}")
        oracle_cols = [r[1] for r in src.execute("PRAGMA table_info(oracle_cards)")]
        set_cols = [r[1] for r in src.execute("PRAGMA table_info(sets)")]
        t = time.time()
        n = _copy(src, pg, "card_refs", list(CARD_COLUMNS), blank=BLANK_REF_COLUMNS)
        print(f"  card_refs: {n} impressões ({time.time() - t:.0f}s)")
        n = _copy(src, pg, "oracle_cards", oracle_cols)
        print(f"  oracle_cards: {n}")
        n = _copy(src, pg, "card_names", ["game_id", "oracle_id", "lang", "name", "name_norm"],
                  f"WHERE lang IN ({', '.join('?' for _ in NAME_LANGS)})", NAME_LANGS)
        print(f"  card_names: {n} nomes ({'/'.join(NAME_LANGS)})")
        n = _copy(src, pg, "sets", set_cols)
        print(f"  sets: {n}")
        for key, value in src.execute("SELECT key, value FROM meta"):
            if key.startswith("schema."):
                continue
            pg.execute("INSERT INTO meta(key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                       (key, value))
        pg.commit()
    with psycopg.connect(session_url(os.environ["DATABASE_URL"]), autocommit=True) as pg:
        pg.execute("ANALYZE")
        rows = pg.execute(
            "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables "
            "ORDER BY pg_total_relation_size(relid) DESC LIMIT 6").fetchall()
        total = pg.execute("SELECT pg_size_pretty(pg_database_size(current_database()))").fetchone()[0]
    print("  maiores tabelas: " + ", ".join(f"{name} {size}" for name, size in rows))
    print(f"  banco inteiro: {total} (limite do plano gratuito: 500 MB) · {time.time() - started:.0f}s")


def index() -> None:
    import httpx

    from app.vision.hashindex import INDEX_STORAGE_KEY

    if not LOCAL_INDEX.exists():
        sys.exit("Índice local não encontrado (rode python -m app.indexer index antes).")
    data = LOCAL_INDEX.read_bytes()
    t = step(f"Enviando índice de hashes ({len(data) / 1e6:.1f} MB)")
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SECRET_KEY"]
    bucket = os.environ.get("DECKSCANNER_BUCKET", "deck-scanner")
    headers = {"apikey": key, "Content-Type": "application/octet-stream", "x-upsert": "true"}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    r = httpx.post(f"{base}/storage/v1/object/{bucket}/{INDEX_STORAGE_KEY}", content=data, headers=headers, timeout=600)
    r.raise_for_status()
    print(f"  ok ({time.time() - t:.0f}s)")


def vercel_env(values: dict[str, str]) -> None:
    exe = shutil.which("vercel") or shutil.which("vercel.cmd")
    if not exe:
        sys.exit("Vercel CLI não encontrada (npm i -g vercel).")
    env = {k: values[k] for k in REQUIRED + OPTIONAL if values.get(k)}
    # segredo das URLs de mídia: gerado uma vez e guardado no .env.hosted
    if not values.get("DECKSCANNER_MEDIA_SECRET"):
        secret = secrets.token_urlsafe(32)
        with ENV_FILE.open("a", encoding="utf-8") as f:
            f.write(f"\nDECKSCANNER_MEDIA_SECRET={secret}\n")
        values["DECKSCANNER_MEDIA_SECRET"] = secret
    env["DECKSCANNER_MEDIA_SECRET"] = values["DECKSCANNER_MEDIA_SECRET"]
    root = BACKEND.parent
    for target in ("production", "preview"):
        for name, value in env.items():
            subprocess.run([exe, "env", "rm", name, target, "--yes"], cwd=root, capture_output=True)
            r = subprocess.run([exe, "env", "add", name, target], cwd=root, input=value, text=True, capture_output=True)
            status = "ok" if r.returncode == 0 else f"falhou: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else r.returncode}"
            print(f"  {target:10s} {name:28s} {status}")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "init", "catalog", "index", "all", "vercel-env"):
        sys.exit(__doc__)
    values = load_env()
    cmd = sys.argv[1]
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
