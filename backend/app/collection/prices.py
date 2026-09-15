"""Preços e lista de compras.

Preço de referência: Scryfall (TCGplayer em USD, Cardmarket em EUR) convertido para reais pela cotação
PTAX do Banco Central. É estimativa de catálogo — o preço real de loja no Brasil está na LigaMagic, que não
tem API pública: a lista de compras gera links de busca e o texto para colar em "Compra por Lista".
"""
from __future__ import annotations

import datetime as dt
import time
from urllib.parse import quote_plus

import httpx

from .. import config, db
from ..games import registry
from ..games.mtg.scryfall_api import client as scryfall
from . import allocation

LIGAMAGIC_CARD = "https://www.ligamagic.com.br/?view=cards/card&card={name}"
LIGAMAGIC_LIST = "https://www.ligamagic.com.br/?view=cards/lista"
PTAX_URL = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo("
            "dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)")
FALLBACK_USD_BRL = config.FALLBACK_USD_BRL
VALUABLE_BRL = config.VALUABLE_BRL


def fx_usd_brl() -> dict:
    conn = db.app_db()
    row = conn.execute("SELECT rate, quoted_at, fetched_at FROM fx_rates WHERE pair='USDBRL'").fetchone()
    if row and time.time() - row["fetched_at"] < 12 * 3600:
        return {"rate": row["rate"], "quoted_at": row["quoted_at"], "source": "PTAX/Banco Central"}
    today = dt.date.today()
    params = {"@dataInicial": f"'{(today - dt.timedelta(days=10)).strftime('%m-%d-%Y')}'",
              "@dataFinalCotacao": f"'{today.strftime('%m-%d-%Y')}'", "$format": "json",
              "$select": "cotacaoVenda,dataHoraCotacao"}
    try:
        r = httpx.get(PTAX_URL, params=params, timeout=10, headers={"User-Agent": config.USER_AGENT})
        r.raise_for_status()
        values = r.json().get("value") or []
        if values:
            last = values[-1]
            rate, quoted = float(last["cotacaoVenda"]), str(last["dataHoraCotacao"])[:10]
            conn.execute("INSERT INTO fx_rates (pair, rate, quoted_at, fetched_at) VALUES ('USDBRL',?,?,?) "
                         "ON CONFLICT (pair) DO UPDATE SET rate=excluded.rate, quoted_at=excluded.quoted_at, "
                         "fetched_at=excluded.fetched_at", (rate, quoted, time.time()))
            return {"rate": rate, "quoted_at": quoted, "source": "PTAX/Banco Central"}
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    if row:
        return {"rate": row["rate"], "quoted_at": row["quoted_at"], "source": "PTAX/Banco Central (última conhecida)"}
    return {"rate": FALLBACK_USD_BRL, "quoted_at": None, "source": "valor padrão (sem acesso à cotação)"}


def usd_from(prices: dict | None, finish: str | None) -> float | None:
    prices = prices or {}
    key = {"foil": "usd_foil", "etched": "usd_etched"}.get(finish or "nonfoil", "usd")
    value = prices.get(key) or (prices.get("usd") if key != "usd" else None) or prices.get("usd_foil")
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def prices_for(game_id: str, card_ref_ids, refresh: bool = False) -> dict[str, dict]:
    """Preços por impressão: cache recente (API) quando houver, senão os do catálogo."""
    ids = [i for i in dict.fromkeys(card_ref_ids) if i and not i.startswith("__")]
    out: dict[str, dict] = {}
    conn = db.app_db()
    fresh_cut = time.time() - config.PRICE_TTL
    for part in db.chunks(ids, 500):
        for r in conn.execute(f"SELECT card_ref_id, prices, fetched_at FROM price_cache WHERE card_ref_id IN "
                              f"({db.placeholders(len(part))})", list(part)):
            if refresh and r["fetched_at"] < fresh_cut:
                continue
            out[r["card_ref_id"]] = {**(db.loads(r["prices"], {}) or {}), "_fetched_at": r["fetched_at"]}
    if refresh:
        stale = [i for i in ids if i not in out]
        now = time.time()
        rows = []
        for card in scryfall().collection(stale):
            p = card.get("prices") or {}
            out[card["id"]] = {**p, "_fetched_at": now}
            rows.append((card["id"], db.dumps(p), now))
        if rows:
            conn.executemany("INSERT INTO price_cache (card_ref_id, prices, fetched_at) VALUES (?,?,?) ON CONFLICT "
                             "(card_ref_id) DO UPDATE SET prices=excluded.prices, fetched_at=excluded.fetched_at", rows)
    missing = [i for i in ids if i not in out]
    if missing:
        catalog_date = db.catalog_meta_get("mtg.default_cards.file") or ""
        for cid, s in registry.get(game_id).card_summaries(missing).items():
            out[cid] = {**(s.get("prices") or {}), "_catalog": catalog_date}
    return out


