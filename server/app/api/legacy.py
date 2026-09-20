"""Bounded legacy envelopes over the authorized, immutable query service."""
import asyncio
import copy
import json
import time
from collections import Counter

import anyio
from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from ..models.domain import DomainError, instant_ms, iso_from_ms, json_bytes
from ..services.legacy_json import legacy_instant
from ..services.grouping_fields import encounter_key
from ..services.safe_regex import compile_regex, create_regex_budget
from .changes import BoundedStreamResponse, frame


MAX_RECORDS = 10000
MAX_BYTES = 8 * 1024 * 1024
STREAM_SECONDS = 5


def legacy_events(records, matching=None, source_ids=()):
    """Retain legacy data/render fields and rebuild activities without losing IDs."""
    nodes, roots = {}, []
    records = sorted(records, key=encounter_key(source_ids))
    for record in records:
        legacy = record.get("extensions", {}).get("legacy", {})
        item = copy.deepcopy(legacy.get("original", {}))
        item.update(id=legacy.get("id") if legacy.get("id") not in (None, "") else record["id"],
                    start=record["start"], end=record["end"] or "",
                    data=copy.deepcopy(record["data"].get("legacy", record["data"])))
        item["data"].setdefault("title", record["title"])
        item["data"].setdefault("namespace", record["data"].get("namespace", record["sourceId"]))
        item.setdefault("render", copy.deepcopy(record.get("render", {})))
        if matching is not None and record["id"] in matching:
            item["render"]["backgroundColor"] = "#F8DF09"
        item["canonicalId"] = record["id"]
        nodes[record["id"]] = item
    for record in records:
        item = nodes[record["id"]]
        parent = nodes.get(record["parentSessionId"])
        if parent is None:
            roots.append(item)
        else:
            parent.setdefault("activities", []).append(item)
    return roots


def legacy_predicate(text):
    """Bounded include|exclude, semicolon OR and plus AND compatibility subset."""
    if len(text) > 4096 or text.count("|") > 1:
        raise DomainError("legacy_filter_unsupported", "Use one include|exclude separator and a bounded filter.", 422)
    parts = (text.split("|", 1) + [""])[:2]
    budget = create_regex_budget()
    def compile_part(value):
        if not value:
            return []
        alternatives = []
        for alternative in value.split(";"):
            terms = []
            for term in alternative.split("+"):
                if not term or "=" in term or any(char in term for char in "\\[]{}()"):
                    raise DomainError("legacy_filter_unsupported", "Ambiguous legacy filter; use the typed filter editor for equality, escaping or complex regex.", 422)
                terms.append(compile_regex(term, budget=budget)["test"])
            alternatives.append(terms)
        return alternatives
    include, exclude = map(compile_part, parts)
    def matches(item):
        value = json.dumps(item, ensure_ascii=False, separators=(",", ":")).replace('"', '')
        def match(alternatives):
            return any(all(test(value) for test in terms) for terms in alternatives)
        return (not exclude or not match(exclude)) and (not include or match(include))
    return matches


