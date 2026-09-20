from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.app.main import create_app
from server.app.models.domain import read_json

ROOT = Path(__file__).resolve().parents[2]
TOKEN = "test-token-keep-private"
BASE = "/api/v1/workspaces/default"


@pytest.fixture
def bundle():
    return read_json(ROOT / "shared/fixtures/initial-snapshot.json")


@pytest.fixture
def app(tmp_path):
    # Contract tests use a stable, compact fixture; test_local_test_data covers shipped demos.
    return create_app(tmp_path / "data", TOKEN, ROOT / "shared/fixtures/initial-snapshot.json")


@pytest.fixture
def client(app):
    with TestClient(app, headers={"Authorization": "Bearer " + TOKEN}) as value:
        yield value


@pytest.fixture
def write_headers(client):
    metadata = client.get(BASE).json()
    return {"X-Workspace-Generation": metadata["generation"], "Idempotency-Key": "test-command"}
