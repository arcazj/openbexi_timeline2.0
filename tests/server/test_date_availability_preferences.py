"""Availability uses the same private legacy filter publications as queries."""
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from conftest import BASE, TOKEN
from test_identity_api import create_identity
from test_legacy_api import ready, write_events
from server.app.main import create_app


@pytest.fixture(params=[False, True], ids=["eager", "partitioned"])
def preferences_archive(tmp_path, request):
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    sources, originals = [], {}
    for namespace, day in (("FIRST", "01"), ("SECOND", "20")):
        root = tmp_path / namespace
        path = root / f"2024/01/{day}/events.json"
        write_events(path, [{"id": namespace, "start": f"2024-01-{day}T12:00:00Z",
                             "data": {"title": namespace + " record"}}])
        originals[path] = path.read_bytes()
        sources.append({"namespace": namespace, "type": "json_file", "enable": True,
                        "data_path": root.as_posix(), "data_model": root.as_posix() + "/yyyy/mm/dd"})
    state = tmp_path / "state"
    options = {"yaml": str(tmp_path / "sources.yml"), "legacyRoot": str(legacy),
               "allowRoots": [source["data_path"] for source in sources], "sourceDocument": {"data_sources": sources},
               "lazy": request.param, "preferencesRoot": str(state / "preferences")}
    app = create_app(state, TOKEN, legacy_config=options)
    with TestClient(app, headers={"Authorization": "Bearer " + TOKEN}) as client:
        if request.param:
            deadline = time.monotonic() + 5
            while not client.get(BASE + "/legacy/loading").json()["complete"]:
                assert time.monotonic() < deadline, "Tiny archive did not finish indexing"
                time.sleep(.01)
        source_ids = {source.namespace: source.id for source in app.state.repository.reader.sources}
        metadata = client.get(BASE).json()
        assert metadata["legacy"]["preferencesEnabled"] is True
        generation = metadata["generation"]
        definition = {"definitionVersion": 2, "relationshipMode": "independent",
                      "sourceIds": [source_ids["SECOND"]], "kinds": ["event", "session"], "schemaRefs": [],
                      "expression": None, "search": {"text": "", "mode": "any", "fields": ["/title"],
                                                       "caseSensitive": False}}
        key = str(uuid.uuid4())
        response = client.post(BASE + "/configuration/commands", json={
            "family": "filters", "type": "create", "generation": generation, "clientCommandId": key,
            "payload": {"name": "Private second-source dates", "visibility": "personal", "definition": definition},
        }, headers={"X-Workspace-Generation": generation, "Idempotency-Key": key})
        assert response.status_code == 200, response.text
        resource = response.json()["resource"]
        key = str(uuid.uuid4())
        response = client.post(BASE + "/configuration/commands", json={
            "family": "filters", "type": "publish", "generation": generation, "clientCommandId": key,
            "resourceId": resource["id"], "expectedRevision": resource["revision"], "payload": {},
        }, headers={"X-Workspace-Generation": generation, "Idempotency-Key": key,
                    "If-Match": f'"{generation}:{resource["revision"]}"'})
        assert response.status_code == 200, response.text
        resource = response.json()["resource"]
        assert resource["versions"]
        assert resource["id"] not in {item["id"] for item in app.state.repository.meta["filters"]}
        assert resource["id"] in {item["id"] for item in app.state.preferences.capture()["catalogs"]["filters"]}
        yield app, client, source_ids, {"filterId": resource["id"], "filterVersion": 1}
    assert all(path.read_bytes() == original for path, original in originals.items())


def availability_request(filters):
    return {"definitionVersion": 2, "range": {"from": "2024-01-10T00:00:00Z", "to": "2024-01-11T00:00:00Z"},
            "filters": filters}


def test_personal_published_filter_matches_query_scope_and_active_source_intersection(preferences_archive):
    app, client, sources, saved = preferences_archive
    query = ready(client, client.post(BASE + "/query-sessions", json={
        "definitionVersion": 2, "domain": {"from": "2024-01-01T00:00:00Z", "to": "2024-02-01T00:00:00Z"},
        "filters": saved}))
    assert query["baseTotal"] == 1
    url = BASE + "/query-sessions/" + query["queryId"]
    try:
        response = client.post(url + "/records/query", json={"definitionVersion": 2})
        assert response.status_code == 200, response.text
        assert {item["record"]["sourceId"] for item in response.json()["items"]} == {sources["SECOND"]}
    finally:
        assert client.delete(url).status_code == 204

    selections = [({}, [sources["SECOND"]]),
                  ({"sourceId": sources["SECOND"], "sourceIds": list(sources.values())}, [sources["SECOND"]]),
                  ({"sourceId": sources["FIRST"]}, []), ({"sourceIds": [sources["FIRST"]]}, [])]
    for selection, expected in selections:
        response = client.post(BASE + "/date-availability", json=availability_request({**saved, **selection}))
        assert response.status_code == 200, response.text
        value = response.json()
        assert value["complete"] is True
        assert [source["sourceId"] for source in value["sources"]] == expected
        assert value["previous"] is None
        assert value["next"] == ("2024-01-20T12:00:00.000Z" if expected else None)
        assert value["preferencesRevision"] == app.state.preferences.revision


def test_private_filter_availability_is_hidden_from_another_principal(preferences_archive):
    _, client, sources, saved = preferences_archive
    _, _, reader_headers = create_identity(client, list(sources.values()))
    public = client.post(BASE + "/date-availability", json=availability_request({}), headers=reader_headers)
    assert public.status_code == 200, public.text
    assert {item["sourceId"] for item in public.json()["sources"]} == set(sources.values())
    response = client.post(BASE + "/date-availability", json=availability_request(saved), headers=reader_headers)
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "configuration_not_found"
    assert "sources" not in response.json()
