"""Compara a escolha de coleção COM e SEM as regiões do número da carta no rodapé.

  python -m tools.printregions_ab --n 20 [--seed 5] [--hard]

Mesma cena e mesma consulta de hash para os dois lados: muda só o conjunto de regiões comparadas
(printmatch.PRINT_REGIONS). Evita atribuir à mudança uma diferença que era só sorte da amostra.
"""
from __future__ import annotations

import argparse
import json

import numpy as np

from app.games import registry
from app.pipeline import printresolve
from app.vision import printmatch
from tools.printlang_eval import _identify, _multi_print_arts, _scene

WITHOUT = {k: v for k, v in printmatch.PRINT_REGIONS.items() if k not in ("number", "setcode")}
WITH = dict(printmatch.PRINT_REGIONS)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=20)
    p.add_argument("--seed", type=int, default=5)
    p.add_argument("--hard", action="store_true")
    args = p.parse_args()
    if "number" not in WITH:
        raise SystemExit("printmatch.PRINT_REGIONS não tem a região 'number' — nada a comparar")

    rng = np.random.default_rng(args.seed)
    adapter = registry.get("mtg")
    rows = []
    for truth_id in _multi_print_arts(rng, args.n):
        got = _identify(_scene(truth_id, rng, args.hard))
        if got is None:
            rows.append({"detected": False})
            continue
        card, ctx, cands, height = got
        truth_set = adapter.card_summary(truth_id)["set_code"]
        row = {"detected": True, "truth": truth_set, "hash": None}
        if cands:
            row["hash"] = adapter.card_summary(cands[0].card_ref_id)["set_code"]
        for name, regions in (("sem", WITHOUT), ("com", WITH)):
            printmatch.PRINT_REGIONS = regions
            res = printresolve.resolve(card, ctx, list(cands), adapter, default_language="en", source_height=height)
            got_set = (adapter.card_summary(res.card_ref_id) or {}).get("set_code") if res.card_ref_id else None
            row[name] = {"set": got_set, "ok": got_set == truth_set, "confident": res.print_confident,
                         "margin": res.metrics.get("print_margin")}
        rows.append(row)
        print(".", end="", flush=True)
    printmatch.PRINT_REGIONS = WITH
    print()

    det = [r for r in rows if r["detected"]]
    report = {"amostras": len(rows), "detectadas": len(det),
              "hash_sozinho": round(sum(r["hash"] == r["truth"] for r in det) / max(len(det), 1), 3)}
    for name in ("sem", "com"):
        ok = sum(r[name]["ok"] for r in det)
        conf = [r for r in det if r[name]["confident"]]
        report[name] = {"acerto": round(ok / max(len(det), 1), 3), "confiantes": len(conf),
                        "acerto_confiantes": round(sum(r[name]["ok"] for r in conf) / max(len(conf), 1), 3)}
    report["mudou"] = [{"truth": r["truth"], "sem": r["sem"]["set"], "com": r["com"]["set"]}
                       for r in det if r["sem"]["set"] != r["com"]["set"]]
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
