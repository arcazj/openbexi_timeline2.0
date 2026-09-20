"""Keep benchmark evidence honest when asynchronous APIs fail or inputs change."""
import importlib.util
import os

import httpx
import pytest

from conftest import ROOT

SPEC = importlib.util.spec_from_file_location("archive_benchmark", ROOT / "scripts/benchmark-archive.py")
benchmark = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark)


def test_archive_receipt_detects_same_size_record_changes_even_with_restored_mtime(tmp_path):
    events = tmp_path / "events.json"
    events.write_text('{"events": [1]}', encoding="utf-8")
    descriptor = tmp_path / "descriptor.json"
    descriptor.write_text('{"description": "note"}', encoding="utf-8")
    before = benchmark.archive_inventory([tmp_path])
    stamp = events.stat()
    events.write_text('{"events": [2]}', encoding="utf-8")
    os.utime(events, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    after = benchmark.archive_inventory([tmp_path])
    assert before[0]["files"] == 2
    assert before[0]["fileMetadataSha256"] == after[0]["fileMetadataSha256"]
    assert before[0]["partitionFileSha256"] != after[0]["partitionFileSha256"]


def test_readiness_follows_async_location_and_rejects_failed_preparation():
    responses = iter([
        httpx.Response(202, headers={"location": "/prepared/one"}),
        httpx.Response(200, json={"state": "failed", "error": {"code": "preparation_timeout"}}),
    ])

    class Client:
        def get(self, location):
            assert location == "/prepared/one"
            return next(responses)

    with pytest.raises(RuntimeError, match="preparation_timeout"):
        benchmark.ready(Client(), httpx.Response(202, headers={"location": "/prepared/one"}))


def test_readiness_deadline_never_accepts_pending_work_as_success():
    with pytest.raises(TimeoutError, match="deadline"):
        benchmark.ready(None, httpx.Response(202, headers={"location": "/never-ready"}), timeout=0)
