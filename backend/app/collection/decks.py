"""Decks salvos: criação, cópia de listas, versões (snapshots), diff entre versões e importação de texto."""
from __future__ import annotations

from collections import Counter, defaultdict

from .. import db
from ..games import registry
from ..games.base import RawCard
from ..games.mtg import importers
from ..pipeline import store
from . import inventory, locations, prints

COUNTED_ZONES = ("commander", "deck", "sideboard")


def create(user_id: str, game_id: str, format_id: str, name: str | None, description: str | None = None) -> dict:
    registry.get(game_id).format(format_id)
    did, now = db.new_id(), db.now_iso()
    db.app_db().execute(
        "INSERT INTO decks (id, user_id, game_id, format_id, name, kind, description, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)", (did, user_id, game_id, format_id, (name or "Deck sem nome").strip()[:120], "deck",
                                       description, now, now))
    return store.get_deck(did)


def touch(deck_id: str) -> None:
    db.app_db().execute("UPDATE decks SET updated_at=? WHERE id=?", (db.now_iso(), deck_id))


def update(deck_id: str, **fields) -> None:
    fields = {k: v for k, v in fields.items() if k in ("name", "format_id", "description", "cover_card_ref_id")}
    if not fields:
        return
    fields["updated_at"] = db.now_iso()
    cols = ", ".join(f"{k}=?" for k in fields)
    db.app_db().execute(f"UPDATE decks SET {cols} WHERE id=?", (*fields.values(), deck_id))
    if "name" in fields:
        db.app_db().execute("UPDATE locations SET name=? WHERE deck_id=?", (fields["name"], deck_id))


def list_for_user(user_id: str, game_id: str | None = None) -> list[dict]:
    sql = ("SELECT d.*, (SELECT COALESCE(SUM(e.quantity),0) FROM deck_entries e WHERE e.deck_id = d.id "
           "AND e.zone <> 'maybeboard') AS card_count, "
           "(SELECT COUNT(*) FROM physical_cards p JOIN locations l ON l.id = p.location_id WHERE l.deck_id = d.id) "
           "AS physical_count, (SELECT MAX(s.created_at) FROM deck_snapshots s WHERE s.deck_id = d.id) AS last_snapshot "
           "FROM decks d WHERE d.user_id=? AND d.kind='deck'")
    params: list = [user_id]
    if game_id:
        sql += " AND d.game_id=?"
        params.append(game_id)
    sql += " ORDER BY d.updated_at DESC"
    return [db.row_to_dict(r) for r in db.app_db().execute(sql, params)]


def replace_entries(deck_id: str, entries: list[dict]) -> None:
    """Substitui a lista do deck; `entries` já vem com quantidades finais (salvas como ajuste manual)."""
    conn = db.app_db()
    with db.tx(conn):
        conn.execute("DELETE FROM deck_entries WHERE deck_id=?", (deck_id,))
        for pos, e in enumerate(entries, start=1):
            qty = int(e.get("quantity") or 0)
            if qty <= 0:
                continue
            store.insert_entry(deck_id, zone=e.get("zone") or "deck", card_ref_id=e["card_ref_id"],
                               oracle_id=e.get("oracle_id"), language=e.get("language") or "en",
                               finish=e.get("finish") or "nonfoil", quantity=qty, quantity_detected=0,
                               quantity_override=qty, is_commander=int(bool(e.get("is_commander"))), manual=1,
                               rule_warnings=[], allocated_physical_ids=[], position=e.get("position") or pos,
                               condition=e.get("condition"))
    touch(deck_id)


def entries_for_copy(deck_id: str) -> list[dict]:
    return [{k: e[k] for k in ("zone", "card_ref_id", "oracle_id", "language", "finish", "quantity", "is_commander",
                                "position", "condition")} for e in store.entries(deck_id) if e["quantity"] > 0]


# ------------------------------------------------------------------ versões e diff
def snapshot_entries(deck_id: str, game_id: str) -> list[dict]:
    rows = [e for e in store.entries(deck_id) if e["quantity"] > 0]
    summaries = registry.get(game_id).card_summaries([e["card_ref_id"] for e in rows])
    out = []
    for e in rows:
        s = summaries.get(e["card_ref_id"]) or {}
        out.append({"oracle_id": e["oracle_id"], "card_ref_id": e["card_ref_id"], "name": s.get("name_en"),
                    "name_pt": s.get("name_pt"), "set_code": s.get("set_code"), "collector_number": s.get("collector_number"),
                    "zone": e["zone"], "quantity": e["quantity"], "language": e["language"], "finish": e["finish"],
                    "is_commander": bool(e["is_commander"])})
    return out


def snapshot(deck: dict, source: str, session_id: str | None = None, note: str | None = None) -> dict:
    items = snapshot_entries(deck["id"], deck["game_id"])
    sid = db.new_id()
    count = sum(i["quantity"] for i in items if i["zone"] in COUNTED_ZONES)
    db.app_db().execute(
        "INSERT INTO deck_snapshots (id, deck_id, user_id, source, session_id, note, card_count, entries, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)", (sid, deck["id"], deck["user_id"], source, session_id, note, count, db.dumps(items),
                                       db.now_iso()))
    return get_snapshot(sid)


def get_snapshot(snapshot_id: str) -> dict | None:
    row = db.app_db().execute("SELECT * FROM deck_snapshots WHERE id=?", (snapshot_id,)).fetchone()
    return db.row_to_dict(row, ("entries",)) if row else None


