"""GameAdapter do Magic: The Gathering (dados da Scryfall)."""
from __future__ import annotations

import re
import threading
import unicodedata
from collections import OrderedDict

from ... import db
from ..base import GameAdapter, RawCard, ResolvedCard
from . import exporters, manabase
from .scryfall_api import client as scryfall, upsert_card

FTS_TOKEN = re.compile(r"\w+", re.UNICODE)
SUMMARY_SQL = (
    "SELECT r.*, o.names_i18n, o.name_en AS oracle_name, o.type_line AS oracle_type_line "
    "FROM card_refs r LEFT JOIN oracle_cards o ON o.oracle_id = r.oracle_id WHERE r.id {cond}")
FIELDS_SQL = (
    "SELECT r.id, r.oracle_id, r.name_en, r.lang, r.printed_name, r.set_code, r.collector_number, r.layout, r.kind, "
    "o.type_line, o.oracle_text, o.mana_cost, o.cmc, o.colors, o.color_identity, o.produced_mana, o.keywords, "
    "o.legalities, o.faces, o.game_changer, o.names_i18n, o.name_en AS oracle_name "
    "FROM card_refs r LEFT JOIN oracle_cards o ON o.oracle_id = r.oracle_id WHERE r.id {cond}")


def strip_accents(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()


def normalize_name(text: str) -> str:
    return " ".join(FTS_TOKEN.findall(strip_accents(text).casefold()))


def normalize_collector_number(value: str | None) -> str | None:
    """'0240', '240/281', ' 240 ' → '240' (mantém sufixos como 'a', '★', 'p')."""
    if not value:
        return None
    v = str(value).strip().split("/")[0].strip()
    m = re.match(r"^0*(\d+)(.*)$", v)
    if m:
        return (m.group(1) or "0") + m.group(2).strip()
    return v or None


class _Lru(OrderedDict):
    def __init__(self, size: int):
        super().__init__()
        self.size = size
        self.lock = threading.Lock()

    def get_hit(self, key):
        with self.lock:
            if key in self:
                self.move_to_end(key)
                return super().__getitem__(key)
        return None

    def put(self, key, value) -> None:
        with self.lock:
            self[key] = value
            self.move_to_end(key)
            while len(self) > self.size:
                self.popitem(last=False)


class MtgAdapter(GameAdapter):
    id = "mtg"
    name = "Magic: The Gathering"

    def __init__(self, rules_dir, manifest):
        super().__init__(rules_dir, manifest)
        self._fields_cache = _Lru(20000)
        self._summary_cache = _Lru(20000)

    # ------------------------------------------------------------------ resolução canônica
    def resolve_card(self, raw: RawCard) -> ResolvedCard | None:
        conn = db.catalog_db()
        lang = (raw.language or "").lower() or None
        if raw.card_ref_id:
            row = conn.execute("SELECT id, oracle_id, name_en, lang FROM card_refs WHERE id=?", (raw.card_ref_id,)).fetchone()
            if row is None:
                card = scryfall().card_by_id(raw.card_ref_id)
                if card:
                    upsert_card(card)
                    row = conn.execute("SELECT id, oracle_id, name_en, lang FROM card_refs WHERE id=?",
                                       (raw.card_ref_id,)).fetchone()
            if row:
                return ResolvedCard(row["id"], row["oracle_id"], row["name_en"], row["lang"], True, "id")

        set_code = (raw.set_code or "").strip().lower() or None
        number = normalize_collector_number(raw.collector_number)
        if set_code and number:
            # 1) catálogo local — set + número + idioma (mais preciso)
            for try_lang in [lang, "en"] if lang and lang != "en" else ["en"]:
                row = conn.execute(
                    "SELECT id, oracle_id, name_en, lang FROM card_refs WHERE set_code=? AND collector_number=? AND lang=?",
                    (set_code, number, try_lang)).fetchone()
                if row:
                    exact = try_lang == (lang or "en")
                    notes = [] if exact else [f"impressão em {lang} fora do catálogo local; usando a versão em inglês"]
                    if exact or not lang:
                        return ResolvedCard(row["id"], row["oracle_id"], row["name_en"], row["lang"], True, "set_number", notes)
                    # 2) API: /cards/{set}/{number}/{lang}
                    card = scryfall().card_by_set_number(set_code, number, lang)
                    if card:
                        upsert_card(card)
                        return ResolvedCard(card["id"], card.get("oracle_id"), card["name"], card.get("lang", lang),
                                            True, "api_set_number")
                    return ResolvedCard(row["id"], row["oracle_id"], row["name_en"], row["lang"], True, "set_number", notes)
            card = scryfall().card_by_set_number(set_code, number, lang)
            if card is None and lang:
                card = scryfall().card_by_set_number(set_code, number)
            if card:
                upsert_card(card)
                return ResolvedCard(card["id"], card.get("oracle_id") or "", card["name"], card.get("lang", "en"),
                                    True, "api_set_number")

        for name in [raw.name, raw.printed_name]:
            if not name:
                continue
            oracle = self._oracle_by_name(name)
            if oracle:
                ref = self._best_print(oracle, set_code, lang)
                if ref:
                    return ResolvedCard(ref["id"], oracle, ref["name_en"], ref["lang"], False, "name")
        fuzzy_name = raw.name or raw.printed_name
        if fuzzy_name:
            card = scryfall().named_fuzzy(fuzzy_name, set_code)
            if card is None and set_code:
                card = scryfall().named_fuzzy(fuzzy_name)
            if card:
                upsert_card(card)
                ref = self._best_print(card.get("oracle_id"), set_code, lang) if card.get("oracle_id") else None
                if ref:
                    return ResolvedCard(ref["id"], card.get("oracle_id"), ref["name_en"], ref["lang"], False, "api_fuzzy")
                return ResolvedCard(card["id"], card.get("oracle_id"), card["name"], card.get("lang", "en"), False, "api_fuzzy")
        return None

    def _oracle_by_name(self, name: str) -> str | None:
        conn = db.catalog_db()
        clean = name.strip()
        row = conn.execute("SELECT oracle_id FROM oracle_cards WHERE lower(name_en) = lower(?)", (clean,)).fetchone()
        if row:
            return row["oracle_id"]
        row = conn.execute("SELECT oracle_id FROM card_names WHERE lower(name) = lower(?) LIMIT 1", (clean,)).fetchone()
        if row:
            return row["oracle_id"]
        norm = normalize_name(clean)
        if not norm:
            return None
        if conn.dialect == "postgres":
            row = conn.execute("SELECT oracle_id FROM card_names WHERE name_norm = ? LIMIT 1", (norm,)).fetchone()
            return row["oracle_id"] if row else None
        query = " ".join(f'"{t}"' for t in norm.split())
        rows = conn.execute(
            "SELECT n.oracle_id, n.name FROM card_names_fts f JOIN card_names n ON n.rowid = f.rowid "
            "WHERE card_names_fts MATCH ? LIMIT 20", (query,)).fetchall()
        for r in rows:
            if normalize_name(r["name"]) == norm:
                return r["oracle_id"]
        return None

    def _best_print(self, oracle_id: str, set_code: str | None, lang: str | None) -> dict | None:
        order_sql: list[str] = []
        order_params: list = []
        if lang:
            order_sql.append("CASE WHEN r.lang = ? THEN 0 ELSE 1 END")
            order_params.append(lang)
        if set_code:
            order_sql.append("CASE WHEN r.set_code = ? THEN 0 ELSE 1 END")
            order_params.append(set_code)
        order_sql += ["CASE WHEN r.lang = 'en' THEN 0 ELSE 1 END",
                      "CASE WHEN r.id = o.default_ref_id THEN 0 ELSE 1 END"]
        sql = (f"SELECT r.id, r.name_en, r.lang FROM card_refs r JOIN oracle_cards o ON o.oracle_id = r.oracle_id "
               f"WHERE r.oracle_id = ? ORDER BY {', '.join(order_sql)}, r.released_at DESC LIMIT 1")
        row = db.catalog_db().execute(sql, [oracle_id] + order_params).fetchone()
        return db.row_to_dict(row) if row else None

    # ------------------------------------------------------------------ dados para regras e UI
    @staticmethod
    def _fields_from_row(r) -> dict:
        faces = db.loads(r["faces"], None) or []
        front = faces[0] if faces else {}
        names_i18n = db.loads(r["names_i18n"], {}) or {}
        return {
            "id": r["id"],
            "key": r["oracle_id"],
            "name": r["oracle_name"] or r["name_en"],
            "face_names": [f.get("name") for f in faces if f.get("name")],
            "display_name": names_i18n.get("pt") or (front.get("name") if faces else None) or r["name_en"],
            "type_line": r["type_line"] or "",
            "front_type_line": front.get("type_line") or r["type_line"] or "",
            "oracle_text": r["oracle_text"] or "",
            "mana_cost": front.get("mana_cost") if faces else (r["mana_cost"] or ""),
            "cmc": r["cmc"] or 0,
            "colors": db.loads(r["colors"], []),
            "color_identity": db.loads(r["color_identity"], []),
            "produced_mana": db.loads(r["produced_mana"], []),
            "keywords": db.loads(r["keywords"], []),
            "legalities": db.loads(r["legalities"], {}),
            "kind": r["kind"],
            "layout": r["layout"],
            "game_changer": bool(r["game_changer"]),
        }

    def card_fields(self, card_ref_id: str) -> dict | None:
        return self.card_fields_many([card_ref_id]).get(card_ref_id)

    def card_fields_many(self, ids) -> dict[str, dict]:
        out: dict[str, dict] = {}
        missing = []
        for i in dict.fromkeys(i for i in ids if i):
            hit = self._fields_cache.get_hit(i)
            if hit is not None:
                out[i] = hit
            else:
                missing.append(i)
        for part in db.chunks(missing, 500):
            rows = db.catalog_db().execute(FIELDS_SQL.format(cond=f"IN ({db.placeholders(len(part))})"), list(part))
            for r in rows:
                fields = self._fields_from_row(r)
                self._fields_cache.put(r["id"], fields)
                out[r["id"]] = fields
        return out

    @staticmethod
    def _summary_from_row(r, lang: str = "pt") -> dict:
        faces = db.loads(r["faces"], None) or []
        names_i18n = db.loads(r["names_i18n"], {}) or {}
        prices = db.loads(r["prices"], {}) or {}
        front_name = faces[0]["name"] if faces and r["layout"] in exporters.FRONT_FACE_LAYOUTS else None
        return {
            "id": r["id"],
            "oracle_id": r["oracle_id"],
            "name_en": r["oracle_name"] or r["name_en"],
            "front_name_en": front_name,
            "name_pt": names_i18n.get("pt"),
            "name_display": (names_i18n.get(lang) if lang != "en" else None) or front_name or r["name_en"],
            "printed_name": r["printed_name"],
            "lang": r["lang"],
            "set_code": r["set_code"],
            "set_name": r["set_name"],
            "collector_number": r["collector_number"],
            "rarity": r["rarity"],
            "layout": r["layout"],
            "kind": r["kind"],
            "type_line": r["type_line"],
            "front_type_line": (faces[0].get("type_line") if faces else None) or r["type_line"],
            "mana_cost": r["mana_cost"],
            "color_identity": db.loads(r["color_identity"], []),
            "finishes": db.loads(r["finishes"], []),
            "games": db.loads(r["games"], []),
            "image_small": r["image_small"],
            "image_normal": r["image_normal"],
            "faces": [{"name": f.get("name"), "image_normal": f.get("image_normal")} for f in faces if f.get("image_normal")],
            "prices": {k: prices.get(k) for k in ("usd", "usd_foil", "usd_etched", "eur", "eur_foil")},
            "frame_effects": db.loads(r["frame_effects"], []),
            "border_color": r["border_color"],
            "full_art": bool(r["full_art"]),
            "promo": bool(r["promo"]),
            "artist": r["artist"],
            "illustration_id": r["illustration_id"],
            "released_at": r["released_at"],
            "game_changer": bool(r["game_changer"]),
        }

    def card_summary(self, card_ref_id: str, lang: str = "pt") -> dict | None:
        return self.card_summaries([card_ref_id], lang).get(card_ref_id)

    def card_summaries(self, ids, lang: str = "pt") -> dict[str, dict]:
        out: dict[str, dict] = {}
        missing = []
        for i in dict.fromkeys(i for i in ids if i):
            hit = self._summary_cache.get_hit((i, lang))
            if hit is not None:
                out[i] = hit
            else:
                missing.append(i)
        for part in db.chunks(missing, 500):
            rows = db.catalog_db().execute(SUMMARY_SQL.format(cond=f"IN ({db.placeholders(len(part))})"), list(part))
            for r in rows:
                s = self._summary_from_row(r, lang)
                self._summary_cache.put((r["id"], lang), s)
                out[r["id"]] = s
        return out

    def invalidate(self, card_ref_id: str) -> None:
        self._fields_cache.pop(card_ref_id, None)
        for key in [k for k in self._summary_cache if k[0] == card_ref_id]:
            self._summary_cache.pop(key, None)

    def search(self, query: str, lang: str = "pt", limit: int = 12) -> list[dict]:
        conn = db.catalog_db()
        norm = normalize_name(query)
        tokens = norm.split()
        if not tokens:
            return []
        if conn.dialect == "postgres":
            where = " AND ".join("n.name_norm LIKE ?" for _ in tokens)
            rows = conn.execute(
                "SELECT n.oracle_id, n.lang, n.name, o.name_en, o.default_ref_id, o.kind, "
                "-similarity(n.name_norm, ?) AS rank FROM card_names n JOIN oracle_cards o ON o.oracle_id = n.oracle_id "
                f"WHERE {where} ORDER BY rank LIMIT 300", [norm] + [f"%{t}%" for t in tokens]).fetchall()
        else:
            fts = " ".join(f'"{t}"*' for t in tokens)
            rows = conn.execute(
                "SELECT n.oracle_id, n.lang, n.name, o.name_en, o.default_ref_id, o.kind, bm25(card_names_fts) AS rank "
                "FROM card_names_fts f JOIN card_names n ON n.rowid = f.rowid "
                "JOIN oracle_cards o ON o.oracle_id = n.oracle_id "
                "WHERE card_names_fts MATCH ? ORDER BY rank LIMIT 300", (fts,)).fetchall()
        scored: dict[str, tuple] = {}
        for r in rows:
            name = normalize_name(r["name"])
            score = (0 if name == norm else 1 if name.startswith(norm) else 2,
                     0 if r["kind"] == "card" else 1,
                     0 if r["lang"] in (lang, "en") else 1,
                     len(r["name"]), r["rank"])
            best = scored.get(r["oracle_id"])
            if best is None or score < best[0]:
                scored[r["oracle_id"]] = (score, r)
        chosen = sorted(scored.values(), key=lambda x: x[0])[:limit]
        summaries = self.card_summaries([r["default_ref_id"] for _, r in chosen if r["default_ref_id"]], lang)
        out = []
        for _, r in chosen:
            summary = summaries.get(r["default_ref_id"])
            if summary:
                out.append({**summary, "matched_name": r["name"], "matched_lang": r["lang"]})
        return out

    def prints_of(self, oracle_id: str, limit: int = 80) -> list[dict]:
        rows = db.catalog_db().execute(
            "SELECT id FROM card_refs WHERE oracle_id=? ORDER BY CASE lang WHEN 'en' THEN 0 WHEN 'pt' THEN 1 ELSE 2 END, "
            "released_at DESC LIMIT ?", (oracle_id, limit)).fetchall()
        ids = [r["id"] for r in rows]
        summaries = self.card_summaries(ids)
        return [summaries[i] for i in ids if i in summaries]

    def basic_land_ref(self, color: str, prefer_set: str | None = None) -> str | None:
        name = manabase.BASIC_BY_COLOR.get(color)
        if not name:
            return None
        oracle = self._oracle_by_name(name)
        if not oracle:
            return None
        ref = self._best_print(oracle, prefer_set, "en")
        return ref["id"] if ref else None

    # ------------------------------------------------------------------ contrato GameAdapter
    def art_hash_source(self) -> dict:
        return {"provider": "scryfall", "bulk": "default_cards", "image": "small",
                "build_command": "python -m app.indexer hashes"}

    def export_formats(self) -> list[dict]:
        return exporters.EXPORTERS

    def export(self, export_id: str, entries: list[dict], options: dict) -> tuple[str, str, str]:
        opts = dict(options)
        opts.setdefault("arena_set_codes", self.data_file("arena_set_codes.json") or {})
        return exporters.export(export_id, entries, opts, deck_name=options.get("deck_name", "deck"))

    def identity_rules(self) -> dict:
        return self.game_meta()["identity"]

    def suggestion_providers(self) -> dict:
        return {"mtg_basic_lands": manabase.suggest_basic_lands}

    def suggestion_additions(self, suggestion_type: str, suggestion: dict) -> list[tuple[str, int]]:
        if suggestion_type != "mtg_basic_lands" or not suggestion.get("applicable"):
            return []
        out = []
        for c in suggestion.get("by_color", []):
            ref = self.basic_land_ref(c["color"])
            if ref and c.get("add", 0) > 0:
                out.append((ref, int(c["add"])))
        return out
