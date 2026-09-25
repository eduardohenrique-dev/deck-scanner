"""Leitura ao vivo: a leitura "duvidosa" (pouca cara de carta) só vale se a arte for reconhecida."""
from __future__ import annotations

import json

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.pipeline import vlm


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _table_jpeg(seed: int) -> bytes:
    """Um pedaço de mesa com proporção de carta: nada que a identificação consiga reconhecer."""
    rng = np.random.default_rng(seed)
    grain = cv2.resize(rng.normal(0, 1, (85, 8)).astype(np.float32), (488, 680), interpolation=cv2.INTER_CUBIC)
    img = np.array([45, 75, 115], np.float32)[None, None, :] * (1 + 0.18 * grain[..., None])
    ok, buf = cv2.imencode(".jpg", np.clip(img, 0, 255).astype(np.uint8))
    assert ok
    return buf.tobytes()


def test_doubtful_live_read_without_known_art_is_dropped(client, monkeypatch):
    monkeypatch.setattr(vlm, "enabled", lambda: False)  # nunca chama a IA num teste
    s = client.post("/api/sessions", json={"game_id": "mtg", "format_id": "commander", "mode": "video", "name": "teste leitura duvidosa"}).json()
    try:
        cap = client.post(f"/api/sessions/{s['id']}/captures", json={"type": "live"}).json()

        def post(group: int, doubtful: bool) -> dict:
            meta = {"capture_id": cap["id"], "group": group, "frame_count": 12, "t_start": 0, "t_end": 1.2, "doubtful": doubtful}
            res = client.post(f"/api/sessions/{s['id']}/sightings", data={"meta": json.dumps(meta)},
                              files=[("cards", ("carta.jpg", _table_jpeg(group), "image/jpeg"))])
            assert res.status_code == 200, res.text
            return res.json()["detection"]

        # duvidosa e sem arte: era a mesa, some sem pedir revisão
        assert post(1, doubtful=True)["status"] == "noise"
        # com cara de carta e sem arte: continua pedindo para a pessoa dizer qual é
        assert post(2, doubtful=False)["status"] == "unidentified"
    finally:
        client.delete(f"/api/sessions/{s['id']}")
