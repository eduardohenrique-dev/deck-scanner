"""Sobe a API nesta máquina usando o banco e o login da hospedagem (Neon), para testar antes de publicar.

  python -m tools.serve_hosted [--port 8420]

Os arquivos ficam no disco local, a menos que backend/.env.hosted tenha as variáveis S3_*.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))  # também funciona chamado pelo caminho do arquivo


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8420)
    args = p.parse_args()
    # mantém backend/data: o índice de hashes local é usado quando não há bucket configurado
    os.environ.setdefault("DECKSCANNER_DATA", str(BACKEND / "data"))
    from tools.hosted import load_env

    load_env(require_s3=False)
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
