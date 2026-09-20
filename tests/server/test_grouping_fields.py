import copy
import json
import shutil
import subprocess

import pytest

from conftest import ROOT
from server.app.services.grouping_fields import GROUPING_LIMITS, discover_grouping_fields
from test_presentation import engine_records


def node(script, payload):
    result = subprocess.run([shutil.which("node"), "--input-type=module", "-e", script],
                            cwd=ROOT, input=json.dumps(payload), encoding="utf-8", capture_output=True, check=True, timeout=30)
    return json.loads(result.stdout)


def metadata_records():
    return [
        {"id": "one", "sourceId": "S1", "order": 0, "data": {"status": "1", "title": "hidden", "description": "hidden",
             "legacy": {"status": "1", "magType": "mw"}, "mixed": 1, "shape": "x", "\U0001f600": True, "\uffff": 1}},
        {"id": "two", "sourceId": "S1", "order": 1, "data": {"status": 1, "later": True, "mixed": None,
             "nested": {"a/b": False, "~": "value"}, "shape": {"child": "yes"}}},
    ]


@pytest.mark.parametrize("limits", [GROUPING_LIMITS, {**GROUPING_LIMITS, "records": 1}, {**GROUPING_LIMITS, "fields": 2}, {**GROUPING_LIMITS, "nodes": 3}])
def test_observed_inventory_has_exact_python_javascript_parity_and_bounded_work(limits):
    records = metadata_records()
    before = copy.deepcopy(records)
    expected = discover_grouping_fields(records, limits=limits)
    script = """import fs from 'node:fs';
      import {discoverGroupingFieldsSteps} from './client/src/data/grouping-fields.js';
      import {drainQuerySteps} from './client/src/data/query-work.js';
      const p = JSON.parse(fs.readFileSync(0, 'utf8'));
      process.stdout.write(JSON.stringify(drainQuerySteps(discoverGroupingFieldsSteps(p.records, {limits:p.limits}))));"""
    assert node(script, {"records": records, "limits": limits}) == expected
    assert discover_grouping_fields(list(reversed(records)), limits=limits) == expected
    assert records == before
    assert len(expected["fields"]) <= limits["fields"]
    if limits == GROUPING_LIMITS:
        assert expected["complete"]
        fields = {field["path"]: field for field in expected["fields"]}
        assert fields["/data/status"]["types"] == ["number", "string"]
        assert fields["/data/legacy/magType"]["label"] == "magType"
        assert "/data/shape" not in fields
        assert "/data/legacy/status" not in fields
    else:
        assert expected["truncated"] and not expected["complete"]


def test_query_inventory_respects_domain_and_source_selection_before_pagination(bundle):
    engine, snapshot = engine_records(bundle, 4)
    source = snapshot["records"][0]["sourceId"]
    snapshot["records"][0]["data"] = {"status": "ok"}
    snapshot["records"][1]["data"] = {"later": True}
    snapshot["records"][2].update(data={"futureOnly": True}, start="2027-01-01T00:00:00.000Z", end="2027-01-02T00:00:00.000Z")
    snapshot["records"][3].update(data={"otherSourceOnly": True}, sourceId="other-source")
    query = engine.create_query({"domain": {"from": "2026-09-12T10:00:00.000Z", "to": "2026-09-12T14:00:00.000Z"},
                                 "filters": {"sourceIds": [source]}})
    assert [field["path"] for field in query["groupingFields"]["fields"]] == ["/data/later", "/data/status"]
    assert "/data/later" not in query["fieldTypes"]
    engine.close()


