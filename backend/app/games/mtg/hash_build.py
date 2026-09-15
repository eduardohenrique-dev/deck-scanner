"""Constrói o banco local de hashes perceptuais a partir das imagens 'small' da Scryfall.

As imagens não são guardadas: baixa, calcula os hashes (mesma normalização da consulta) e descarta.
A ordem prioriza UMA impressão por ilustração — assim um build parcial já cobre todas as artes —
e depois completa as demais impressões (melhora a desambiguação de impressão pela moldura).
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import time

import httpx

from ... import config, db
from ...vision import hashing
from ...vision.hashindex import build_index_file
from .scryfall_import import log

UPSERT_HASH_SQL = ("INSERT INTO art_hashes (card_ref_id, face, art, \"full\", color, created_at) VALUES (?,?,?,?,?,?) "
                   "ON CONFLICT (card_ref_id, face) DO UPDATE SET art=excluded.art, \"full\"=excluded.\"full\", "
                   "color=excluded.color, created_at=excluded.created_at")
CARD_BACK_ID = "0aeebaf5-8c7d-4636-9e82-8c27447861f7"
CARD_BACK_REF = f"__back__:{CARD_BACK_ID}"
CARD_BACK_URL = f"https://backs.scryfall.io/small/0/a/{CARD_BACK_ID}.jpg"


def select_targets(langs: tuple[str, ...] = ("en",), limit: int | None = None,
                   sets: list[str] | None = None, include_existing: bool = False) -> list[tuple[str, int, str]]:
    conn = db.catalog_db()
    params: list = ["mtg"]
    sql = ("SELECT id, lang, illustration_id, image_small, faces, highres, promo, released_at, kind "
           "FROM card_refs WHERE game_id=? AND kind IN ('card','token','emblem','art_series')")
    lang_list = list(langs)
    # impressões que só existem num idioma (sem contraparte em inglês) também entram
    sql += (f" AND (lang IN ({','.join('?' for _ in lang_list)}) OR NOT EXISTS ("
            "SELECT 1 FROM card_refs e WHERE e.set_code=card_refs.set_code "
            "AND e.collector_number=card_refs.collector_number AND e.lang='en'))")
    params.extend(lang_list)
    if sets:
        sql += f" AND set_code IN ({','.join('?' for _ in sets)})"
        params.extend(s.lower() for s in sets)
    rows = conn.execute(sql, params).fetchall()
    existing = set()
    if not include_existing:
        existing = {(r[0], r[1]) for r in conn.execute("SELECT card_ref_id, face FROM art_hashes")}

    targets: list[tuple[tuple, tuple[str, int, str], str | None]] = []
    for r in rows:
        faces = db.loads(r["faces"], None) or []
        face_imgs = [(i, f.get("image_small"), f.get("illustration_id")) for i, f in enumerate(faces)
                     if f.get("image_small")]
        if face_imgs:
            items = face_imgs
        elif r["image_small"]:
            items = [(0, r["image_small"], r["illustration_id"])]
        else:
            continue
        for face, url, illus in items:
            if (r["id"], face) in existing:
                continue
            quality = (r["lang"] != "en", not r["highres"], bool(r["promo"]), r["kind"] != "card",
                       -(int((r["released_at"] or "0000-00-00").replace("-", ""))))
            targets.append((quality, (r["id"], face, url), illus or f"noillus:{r['id']}:{face}"))

    targets.sort(key=lambda t: t[0])
    first, rest, seen = [], [], set()
    for _, target, illus in targets:
        if illus in seen:
            rest.append(target)
        else:
            seen.add(illus)
            first.append(target)
    ordered = first + rest
    if limit:
        ordered = ordered[:limit]
    return ordered


def _hash_bytes(data: bytes):
    img = hashing.decode_image(data)
    if img is None:
        return None
    h = hashing.compute_hashes(img)
    return h.art.tobytes(), h.full.tobytes(), h.color.tobytes()


async def _run(targets: list[tuple[str, int, str]], concurrency: int) -> dict:
    conn = db.catalog_db()
    loop = asyncio.get_running_loop()
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=6)
    sem = asyncio.Semaphore(concurrency)
    stats = {"ok": 0, "failed": 0}
    started = time.time()

    async with httpx.AsyncClient(
        headers={"User-Agent": config.USER_AGENT}, timeout=30, follow_redirects=True,
        limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency),
    ) as client:
        async def one(card_id: str, face: int, url: str):
            async with sem:
                data = None
                for attempt in range(4):
                    try:
                        resp = await client.get(url)
                        if resp.status_code == 200:
                            data = resp.content
                            break
                        if resp.status_code in (403, 404):
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(1.5 * (attempt + 1))
            if data is None:
                return None
            hashed = await loop.run_in_executor(pool, _hash_bytes, data)
            return None if hashed is None else (card_id, face, *hashed)

        chunk = 600
        for i in range(0, len(targets), chunk):
            results = await asyncio.gather(*(one(*t) for t in targets[i:i + chunk]))
            rows = [(r[0], r[1], r[2], r[3], r[4], db.now_iso()) for r in results if r]
            stats["ok"] += len(rows)
            stats["failed"] += len(results) - len(rows)
            if rows:
                conn.executemany(UPSERT_HASH_SQL, rows)
            done = i + len(results)
            rate = done / max(time.time() - started, 1e-6)
            log(f"[hashes] {done}/{len(targets)} ({rate:.0f} img/s, falhas {stats['failed']})")
    pool.shutdown()
    return stats


def ensure_card_back() -> None:
    conn = db.catalog_db()
    if conn.execute("SELECT 1 FROM art_hashes WHERE card_ref_id=?", (CARD_BACK_REF,)).fetchone():
        return
    resp = httpx.get(CARD_BACK_URL, headers={"User-Agent": config.USER_AGENT}, timeout=30)
    resp.raise_for_status()
    art, full, color = _hash_bytes(resp.content)
    conn.execute(UPSERT_HASH_SQL, (CARD_BACK_REF, 0, art, full, color, db.now_iso()))


def build_hashes(langs: tuple[str, ...] = ("en",), limit: int | None = None, sets: list[str] | None = None,
                 concurrency: int = 12) -> dict:
    ensure_card_back()
    targets = select_targets(langs=langs, limit=limit, sets=sets)
    log(f"[hashes] {len(targets)} imagens a processar")
    if not targets:
        return {"ok": 0, "failed": 0}
    stats = asyncio.run(_run(targets, concurrency))
    total = db.catalog_db().execute("SELECT COUNT(*) FROM art_hashes").fetchone()[0]
    db.catalog_meta_set("mtg.hashes.count", str(total))
    db.catalog_meta_set("mtg.hashes.updated_at", db.now_iso())
    info = build_index_file()
    log(f"[hashes] concluído: {stats} — total no banco {total}; índice {info['file']}")
    return stats
