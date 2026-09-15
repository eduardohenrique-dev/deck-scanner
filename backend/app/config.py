"""Configuração central: ambientes (local x hospedado), integrações e limiares do pipeline.

Local (padrão): SQLite em backend/data, arquivos em disco, um único usuário "local".
Hospedado (Vercel): DATABASE_URL (Postgres/Supabase), login Supabase e Storage do Supabase.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


SERVERLESS = bool(_env("VERCEL"))  # a Vercel define VERCEL=1 nas funções

# Em função serverless só /tmp é gravável: lá ficam apenas caches descartáveis.
DATA_DIR = Path(_env("DECKSCANNER_DATA") or ("/tmp/deck-scanner" if SERVERLESS else str(BACKEND_DIR / "data")))
# Regras de formato, listas e metadados de jogo são DADOS: ficam fora do código e
# são recarregados em tempo de execução (mudança de banlist não exige deploy).
RULES_DIR = Path(_env("DECKSCANNER_RULES") or str(BACKEND_DIR / "rules"))

CATALOG_DB = DATA_DIR / "catalog.db"
APP_DB = DATA_DIR / "app.db"
CACHE_DIR = DATA_DIR / "cache"
STORAGE_DIR = DATA_DIR / "storage"
SCRYFALL_DIR = DATA_DIR / "scryfall"
HASH_INDEX_FILE = DATA_DIR / "hashindex.npz"
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"

for _d in (DATA_DIR, CACHE_DIR, STORAGE_DIR, SCRYFALL_DIR):
    try:
        _d.mkdir(parents=True, exist_ok=True)
    except OSError:  # sistema de arquivos somente leitura: o que precisar de disco falha na hora de usar
        pass

# ---------------------------------------------------------------- banco
DATABASE_URL = _env("DATABASE_URL")          # vazio = SQLite local
DB_POOL_MAX = int(_env("DECKSCANNER_DB_POOL", "4"))

# ---------------------------------------------------------------- login (Neon Auth)
NEON_AUTH_BASE_URL = _env("NEON_AUTH_BASE_URL").rstrip("/")   # público: o navegador fala direto com ele
NEON_AUTH_JWKS_URL = _env("NEON_AUTH_JWKS_URL") or (f"{NEON_AUTH_BASE_URL}/.well-known/jwks.json" if NEON_AUTH_BASE_URL else "")
AUTH_MODE = _env("DECKSCANNER_AUTH") or ("neon" if NEON_AUTH_BASE_URL else "local")
# formas de entrar mostradas na tela de login (password = e-mail e senha)
AUTH_PROVIDERS = [p.strip() for p in _env("DECKSCANNER_AUTH_PROVIDERS", "password,google").split(",") if p.strip()]
DEFAULT_USER_ID = "local"
DEFAULT_GAME_ID = "mtg"

# ---------------------------------------------------------------- arquivos (fotos, recortes, índice)
# Hospedado: qualquer storage compatível com S3 (Cloudflare R2, por exemplo), bucket privado.
S3_ENDPOINT = _env("S3_ENDPOINT").rstrip("/")     # R2: https://<account-id>.r2.cloudflarestorage.com
S3_REGION = _env("S3_REGION", "auto")
S3_BUCKET = _env("S3_BUCKET")
S3_ACCESS_KEY_ID = _env("S3_ACCESS_KEY_ID")
S3_SECRET_ACCESS_KEY = _env("S3_SECRET_ACCESS_KEY")
STORAGE_BACKEND = _env("DECKSCANNER_STORAGE") or ("s3" if S3_ENDPOINT and S3_BUCKET and S3_ACCESS_KEY_ID else "local")
MEDIA_URL_TTL = 3600
# segredo para assinar URLs de mídia servidas pela própria API (modo local); troque em produção
MEDIA_SIGNING_SECRET = _env("DECKSCANNER_MEDIA_SECRET") or S3_SECRET_ACCESS_KEY or "deck-scanner-local"

# ---------------------------------------------------------------- Scryfall
USER_AGENT = "DeckScanner/0.2"
SCRYFALL_API = "https://api.scryfall.com"
SCRYFALL_MIN_INTERVAL = 0.11  # ~9 req/s, abaixo do limite de 10 req/s
SCRYFALL_CACHE_TTL = 7 * 24 * 3600
PRICE_TTL = 24 * 3600

# ---------------------------------------------------------------- modelo multimodal (etapa 3)
ANTHROPIC_API_KEY = _env("ANTHROPIC_API_KEY")
AI_GATEWAY_API_KEY = _env("AI_GATEWAY_API_KEY")
_VLM_SWITCH = _env("DECKSCANNER_VLM")  # "1" liga, "0" desliga; vazio = liga só com chave configurada
# Na Vercel o AI Gateway aceita o token OIDC da própria função (chega a cada requisição), mas isso gera custo
# na conta: sem chave explícita o modelo só é usado com DECKSCANNER_VLM=1.
VLM_PROVIDER = _env("DECKSCANNER_VLM_PROVIDER") or (
    "anthropic" if ANTHROPIC_API_KEY else
    "gateway" if (AI_GATEWAY_API_KEY or _env("VERCEL_OIDC_TOKEN") or (SERVERLESS and _VLM_SWITCH == "1")) else "")
VLM_MODEL = _env("DECKSCANNER_VLM_MODEL", "claude-opus-5")
VLM_EFFORT = _env("DECKSCANNER_VLM_EFFORT", "low")  # leitura de carta é tarefa simples
VLM_ENABLED = bool(VLM_PROVIDER) and _VLM_SWITCH != "0"
VLM_MAX_CONCURRENCY = int(_env("DECKSCANNER_VLM_CONCURRENCY", "4"))

# Verificação geométrica (ORB) baixa a imagem oficial do candidato; pode ser desligada offline.
ORB_VERIFY_ENABLED = _env("DECKSCANNER_ORB_VERIFY", "1") != "0"

# ---------------------------------------------------------------- integrações da Fase 2
SPELLBOOK_API = "https://backend.commanderspellbook.com"
SPELLBOOK_ENABLED = _env("DECKSCANNER_SPELLBOOK", "1") != "0"
FALLBACK_USD_BRL = float(_env("DECKSCANNER_USD_BRL", "5.40"))   # só sem acesso à cotação PTAX
VALUABLE_BRL = float(_env("DECKSCANNER_VALUABLE_BRL", "50"))    # a partir de quanto uma carta vira "achado valioso"

# Vídeo (arquivo processado no servidor: só ferramentas de teste; no app o vídeo é lido no navegador)
VIDEO_SAMPLE_FPS = float(_env("DECKSCANNER_VIDEO_FPS", "10"))
