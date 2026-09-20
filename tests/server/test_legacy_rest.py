import json
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from conftest import TOKEN
from test_legacy_api import legacy, write_events  # noqa: F401
from test_identity_api import create_identity
from test_legacy_preferences import definition
from server.app.api import legacy as adapter
from server.app.main import create_app

URL = "/openbexi_timeline/sessions"
WINDOW = {"startDate": "2024-03-01T00:00:00Z", "endDate": "2024-03-02T00:00:00Z"}


@pytest.mark.parametrize("lazy", [False, True])
def test_legacy_rest_keeps_families_namespace_and_ancestor_context(legacy, tmp_path, lazy):  # noqa: F811
    options, first, second = legacy
    # The parent is a point outside the visible day: its activity must still be nested.
    write_events(first, [{"id": "parent", "start": "2023-12-31T00:00:00Z", "data": {"title": "Parent", "status": "ready"},
                          "activities": [{"id": "child", "start": "2024-03-01T12:00:00Z", "data": {"title": "Activity", "status": "failed"}}]}])
    before = {path: path.read_bytes() for path in (first, second)}
    app = create_app(tmp_path / "state", TOKEN, legacy_config={**options, "lazy": lazy})
    with TestClient(app, headers={"Authorization": "Bearer " + TOKEN}) as client:
        # A lazy archive needs its background index to discover long/old-file parents.
        if lazy:
            deadline = time.monotonic() + 5
            while not app.state.repository.coverage()["complete"] and time.monotonic() < deadline:
                time.sleep(.01)
            assert app.state.repository.coverage()["complete"]
        response = client.get(URL, params={**WINDOW, "namespace": "N", "scene": "primary"})
        assert response.status_code == 200, response.text
        reply = response.json()
        assert reply["dateTimeFormat"] == "iso8601" and reply["scene"] == "primary"
        parent = next(item for item in reply["events"] if item["id"] == "parent")
        assert [item["id"] for item in parent["activities"]] == ["child"]
        assert parent["data"]["status"] == "ready"
        assert parent["activities"][0]["data"]["status"] == "failed"
        assert client.get(URL, params={**WINDOW, "namespace": "unavailable"}).status_code == 404
        filtered = client.get(URL, params={**WINDOW, "filter": "status:failed"})
        assert filtered.status_code == 200, filtered.text
        assert [event["id"] for event in filtered.json()["events"]] == ["parent"]
        assert not app.state.queries.queries
    assert all(path.read_bytes() == content for path, content in before.items())


def test_all_record_pages_are_serialized_and_limit_errors_release_queries(legacy, tmp_path, monkeypatch):  # noqa: F811
    options, _, second = legacy
    write_events(second, [{"id": "event-" + str(index), "start": "2024-03-01T12:00:00Z", "data": {"title": "Event " + str(index)}} for index in range(1010)])
    app = create_app(tmp_path / "state", TOKEN, legacy_config=options)
    with TestClient(app, headers={"Authorization": "Bearer " + TOKEN}) as client:
        response = client.get(URL, params=WINDOW)
        assert response.status_code == 200, response.text
        ids = [event["id"] for event in response.json()["events"]]
        assert len(ids) == len(set(ids)) == 1011
        assert not app.state.queries.queries
        monkeypatch.setattr(adapter, "MAX_RECORDS", 2)
        response = client.get(URL, params=WINDOW)
        assert response.status_code == 413 and response.json()["code"] == "legacy_window_limit"
        assert not app.state.queries.queries


@pytest.mark.parametrize("lazy", [False, True])
def test_descriptor_uses_pinned_query_and_missing_sidecars_are_not_empty_success(legacy, tmp_path, lazy):  # noqa: F811
    options, _, second = legacy
    path = second.parent / "descriptors/a.json"
    path.parent.mkdir()
    path.write_text(json.dumps({"event_descriptor": [{"id": "a", "data": {"namespace": "N", "description": "Current descriptor"}}]}), encoding="utf-8")
    app = create_app(tmp_path / "state", TOKEN, legacy_config={**options, "lazy": lazy})
    with TestClient(app, headers={"Authorization": "Bearer " + TOKEN}) as client:
        params = {"ob_request": "readDescriptor", "namespace": "N", "start": "2024-03-01T12:00:00Z", "event_id": "a"}
        response = client.post(URL, params=params)
        assert response.status_code == 200, response.text
        assert response.json()["event_descriptor"][0]["data"]["description"] == "Current descriptor"
        assert client.post(URL, params={**params, "event_id": "b"}).status_code == 404
        assert client.post(URL, params={**params, "event_id": ""}).status_code == 422
        assert not app.state.queries.queries


