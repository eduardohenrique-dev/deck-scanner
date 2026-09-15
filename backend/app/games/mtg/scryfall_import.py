"""Importa o bulk data da Scryfall (JSONL gzip) para o catálogo local (catalog.db)."""
from __future__ import annotations

import gzip
import re
import sys
import unicodedata
from pathlib import Path
from typing import Iterator

import httpx
import orjson

from ... import config, db

GAME_ID = "mtg"
BULK_ENDPOINT = f"{config.SCRYFALL_API}/bulk-data"
HEADERS = {"User-Agent": config.USER_AGENT, "Accept": "application/json;q=0.9,*/*;q=0.8"}

CARD_COLUMNS = (
    "id", "game_id", "oracle_id", "name_en", "printed_name", "lang", "set_code", "set_name", "set_type",
    "collector_number", "rarity", "released_at", "layout", "kind", "mana_cost", "cmc", "type_line",
    "oracle_text", "colors", "color_identity", "produced_mana", "keywords", "legalities", "finishes",
    "games", "frame", "frame_effects", "border_color", "full_art", "promo", "oversized", "artist",
    "illustration_id", "highres", "image_small", "image_normal", "image_large", "faces", "prices",
    "arena_id", "game_changer", "image_status",
)
UPSERT_CARD_SQL = (
    f"INSERT INTO card_refs ({', '.join(CARD_COLUMNS)}) VALUES ({', '.join('?' for _ in CARD_COLUMNS)}) "
    f"ON CONFLICT (id) DO UPDATE SET " + ", ".join(f"{c}=excluded.{c}" for c in CARD_COLUMNS if c != "id")
)
INSERT_CARD_SQL = UPSERT_CARD_SQL
INSERT_NAME_SQL = ("INSERT INTO card_names (game_id, oracle_id, lang, name, name_norm) VALUES (?,?,?,?,?) "
                   "ON CONFLICT DO NOTHING")
_TOKEN = re.compile(r"\w+", re.UNICODE)


def name_norm(text: str) -> str:
    plain = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return " ".join(_TOKEN.findall(plain.casefold()))


def log(msg: str) -> None:
    print(msg, flush=True, file=sys.stderr)


def bulk_info(kind: str) -> dict:
    r = httpx.get(BULK_ENDPOINT, headers=HEADERS, timeout=30)
    r.raise_for_status()
    for item in r.json()["data"]:
        if item["type"] == kind:
            return item
    raise RuntimeError(f"bulk '{kind}' não encontrado na Scryfall")


def ensure_bulk_file(kind: str, offline: bool = False) -> Path:
    """Garante o arquivo JSONL.gz mais recente do tipo pedido (baixa só se mudou)."""
    prefix = kind.replace("_", "-")
    existing = sorted(config.SCRYFALL_DIR.glob(f"{prefix}-*.jsonl.gz"))
    if offline and existing:
        return existing[-1]
    try:
        info = bulk_info(kind)
    except Exception as exc:  # sem rede: usa o que houver
        if existing:
            log(f"[bulk] sem acesso à Scryfall ({exc}); usando {existing[-1].name}")
            return existing[-1]
        raise
    uri = info["jsonl_download_uri"]
    target = config.SCRYFALL_DIR / uri.rsplit("/", 1)[-1]
    expected = info.get("compressed_size")
    if target.exists() and (expected is None or target.stat().st_size == expected):
        return target
    log(f"[bulk] baixando {uri}")
    tmp = target.with_suffix(".part")
    with httpx.stream("GET", uri, headers={"User-Agent": config.USER_AGENT}, timeout=None,
                      follow_redirects=True) as resp:
        resp.raise_for_status()
        with open(tmp, "wb") as fh:
            for chunk in resp.iter_raw(1 << 20):
                fh.write(chunk)
    tmp.replace(target)
    for old in existing:
        if old != target:
            old.unlink(missing_ok=True)
    return target


def iter_jsonl_gz(path: Path) -> Iterator[dict]:
    with gzip.open(path, "rb") as fh:
        for line in fh:
            line = line.strip()
            if line.endswith(b","):
                line = line[:-1]
            if not line or line in (b"[", b"]"):
                continue
            yield orjson.loads(line)


