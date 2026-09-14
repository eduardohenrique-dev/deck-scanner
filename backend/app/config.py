"""Configuração central: caminhos, integrações e limiares do pipeline."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

DATA_DIR = Path(os.environ.get("DECKSCANNER_DATA", BACKEND_DIR / "data"))
# Regras de formato, listas e metadados de jogo são DADOS: ficam fora do código e
# são recarregados em tempo de execução (mudança de banlist não exige deploy).
RULES_DIR = Path(os.environ.get("DECKSCANNER_RULES", BACKEND_DIR / "rules"))

CATALOG_DB = DATA_DIR / "catalog.db"
APP_DB = DATA_DIR / "app.db"
UPLOAD_DIR = DATA_DIR / "uploads"
CROP_DIR = DATA_DIR / "crops"
CACHE_DIR = DATA_DIR / "cache"
SCRYFALL_DIR = DATA_DIR / "scryfall"
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"

for _d in (DATA_DIR, UPLOAD_DIR, CROP_DIR, CACHE_DIR, SCRYFALL_DIR):
    _d.mkdir(parents=True, exist_ok=True)

USER_AGENT = "DeckScanner/0.1"
SCRYFALL_API = "https://api.scryfall.com"
SCRYFALL_MIN_INTERVAL = 0.11  # ~9 req/s, abaixo do limite de 10 req/s
SCRYFALL_CACHE_TTL = 7 * 24 * 3600

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
VLM_MODEL = os.environ.get("DECKSCANNER_VLM_MODEL", "claude-opus-5")
VLM_EFFORT = os.environ.get("DECKSCANNER_VLM_EFFORT", "low")  # leitura de carta é tarefa simples
VLM_ENABLED = bool(ANTHROPIC_API_KEY) and os.environ.get("DECKSCANNER_VLM", "1") != "0"
VLM_MAX_CONCURRENCY = int(os.environ.get("DECKSCANNER_VLM_CONCURRENCY", "4"))

# Verificação geométrica (ORB) baixa a imagem oficial do candidato; pode ser desligada offline.
ORB_VERIFY_ENABLED = os.environ.get("DECKSCANNER_ORB_VERIFY", "1") != "0"

DEFAULT_USER_ID = "local"
DEFAULT_GAME_ID = "mtg"

# Vídeo
VIDEO_SAMPLE_FPS = float(os.environ.get("DECKSCANNER_VIDEO_FPS", "10"))
