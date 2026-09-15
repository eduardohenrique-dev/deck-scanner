"""Interface GameAdapter: tudo que varia entre jogos fica aqui ou em JSON.

O motor de regras, o pipeline de visão e a API não conhecem nenhum jogo específico:
consomem campos canônicos de carta (`card_fields`), regras declarativas (`formats`),
zonas (`zones`) e exportadores (`export_formats`) fornecidos pelo adapter.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import orjson


@dataclass
class RawCard:
    """Leitura bruta de uma carta (pHash, modelo multimodal ou usuário)."""
    name: str | None = None
    printed_name: str | None = None
    set_code: str | None = None
    collector_number: str | None = None
    language: str | None = None
    finish: str | None = None
    card_ref_id: str | None = None


@dataclass
class ResolvedCard:
    card_ref_id: str
    oracle_id: str | None
    name_en: str
    lang: str
    exact_print: bool
    method: str
    notes: list[str] = field(default_factory=list)


class _JsonDir:
    """Carrega JSON do diretório de regras com recarga automática por mtime (sem deploy)."""

    def __init__(self) -> None:
        self._cache: dict[Path, tuple[float, Any]] = {}

    def load(self, path: Path) -> Any:
        mtime = path.stat().st_mtime
        hit = self._cache.get(path)
        if hit and hit[0] == mtime:
            return hit[1]
        data = orjson.loads(path.read_bytes())
        self._cache[path] = (mtime, data)
        return data


class GameAdapter(ABC):
    id: str = ""
    name: str = ""

    def __init__(self, rules_dir: Path, manifest: dict) -> None:
        self.rules_dir = rules_dir / self.id
        self.manifest = manifest
        self._json = _JsonDir()

    # ---------- dados declarativos ----------
    def game_meta(self) -> dict:
        return self._json.load(self.rules_dir / "game.json")

    @property
    def zones(self) -> list[dict]:
        return self.game_meta()["zones"]

    def formats(self) -> dict[str, dict]:
        out = {}
        for path in sorted((self.rules_dir / "formats").glob("*.json")):
            rule = self._json.load(path)
            out[rule["id"]] = rule
        return dict(sorted(out.items(), key=lambda kv: kv[1].get("order", 999)))

    def format(self, format_id: str) -> dict:
        formats = self.formats()
        if format_id not in formats:
            raise KeyError(f"formato desconhecido: {self.id}/{format_id}")
        return formats[format_id]

    def data_file(self, name: str) -> Any:
        path = self.rules_dir / "data" / name
        return self._json.load(path) if path.exists() else None

    # ---------- integrações específicas do jogo ----------
    @abstractmethod
    def resolve_card(self, raw: RawCard) -> ResolvedCard | None:
        """Chama a fonte de dados do jogo (local primeiro, API se faltar) e devolve a carta canônica."""

    @abstractmethod
    def art_hash_source(self) -> dict:
        """De onde vêm as artes para o banco de pHash (e comando de build)."""

    @abstractmethod
    def export_formats(self) -> list[dict]:
        """Exportadores do jogo: [{id, name, extension, supports_grouping, options}]."""

    @abstractmethod
    def export(self, export_id: str, entries: list[dict], options: dict) -> tuple[str, str, str]:
        """Gera (texto, nome_do_arquivo, mime)."""

    @abstractmethod
    def identity_rules(self) -> dict:
        """Como ler a 'identidade' de uma carta (cor no MTG, tipo de líder no OPCG etc.)."""

    @abstractmethod
    def card_fields(self, card_ref_id: str) -> dict | None:
        """Campos canônicos usados pelos predicados das regras."""

    @abstractmethod
    def card_summary(self, card_ref_id: str, lang: str = "pt") -> dict | None:
        """Resumo para a UI (nomes, imagem oficial, set/número, preço)."""

    def card_fields_many(self, ids) -> dict[str, dict]:
        """Lote de `card_fields` (adapters com banco remoto devem sobrescrever com uma consulta só)."""
        out = {}
        for i in dict.fromkeys(ids):
            f = self.card_fields(i) if i else None
            if f is not None:
                out[i] = f
        return out

    def card_summaries(self, ids, lang: str = "pt") -> dict[str, dict]:
        out = {}
        for i in dict.fromkeys(ids):
            s = self.card_summary(i, lang) if i else None
            if s is not None:
                out[i] = s
        return out

    @abstractmethod
    def search(self, query: str, lang: str = "pt", limit: int = 12) -> list[dict]:
        ...

    @abstractmethod
    def prints_of(self, oracle_id: str, limit: int = 60) -> list[dict]:
        ...

    def suggestion_providers(self) -> dict[str, Callable[..., dict]]:
        return {}

    def suggestion_additions(self, suggestion_type: str, suggestion: dict) -> list[tuple[str, int]]:
        """Converte uma sugestão aceita em cartas a adicionar: [(card_ref_id, quantidade)]."""
        return []

    def vision_profile(self) -> dict:
        return self.game_meta().get("vision", {})

    def public_info(self) -> dict:
        meta = self.game_meta()
        return {
            "id": self.id,
            "name": meta.get("name", self.name),
            "enabled": True,
            "zones": meta["zones"],
            "languages": meta.get("languages", []),
            "formats": [
                {k: v for k, v in f.items() if k in (
                    "id", "name", "group", "description", "deck_size", "zones", "copy_limit", "requires_commander",
                    "enforces_color_identity", "zone_labels", "zone_limits", "order")}
                for f in self.formats().values()
            ],
            "exporters": self.export_formats(),
        }