def card_kind(c: dict) -> str:
    layout = c.get("layout") or ""
    set_type = c.get("set_type") or ""
    type_line = c.get("type_line") or ""
    if layout in ("token", "double_faced_token") or set_type == "token":
        return "token"
    if layout == "emblem":
        return "emblem"
    if layout == "art_series":
        return "art_series"
    if layout in ("planar", "scheme", "vanguard") or c.get("oversized"):
        return "other"
    if type_line.startswith("Card"):
        return "other"
    return "card"


def _faces(c: dict) -> list[dict]:
    out = []
    for f in c.get("card_faces") or []:
        iu = f.get("image_uris") or {}
        out.append({
            "name": f.get("name"),
            "printed_name": f.get("printed_name"),
            "flavor_name": f.get("flavor_name"),
            "mana_cost": f.get("mana_cost") or "",
            "type_line": f.get("type_line") or "",
            "oracle_text": f.get("oracle_text") or "",
            "colors": f.get("colors"),
            "oracle_id": f.get("oracle_id"),
            "image_small": iu.get("small"),
            "image_normal": iu.get("normal"),
            "image_large": iu.get("large"),
            "illustration_id": f.get("illustration_id"),
        })
    return out


def card_row(c: dict) -> tuple:
    faces = _faces(c)
    iu = c.get("image_uris") or {}
    if not iu and faces:
        iu = {"small": faces[0]["image_small"], "normal": faces[0]["image_normal"],
              "large": faces[0]["image_large"]}
    oracle_id = c.get("oracle_id") or (faces[0].get("oracle_id") if faces else None)
    type_line = c.get("type_line") or " // ".join(f["type_line"] for f in faces if f["type_line"])
    oracle_text = c.get("oracle_text")
    if oracle_text is None and faces:
        oracle_text = "\n//\n".join(f["oracle_text"] for f in faces)
    mana_cost = c.get("mana_cost")
    if mana_cost is None and faces:
        mana_cost = " // ".join(f["mana_cost"] for f in faces if f["mana_cost"])
    printed_name = c.get("printed_name")
    if printed_name is None and faces and any(f.get("printed_name") for f in faces):
        printed_name = " // ".join(f.get("printed_name") or f["name"] for f in faces)
    illustration_id = c.get("illustration_id") or (faces[0].get("illustration_id") if faces else None)
    values = {
        "id": c["id"],
        "game_id": GAME_ID,
        "oracle_id": oracle_id,
        "name_en": c["name"],
        "printed_name": printed_name,
        "lang": c.get("lang") or "en",
        "set_code": c.get("set"),
        "set_name": c.get("set_name"),
        "set_type": c.get("set_type"),
        "collector_number": c.get("collector_number"),
        "rarity": c.get("rarity"),
        "released_at": c.get("released_at"),
        "layout": c.get("layout"),
        "kind": card_kind(c),
        "mana_cost": mana_cost or "",
        "cmc": c.get("cmc"),
        "type_line": type_line or "",
        "oracle_text": oracle_text or "",
        "colors": db.dumps(c.get("colors") or (faces[0].get("colors") if faces else []) or []),
        "color_identity": db.dumps(c.get("color_identity") or []),
        "produced_mana": db.dumps(c.get("produced_mana") or []),
        "keywords": db.dumps(c.get("keywords") or []),
        "legalities": db.dumps(c.get("legalities") or {}),
        "finishes": db.dumps(c.get("finishes") or []),
        "games": db.dumps(c.get("games") or []),
        "frame": c.get("frame"),
        "frame_effects": db.dumps(c.get("frame_effects") or []),
        "border_color": c.get("border_color"),
        "full_art": int(bool(c.get("full_art"))),
        "promo": int(bool(c.get("promo"))),
        "oversized": int(bool(c.get("oversized"))),
        "artist": c.get("artist"),
        "illustration_id": illustration_id,
        "highres": int(bool(c.get("highres_image"))),
        "image_small": iu.get("small"),
        "image_normal": iu.get("normal"),
        "image_large": iu.get("large"),
        "faces": db.dumps(faces) if faces else None,
        "prices": db.dumps(c.get("prices") or {}),
        "arena_id": c.get("arena_id"),
        "game_changer": int(bool(c.get("game_changer"))),
        "image_status": c.get("image_status"),
    }
    return tuple(values[k] for k in CARD_COLUMNS)


