"""Torneios: lista, criação, leitura (com atalho "nada mudou" para o telão), gravação com versão e exclusão."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from .. import tournaments
from ..auth import User, current_user
from .common import json_response

router = APIRouter()


class TournamentIn(BaseModel):
    doc: dict
    summary: dict | None = None


class TournamentSave(TournamentIn):
    base_version: int


def _own(tournament_id: str, user: User) -> dict:
    row = tournaments.get(tournament_id)
    if row is None or row["user_id"] != user.id:
        raise HTTPException(404, "torneio não encontrado")
    return row


def _public(row: dict) -> dict:
    return {k: v for k, v in row.items() if k != "user_id"}


@router.get("/tournaments")
def list_tournaments(user: User = Depends(current_user)):
    return json_response([_public(r) for r in tournaments.list_for(user.id)])


@router.post("/tournaments")
def create_tournament(body: TournamentIn, user: User = Depends(current_user)):
    try:
        row = tournaments.create(user.id, body.doc, body.summary)
    except tournaments.TooLarge as e:
        raise HTTPException(413, str(e)) from e
    return json_response(_public(row), status_code=201)


@router.get("/tournaments/{tournament_id}")
def get_tournament(tournament_id: str, since: int | None = None, user: User = Depends(current_user)):
    # o telão pergunta com a versão que já tem: se nada mudou, a resposta vem vazia (e barata)
    if since is not None:
        head = tournaments.head(tournament_id)
        if head is None or head["user_id"] != user.id:
            raise HTTPException(404, "torneio não encontrado")
        if head["version"] == since:
            return Response(status_code=204)
    return json_response(_public(_own(tournament_id, user)))


@router.put("/tournaments/{tournament_id}")
def save_tournament(tournament_id: str, body: TournamentSave, user: User = Depends(current_user)):
    current = _own(tournament_id, user)
    try:
        saved = tournaments.save(tournament_id, user.id, body.doc, body.summary, body.base_version)
    except tournaments.TooLarge as e:
        raise HTTPException(413, str(e)) from e
    if saved is None:
        latest = tournaments.get(tournament_id) or current
        return json_response({"detail": "Este torneio foi alterado em outro aparelho.", "current": _public(latest)}, status_code=409)
    return json_response(saved)


@router.delete("/tournaments/{tournament_id}")
def delete_tournament(tournament_id: str, user: User = Depends(current_user)):
    _own(tournament_id, user)
    tournaments.delete(tournament_id, user.id)
    return json_response({"ok": True})
