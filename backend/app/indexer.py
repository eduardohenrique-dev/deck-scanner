"""CLI de indexação do catálogo e do banco de hashes.

Uso:
  python -m app.indexer catalog            # bulk default_cards + nomes em todos os idiomas (+ impressões PT)
  python -m app.indexer sets               # coleções (checagem de impressão impossível)
  python -m app.indexer hashes [--limit N] [--sets blb,mh3] [--langs en,pt] [--concurrency 12]
  python -m app.indexer index              # regera data/hashindex.npz a partir de art_hashes
  python -m app.indexer all
  python -m app.indexer status
"""
from __future__ import annotations

import argparse
import json

from . import config, db
from .games.mtg import hash_build, scryfall_import
from .vision.hashindex import build_index_file


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.indexer")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_cat = sub.add_parser("catalog", help="importa o bulk data da Scryfall")
    p_cat.add_argument("--offline", action="store_true", help="usa os arquivos já baixados")
    p_cat.add_argument("--full-langs", default="pt", help="idiomas com impressões completas (ex.: pt,es)")
    p_cat.add_argument("--skip-i18n", action="store_true")

    sub.add_parser("sets", help="importa a lista de coleções")

    p_hash = sub.add_parser("hashes", help="gera o banco de pHash")
    p_hash.add_argument("--limit", type=int)
    p_hash.add_argument("--sets")
    p_hash.add_argument("--langs", default="en")
    p_hash.add_argument("--concurrency", type=int, default=12)

    sub.add_parser("index", help="regera o arquivo do índice de hashes")
    sub.add_parser("backfill", help="preenche colunas novas em catálogos antigos")

    p_all = sub.add_parser("all", help="catalog + sets + hashes")
    p_all.add_argument("--offline", action="store_true")
    p_all.add_argument("--concurrency", type=int, default=12)

    sub.add_parser("status")
    args = parser.parse_args()

    db.init_all()
    if args.cmd in ("catalog", "all"):
        default_path = scryfall_import.ensure_bulk_file("default_cards", offline=args.offline)
        scryfall_import.import_default_cards(default_path)
        if not getattr(args, "skip_i18n", False):
            all_path = scryfall_import.ensure_bulk_file("all_cards", offline=args.offline)
            langs = tuple(x.strip() for x in getattr(args, "full_langs", "pt").split(",") if x.strip())
            scryfall_import.import_i18n(all_path, full_langs=langs)
        else:
            scryfall_import.rebuild_name_index()
    if args.cmd in ("sets", "all"):
        print(f"{scryfall_import.import_sets()} coleções")
    if args.cmd == "hashes":
        sets = [s.strip() for s in args.sets.split(",")] if args.sets else None
        langs = tuple(x.strip() for x in args.langs.split(",") if x.strip())
        hash_build.build_hashes(langs=langs, limit=args.limit, sets=sets, concurrency=args.concurrency)
    if args.cmd == "all":
        hash_build.build_hashes(concurrency=args.concurrency)
    if args.cmd == "index":
        print(json.dumps(build_index_file()))
    if args.cmd == "backfill":
        print(f"name_norm preenchido em {scryfall_import.backfill_name_norm()} nomes")
        bulks = sorted(config.SCRYFALL_DIR.glob("default-cards-*.jsonl.gz"))[-1:] + \
            sorted(config.SCRYFALL_DIR.glob("all-cards-*.jsonl.gz"))[-1:]
        print(f"image_status lido de {scryfall_import.backfill_image_status(bulks)} impressões")
    if args.cmd == "status":
        conn = db.catalog_db()
        out = {
            "prints": conn.execute("SELECT COUNT(*) FROM card_refs").fetchone()[0],
            "oracle_cards": conn.execute("SELECT COUNT(*) FROM oracle_cards").fetchone()[0],
            "names": conn.execute("SELECT COUNT(*) FROM card_names").fetchone()[0],
            "sets": conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0],
            "hashes": conn.execute("SELECT COUNT(*) FROM art_hashes").fetchone()[0],
            "meta": {r[0]: r[1] for r in conn.execute("SELECT key, value FROM meta")},
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