def test_read_filters_fallback_and_sse_reconnections_release_capacity(legacy, tmp_path, monkeypatch):  # noqa: F811
    app = create_app(tmp_path / "state", TOKEN, legacy_config=legacy[0])
    monkeypatch.setattr(adapter, "STREAM_SECONDS", 0)
    with TestClient(app, headers={"Authorization": "Bearer " + TOKEN}) as client:
        response = client.post(URL, params={"ob_request": "readFilters", "timelineName": "test"})
        assert response.status_code == 200, response.text
        filters = response.json()["openbexi_timeline"][0]["filters"]
        assert [item["name"] for item in filters] == ["ALL", "BY_NAMESPACE"]
        for _ in range(3):
            response = client.get("/openbexi_timeline_sse/sessions", params=WINDOW)
            assert response.status_code == 200, response.text
            assert response.headers["content-type"].startswith("text/event-stream")
            data = next(line[6:] for line in response.text.splitlines() if line.startswith("data: "))
            assert len(json.loads(data)["events"]) == 3
            assert not app.state.queries.queries


def test_legacy_paths_enforce_authorization_parameter_validation_and_read_only(legacy, tmp_path):  # noqa: F811
    app = create_app(tmp_path / "state", TOKEN, legacy_config=legacy[0])
    with TestClient(app) as client:
        for path in (URL, "/openbexi_timeline_sse/sessions"):
            assert client.get(path, params=WINDOW).status_code == 401
        client.headers["Authorization"] = "Bearer " + TOKEN
        assert client.get(URL, params=[("startDate", WINDOW["startDate"]), ("startDate", WINDOW["startDate"])]).status_code == 422
        assert client.get(URL, params={"startDate": WINDOW["startDate"]}).status_code == 422
        assert client.get(URL, params={**WINDOW, "filter": "status=ready"}).status_code == 422
        assert client.get(URL, params={"ob_request": "deleteFilter"}).status_code == 405
        assert client.post(URL, params={"ob_request": "addEvent"}, json={}).status_code == 403
        assert client.post(URL, params={"ob_request": "deleteFilter"}, json={"family": "filters", "type": "delete"}).status_code == 403
        assert not app.state.queries.queries


def test_namespace_and_descriptor_cannot_expand_an_identity_source_scope(legacy, tmp_path):  # noqa: F811
    app = create_app(tmp_path / "state", TOKEN, legacy_config=legacy[0])
    with TestClient(app, headers={"Authorization": "Bearer " + TOKEN}) as client:
        _, _, headers = create_identity(client, [])
        response = client.get(URL, params=WINDOW, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["events"] == []
        assert client.get(URL, params={**WINDOW, "namespace": "N"}, headers=headers).status_code == 404
        assert client.post(URL, params={"ob_request": "readDescriptor", "event_id": "a", "start": "2024-03-01T12:00:00Z"}, headers=headers).status_code == 404
        assert not app.state.queries.queries


def test_saved_filters_round_trip_real_predicates_and_search_highlighting(legacy, tmp_path):  # noqa: F811
    state = tmp_path / "state"
    app = create_app(state, TOKEN, legacy_config={**legacy[0], "preferencesRoot": str(state / "preferences")})
    with TestClient(app, headers={"Authorization": "Bearer " + TOKEN}) as client:
        identity = app.state.identities.authenticate(TOKEN)
        generation = app.state.repository.meta["manifest"]["generation"]
        key = uuid.uuid4().hex
        resource = app.state.configuration.mutate(identity, {"family": "filters", "type": "create", "generation": generation, "clientCommandId": key,
            "payload": {"name": "Only matches", "visibility": "personal", "definition": definition()}}, generation, key)["resource"]
        if not resource["versions"]:
            key = uuid.uuid4().hex
            resource = app.state.configuration.mutate(identity, {"family": "filters", "type": "publish", "generation": generation, "clientCommandId": key,
                "resourceId": resource["id"], "expectedRevision": resource["revision"], "payload": {}}, generation, key,
                f'"{generation}:{resource["revision"]}"')["resource"]
        reply = client.get(URL, params={"ob_request": "readFilters"})
        assert reply.status_code == 200, reply.text
        exported = reply.json()["openbexi_timeline"][0]["filters"][0]
        assert exported["canonicalDefinition"] == definition()
        assert exported["expressionFormat"] == "canonical"
        assert exported["filterVersion"] == 1
        reply = client.get(URL, params={**WINDOW, "filterName": resource["id"], "search": "First", "searchMode": "regex"})
        assert reply.status_code == 200, reply.text
        events = reply.json()["events"]
        assert {event["id"] for event in events} == {"a", "b"}
        assert next(event for event in events if event["id"] == "a")["render"]["backgroundColor"] == "#F8DF09"
        assert next(event for event in events if event["id"] == "b")["render"].get("backgroundColor") != "#F8DF09"
        assert not app.state.queries.queries
