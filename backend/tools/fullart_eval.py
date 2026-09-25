"""Mede o 'cara de carta' (cardness) por tipo de moldura, com imagens reais renderizadas como frames da câmera.

  .venv\\Scripts\\python -m tools.fullart_eval [n por grupo]

Grupos: terreno básico de arte completa (o caso mais difícil: sem caixa de texto), outras cartas de arte
completa, cartas sem borda e cartas normais (controle).
"""
from __future__ import annotations

import json
import sys

import numpy as np

from app import config, db
from app.games import registry
from app.pipeline import identify
from app.vision import cardness, detect
from tools import synth

ADAPTER = registry.get("mtg")

BUCKETS = {
    "basico full art": "full_art = 1 AND type_line LIKE 'Basic Land%'",
    "full art": "full_art = 1 AND type_line NOT LIKE 'Basic Land%' AND border_color != 'borderless'",
    "sem borda": "border_color = 'borderless'",
    "normal": "full_art = 0 AND border_color = 'black' AND (frame_effects IS NULL OR frame_effects IN ('', '[]'))",
}


def pick(where: str, n: int) -> list[tuple[str, str, str]]:
    rows = db.catalog_db().execute(
        "SELECT id, name_en, set_code, oracle_id FROM card_refs WHERE image_large IS NOT NULL AND lang='en' "
        f"AND kind='card' AND oversized=0 AND highres=1 AND {where} ORDER BY id LIMIT ?", (n,)).fetchall()
    return [(r["id"], f"{r['name_en']} ({r['set_code']})", r["oracle_id"]) for r in rows]


def read(warped: np.ndarray) -> identify.IdentifyResult:
    """A mesma identificação da leitura ao vivo (sem IA)."""
    return identify.identify(warped, adapter=ADAPTER, allow_vlm=False)


def frame_of(card: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Uma carta na mão, parada na frente da câmera: mesa ao fundo, leve ângulo, ruído de câmera."""
    W, H = 1280, 720
    canvas = synth.table_texture(W, H, rng)
    quad = synth.quad_for((W / 2, H / 2), H * 0.82, float(rng.normal(0, 4)),
                          tilt=np.float32([[0.004, 0.006], [-0.006, 0.004], [-0.004, -0.006], [0.006, -0.004]]))
    synth.paste(canvas, synth.card_rgba(card), quad)
    return synth.camera(canvas, rng, blur=0.6, noise=2.5, jpeg=88)


def measure(bucket: str, where: str, n: int, rng: np.random.Generator) -> list[dict]:
    rows = []
    for card_ref_id, name, oracle_id in pick(where, n):
        try:
            img = synth.card_image(card_ref_id)
        except Exception as e:  # noqa: BLE001 — carta sem imagem não invalida a medição
            print(f"  ! {name}: {e}")
            continue
        frame = frame_of(img, rng)
        q = detect.detect_primary_card(frame)
        if q is None:
            rows.append({"name": name, "detected": False, "score": None})
            continue
        warped = detect.warp_card(frame, q.pts)
        r = read(warped)
        rows.append({"name": name, "detected": True, **cardness.cardness(warped), "status": r.status,
                     "right": r.oracle_id == oracle_id, "conf": round(r.confidence, 2)})
    return rows


def background(n: int, rng: np.random.Generator) -> list[dict]:
    """Recortes com proporção de carta tirados da mesa: a identificação precisa recusar todos."""
    out = []
    for i in range(n):
        W, H = 1280, 720
        canvas = synth.camera(synth.table_texture(W, H, rng, "wood" if i % 2 else "felt"), rng, blur=0.6)
        ch = int(H * 0.8)
        cw = int(ch * 63 / 88)
        x = int(rng.integers(0, W - cw))
        pts = np.float32([[x, 40], [x + cw, 40], [x + cw, 40 + ch], [x, 40 + ch]])
        warped = detect.warp_card(canvas, pts)
        r = read(warped)
        out.append({**cardness.cardness(warped), "status": r.status, "conf": round(r.confidence, 2)})
    return out


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    rng = np.random.default_rng(7)
    out: dict[str, list] = {}
    for bucket, where in BUCKETS.items():
        rows = measure(bucket, where, n, rng)
        out[bucket] = rows
        scores = sorted(r["score"] for r in rows if r.get("score") is not None)
        print(f"\n{bucket}: {len(rows)} cartas, não detectadas {sum(1 for r in rows if not r['detected'])}")
        if scores:
            print(f"  score: min {scores[0]:.2f} · mediana {scores[len(scores) // 2]:.2f} · max {scores[-1]:.2f}"
                  f" · abaixo de 0,50: {sum(1 for s in scores if s < 0.5)} · abaixo de 0,70: {sum(1 for s in scores if s < 0.7)}")
        ok = [r for r in rows if r.get("status") == "identified" and r.get("right")]
        print(f"  identificadas certo: {len(ok)}/{len(rows)}")
        for r in sorted(rows, key=lambda r: (r.get("score") is None, r.get("score") or 0)):
            state = "não detectada" if not r["detected"] else (
                f"score {r['score']:.2f} (layout {r['layout']:.2f} texto {r['text']:.2f}) · {r['status']}"
                f"{'' if r['right'] else ' ERRADA'} {r['conf']:.2f}")
            print(f"  {r['name'][:40]:40} {state}")
    bg = background(40, rng)
    fooled = [b for b in bg if b["status"] == "identified"]
    print(f"\nmesa: {len(bg)} recortes · identificados como carta: {len(fooled)}"
          f" · score mediano {sorted(b['score'] for b in bg)[len(bg) // 2]:.2f}")
    out["mesa"] = bg
    with open(config.DATA_DIR / "fullart_eval.json", "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