def valuation(game_id: str, items: list[dict], refresh: bool = False) -> dict:
    """items: {card_ref_id, finish, quantity}. Soma em USD e em reais, com as cartas mais valiosas."""
    fx = fx_usd_brl()
    prices = prices_for(game_id, [i["card_ref_id"] for i in items], refresh=refresh)
    total_usd, priced, unpriced = 0.0, [], 0
    for it in items:
        usd = usd_from(prices.get(it["card_ref_id"]), it.get("finish"))
        qty = int(it.get("quantity") or 1)
        if usd is None:
            unpriced += qty
            continue
        total_usd += usd * qty
        priced.append({**it, "unit_usd": round(usd, 2), "unit_brl": round(usd * fx["rate"], 2),
                       "total_brl": round(usd * fx["rate"] * qty, 2)})
    priced.sort(key=lambda x: -x["unit_brl"])
    return {"total_usd": round(total_usd, 2), "total_brl": round(total_usd * fx["rate"], 2), "fx": fx,
            "unpriced": unpriced, "top": priced[:10], "items": priced}


def valuable_finds(game_id: str, items: list[dict], threshold_brl: float = VALUABLE_BRL) -> list[dict]:
    """Alerta de carta cara que o usuário talvez não soubesse que tinha."""
    v = valuation(game_id, items)
    return [i for i in v["items"] if i["unit_brl"] >= threshold_brl][:12]


def ligamagic_url(name_en: str) -> str:
    return LIGAMAGIC_CARD.format(name=quote_plus(name_en))


def shopping_list(deck: dict, refresh: bool = False) -> dict:
    """O que falta para fechar o deck: comprar (não tem) × decidir (tem, mas está em outro deck) × buscar (pasta/caixa)."""
    adapter = registry.get(deck["game_id"])
    report = allocation.deck_report(deck)
    summaries = adapter.card_summaries([it["card_ref_id"] for it in report["items"]])
    fx = fx_usd_brl()
    prices = prices_for(deck["game_id"], [it["card_ref_id"] for it in report["items"] if it["buy"]], refresh=refresh)
    buy, decide, fetch = [], [], []
    total_usd = 0.0
    for it in report["items"]:
        s = summaries.get(it["card_ref_id"]) or {}
        base = {"oracle_id": it["oracle_id"], "card_ref_id": it["card_ref_id"], "name": s.get("name_en"),
                "name_pt": s.get("name_pt"), "image_small": s.get("image_small")}
        if it["buy"]:
            usd = usd_from(prices.get(it["card_ref_id"]), "nonfoil")
            if usd is not None:
                total_usd += usd * it["buy"]
            buy.append({**base, "quantity": it["buy"], "unit_usd": usd,
                        "unit_brl": round(usd * fx["rate"], 2) if usd is not None else None,
                        "ligamagic_url": ligamagic_url(s.get("name_en") or "")})
        if it["conflict"]:
            decide.append({**base, "quantity": it["conflict"], "decks": sorted({c["location_name"] for c in it["in_other_decks"]
                                                                                if c.get("location_name")})})
        if it["move"]:
            fetch.append({**base, "quantity": it["move"], "from": sorted({c["location_name"] or "Solto"
                                                                         for c in it["available"]})})
    text = "\n".join(f"{b['quantity']} {b['name']}" for b in buy if b["name"])
    return {"buy": buy, "decide": decide, "fetch": fetch, "fx": fx,
            "total_usd": round(total_usd, 2), "total_brl": round(total_usd * fx["rate"], 2),
            "ligamagic_list_text": text, "ligamagic_list_url": LIGAMAGIC_LIST}
