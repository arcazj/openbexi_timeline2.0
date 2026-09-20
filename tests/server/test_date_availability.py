import pytest

from conftest import BASE
from test_identity_api import create_identity
from test_openapi import response_matches
from server.app.api.openapi import build_contract
from server.app.models.domain import DomainError, instant_ms
from server.app.services.date_availability import DateAvailability, record_intervals, request_range


def at(day):
    return f"2024-01-{day:02d}T12:00:00.000Z"


def point(day):
    return {"start": at(day), "end": None, "kind": "event", "deletedAt": None}


def test_sparse_dates_source_scope_deleted_records_and_half_open_sessions():
    availability = DateAvailability({"one": record_intervals([point(1), point(20), {**point(10), "deletedAt": at(11)}]),
        "two": record_intervals([{**point(12), "kind": "session", "end": at(14)}])})
    request = {"range": {"from": at(10), "to": at(11)}}
    assert availability.read(["one", "two"], request)["next"] == at(12)
    assert availability.read(["one"], request)["next"] == at(20)
    assert availability.read(["one"], request)["previous"] == at(1)
    assert availability.read([], request)["sources"] == []
    end = availability.read(["two"], {"range": {"from": at(14), "to": at(15)}})
    assert end["previous"] == "2024-01-14T11:59:59.999Z"
    assert end["next"] is None


def test_ongoing_and_negative_years_keep_chronological_dates():
    early, late = "-000500-01-01T00:00:00.000Z", "-000200-01-01T00:00:00.000Z"
    availability = DateAvailability({"one": [[instant_ms(early), instant_ms(early) + 1]],
                                     "two": [[instant_ms(late), instant_ms(late) + 1]]})
    assert availability.read(["one", "two"], {"range": {"from": at(1), "to": at(2)}})["previous"] == late
    ongoing = DateAvailability({"one": record_intervals([{**point(1), "kind": "session"}])})
    value = ongoing.read(["one"], {"range": {"from": at(5), "to": at(6)}})
    assert value["next"] == at(6)
    assert value["sources"][0]["ongoing"] is True
    assert value["sources"][0]["last"] is None


def test_last_supported_millisecond_event_is_not_an_ongoing_session():
    last = "9999-12-31T23:59:59.999Z"
    value = DateAvailability({"one": record_intervals([{**point(1), "start": last}])}).read(
        ["one"], {"range": {"from": at(1), "to": at(2)}})
    assert value["sources"][0]["last"] == last
    assert value["sources"][0]["ongoing"] is False


@pytest.mark.parametrize("payload", [None, {}, {"range": {}}, {"range": {"from": 0, "to": 1}},
    {"range": {"from": at(2), "to": at(1)}}, {"range": {"from": at(1), "to": at(2), "extra": 1}}])
def test_invalid_ranges(payload):
    with pytest.raises(DomainError):
        request_range(payload)


def test_http_dates_are_authorized_and_source_selected_even_with_record_filters(client, app):
    _, _, headers = create_identity(client, ["operations"])
    request = {"range": {"from": "2020-01-01T00:00:00Z", "to": "2020-01-02T00:00:00Z"},
               "filters": {"sourceIds": ["operations", "verification"], "kinds": []}}
    response = client.post(BASE + "/date-availability", json=request, headers=headers)
    assert response.status_code == 200, response.text
    value = response.json()
    assert [source["sourceId"] for source in value["sources"]] == ["operations"]
    assert value["next"] is not None
    assert value["scope"] == "selected-sources"
    response_matches(build_contract(app), BASE + "/date-availability", "POST", response)
    request["filters"] = {"sourceId": "verification"}
    assert client.post(BASE + "/date-availability", json=request, headers=headers).json()["sources"] == []
    assert client.post(BASE + "/date-availability", json=request, headers={"Authorization": "Bearer invalid"}).status_code == 401
