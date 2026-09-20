"""Measure the copied multi-source archive through the real ASGI API.

Run with the project environment (development dependencies required). Fresh
mutable state and the JSON report are retained under ignored runtime/. This is
a diagnostic sample, not a browser, physical-disk, or release performance gate.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import platform
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
BASE = "/api/v1/workspaces/default"
TOKEN = "archive-benchmark-local-identity"
DOMAIN = {"from": "2024-03-17T00:00:00Z", "to": "2024-03-25T00:00:00Z"}
PAN_DAYS = ("2024-03-17", "2024-03-24", "2024-03-25", "2024-11-11")


def emit(value):
    print(json.dumps(value, ensure_ascii=True, allow_nan=False), flush=True)


def archive_inventory(roots):
    """Content hashes for record files, metadata receipt for every archive file.

    This deliberately does not read 120k descriptor payloads or treat mtime as a
    content proof. Reading event files here also means disk caches are uncontrolled.
    """
    result = []
    for root in roots:
        digest, events, count, size = hashlib.sha256(), {}, 0, 0
        for directory, children, names in os.walk(root):
            children.sort()
            for name in sorted(names):
                path = Path(directory) / name
                info, relative = path.stat(), path.relative_to(root).as_posix()
                digest.update(json.dumps([relative, info.st_size, info.st_mtime_ns], separators=(",", ":")).encode())
                count += 1
                size += info.st_size
                if name in ("events.json", "zones.json"):
                    events[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        result.append({"source": root.name, "files": count, "bytes": size,
                       "fileMetadataSha256": digest.hexdigest(), "partitionFileSha256": events})
    return result


def ready(client, response, timeout=45):
    deadline, polls = time.monotonic() + timeout, 0
    while response.status_code == 202:
        if time.monotonic() >= deadline:
            raise TimeoutError("API preparation exceeded its benchmark deadline")
        location = response.headers["location"]
        time.sleep(.01)
        response = client.get(location)
        polls += 1
    if response.status_code != 200:
        raise RuntimeError(f"API returned {response.status_code}: {response.text[:1000]}")
    value = response.json()
    if value.get("state", "ready") != "ready":
        raise RuntimeError(f"API preparation failed: {value}")
    return value, polls


def metric_delta(before, after):
    return {key: after.get(key, 0) - before.get(key, 0)
            for key in ("windowReads", "bytesRead", "indexFilesRead", "indexFilesReused", "prefetches")}


def summarize(phases):
    groups = {}
    for item in phases:
        if item["status"] == "ok":
            groups.setdefault(item["name"], []).append(item["milliseconds"])
    return {key: {"samples": len(values), "minMs": min(values), "medianMs": statistics.median(values),
                  "maxMs": max(values)} for key, values in groups.items()}


def source_evidence():
    paths = [Path(__file__), ROOT / "yaml/multiple_sources_test.yml", ROOT / "models/multiple_sources_test.json",
             ROOT / "filters/multiple_sources_test.json", *sorted((ROOT / "server/app").rglob("*.py"))]
    return {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


def receipt_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def worker(directory, rounds, index_timeout):
    imported = time.perf_counter()
    from fastapi.testclient import TestClient
    from server.app.main import create_app
    from server.app.models.domain import instant_ms, iso_from_ms
    from server.app.services.launch_configuration import load_launch_configuration

    spec = importlib.util.spec_from_file_location("server_benchmark_memory", ROOT / "scripts/benchmark-server.py")
    memory_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(memory_module)
    memory_bytes = memory_module.memory_bytes
    import_ms = (time.perf_counter() - imported) * 1000
    source_before = source_evidence()
    roots = [ROOT / "data/SOURCES1/2024", ROOT / "data/SOURCES2/2024"]
    inventory_before = archive_inventory(roots)
    # The year is the root of the measured archive; report useful source names.
    for item, root in zip(inventory_before, roots):
        item["source"] = root.parent.name
    state = directory / "state"
    if state.exists():
        raise ValueError("A benchmark must start with a fresh state directory")
    app, client, entered = None, None, False
    report = {"formatVersion": 1, "status": "running", "rounds": rounds,
              "measuredAt": datetime.now(timezone.utc).isoformat(),
              "baseCommit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
                                           text=True, check=True).stdout.strip(),
              "environment": {"python": platform.python_version(), "platform": platform.platform(),
                              "logicalCpuCount": os.cpu_count(), "processor": platform.processor()},
              "qualification": "Single fresh-process diagnostic run; ASGI API and async preparation, no TCP or browser. "
                               "OS file cache and competing host workloads are uncontrolled. No latency SLO claim.",
              "importMilliseconds": import_ms, "archiveBefore": inventory_before,
              "sourceSha256": source_before, "sourceTreeSha256": receipt_digest(source_before),
              "archiveReceiptSha256": receipt_digest(inventory_before), "phases": []}

    def repository_metrics():
        repository = getattr(app.state, "repository", None) if app else None
        return repository.loading_status() if repository and repository.available else {}

    def measure(name, operation, **context):
        before, before_loading = memory_bytes(), repository_metrics()
        sampled, stop = [before["rss"] or 0], threading.Event()

        def sample():
            while not stop.wait(.025):
                sampled[0] = max(sampled[0], memory_bytes()["rss"] or 0)

        sampler = threading.Thread(target=sample, daemon=True)
        sampler.start()
        started = time.perf_counter()
        item = {"name": name, "status": "ok", **context}
        try:
            item["details"] = operation()
        except Exception as error:
            item.update(status="failed", error={"type": type(error).__name__, "message": str(error)})
            raise
        finally:
            item["milliseconds"] = (time.perf_counter() - started) * 1000
            stop.set()
            sampler.join(timeout=1)
            after = memory_bytes()
            loading = repository_metrics()
            item.update(rssBefore=before["rss"], rssAfter=after["rss"],
                        sampledPeakRss=max(sampled[0], after["rss"] or 0) or None,
                        processPeakRss=after["processPeakRss"], loading=loading,
                        metricDelta=metric_delta(before_loading.get("metrics", {}), loading.get("metrics", {})))
            report["phases"].append(item)
            emit({"event": "phase", **item})

    def start():
        nonlocal app, client, entered
        settings = load_launch_configuration(ROOT / "yaml/multiple_sources_test.yml")
        options = {"yaml": str(settings["source_yaml"]), "sourceDocument": settings["source_document"],
                   "legacyRoot": str(settings["legacy_root"]), "allowRoots": settings["allow_root"],
                   "model": str(settings["model"]), "modelRoot": str(settings["model_root"]),
                   "namespaceGrouping": settings["namespace_grouping"], "launch": settings["launch"],
                   "loading": settings["loading"], "lazy": True,
                   "preferencesRoot": str(state / "preferences")}
        report["loadingConfiguration"] = settings["loading"]
        app = create_app(state, TOKEN, legacy_config=options)
        client = TestClient(app, headers={"Authorization": "Bearer " + TOKEN})
        client.__enter__()
        entered = True
        response = client.get("/health/ready")
        if response.status_code != 200:
            raise RuntimeError(response.text)
        return {"ready": True, "recordCount": client.get(BASE).json()["recordCount"]}

    def view(domain, source="all", group="none"):
        query, polls = ready(client, client.post(BASE + "/query-sessions", json={
            "definitionVersion": 2, "domain": domain, "filters": {"sourceId": source}}))
        url = BASE + "/query-sessions/" + query["queryId"]
        try:
            presentation = copy.deepcopy(app.state.repository.meta["settings"].get("presentation", {"version": 1}))
            if group == "none":
                presentation.pop("grouping", None)
            else:
                presentation["grouping"] = {"field": group, "direction": "asc",
                                            "recordPolicy": "parent-family", "order": "encounter"}
            layout, layout_polls = ready(client, client.post(url + "/layouts", json={
                "definitionVersion": 2, "mapId": query["mapId"], **domain, "width": 1200,
                "availableHeight": 600, "presentation": presentation}))
            rows = client.get(url + "/layouts/" + layout["layoutId"] + "/rows")
            rows.raise_for_status()
            if layout["detailTotal"] <= 0:
                raise RuntimeError(f"Expected records in the copied archive's selected window: {domain}")
            return {"detailTotal": layout["detailTotal"], "totalRows": layout["totalRows"],
                    "pageItems": len(rows.json()["items"]), "responseBytes": len(rows.content),
                    "preparationPolls": polls + layout_polls}
        finally:
            response = client.delete(url)
            response.raise_for_status()

    def index():
        deadline = time.monotonic() + index_timeout
        next_progress = time.monotonic() + 15
        while time.monotonic() < deadline:
            status = repository_metrics()
            if status.get("complete"):
                return status
            if status.get("state") in ("failed", "incomplete"):
                raise RuntimeError(f"Archive index did not complete: {status}")
            if time.monotonic() >= next_progress:
                emit({"event": "index-progress", **status})
                next_progress = time.monotonic() + 15
            time.sleep(.1)
        raise TimeoutError(f"Archive index deadline exceeded: {repository_metrics()}")

    try:
        measure("fresh-state-startup", start)
        measure("first-visible-window", lambda: view(DOMAIN), domain=DOMAIN)
        measure("remaining-background-index", index)
        aliases = app.state.repository.configuration.aliases
        for round_number in range(rounds):
            for day in PAN_DAYS:
                low = day + "T00:00:00Z"
                domain = {"from": low, "to": iso_from_ms(instant_ms(low) + 86400000)}
                measure("pan-one-day", lambda: view(domain), round=round_number + 1, domain=domain)
            for alias in ("source1", "source2"):
                measure("filter-source", lambda: view(DOMAIN, aliases[alias]),
                        round=round_number + 1, source=alias, domain=DOMAIN)
            for group in ("/data/status", "/data/namespace"):
                measure("group-visible-window", lambda: view(DOMAIN, group=group),
                        round=round_number + 1, groupBy=group, domain=DOMAIN)
        query, _ = ready(client, client.post(BASE + "/query-sessions", json={"definitionVersion": 2, "domain": DOMAIN}))
        url = BASE + "/query-sessions/" + query["queryId"]
        try:
            def table(field):
                result = client.post(url + "/records/query", json={
                    "definitionVersion": 2, "sort": [{"field": field, "direction": "asc"}], "limit": 100})
                result.raise_for_status()
                value = result.json()
                return {"total": value["total"], "items": len(value["items"]), "responseBytes": len(result.content)}
            for round_number in range(rounds):
                for field in ("title", "data.status", "start"):
                    measure("table-sort-first-page", lambda: table(field), round=round_number + 1, field=field)
        finally:
            client.delete(url).raise_for_status()
        report["afterRelease"] = app.state.queries.resources.stats()
        report["status"] = "passed"
    except Exception as error:
        report.update(status="failed", error={"type": type(error).__name__, "message": str(error)})
    finally:
        if entered:
            client.__exit__(None, None, None)
        after = archive_inventory(roots)
        for item, root in zip(after, roots):
            item["source"] = root.parent.name
        report["archiveUnchanged"] = after == inventory_before
        report["sourceSha256After"] = source_evidence()
        report["sourceStateStable"] = report["sourceSha256After"] == source_before
        report["summary"] = summarize(report["phases"])
        report["finalMemory"] = memory_bytes()
        if not report["archiveUnchanged"] or not report["sourceStateStable"]:
            report["status"] = "failed"
        (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    emit({"event": "complete", "status": report["status"], "summary": report["summary"]})
    return 0 if report["status"] == "passed" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--index-timeout", type=int, default=180)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--worker-directory", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1 <= args.rounds <= 20 or not 1 <= args.index_timeout < args.timeout <= 1800:
        parser.error("rounds must be 1-20; 1 <= index-timeout < timeout <= 1800")
    if args.worker_directory:
        return worker(args.worker_directory, args.rounds, args.index_timeout)
    runtime = ROOT / "runtime"
    runtime.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="archive-benchmark-", dir=runtime))
    emit({"event": "start", "directory": str(directory)})
    command = [sys.executable, str(Path(__file__)), "--worker-directory", str(directory),
               "--rounds", str(args.rounds), "--index-timeout", str(args.index_timeout), "--timeout", str(args.timeout)]
    try:
        result = subprocess.run(command, cwd=ROOT, timeout=args.timeout)
    except subprocess.TimeoutExpired:
        (directory / "timeout.json").write_text(json.dumps({"status": "timed-out", "seconds": args.timeout}) + "\n")
        emit({"event": "timed-out", "directory": str(directory)})
        return 1
    emit({"event": "report", "path": str(directory / "report.json"), "exitCode": result.returncode})
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