def test_parent_family_grouping_and_encounter_order_match_local_through_pagination(bundle):
    engine, snapshot = engine_records(bundle, 5)
    records = snapshot["records"]
    for index, record in enumerate(records):
        record.update(order=index, render={}, data={"status": ["Z", "A", 1, "1", None][index]},
                      extensions={"legacy": {"file": "a.json", "pointer": "/events/" + str(index)}})
    records[1]["parentSessionId"] = records[0]["id"]
    domain = {"from": "2026-09-12T10:00:00.000Z", "to": "2026-09-12T14:00:00.000Z"}
    presentation = {"version": 1, "grouping": {"field": "/data/status", "direction": "asc", "recordPolicy": "parent-family", "order": "encounter"},
                    "nesting": {"enabled": True}}
    query = engine.create_query({"domain": domain, "definitionVersion": 2})
    for height in (128, 480):
        request = {**domain, "mapId": query["mapId"], "width": 800, "availableHeight": height, "rowHeight": 32, "fontSize": 13, "definitionVersion": 2, "presentation": presentation}
        manifest = engine.create_layout(query["queryId"], request)
        pages, page = [], engine.rows(query["queryId"], manifest["layoutId"])
        while True:
            pages.append(page)
            if not page["nextCursor"]:
                break
            page = engine.rows(query["queryId"], manifest["layoutId"], page["nextCursor"])
        rows = [row for page in pages for row in page["rows"]]
        groups = list(dict.fromkeys(row["key"] for row in rows if row["type"] == "group"))
        items = [item for page in pages for item in page["items"]]
        expected = {"groups": groups, "items": [{"id": item["record"]["id"], "depth": item["depth"], "row": item["row"]} for item in items]}
        script = """import fs from 'node:fs'; import {buildLayout} from './client/src/timeline/layout.js';
          const p = JSON.parse(fs.readFileSync(0,'utf8'));
          const request = {...p.request,from:Date.parse(p.request.from),to:Date.parse(p.request.to)};
          const map = {knots:[{timeMs:request.from,u:'0'},{timeMs:request.to,u:'1'}]};
          const r = buildLayout(p.records.reverse(),map,request);
          process.stdout.write(JSON.stringify({groups:[...new Set(r.rows.filter(x=>x.type==='group').map(x=>x.key))],
            items:r.items.map(x=>({id:x.record.id,depth:x.depth,row:x.row}))}));"""
        assert node(script, {"records": records, "request": request}) == expected
        assert groups == ["string:Z", "number:1", "string:1", "null:"]
        assert next(item for item in items if item["record"]["id"] == records[1]["id"])["depth"] == 1
        engine.release_layout(query["queryId"], manifest["layoutId"])
    engine.close()


def test_encounter_group_headers_keep_chronological_independent_rows_in_both_providers(bundle):
    engine, snapshot = engine_records(bundle, 4)
    records = snapshot["records"]
    for index, (record, hour) in enumerate(zip(records, [12, 13, 10, 11])):
        record.update(order=index, render={}, data={"status": "Z" if index == 0 else "A"},
                      start=f"2026-09-12T{hour:02d}:00:00.000Z",
                      end=f"2026-09-12T{hour + 1:02d}:00:00.000Z",
                      extensions={"legacy": {"file": "a.json", "pointer": "/events/" + str(index)}})
    domain = {"from": "2026-09-12T10:00:00.000Z", "to": "2026-09-12T15:00:00.000Z"}
    query = engine.create_query({"domain": domain})
    request = {**domain, "mapId": query["mapId"], "width": 800, "availableHeight": 480,
               "rowHeight": 32, "fontSize": 13,
               "presentation": {"version": 1, "grouping": {"field": "/data/status", "order": "encounter",
                                  "recordPolicy": "parent-family"}, "nesting": {"enabled": True}}}
    manifest = engine.create_layout(query["queryId"], request)
    page = engine.rows(query["queryId"], manifest["layoutId"])
    expected = {"groups": [row["key"] for row in page["rows"] if row["type"] == "group"],
                "items": [{"id": item["record"]["id"], "row": item["row"]} for item in page["items"]]}
    script = """import fs from 'node:fs'; import {buildLayout} from './client/src/timeline/layout.js';
      const p = JSON.parse(fs.readFileSync(0,'utf8'));
      const request = {...p.request,from:Date.parse(p.request.from),to:Date.parse(p.request.to)};
      const r = buildLayout(p.records.reverse(),{knots:[{timeMs:request.from,u:'0'},{timeMs:request.to,u:'1'}]},request);
      process.stdout.write(JSON.stringify({groups:r.rows.filter(x=>x.type==='group').map(x=>x.key),
        items:r.items.map(x=>({id:x.record.id,row:x.row}))}));"""
    assert node(script, {"records": records, "request": request}) == expected
    assert expected["groups"] == ["string:Z", "string:A"]
    assert [item["id"] for item in expected["items"]] == [records[index]["id"] for index in [0, 2, 3, 1]]
    engine.close()