def _default_print_score(c: dict) -> tuple:
    """Menor é melhor: impressão 'reconhecível' para representar a carta."""
    set_type = c.get("set_type") or ""
    preferred_set = set_type in ("expansion", "core", "commander", "masters", "draft_innovation", "starter")
    return (
        c.get("lang") != "en",
        card_kind(c) != "card",
        bool(c.get("promo")),
        not preferred_set,
        bool(c.get("full_art")) or "showcase" in (c.get("frame_effects") or []),
        c.get("border_color") != "black",
        not c.get("highres_image"),
        # mais recente primeiro
        tuple(-int(p) for p in (c.get("released_at") or "0000-00-00").split("-")),
    )


def import_default_cards(path: Path) -> dict:
    conn = db.catalog_db()
    count = 0
    best: dict[str, tuple[tuple, dict]] = {}
    names: set[tuple[str, str, str]] = set()
    batch: list[tuple] = []
    with db.tx(conn):
        conn.execute("DELETE FROM card_refs WHERE game_id=?", (GAME_ID,))
        for c in iter_jsonl_gz(path):
            if c.get("digital"):
                continue
            row = card_row(c)
            batch.append(row)
            count += 1
            oracle_id = row[CARD_COLUMNS.index("oracle_id")]
            if not oracle_id:
                continue
            score = _default_print_score(c)
            cur = best.get(oracle_id)
            if cur is None or score < cur[0]:
                best[oracle_id] = (score, c)
            names.add((oracle_id, "en", c["name"]))
            for f in c.get("card_faces") or []:
                if f.get("name"):
                    names.add((oracle_id, "en", f["name"]))
                if f.get("flavor_name"):
                    names.add((oracle_id, "en", f["flavor_name"]))
            if c.get("flavor_name"):
                names.add((oracle_id, "en", c["flavor_name"]))
            if c.get("lang") != "en":
                pn = c.get("printed_name") or next(
                    (f.get("printed_name") for f in c.get("card_faces") or [] if f.get("printed_name")), None)
                if pn:
                    names.add((oracle_id, c["lang"], pn))
            if len(batch) >= 2000:
                conn.executemany(INSERT_CARD_SQL, batch)
                batch.clear()
                log(f"[catalog] {count} impressões...")
        if batch:
            conn.executemany(INSERT_CARD_SQL, batch)

        conn.execute("DELETE FROM oracle_cards WHERE game_id=?", (GAME_ID,))
        oracle_rows = []
        for oracle_id, (_, c) in best.items():
            r = dict(zip(CARD_COLUMNS, card_row(c)))
            oracle_rows.append((
                oracle_id, GAME_ID, c["name"], c["id"], r["kind"], r["layout"], r["mana_cost"], r["cmc"],
                r["type_line"], r["oracle_text"], r["colors"], r["color_identity"], r["produced_mana"],
                r["keywords"], r["legalities"], r["faces"], r["game_changer"], None,
            ))
        conn.executemany(
            "INSERT INTO oracle_cards (oracle_id, game_id, name_en, default_ref_id, kind, layout, "
            "mana_cost, cmc, type_line, oracle_text, colors, color_identity, produced_mana, keywords, "
            "legalities, faces, game_changer, names_i18n) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT (oracle_id) DO UPDATE SET name_en=excluded.name_en, default_ref_id=excluded.default_ref_id, "
            "kind=excluded.kind, layout=excluded.layout, mana_cost=excluded.mana_cost, cmc=excluded.cmc, "
            "type_line=excluded.type_line, oracle_text=excluded.oracle_text, colors=excluded.colors, "
            "color_identity=excluded.color_identity, produced_mana=excluded.produced_mana, keywords=excluded.keywords, "
            "legalities=excluded.legalities, faces=excluded.faces, game_changer=excluded.game_changer",
            oracle_rows,
        )
        conn.execute("DELETE FROM card_names WHERE game_id=? AND lang='en'", (GAME_ID,))
        conn.executemany(INSERT_NAME_SQL, [(GAME_ID, o, lang, n, name_norm(n)) for (o, lang, n) in names])
    db.catalog_meta_set("mtg.default_cards.file", path.name)
    db.catalog_meta_set("mtg.default_cards.count", str(count))
    log(f"[catalog] {count} impressões, {len(best)} cartas (oracle)")
    return {"prints": count, "oracle_cards": len(best)}