def list_snapshots(deck_id: str) -> list[dict]:
    rows = db.app_db().execute(
        "SELECT id, deck_id, source, session_id, note, card_count, created_at FROM deck_snapshots WHERE deck_id=? "
        "ORDER BY created_at DESC", (deck_id,)).fetchall()
    return [db.row_to_dict(r) for r in rows]


def diff(old: list[dict], new: list[dict]) -> dict:
    """O que mudou entre duas listas (por carta, independente da impressão; troca de impressão aparte)."""
    def by_oracle(items):
        qty: Counter = Counter()
        prints: dict[str, Counter] = defaultdict(Counter)
        info: dict[str, dict] = {}
        for i in items:
            if i.get("zone") == "maybeboard":
                continue
            key = i.get("oracle_id") or i.get("card_ref_id")
            qty[key] += i["quantity"]
            prints[key][(i.get("card_ref_id"), i.get("language"), i.get("finish"))] += i["quantity"]
            info.setdefault(key, i)
        return qty, prints, info

    oq, op, oi = by_oracle(old)
    nq, np_, ni = by_oracle(new)
    added, removed, changed, reprinted = [], [], [], []
    for key in sorted(set(oq) | set(nq), key=lambda k: ((ni.get(k) or oi.get(k) or {}).get("name") or "")):
        base = ni.get(key) or oi.get(key)
        item = {"oracle_id": key, "name": base.get("name"), "name_pt": base.get("name_pt"),
                "card_ref_id": base.get("card_ref_id")}
        if key not in oq:
            added.append({**item, "quantity": nq[key]})
        elif key not in nq:
            removed.append({**item, "quantity": oq[key]})
        elif oq[key] != nq[key]:
            changed.append({**item, "before": oq[key], "after": nq[key], "delta": nq[key] - oq[key]})
        elif op[key] != np_[key]:
            reprinted.append({**item, "quantity": nq[key],
                              "before": [{"card_ref_id": k[0], "language": k[1], "finish": k[2], "quantity": v}
                                         for k, v in op[key].items()],
                              "after": [{"card_ref_id": k[0], "language": k[1], "finish": k[2], "quantity": v}
                                        for k, v in np_[key].items()]})
    return {"added": added, "removed": removed, "changed": changed, "reprinted": reprinted,
            "unchanged": sum(1 for k in set(oq) & set(nq) if oq[k] == nq[k] and op[k] == np_[k]),
            "count_before": sum(v for k, v in oq.items()), "count_after": sum(v for k, v in nq.items())}


# ------------------------------------------------------------------ importar texto
def import_text(deck: dict, text: str, replace: bool, default_language: str = "en") -> dict:
    adapter = registry.get(deck["game_id"])
    rule = adapter.format(deck["format_id"])
    zones = rule.get("zones") or ["deck"]
    parsed = importers.parse(text)
    resolved, unresolved, print_warnings = [], [], []
    for p in parsed:
        if p.set_code and p.collector_number:
            warning = prints.check(deck["game_id"], p.set_code, p.collector_number, None,
                                   p.finish if p.finish != "nonfoil" else None, p.name)
            if warning:
                print_warnings.append({"line": p.line_no, "text": p.raw.strip(), **warning})
        rc = adapter.resolve_card(RawCard(name=p.name, set_code=p.set_code, collector_number=p.collector_number,
                                          language=None))
        if rc is None:
            unresolved.append({"line": p.line_no, "text": p.raw.strip()})
            continue
        zone = p.zone if p.zone in zones else ("deck" if "deck" in zones else zones[0])
        resolved.append({"card_ref_id": rc.card_ref_id, "oracle_id": rc.oracle_id, "quantity": p.quantity, "zone": zone,
                         "language": rc.lang if rc.lang != "en" else default_language, "finish": p.finish,
                         "is_commander": p.is_commander and "commander" in zones})
    merged: dict[tuple, dict] = {}
    for r in resolved:
        key = (r["card_ref_id"], r["zone"], r["language"], r["finish"])
        if key in merged:
            merged[key]["quantity"] += r["quantity"]
        else:
            merged[key] = dict(r)
    items = list(merged.values())
    if not replace:
        items = entries_for_copy(deck["id"]) + items
    replace_entries(deck["id"], items)
    return {"imported": sum(r["quantity"] for r in resolved), "lines": len(parsed), "unresolved": unresolved,
            "print_warnings": print_warnings}


def delete(deck: dict) -> dict:
    """Apaga o deck; as cartas físicas dele vão para 'Solto' (nunca somem com o deck)."""
    loc = locations.of_deck(deck["id"])
    moved = 0
    conn = db.app_db()
    with db.tx(conn):
        if loc:
            loose = locations.ensure_loose(deck["user_id"], deck["game_id"])
            moved = conn.execute("UPDATE physical_cards SET location_id=?, updated_at=? WHERE location_id=?",
                                 (loose["id"], db.now_iso(), loc["id"])).rowcount
            conn.execute("DELETE FROM locations WHERE id=?", (loc["id"],))
        conn.execute("DELETE FROM deck_entries WHERE deck_id=?", (deck["id"],))
        conn.execute("DELETE FROM deck_snapshots WHERE deck_id=?", (deck["id"],))
        conn.execute("UPDATE scan_sessions SET saved_deck_id=NULL WHERE saved_deck_id=?", (deck["id"],))
        conn.execute("DELETE FROM decks WHERE id=?", (deck["id"],))
    return {"moved_to_loose": moved}


def physical_in_deck(deck_id: str) -> list[dict]:
    loc = locations.of_deck(deck_id)
    return inventory.in_location(loc["id"]) if loc else []
