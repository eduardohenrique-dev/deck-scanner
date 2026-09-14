"""Utilitários de teste: montam entradas do motor de regras a partir de nomes reais do catálogo."""
from __future__ import annotations

from app.games import registry
from app.rules import engine
from app.rules.messages import load_messages


def ref_for(name: str, lang: str | None = None, set_code: str | None = None) -> tuple[str, str]:
    adapter = registry.get("mtg")
    oracle = adapter._oracle_by_name(name)
    assert oracle, f"carta não encontrada no catálogo: {name}"
    ref = adapter._best_print(oracle, set_code, lang)
    assert ref, f"sem impressão para {name}"
    return ref["id"], oracle


def evaluate(format_id: str, spec: list[tuple]) -> tuple[dict, dict[str, str]]:
    """spec: (nome, qtd_detectada[, zona[, comandante[, idioma[, override]]]])."""
    adapter = registry.get("mtg")
    entries, cards, ids = [], {}, {}
    for i, item in enumerate(spec):
        name, qty = item[0], item[1]
        zone = item[2] if len(item) > 2 else "deck"
        is_cmd = item[3] if len(item) > 3 else False
        lang = item[4] if len(item) > 4 else None
        override = item[5] if len(item) > 5 else None
        ref_id, oracle = ref_for(name, lang)
        cards[ref_id] = adapter.card_fields(ref_id)
        entry_id = f"e{i}"
        ids[f"{name}|{lang or ''}|{zone}"] = entry_id
        entries.append(engine.EngineEntry(id=entry_id, card_ref_id=ref_id, key=oracle, zone=zone,
                                          quantity_detected=qty, quantity_override=override,
                                          is_commander=is_cmd, position=i))
    report = engine.evaluate(adapter.format(format_id), entries, cards, game_meta=adapter.game_meta(),
                             messages=load_messages(), suggestion_providers=adapter.suggestion_providers())
    return report, ids
