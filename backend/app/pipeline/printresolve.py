"""Depois que o pHash reconheceu a ARTE: qual impressão (coleção) e em qual idioma está a carta.

Candidatas de coleção: impressões em inglês da mesma carta com pontuação de hash próxima (mesma arte,
molduras parecidas). Candidatas de idioma: impressões em português com a mesma coleção/número ou, se não
houver, com a mesma arte em outra coleção. As imagens oficiais são comparadas com o recorte fora da arte
(vision/printmatch.py). Sem margem suficiente, a coleção fica com o hash e o idioma com o padrão da sessão —
e a revisão mostra a dúvida.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from .. import config, db
from ..vision import hashing, printmatch, verify
from ..vision.hashindex import Candidate

PRINT_SCORE_WINDOW = 12.0   # candidatas de coleção: até esta distância de hash da melhor
MAX_PRINTS = 4
MAX_PT = 3
PRINT_MARGIN = 0.03         # correlação média a mais para confiar na coleção escolhida pela imagem
# idioma: (texto × português) − (texto × inglês). Calibrado em cenas sintéticas (tools/printlang_eval.py, 3 sementes,
# 240 cenas, scans "placeholder" excluídos): português quase sempre ≥ 0,11; inglês errado aparece até ~0,10.
# Corte em 0,06; confiança só fora da faixa 0,01–0,11.
LANG_SPLIT = 0.06
LANG_CONFIDENCE = 0.05
LANG_MIN_EVIDENCE = 0.45    # a melhor correlação de texto precisa passar disso para a decisão valer
NOTE_PRINT = "impressão incerta: mesma arte em outras coleções"
NOTE_SET_HINT = "coleção {set_code} definida para esta sessão"
NOTE_LANG = "idioma não confirmado pela imagem"
NOTE_NO_PT = "não existe impressão em português desta carta com esta arte — registrada em inglês"


@dataclass
class PrintResolution:
    card_ref_id: str
    language: str
    print_confident: bool
    language_confident: bool
    notes: list[str] = field(default_factory=list)
    alternatives: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)


def query_crop(card_bgr: np.ndarray, context_bgr: np.ndarray | None, variant: int) -> np.ndarray:
    """O mesmo recorte (com/sem margem de sleeve, orientação) que casou no índice de hashes."""
    crop_idx, rotated = variant // 2, variant % 2 == 1
    if context_bgr is not None and crop_idx < len(hashing.CROP_VARIANTS):
        img = hashing.crop_from_context(context_bgr, *hashing.CROP_VARIANTS[crop_idx])
    elif crop_idx == 1:
        img = hashing.inset_card(card_bgr, *hashing.SLEEVE_INSET)
    else:
        img = card_bgr
    return cv2.rotate(img, cv2.ROTATE_180) if rotated else img


def query_image(card_bgr: np.ndarray, context_bgr: np.ndarray | None, variant: int) -> tuple[np.ndarray, bool]:
    """Imagem para comparar com as oficiais: o contexto inteiro (carta + margem) quando existe — o
    alinhamento pela arte recorta a carta com precisão, sem depender do recorte do detector."""
    if context_bgr is None:
        return query_crop(card_bgr, None, variant), False
    return (cv2.rotate(context_bgr, cv2.ROTATE_180) if variant % 2 == 1 else context_bgr), True


SCANNED = "(image_status IS NULL OR image_status NOT IN ('placeholder', 'missing'))"


def _print_in_sets(oracle_id: str | None, sets: set[str], lang: str) -> str | None:
    """Impressão desta carta em uma das coleções informadas pela pessoa (a mais recente com imagem)."""
    if not oracle_id or not sets:
        return None
    marks = ",".join("?" * len(sets))
    row = db.catalog_db().execute(
        f"SELECT id FROM card_refs WHERE oracle_id=? AND lang=? AND LOWER(set_code) IN ({marks}) AND {SCANNED} "
        "ORDER BY released_at DESC, id LIMIT 1", (oracle_id, lang, *sorted(sets))).fetchone()
    return row["id"] if row else None


def portuguese_prints(prints: list[dict]) -> tuple[list[tuple[str, str | None]], list[str]]:
    """Impressões em português da carta: (com scan real [(id pt, id en da mesma coleção)], sem scan [id pt]).

    Primeiro as coleções candidatas, depois outras coleções com a MESMA arte (o hash pode ter preferido uma
    reimpressão em inglês). Impressão com imagem "placeholder" não serve para comparar texto."""
    conn = db.catalog_db()
    out: list[tuple[str, str | None]] = []
    unscanned: list[str] = []
    for p in prints:
        row = conn.execute("SELECT id, image_status FROM card_refs WHERE set_code=? AND collector_number=? AND lang='pt'",
                           (p["set_code"], p["collector_number"])).fetchone()
        if row and row["image_status"] in ("placeholder", "missing"):
            unscanned.append(row["id"])
        elif row:
            out.append((row["id"], p["id"]))
    illus = prints[0].get("illustration_id") if prints else None
    if illus and len(out) < MAX_PT:
        rows = conn.execute("SELECT r.id, e.id AS en_id FROM card_refs r LEFT JOIN card_refs e ON e.set_code = r.set_code "
                            "AND e.collector_number = r.collector_number AND e.lang = 'en' "
                            f"WHERE r.illustration_id=? AND r.lang='pt' AND {SCANNED.replace('image_status', 'r.image_status')} "
                            "ORDER BY r.released_at DESC LIMIT ?", (illus, MAX_PT + 2)).fetchall()
        known = {pt for pt, _ in out}
        out += [(r["id"], r["en_id"]) for r in rows if r["id"] not in known]
    return out[:MAX_PT], unscanned


def _near_identical_sets(a: str, b: str) -> bool:
    """Versões praticamente iguais na imagem: promo de pré-lançamento/pacote (pXXX × XXX) e The List (plst)."""
    a, b = (a or "").lower(), (b or "").lower()
    return "plst" in (a, b) or a == f"p{b}" or b == f"p{a}"


def _text_score(matcher: printmatch.QueryMatcher, ref_id: str, ref: np.ndarray | None) -> printmatch.RegionScore | None:
    if ref is None:
        return None
    s = matcher.score(ref_id, ref, printmatch.TEXT_REGIONS)
    # só vale com alinhamento pela arte: sem ele a posição do texto é chute e a comparação fica injusta
    return None if math.isnan(s.total) or not s.aligned else s


def _region_votes(pt: printmatch.RegionScore, en: printmatch.RegionScore, min_diff: float = 0.03) -> tuple[int, int]:
    """Quantas regiões (nome, tipo, texto) preferem português e quantas preferem inglês."""
    pt_votes = en_votes = 0
    for name in printmatch.TEXT_REGIONS:
        a, b = pt.regions.get(name), en.regions.get(name)
        if a is None or b is None or abs(a - b) < min_diff:
            continue
        if a > b:
            pt_votes += 1
        else:
            en_votes += 1
    return pt_votes, en_votes


def resolve(card_bgr: np.ndarray, context_bgr: np.ndarray | None, cands: list[Candidate], adapter,
            default_language: str = "en", enabled: bool = True, source_height: float | None = None,
            preferred_sets: set[str] | None = None) -> PrintResolution:
    """`source_height`: altura da carta, em pixels, na foto/frame original (texto pequeno demais não decide).

    `preferred_sets`: a pessoa disse de qual coleção são as cartas desta sessão. Entre impressões da mesma
    arte, a dessa coleção ganha sem depender da comparação de imagem — é o que resolve a reimpressão."""
    best = cands[0]
    preferred_sets = {s.lower() for s in preferred_sets} if preferred_sets else None
    summaries = adapter.card_summaries([c.card_ref_id for c in cands[:16]])
    base = summaries.get(best.card_ref_id) or {}
    base_lang = base.get("lang") or "en"
    result = PrintResolution(card_ref_id=best.card_ref_id, language=base_lang, print_confident=True,
                             language_confident=base_lang != "en")
    same_art: list[Candidate] = []
    for c in cands:
        if c.oracle_id == best.oracle_id and c.score - best.score <= PRINT_SCORE_WINDOW \
                and c.card_ref_id not in {x.card_ref_id for x in same_art} and c.card_ref_id in summaries:
            same_art.append(c)
    prints = [{"id": c.card_ref_id, **summaries[c.card_ref_id]} for c in same_art[:MAX_PRINTS]]
    result.alternatives = [p["id"] for p in prints[1:]]
    multiple_sets = len({(p["set_code"], p["collector_number"]) for p in prints}) > 1
    pt_prints, pt_unscanned = portuguese_prints(prints) if base_lang == "en" else ([], [])

    hinted = [p for p in prints if preferred_sets and (p.get("set_code") or "").lower() in preferred_sets]
    if not hinted and preferred_sets:
        # a impressão da coleção informada pode nem estar entre as candidatas do hash: busca no catálogo
        other = _print_in_sets(best.oracle_id, preferred_sets, base_lang)
        if other:
            summary = adapter.card_summaries([other]).get(other)
            if summary:
                hinted = [{"id": other, **summary}]
    if hinted:
        # a coleção da sessão manda: sobra decidir só o idioma
        result.card_ref_id = hinted[0]["id"]
        result.print_confident = True
        result.notes.append(NOTE_SET_HINT.format(set_code=(hinted[0].get("set_code") or "").upper()))
        result.metrics["print_set_hint"] = 1
        prints = hinted[:1]
        multiple_sets = False
        pt_prints, pt_unscanned = portuguese_prints(prints) if base_lang == "en" else ([], [])

    def by_default() -> PrintResolution:
        """Existe versão em português, mas não dá para comparar pela imagem: vale o idioma da sessão."""
        result.language, result.language_confident = ("pt" if default_language == "pt" else "en"), False
        if result.language == "pt":
            result.card_ref_id = pt_prints[0][0] if pt_prints else pt_unscanned[0]
        result.notes.append(NOTE_LANG)
        return result

    if not enabled or not config.ORB_VERIFY_ENABLED or (not multiple_sets and not pt_prints):
        if multiple_sets:
            result.print_confident = False
            result.notes.append(NOTE_PRINT)
        if base_lang == "en":
            if pt_prints or pt_unscanned:
                return by_default()
            if default_language == "pt":
                result.notes.append(NOTE_NO_PT)
        return result

    query, is_context = query_image(card_bgr, context_bgr, best.variant)
    matcher = printmatch.QueryMatcher(query, is_context)
    refs: dict[str, np.ndarray] = {}
    counterparts = [en for _, en in pt_prints if en]
    wanted = [p["id"] for p in prints] + [pt for pt, _ in pt_prints] + counterparts
    for pid in dict.fromkeys(wanted):
        img = verify.reference_image(pid, 0)
        if img is not None:
            refs[pid] = img

    chosen = best.card_ref_id
    if multiple_sets:
        ranked = matcher.rank({p["id"]: refs[p["id"]] for p in prints if p["id"] in refs},
                              printmatch.PRINT_REGIONS, blur=0.9)
        valid = [(k, s) for k, s in ranked if not math.isnan(s.total)]
        confident = False
        if len(valid) >= 2:
            (k1, s1), (k2, s2) = valid[0], valid[1]
            margin = s1.total - s2.total
            result.metrics.update(print_margin=round(margin, 4), print_candidates=len(valid))
            sym1, sym2 = s1.regions.get("symbol"), s2.regions.get("symbol")
            symbol_agrees = sym1 is None or sym2 is None or sym1 >= sym2 - 0.02
            by_id = {p["id"]: p for p in prints}
            twins = _near_identical_sets(by_id[k1]["set_code"], by_id[k2]["set_code"])
            confident = margin >= PRINT_MARGIN and symbol_agrees and not twins
            if confident:  # na dúvida, a coleção fica com o hash (medido: trocar sem confiança não melhora)
                chosen = k1
        if not confident:
            result.print_confident = False
            result.notes.append(NOTE_PRINT)
    result.card_ref_id = chosen
    if base_lang != "en":
        return result
    if not pt_prints:
        if pt_unscanned:
            return by_default()
        result.language, result.language_confident = "en", True
        if default_language == "pt":
            result.notes.append(NOTE_NO_PT)
        return result

    # idioma: o texto do recorte parece mais com a versão em inglês ou com a em português?
    # inglês de cada coleção comparada em português entra também: texto e moldura da mesma coleção, comparação justa
    en_pool = list(dict.fromkeys(([chosen] if result.print_confident else [p["id"] for p in prints]) + counterparts))
    en_scored = [s for s in (_text_score(matcher, pid, refs.get(pid)) for pid in en_pool) if s is not None]
    pt_scored = [(s, pt) for s, pt in ((_text_score(matcher, pt, refs.get(pt)), pt) for pt, _ in pt_prints) if s is not None]
    if not en_scored or not pt_scored:
        return by_default()
    en_best = max(en_scored, key=lambda s: s.total)
    pt_best, best_pt = max(pt_scored, key=lambda x: x[0].total)
    en_score, best_pt_score = en_best.total, pt_best.total
    margin = best_pt_score - en_score
    pt_votes, en_votes = _region_votes(pt_best, en_best)
    result.metrics.update(language_margin=round(margin, 4), en_score=round(en_score, 4), pt_score=round(best_pt_score, 4),
                          region_votes={"pt": pt_votes, "en": en_votes})
    if source_height:
        result.metrics["source_height"] = round(float(source_height))
    is_pt = margin >= LANG_SPLIT
    # sem evidência (texto ilegível, coberto por outra carta ou alinhamento ruim) as duas notas ficam baixas;
    # carta parcialmente coberta faz as regiões discordarem entre si
    readable = max(en_score, best_pt_score) >= LANG_MIN_EVIDENCE
    agree = (en_votes == 0 and pt_votes >= 2) if is_pt else (pt_votes == 0 and en_votes >= 2)
    result.language_confident = readable and agree and abs(margin - LANG_SPLIT) >= LANG_CONFIDENCE
    if not readable:
        is_pt = default_language == "pt"  # texto ilegível: vale o que a pessoa disse sobre as cartas
    if is_pt:
        result.card_ref_id, result.language = best_pt, "pt"
    else:
        result.language = "en"
    if not result.language_confident:
        result.notes.append(NOTE_LANG)
    return result
