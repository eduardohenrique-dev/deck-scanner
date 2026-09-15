"""Salvar o resultado de um scan: vira deck (novo ou atualização) e/ou entra na coleção física.

Antes de salvar, a prévia mostra cartas que o usuário JÁ TEM em outro lugar: pode ser a mesma carta
física que foi mudada de lugar (mover) ou outra cópia (nova). O padrão é "nova cópia" — contar duas vezes
irrita menos que apagar uma carta em silêncio — e a decisão fica visível para a pessoa.
"""
from __future__ import annotations

from collections import defaultdict

from .. import db
from ..games import registry
from ..pipeline import deck as deck_pipeline
from ..pipeline import store
from . import decks as saved_decks
from . import inventory, locations


def _reps(session: dict) -> list[dict]:
    return deck_pipeline.representatives(store.detections(session["id"]))


def preview(session: dict, target_deck_id: str | None = None, location_id: str | None = None) -> dict:
    adapter = registry.get(session["game_id"])
    reps = _reps(session)
    by_oracle: dict[str, list[dict]] = defaultdict(list)
    for d in reps:
        by_oracle[d["oracle_id"]].append(d)
    copies = inventory.copies_by_oracle(session["user_id"], session["game_id"], list(by_oracle))
    target_loc = None
    if target_deck_id:
        target_loc = locations.of_deck(target_deck_id)
    elif location_id:
        target_loc = locations.get(location_id)
    summaries = adapter.card_summaries([d["card_ref_id"] for d in reps])
    elsewhere, already_here = [], []
    for oracle, dets in by_oracle.items():
        cps = copies.get(oracle, [])
        here = [c for c in cps if target_loc and c["location_id"] == target_loc["id"]]
        others = [c for c in cps if not (target_loc and c["location_id"] == target_loc["id"])]
        s = summaries.get(dets[0]["card_ref_id"]) or {}
        name = s.get("name_pt") or s.get("name_en")
        if here:
            already_here.append({"oracle_id": oracle, "name": name, "scanned": len(dets), "in_target": len(here)})
        if others:
            elsewhere.append({
                "oracle_id": oracle, "name": name, "card_ref_id": dets[0]["card_ref_id"],
                "detection_ids": [d["id"] for d in dets],
                "copies": [{"id": c["id"], "card_ref_id": c["card_ref_id"], "language": c.get("language"),
                            "finish": c.get("finish"), "location_id": c["location_id"],
                            "location_name": c.get("location_name"), "location_type": c.get("location_type"),
                            "same_print": c["card_ref_id"] == dets[0]["card_ref_id"]} for c in others],
            })
    missing_here = []
    if target_loc:
        scanned = {o: len(v) for o, v in by_oracle.items()}
        for c in inventory.in_location(target_loc["id"]):
            scanned_n = scanned.get(c["oracle_id"], 0)
            if scanned_n > 0:
                scanned[c["oracle_id"]] = scanned_n - 1
            else:
                missing_here.append(c)
    return {"physical_cards": len(reps), "elsewhere": elsewhere, "already_here": already_here,
            "not_scanned_in_target": [{"id": c["id"], "card_ref_id": c["card_ref_id"], "oracle_id": c["oracle_id"]}
                                      for c in missing_here]}


def save(session: dict, *, target: str, deck_name: str | None = None, deck_id: str | None = None,
         location_id: str | None = None, add_to_collection: bool = True, moves: dict[str, str] | None = None,
         unscanned_action: str = "keep") -> dict:
    """target: new_deck | existing_deck | collection."""
    moves = moves or {}
    user_id, game_id = session["user_id"], session["game_id"]
    draft = store.get_deck(session["deck_id"])
    deck_pipeline.validate_deck(draft)
    deck = None
    if target == "new_deck":
        deck = saved_decks.create(user_id, game_id, session["format_id"], deck_name or session.get("name") or "Deck escaneado")
        saved_decks.replace_entries(deck["id"], saved_decks.entries_for_copy(draft["id"]))
    elif target == "existing_deck":
        deck = store.get_deck(deck_id or "")
        if deck is None or deck["user_id"] != user_id or deck["kind"] != "deck":
            raise KeyError("deck não encontrado")
        if not saved_decks.list_snapshots(deck["id"]):
            saved_decks.snapshot(deck, "manual", note="lista antes do scan")
        saved_decks.replace_entries(deck["id"], saved_decks.entries_for_copy(draft["id"]))
        if session["format_id"] != deck["format_id"]:
            saved_decks.update(deck["id"], format_id=session["format_id"])
    elif target != "collection":
        raise ValueError("destino inválido")

    snapshot = None
    if deck is not None:
        deck = store.get_deck(deck["id"])
        deck_pipeline.validate_deck(deck)
        snapshot = saved_decks.snapshot(deck, "scan", session_id=session["id"])

    created = moved = matched = released = 0
    if add_to_collection:
        if deck is not None:
            loc = locations.for_deck(deck)
        elif location_id:
            loc = locations.get(location_id)
            if loc is None or loc["user_id"] != user_id:
                raise KeyError("local não encontrado")
        else:
            loc = locations.ensure_loose(user_id, game_id)
        reps = _reps(session)
        in_target = inventory.in_location(loc["id"])
        pool: dict[str, list[dict]] = defaultdict(list)  # cópias que já estão no destino, por carta
        for c in in_target:
            pool[c["oracle_id"]].append(c)
        new_items, move_ids = [], []
        for d in sorted(reps, key=lambda x: x["seq"]):
            chosen = moves.get(d["id"])
            if chosen:
                card = inventory.get(chosen)
                if card and card["user_id"] == user_id and card["oracle_id"] == d["oracle_id"]:
                    move_ids.append(card["id"])
                    continue
            same = pool.get(d["oracle_id"])
            if same:  # re-scan do mesmo deck: a carta física já está registrada aqui
                same.sort(key=lambda c: c["card_ref_id"] != d["card_ref_id"])
                same.pop(0)
                matched += 1
                continue
            cond = d.get("condition") or {}
            new_items.append({
                "card_ref_id": d["card_ref_id"], "oracle_id": d["oracle_id"], "language": d.get("language"),
                "finish": d.get("finish"), "condition": cond.get("grade") if cond.get("confidence", 0) >= 0.5 else None,
                "condition_source": "estimate" if cond.get("grade") and cond.get("confidence", 0) >= 0.5 else None,
                "source_session_id": session["id"], "source_detection_id": d["id"]})
        created = len(inventory.add_cards(user_id, game_id, new_items, loc["id"]))
        moved = inventory.move(user_id, move_ids, loc["id"])
        if unscanned_action == "loose" and deck is not None:
            leftovers = [c["id"] for cards in pool.values() for c in cards]
            loose = locations.ensure_loose(user_id, game_id)
            released = inventory.move(user_id, leftovers, loose["id"])

    store.update_session(session["id"], status="saved", saved_deck_id=deck["id"] if deck else None,
                         saved_at=db.now_iso())
    return {"deck_id": deck["id"] if deck else None, "snapshot_id": snapshot["id"] if snapshot else None,
            "created": created, "moved": moved, "matched": matched, "released": released}