def legacy_router(authenticated, read_body):
    router = APIRouter(dependencies=[Depends(authenticated)])
    streams = Counter()

    async def call(request, operation, *args):
        return await run_in_threadpool(request.app.state.preparations.dispatch, request.state.identity, operation, *args)

    async def parameters(request):
        if len(request.url.query.encode()) > 16384:
            raise DomainError("request_too_large", "Legacy query parameters exceed 16 KiB.", 413)
        values = dict(request.query_params)
        if any(len(request.query_params.getlist(key)) != 1 for key in values):
            raise DomainError("invalid_request", "Duplicate legacy parameters are ambiguous.", 422)
        if any(len(value) > 4096 for value in values.values()):
            raise DomainError("request_too_large", "Legacy parameter exceeds 4096 characters.", 413)
        return values

    async def filters(request, params):
        service, actor = request.app.state.configuration, request.state.identity
        listing = await run_in_threadpool(service.list_resources, actor, "filters", False)
        effective = (await run_in_threadpool(service.get_effective, actor))["values"]
        items = []
        for resource in listing["items"]:
            detail = (await run_in_threadpool(service.get_resource, actor, "filters", resource["id"]))["resource"]
            if not detail["versions"]:
                continue
            publication = max(detail["versions"], key=lambda value: value["version"])
            definition = publication["definition"]
            original = definition.get("migration", {}).get("original", {})
            selected = resource["id"] == effective.get("filterId")
            grouping = effective.get("presentation", {}).get("grouping") if selected else None
            path = grouping.get("field", "") if grouping else ""
            sort_by = original.get("sortBy", path.removeprefix("/data/legacy/").removeprefix("/data/").replace("/", ".") if path else "NONE")
            raw_filter = original.get("include", "") + ("|" + original["exclude"] if original.get("exclude") else "")
            items.append({"id": resource["id"], "name": resource["name"], "filter_value": raw_filter,
                          "sortBy": sort_by, "current": "yes" if resource["name"] == params.get("filterName") or (not params.get("filterName") and selected) else "no",
                          "canonicalDefinition": definition, "filterVersion": publication["version"],
                          "expressionFormat": "legacy" if original else "canonical",
                          "publishedVersions": resource["publishedVersions"]})
        if not items:
            items = [{"name": "ALL", "filter_value": "", "sortBy": "NONE", "current": "yes"},
                     {"name": "BY_NAMESPACE", "filter_value": "", "sortBy": "namespace", "current": "no"}]
        return {"dateTimeFormat": "iso8601", "scene": params.get("scene", "0"),
                "openbexi_timeline": [{"name": params.get("timelineName", "OpenBEXI Timeline"),
                    "user": actor["name"] if "name" in actor else actor["id"], "filters": items}]}

    async def sessions(request, params, descriptor=False):
        access, actor = request.app.state.access, request.state.identity
        metadata = await run_in_threadpool(access.metadata, actor)
        effective = (await run_in_threadpool(request.app.state.configuration.get_effective, actor))["values"]
        domain = effective["range"]
        if descriptor and not params.get("event_id"):
            raise DomainError("descriptor_unavailable", "readDescriptor requires event_id.", 422)
        if descriptor and params.get("start"):
            start = legacy_instant(params["start"], default_timezone="UTC")
            domain = {"from": start, "to": iso_from_ms(instant_ms(start) + 1)}
        elif "startDate" in params or "endDate" in params:
            if not params.get("startDate") or not params.get("endDate"):
                raise DomainError("invalid_range", "Both startDate and endDate are required.", 422)
            domain = {"from": legacy_instant(params["startDate"], default_timezone="UTC"),
                      "to": legacy_instant(params["endDate"], default_timezone="UTC")}
        namespace = params.get("namespace", "")
        selected = {}
        if namespace not in ("", "ALL", "all", "*", "0", "undefined", "null"):
            listing = await run_in_threadpool(request.app.state.configuration.list_resources, actor, "sources", False)
            sources = [source["id"] for source in listing["items"] if source["id"] in metadata["sourceIds"] and namespace in (source["id"], source["name"])]
            if not sources:
                raise DomainError("source_not_found", "Requested namespace is unavailable.", 404)
            selected["sourceIds"] = sources
        name = params.get("filterName", "")
        if name:
            listing = await run_in_threadpool(request.app.state.configuration.list_resources, actor, "filters", False)
            candidates = [item for item in listing["items"] if name in (item["name"], item["id"])]
            if len(candidates) > 1:
                raise DomainError("ambiguous_filter", "Use the saved filter ID; this name is not unique.", 409)
            if candidates and candidates[0]["publishedVersions"]:
                selected.update(filterId=candidates[0]["id"], filterVersion=max(candidates[0]["publishedVersions"]))
            elif name not in ("ALL", "BY_NAMESPACE"):
                raise DomainError("filter_not_found", "Requested saved filter is unavailable.", 404)
        elif effective.get("filterId") is not None:
            selected.update(filterId=effective["filterId"], filterVersion=effective["filterVersion"])
        predicate = legacy_predicate(params.get("filter", ""))
        query = None
        try:
            query = await call(request, "create_query", {"definitionVersion": 2, "relationshipMode": "family",
                "domain": domain, "scaleMode": "uniform", "filters": selected,
                **({"search": params["search"]} if "search" in params else {})})
            query_id = query["queryId"]
            while query.get("state") == "preparing":
                if await request.is_disconnected():
                    raise DomainError("client_disconnected", "Legacy request disconnected.", 409)
                await asyncio.sleep(.025)
                query = await call(request, "get_query", query_id)
            if query.get("state") == "failed":
                error = query["error"]
                raise DomainError(error["code"], error["message"], error["status"])
            records, cursor, used, matching = [], None, 0, set()
            def admit(record):
                nonlocal used
                used += len(json_bytes(record))
                if used > MAX_BYTES or len(records) >= MAX_RECORDS:
                    raise DomainError("legacy_window_limit", "Legacy window exceeds 10000 records or 8 MiB; request a narrower interval.", 413)
                records.append(record)
            while True:
                page = await call(request, "query_records", query_id,
                    {"definitionVersion": 2, "scope": "all", "projection": "context", "limit": 1000, **({"cursor": cursor} if cursor else {})})
                for item in page["items"]:
                    admit(item["record"])
                    if item["match"]:
                        matching.add(item["record"]["id"])
                cursor = page["nextCursor"]
                if not cursor:
                    break
            # Authorized ancestor context can lie outside the requested interval.
            # Inspect only referenced parents, through the same pinned query scope.
            ids = {record["id"] for record in records}
            for record in records:
                parent = record.get("parentSessionId")
                if parent and parent not in ids:
                    context = await call(request, "query_record", query_id, parent)
                    admit(context["record"])
                    ids.add(parent)
            if descriptor:
                identity = params.get("event_id")
                found = [record for record in records if identity in (record["id"], str(record.get("extensions", {}).get("legacy", {}).get("id")))]
                if len(found) != 1:
                    raise DomainError("descriptor_unavailable", "Use a unique event_id, namespace and start for the descriptor.", 404)
                record = found[0]
                if not getattr(request.app.state.repository, "reader", None):
                    raise DomainError("descriptor_unavailable", "This workspace has no external descriptors.", 404)
                result = await run_in_threadpool(request.app.state.repository.reader.descriptor, record)
                await call(request, "query_record", query_id, record["id"])
                if result["status"] != "current":
                    raise DomainError("descriptor_unavailable", "The source descriptor is missing or unavailable.", 404)
                return {"event_descriptor": [result["descriptor"]], "scene": params.get("scene", "0")}
            active_search = params.get("search", effective.get("search", {}).get("text", ""))
            reader = getattr(request.app.state.repository, "reader", None)
            source_ids = [source.id for source in reader.sources] if reader else ()
            events = [item for item in legacy_events(records, matching if active_search else None, source_ids) if predicate(item)]
            result = {"dateTimeFormat": "iso8601", "scene": params.get("scene", "0"), "events": events,
                      "coverage": query.get("coverage"), "queryRevision": query["revision"]}
            if len(json_bytes(result)) > MAX_BYTES:
                raise DomainError("legacy_window_limit", "Serialized legacy response exceeds 8 MiB; request a narrower interval.", 413)
            return result
        finally:
            if query is not None:
                try:
                    with anyio.CancelScope(shield=True):
                        await call(request, "release_query", query["queryId"])
                except DomainError as error:
                    if error.status not in (401, 403, 404, 409, 410):
                        raise

    async def read(request, params):
        action = params.get("ob_request", "sessions")
        if action == "readFilters":
            return await filters(request, params)
        if action in ("sessions", "readDescriptor"):
            return await sessions(request, params, action == "readDescriptor")
        raise DomainError("legacy_action_requires_post", "This action requires POST and validated write preconditions.", 405)

    @router.get("/openbexi_timeline/sessions")
    async def legacy_sessions(request: Request):
        return await read(request, await parameters(request))

    @router.post("/openbexi_timeline/sessions")
    async def legacy_action(request: Request):
        params = await parameters(request)
        action = params.get("ob_request", "sessions")
        if action in ("sessions", "readFilters", "readDescriptor"):
            return await read(request, params)
        payload = await read_body(request)
        if action == "addEvent":
            return await run_in_threadpool(request.app.state.access.mutate, request.state.identity, "create", None, payload,
                request.headers.get("x-workspace-generation"), request.headers.get("if-match"), request.headers.get("idempotency-key"),
                request_route=request.url.path)
        operations = {"addFilter": "create", "updateFilter": "update", "saveFilter": "publish", "deleteFilter": "delete"}
        if action not in operations or payload.get("family") != "filters" or payload.get("type") != operations[action]:
            raise DomainError("legacy_action_unsupported", "Supply the matching canonical filter command with generation, revision and idempotency preconditions.", 422)
        return await run_in_threadpool(request.app.state.configuration.mutate, request.state.identity, payload,
            request.headers.get("x-workspace-generation"), request.headers.get("idempotency-key"), request.headers.get("if-match"))

    @router.get("/openbexi_timeline_sse/sessions")
    async def legacy_stream(request: Request):
        params = await parameters(request)
        principal = request.state.identity["id"]
        if sum(streams.values()) >= 32 or streams[principal] >= 2:
            raise DomainError("stream_capacity", "Legacy stream capacity is in use; close the previous stream.", 429)
        streams[principal] += 1
        released = False
        def release():
            nonlocal released
            if not released:
                released = True
                streams[principal] -= 1
                if not streams[principal]:
                    del streams[principal]
        try:
            initial = await read(request, params)
        except BaseException:
            release()
            raise
        async def events():
            try:
                yield "retry: 1000\ndata: " + json.dumps(initial, ensure_ascii=True, separators=(",", ":")) + "\n\n"
                deadline = time.monotonic() + STREAM_SECONDS
                while time.monotonic() < deadline:
                    await asyncio.sleep(1)
                    if await request.is_disconnected():
                        return
                    try:
                        await authenticated(request)
                        await run_in_threadpool(request.app.state.access.metadata, request.state.identity)
                    except DomainError as error:
                        yield frame("error", {"code": error.code, "status": error.status})
                        return
                    yield ": heartbeat\n\n"
            finally:
                release()
        return BoundedStreamResponse(events(), release)

    return router