def import_i18n(path: Path, full_langs: tuple[str, ...] = ("pt",)) -> dict:
    """Nomes impressos em todos os idiomas (busca/exibição) + impressões completas dos idiomas pedidos."""
    conn = db.catalog_db()
    names: set[tuple[str, str, str]] = set()
    front_names: dict[str, dict[str, str]] = {}
    batch: list[tuple] = []
    full_count = 0
    with db.tx(conn):
        for c in iter_jsonl_gz(path):
            lang = c.get("lang") or "en"
            if lang == "en" or c.get("digital"):
                continue
            oracle_id = c.get("oracle_id") or next(
                (f.get("oracle_id") for f in c.get("card_faces") or [] if f.get("oracle_id")), None)
            if not oracle_id:
                continue
            printed = c.get("printed_name")
            faces = c.get("card_faces") or []
            if printed:
                names.add((oracle_id, lang, printed))
            face_printed = [f.get("printed_name") for f in faces if f.get("printed_name")]
            for fp in face_printed:
                names.add((oracle_id, lang, fp))
            # nome de exibição = face frontal (DFC) ou nome impresso; ignora "traduções" iguais ao inglês
            front = (faces[0].get("printed_name") if faces else None) or printed
            english_front = faces[0].get("name") if faces else c.get("name")
            if front and front != english_front:
                front_names.setdefault(oracle_id, {}).setdefault(lang, front)
            if lang in full_langs:
                batch.append(card_row(c))
                full_count += 1
                if len(batch) >= 2000:
                    conn.executemany(INSERT_CARD_SQL, batch)
                    batch.clear()
                    log(f"[i18n] {full_count} impressões em {full_langs}...")
        if batch:
            conn.executemany(INSERT_CARD_SQL, batch)
        conn.execute("DELETE FROM card_names WHERE game_id=? AND lang<>'en'", (GAME_ID,))
        conn.executemany(INSERT_NAME_SQL, [(GAME_ID, o, lang, n, name_norm(n)) for (o, lang, n) in names])
        conn.executemany(
            "UPDATE oracle_cards SET names_i18n=? WHERE oracle_id=?",
            [(db.dumps(v), o) for o, v in front_names.items()],
        )
    rebuild_name_index()
    db.catalog_meta_set("mtg.all_cards.file", path.name)
    log(f"[i18n] {len(names)} nomes traduzidos; {full_count} impressões completas em {full_langs}")
    return {"names": len(names), "full_prints": full_count}


def rebuild_name_index() -> None:
    conn = db.catalog_db()
    if conn.dialect == "sqlite":
        conn.execute("INSERT INTO card_names_fts(card_names_fts) VALUES('rebuild')")


def backfill_image_status(paths: list[Path]) -> int:
    """Preenche image_status (placeholder = sem scan do idioma) a partir dos arquivos bulk já baixados."""
    conn = db.catalog_db()
    rows = []
    for path in paths:
        for c in iter_jsonl_gz(path):
            if c.get("image_status"):
                rows.append((c["image_status"], c["id"]))
    with db.tx(conn):
        for part in db.chunks(rows, 5000):
            conn.executemany("UPDATE card_refs SET image_status=? WHERE id=? AND image_status IS NULL", part)
    return len(rows)


def backfill_name_norm() -> int:
    """Preenche name_norm em catálogos importados antes da coluna existir."""
    conn = db.catalog_db()
    rows = conn.execute("SELECT game_id, oracle_id, lang, name FROM card_names WHERE name_norm IS NULL").fetchall()
    with db.tx(conn):
        conn.executemany("UPDATE card_names SET name_norm=? WHERE game_id=? AND oracle_id=? AND lang=? AND name=?",
                         [(name_norm(r[3]), r[0], r[1], r[2], r[3]) for r in rows])
    return len(rows)


def import_sets() -> int:
    """Coleções (código, tamanho impresso) — base da checagem de impressão impossível."""
    r = httpx.get(f"{config.SCRYFALL_API}/sets", headers=HEADERS, timeout=60)
    r.raise_for_status()
    rows = [(s["code"], GAME_ID, s.get("name"), s.get("set_type"), s.get("released_at"), s.get("card_count"),
             s.get("printed_size"), s.get("icon_svg_uri")) for s in r.json()["data"]]
    conn = db.catalog_db()
    with db.tx(conn):
        conn.executemany(
            "INSERT INTO sets (code, game_id, name, set_type, released_at, card_count, printed_size, icon_svg_uri) "
            "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (code) DO UPDATE SET name=excluded.name, set_type=excluded.set_type, "
            "released_at=excluded.released_at, card_count=excluded.card_count, printed_size=excluded.printed_size, "
            "icon_svg_uri=excluded.icon_svg_uri", rows)
    db.catalog_meta_set("mtg.sets.count", str(len(rows)))
    return len(rows)
