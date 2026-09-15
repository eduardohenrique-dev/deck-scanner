"""Alocação de cartas físicas em decks (inventário compartilhado entre decks).

Uma carta de papel está em um único lugar. Para cada carta da lista de um deck o sistema separa:
  - aqui: cópias que já estão neste deck;
  - para mover: cópias em pasta, caixa ou soltas (não precisa comprar, só buscar);
  - em outro deck: a cópia existe mas está montada em outro deck — pede decisão, não compra;
  - comprar: o usuário não tem cópia nenhuma disponível.
"""
from __future__ import annotations

from collections import defaultdict

from ..games import registry
from ..pipeline import store
from . import inventory, locations


class AllocationConflict(Exception):
    def __init__(self, message: str, card: dict, other_deck: dict | None):
        super().__init__(message)
        self.message = message
        self.card = card
        self.other_deck = other_deck


def _card_name(summaries: dict, card_ref_id: str) -> str:
    s = summaries.get(card_ref_id) or {}
    return s.get("name_pt") or s.get("name_en") or "carta"


def deck_report(deck: dict) -> dict:
    adapter = registry.get(deck["game_id"])
    loc = locations.of_deck(deck["id"])
    rows = [e for e in store.entries(deck["id"]) if e["quantity"] > 0 and e["zone"] != "maybeboard"]
    need: dict[str, int] = defaultdict(int)
    entry_by_oracle: dict[str, list[dict]] = defaultdict(list)
    for e in rows:
        key = e["oracle_id"] or e["card_ref_id"]
        need[key] += e["quantity"]
        entry_by_oracle[key].append(e)
    copies = inventory.copies_by_oracle(deck["user_id"], deck["game_id"], list(need))
    summaries = adapter.card_summaries([e["card_ref_id"] for e in rows])
    in_location = inventory.in_location(loc["id"]) if loc else []
    kept_ids: set[str] = set()
    items = []
    totals = {"needed": 0, "here": 0, "move": 0, "conflict": 0, "buy": 0}
    for key, qty in need.items():
        cps = copies.get(key, [])
        here = [c for c in cps if loc and c["location_id"] == loc["id"]]
        kept_ids.update(c["id"] for c in here[:qty])
        others = [c for c in cps if not (loc and c["location_id"] == loc["id"])]
        available = [c for c in others if c.get("location_type") != "deck"]
        in_decks = [c for c in others if c.get("location_type") == "deck"]
        missing = max(0, qty - len(here))
        move = min(missing, len(available))
        conflict = min(missing - move, len(in_decks))
        buy = missing - move - conflict
        entry = entry_by_oracle[key][0]
        name = _card_name(summaries, entry["card_ref_id"])
        warnings = []
        for c in in_decks[:conflict]:
            warnings.append(f"este {name} já está alocado no deck {c.get('location_name') or 'outro deck'}")
        status = "ok" if missing == 0 else "move" if buy == 0 and conflict == 0 else "conflict" if buy == 0 else "buy"
        items.append({
            "oracle_id": key, "entry_ids": [e["id"] for e in entry_by_oracle[key]], "card_ref_id": entry["card_ref_id"],
            "name": name, "name_en": (summaries.get(entry["card_ref_id"]) or {}).get("name_en"),
            "needed": qty, "here": len(here), "move": move, "conflict": conflict, "buy": buy,
            "status": status, "warnings": warnings,
            "here_ids": [c["id"] for c in here],
            "available": [_copy_public(c) for c in available],
            "in_other_decks": [_copy_public(c) for c in in_decks],
        })
        totals["needed"] += qty
        totals["here"] += min(qty, len(here))
        totals["move"] += move
        totals["conflict"] += conflict
        totals["buy"] += buy
    # sobra: cartas no deck que não estão na lista, ou cópias além da quantidade da lista
    extra = [c for c in in_location if c["id"] not in kept_ids]
    order = {"conflict": 0, "buy": 1, "move": 2, "ok": 3}
    items.sort(key=lambda x: (order[x["status"]], x["name"]))
    return {"deck_id": deck["id"], "location_id": loc["id"] if loc else None, "items": items, "totals": totals,
            "extra": [_copy_public(c) for c in extra],
            "complete": totals["here"] == totals["needed"]}


def _copy_public(c: dict) -> dict:
    return {"id": c["id"], "card_ref_id": c["card_ref_id"], "language": c.get("language"), "finish": c.get("finish"),
            "condition": c.get("condition"), "location_id": c.get("location_id"),
            "location_name": c.get("location_name"), "location_type": c.get("location_type"),
            "deck_id": c.get("location_deck_id")}


def allocate(deck: dict, physical_card_id: str, force: bool = False) -> dict:
    """Coloca uma carta física neste deck. Se ela estiver montada em OUTRO deck, exige confirmação."""
    card = inventory.get(physical_card_id)
    if card is None or card["user_id"] != deck["user_id"]:
        raise KeyError("carta física não encontrada")
    loc = locations.for_deck(deck)
    if card["location_id"] == loc["id"]:
        return {"moved": False, "card_id": card["id"]}
    current = locations.get(card["location_id"]) if card.get("location_id") else None
    if current and current["type"] == "deck" and not force:
        other = store.get_deck(current["deck_id"]) if current.get("deck_id") else None
        summary = registry.get(deck["game_id"]).card_summary(card["card_ref_id"]) or {}
        name = summary.get("name_pt") or summary.get("name_en") or "carta"
        raise AllocationConflict(f"este {name} já está alocado no deck {other['name'] if other else current['name']}",
                                 card, other)
    inventory.move(deck["user_id"], [card["id"]], loc["id"])
    return {"moved": True, "card_id": card["id"], "from": current["name"] if current else None}


def auto_allocate(deck: dict) -> dict:
    """Busca em pastas, caixas e cartas soltas o que falta neste deck. Nunca tira carta de outro deck."""
    report = deck_report(deck)
    loc = locations.for_deck(deck)
    moved = []
    for it in report["items"]:
        take = it["move"]
        if take <= 0:
            continue
        chosen = sorted(it["available"], key=lambda c: (c["card_ref_id"] != it["card_ref_id"], c["location_type"] != "loose"))
        ids = [c["id"] for c in chosen[:take]]
        inventory.move(deck["user_id"], ids, loc["id"])
        moved += ids
    return {"moved": len(moved)}


def release_extra(deck: dict) -> dict:
    """Cartas físicas no deck que não estão na lista voltam para 'Solto'."""
    report = deck_report(deck)
    loose = locations.ensure_loose(deck["user_id"], deck["game_id"])
    ids = [c["id"] for c in report["extra"]]
    inventory.move(deck["user_id"], ids, loose["id"])
    return {"moved": len(ids)}


def owned_elsewhere_warnings(user_id: str, game_id: str, deck_id: str | None, oracle_ids: list[str]) -> dict[str, list[str]]:
    """Para uma lista em montagem (ex.: resultado de scan): quais cartas já estão alocadas em decks salvos."""
    copies = inventory.copies_by_oracle(user_id, game_id, oracle_ids)
    out: dict[str, list[str]] = {}
    for oracle, cps in copies.items():
        decks = sorted({c.get("location_name") for c in cps
                        if c.get("location_type") == "deck" and c.get("location_deck_id") != deck_id and c.get("location_name")})
        if decks:
            out[oracle] = decks
    return out
