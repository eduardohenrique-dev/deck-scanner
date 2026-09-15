"""Conferência de deck (fluxo reverso): a lista já está salva e o baralho físico é escaneado para comparar.

Saída: cartas faltando, cartas sobrando e cartas trocadas — impressão/idioma/acabamento diferente da lista,
e pares prováveis de "saiu uma, entrou outra" (mesmo tipo e mesmo custo).
"""
from __future__ import annotations

from collections import Counter, defaultdict

from ..games import registry
from ..games.mtg.exporters import type_group
from ..pipeline import deck as deck_pipeline
from ..pipeline import store
from . import decks as saved_decks

EXCLUDED_ZONES = ("maybeboard",)


def _expected(target: dict) -> list[dict]:
    return [e for e in store.entries(target["id"]) if e["quantity"] > 0 and e["zone"] not in EXCLUDED_ZONES]


def _scanned(session: dict) -> list[dict]:
    dets = store.detections(session["id"])
    return deck_pipeline.representatives(dets)


def result(session: dict) -> dict:
    target = store.get_deck(session.get("target_deck_id") or "")
    if target is None:
        return {"available": False, "reason": "o deck conferido não existe mais"}
    adapter = registry.get(target["game_id"])
    default_lang = (session.get("settings") or {}).get("default_language", "en")
    expected = _expected(target)
    scanned = _scanned(session)

    exp_qty: Counter = Counter()
    exp_prints: dict[str, Counter] = defaultdict(Counter)
    ref_for: dict[str, str] = {}
    for e in expected:
        key = e["oracle_id"] or e["card_ref_id"]
        exp_qty[key] += e["quantity"]
        exp_prints[key][(e["card_ref_id"], e["language"] or default_lang, e["finish"] or "nonfoil")] += e["quantity"]
        ref_for.setdefault(key, e["card_ref_id"])
    scan_qty: Counter = Counter()
    scan_prints: dict[str, Counter] = defaultdict(Counter)
    det_ids: dict[str, list[str]] = defaultdict(list)
    for d in scanned:
        key = d["oracle_id"] or d["card_ref_id"]
        scan_qty[key] += 1
        scan_prints[key][(d["card_ref_id"], d.get("language") or default_lang, d.get("finish") or "nonfoil")] += 1
        det_ids[key].append(d["id"])
        ref_for.setdefault(key, d["card_ref_id"])

    summaries = adapter.card_summaries(list(ref_for.values()))
    fields = adapter.card_fields_many(list(ref_for.values()))

    def card(key: str) -> dict:
        s = summaries.get(ref_for[key]) or {}
        return {"oracle_id": key, "card_ref_id": ref_for[key], "name": s.get("name_en"), "name_pt": s.get("name_pt"),
                "image_small": s.get("image_small"), "type_group": type_group(s.get("front_type_line") or ""),
                "cmc": (fields.get(ref_for[key]) or {}).get("cmc")}

    missing, extra, swapped = [], [], []
    ok = 0
    for key in sorted(set(exp_qty) | set(scan_qty), key=lambda k: card(k)["name"] or ""):
        e_n, s_n = exp_qty[key], scan_qty[key]
        matched = min(e_n, s_n)
        ok += matched
        if e_n > s_n:
            missing.append({**card(key), "quantity": e_n - s_n, "expected": e_n, "scanned": s_n})
        if s_n > e_n:
            extra.append({**card(key), "quantity": s_n - e_n, "expected": e_n, "scanned": s_n,
                          "detection_ids": det_ids[key][e_n:] if e_n else det_ids[key]})
        if matched:
            common = sum((exp_prints[key] & scan_prints[key]).values())
            diff_n = matched - common
            if diff_n > 0:
                swapped.append({**card(key), "quantity": diff_n, "kind": "print",
                                "expected_prints": _prints(exp_prints[key] - scan_prints[key], summaries),
                                "scanned_prints": _prints(scan_prints[key] - exp_prints[key], summaries)})

    # "saiu uma, entrou outra": mesmo grupo de tipo e custo de mana próximo
    pairs = []
    used_extra: set[str] = set()
    for m in missing:
        best = None
        for x in extra:
            if x["oracle_id"] in used_extra or x["type_group"] != m["type_group"]:
                continue
            gap = abs((x["cmc"] or 0) - (m["cmc"] or 0))
            if gap <= 1 and (best is None or gap < best[0]):
                best = (gap, x)
        if best:
            used_extra.add(best[1]["oracle_id"])
            pairs.append({"out": m, "in": best[1]})

    return {
        "available": True,
        "deck": {"id": target["id"], "name": target["name"], "format_id": target["format_id"]},
        "summary": {"expected": sum(exp_qty.values()), "scanned": sum(scan_qty.values()), "ok": ok,
                    "missing": sum(m["quantity"] for m in missing), "extra": sum(x["quantity"] for x in extra),
                    "swapped": sum(s["quantity"] for s in swapped)},
        "missing": missing, "extra": extra, "swapped": swapped, "likely_swaps": pairs,
        "matches": not missing and not extra,
    }


def _prints(counter: Counter, summaries: dict) -> list[dict]:
    out = []
    for (ref, lang, finish), n in counter.items():
        s = summaries.get(ref) or {}
        out.append({"card_ref_id": ref, "language": lang, "finish": finish, "quantity": n,
                    "set_code": s.get("set_code"), "collector_number": s.get("collector_number")})
    return out


def apply_scan_to_list(session: dict) -> dict:
    """Atualiza a lista do deck salvo com o que foi escaneado (guarda a versão anterior no histórico)."""
    target = store.get_deck(session["target_deck_id"])
    if not saved_decks.list_snapshots(target["id"]):
        saved_decks.snapshot(target, "manual", note="lista antes da conferência")
    scanned_entries = saved_decks.entries_for_copy(session["deck_id"])
    commanders = {e["oracle_id"] for e in store.entries(target["id"]) if e["is_commander"]}
    for e in scanned_entries:
        if e["oracle_id"] in commanders:
            e["is_commander"], e["zone"] = True, "commander"
    saved_decks.replace_entries(target["id"], scanned_entries)
    deck_pipeline.validate_deck(store.get_deck(target["id"]))
    snap = saved_decks.snapshot(store.get_deck(target["id"]), "check", session_id=session["id"])
    store.update_session(session["id"], status="saved", saved_deck_id=target["id"], saved_at=snap["created_at"])
    return {"deck_id": target["id"], "snapshot_id": snap["id"]}
