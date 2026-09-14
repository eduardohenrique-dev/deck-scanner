"""Predicados declarativos das regras. Não conhecem jogo nenhum: operam sobre campos de carta.

Formas aceitas:
  {"match": "all" | "any", "of": [pred, ...]}
  {"match": "not", "of": pred}
  {"match": "field_<op>", "field": "type_line", "value": ...}
  {"match": "<campo>_<op>", "value": ...}        # atalho: "type_line_contains", "legalities.vintage_equals"
Operadores: contains, regex, equals, in, includes, gte, lte, truthy.
Regex com grupos nomeados devolve capturas (ex.: limite "up to (?P<n>\\w+)").
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

OPS = ("contains", "includes", "regex", "equals", "truthy", "gte", "lte", "in")


@lru_cache(maxsize=1024)
def _rx(pattern: str) -> re.Pattern:
    return re.compile(pattern)


def get_field(card: dict, path: str) -> Any:
    cur: Any = card
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _split(match: str) -> tuple[str, str]:
    for op in sorted(OPS, key=len, reverse=True):
        if match.endswith("_" + op):
            return match[: -(len(op) + 1)], op
    raise ValueError(f"predicado desconhecido: {match}")


def evaluate(pred: dict | None, card: dict) -> tuple[bool, dict]:
    """Retorna (casou, capturas_de_regex)."""
    if not pred:
        return False, {}
    kind = pred["match"]
    if kind == "all":
        caps: dict = {}
        for p in pred["of"]:
            ok, c = evaluate(p, card)
            if not ok:
                return False, {}
            caps.update(c)
        return True, caps
    if kind == "any":
        for p in pred["of"]:
            ok, c = evaluate(p, card)
            if ok:
                return True, c
        return False, {}
    if kind == "not":
        ok, _ = evaluate(pred["of"], card)
        return (not ok), {}
    if kind == "always":
        return True, {}

    if kind.startswith("field_"):
        field, op = pred["field"], kind[len("field_"):]
    else:
        field, op = _split(kind)
    value = get_field(card, field)
    target = pred.get("value")

    if op == "contains":
        if isinstance(value, (list, tuple)):
            return any(isinstance(v, str) and v.casefold() == str(target).casefold() for v in value), {}
        return (isinstance(value, str) and str(target).casefold() in value.casefold()), {}
    if op == "includes":
        return (isinstance(value, (list, tuple)) and target in value), {}
    if op == "regex":
        if not isinstance(value, str):
            return False, {}
        m = _rx(str(target)).search(value)
        if m is None:
            return False, {}
        return True, {k: v for k, v in m.groupdict().items() if v is not None}
    if op == "equals":
        return value == target, {}
    if op == "in":
        return (value in (target or [])), {}
    if op == "truthy":
        expected = True if target is None else bool(target)
        return bool(value) == expected, {}
    if op in ("gte", "lte"):
        try:
            v, t = float(value), float(target)
        except (TypeError, ValueError):
            return False, {}
        return (v >= t if op == "gte" else v <= t), {}
    raise ValueError(f"operador desconhecido: {op}")
