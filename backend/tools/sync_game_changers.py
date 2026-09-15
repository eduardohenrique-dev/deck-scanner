"""Atualiza rules/mtg/data/game_changers.json a partir do catálogo importado (flag game_changer da Scryfall).

  python -m tools.sync_game_changers          # grava a lista nova e mostra o que entrou/saiu
  python -m tools.sync_game_changers --check  # só compara (útil depois de importar o catálogo)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json

from app import config, db


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    db.init_all()
    names = [r[0] for r in db.catalog_db().execute(
        "SELECT name_en FROM oracle_cards WHERE game_changer=1 ORDER BY name_en").fetchall()]
    path = config.RULES_DIR / "mtg" / "data" / "game_changers.json"
    current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cards": []}
    added = sorted(set(names) - set(current["cards"]))
    removed = sorted(set(current["cards"]) - set(names))
    print(json.dumps({"total": len(names), "added": added, "removed": removed}, ensure_ascii=False, indent=2))
    if args.check or not (added or removed):
        return
    current.update(version=dt.date.today().isoformat(), cards=names)
    path.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
