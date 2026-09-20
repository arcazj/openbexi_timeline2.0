import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess

import pytest
import yaml

from server.app.models.configuration_catalog import effective_settings
from server.app.models.domain import DomainError
from server.app.repositories.legacy_repository import LegacyRepository
from server.app.repositories.partitioned_legacy_repository import PartitionedLegacyRepository
from server.app.repositories.legacy_preferences import LegacyPreferencesRepository
from server.app.services.launch_configuration import load_launch_configuration
from server.app.services.legacy_sources import load_legacy_sources
from server.app.services.query_configuration import resolve_query_configuration


MODEL = {"params": [{"title": "Portable timeline", "date": "2024-01-01T00:00:00Z", "timeZone": "UTC"}],
         "bands": [{"name": "primary", "height": "75%", "intervalPixels": 100, "intervalUnit": "HOUR"},
                   {"name": "overview", "height": "25%", "intervalPixels": 100, "intervalUnit": "DAY"}]}


@pytest.fixture
def environment(tmp_path):
    for name in ("yaml", "models", "filters", "data"):
        (tmp_path / name).mkdir()
    partition = tmp_path / "data/2024/03/18"
    partition.mkdir(parents=True)
    (partition / "events.json").write_text(json.dumps({"events": [
        {"id": "one", "start": "2024-03-18T19:30:00Z", "data": {"title": "One", "status": "OK"}},
        {"id": "two", "start": "2024-03-18T20:30:00Z", "data": {"title": "Two", "status": "ERROR"}},
    ]}), encoding="utf-8")
    path = tmp_path / "yaml/test.yml"
    document = {"version": 2, "server": {"host": "127.0.0.1", "port": 8771, "local_browser": True, "state_root": "../var"},
                "model": "../models/test.json", "filter": "../filters/test.json",
                "data_sources": [{"id": "source1", "namespace": "SOURCE1", "type": "json_file", "enable": True,
                                  "data_path": "../data", "data_model": "yyyy/mm/dd", "identity_path": "tests/data/SOURCES1/yyyy/mm/dd"}]}
    filter_file = {"version": 1, "name": "ALL", "source_ids": ["source1"], "group_by": "status", "expression": None,
                   "search": {"text": "", "mode": "any"}}
    (tmp_path / "models/test.json").write_text(json.dumps(MODEL), encoding="utf-8")
    (tmp_path / "filters/test.json").write_text(json.dumps(filter_file), encoding="utf-8")
    path.write_text(yaml.safe_dump(document), encoding="utf-8")
    return path, document, filter_file


def options(settings):
    return {"yaml": str(settings["source_yaml"]), "sourceDocument": settings["source_document"],
            "legacyRoot": str(settings["legacy_root"]), "allowRoots": settings["allow_root"],
            "model": str(settings["model"]), "modelRoot": str(settings["model_root"]),
            "namespaceGrouping": settings["namespace_grouping"], "launch": settings["launch"], "loading": settings["loading"]}


def write_filter(environment):
    path, _, selected_filter = environment
    (path.parent.parent / "filters/test.json").write_text(json.dumps(selected_filter), encoding="utf-8")


@pytest.mark.parametrize("repository_type", [LegacyRepository, PartitionedLegacyRepository])
def test_now_never_selects_latest_archive_or_model_date(environment, repository_type, monkeypatch):
    path, _, _ = environment
    monkeypatch.setattr("server.app.services.launch_environment.now_iso", lambda: "2026-09-20T12:34:00Z")
    repository = repository_type(options(load_launch_configuration(path)), path.parent.parent / "var")
    try:
        repository.open()
        settings = effective_settings(repository.meta)["values"]
        assert settings["range"] == {"from": "2026-09-20T12:04:00.000Z", "to": "2026-09-20T13:04:00.000Z"}
        assert repository.meta["manifest"]["legacy"]["viewHints"]["focus"]["timestamp"] == "2026-09-20T12:34:00Z"
        assert settings["presentation"]["grouping"] == {"field": "/data/status", "direction": "asc", "recordPolicy": "parent-family", "order": "encounter"}
        assert repository.capture_query_domain({"domain": settings["range"]})["records"] == []
    finally:
        repository.close()


def test_explicit_filter_window_is_not_an_enduring_predicate(environment, monkeypatch):
    path, _, selected_filter = environment
    selected_filter["initial_range"] = {"from": "2024-03-18T21:00:00+02:00", "to": "2024-03-18T22:00:00+02:00"}
    selected_filter["expression"] = {"version": 1, "root": {"op": "eq", "field": "/data/status", "value": "ERROR"}}
    write_filter(environment)
    settings = load_launch_configuration(path)
    repository = PartitionedLegacyRepository(options(settings), settings["state_root"])
    try:
        repository.open()
        effective = effective_settings(repository.meta)["values"]
        assert effective["range"] == {"from": "2024-03-18T19:00:00.000Z", "to": "2024-03-18T20:00:00.000Z"}
        domain = {"from": "2024-03-18T20:00:00Z", "to": "2024-03-18T21:00:00Z"}
        captured = repository.capture_query_domain({"domain": domain})
        compiled = resolve_query_configuration(captured, {"definitionVersion": 2, "filters": {"filterId": effective["filterId"], "filterVersion": 1}})
        assert [record["title"] for record in captured["records"] if compiled["predicate"](record)] == ["Two"]
    finally:
        repository.close()


def test_alias_rename_and_v1_migration_preserve_source_and_record_identity(environment):
    path, document, selected_filter = environment
    settings = load_launch_configuration(path)
    modern = load_legacy_sources(path, legacy_root=settings["legacy_root"], allow_roots=settings["allow_root"], document=settings["source_document"])
    old = load_legacy_sources(path, legacy_root=path.parent, allow_roots=settings["allow_root"],
                              path_maps={"tests/data/SOURCES1": settings["allow_root"][0]},
                              document={"data_sources": [{"namespace": "SOURCE1", "type": "json_file", "enable": True,
                                                           "data_model": "tests/data/SOURCES1/yyyy/mm/dd"}]})
    assert modern.sources == old.sources
    assert modern.aliases["source1"] == old.sources[0].id
    document["data_sources"][0]["id"] = "renamed"
    selected_filter["source_ids"] = ["renamed"]
    write_filter(environment)
    path.write_text(yaml.safe_dump(document), encoding="utf-8")
    assert load_launch_configuration(path)["launch"]["sourceAliases"]["renamed"] == old.sources[0].id


@pytest.mark.parametrize("initial", [None, {}, "latest", "", {"from": "2024-03-18T19:00:00Z"},
                                    {"from": "2024-03-18T19:00:00", "to": "2024-03-18T20:00:00Z"},
                                    {"from": "2024-03-18T20:00:00Z", "to": "2024-03-18T19:00:00Z"}])
def test_invalid_initial_ranges_fail_before_creating_state(environment, initial):
    path, _, selected_filter = environment
    selected_filter["initial_range"] = initial
    write_filter(environment)
    with pytest.raises((ValueError, DomainError)):
        load_launch_configuration(path)
    assert not (path.parent.parent / "var").exists()


@pytest.mark.parametrize("mutation", ["disabled", "unknown", "duplicate", "wrong-template", "yaml-range"])
def test_source_selection_and_range_ownership_validation(environment, mutation):
    path, document, selected_filter = environment
    if mutation == "disabled":
        document["data_sources"][0]["enable"] = False
    if mutation == "unknown":
        selected_filter["source_ids"] = ["not-configured"]
    if mutation == "duplicate":
        document["data_sources"].append(copy.deepcopy(document["data_sources"][0]))
    if mutation == "wrong-template":
        document["data_sources"][0]["data_model"] = "../elsewhere/yyyy/mm/dd"
    if mutation == "yaml-range":
        document["loading"] = {"initial_range": {"from": "2024-03-18T19:00:00Z", "to": "2024-03-18T20:00:00Z"}}
    path.write_text(yaml.safe_dump(document), encoding="utf-8")
    write_filter(environment)
    with pytest.raises((ValueError, DomainError)):
        load_launch_configuration(path)


def test_import_is_idempotent_retains_old_models_filters_and_ignores_stale_personal_pins(environment):
    path, _, selected_filter = environment
    saved = None
    for iteration in range(3):
        repository = LegacyRepository(options(load_launch_configuration(path)), path.parent.parent / "var")
        try:
            repository.open()
            if iteration == 0:
                saved = copy.deepcopy(repository.meta)
                catalog_bytes = (repository.root / "launch-catalog.json").read_bytes()
            elif iteration == 1:
                assert (repository.root / "launch-catalog.json").read_bytes() == catalog_bytes
                selected_filter["initial_range"] = {"from": "2024-03-18T19:00:00Z", "to": "2024-03-18T21:00:00Z"}
                write_filter(environment)
                model = copy.deepcopy(MODEL)
                model["params"][0]["title"] = "Revised model"
                (path.parent.parent / "models/test.json").write_text(json.dumps(model), encoding="utf-8")
            else:
                metadata = copy.deepcopy(repository.meta)
                metadata["preferences"] = [{"principalId": "alice", "revision": 1, "values": copy.deepcopy(saved["settings"])}]
                active = effective_settings(metadata, principal_id="alice")["values"]
                assert active["modelId"] != saved["settings"]["modelId"]
                assert active["filterId"] != saved["settings"]["filterId"]
                assert active["range"]["from"] == "2024-03-18T19:00:00.000Z"
                assert {value["id"] for value in saved["models"]}.issubset({value["id"] for value in metadata["models"]})
                assert {value["id"] for value in saved["filters"]}.issubset({value["id"] for value in metadata["filters"]})
        finally:
            repository.close()


def test_yaml_can_live_above_its_disjoint_state_directory(environment):
    path, document, _ = environment
    root = path.parent.parent
    document.update(model="models/test.json", filter="filters/test.json")
    document["server"]["state_root"] = "var"
    document["data_sources"][0]["data_path"] = "data"
    path = root / "environment.yml"
    path.write_text(yaml.safe_dump(document), encoding="utf-8")
    settings = load_launch_configuration(path)
    repository = PartitionedLegacyRepository(options(settings), settings["state_root"])
    try:
        repository.open()
        assert repository.available
    finally:
        repository.close()


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is needed to exercise the generator CLI")
def test_generated_environment_launches_and_resolves_external_descriptors(tmp_path):
    project = Path(__file__).resolve().parents[2]
    config = tmp_path / "generator.json"
    config.write_text(json.dumps({"seed": "launch-round-trip", "pastCount": 2, "futureCount": 2, "descriptorProbability": 1}), encoding="utf-8")
    output = tmp_path / "generated"
    completed = subprocess.run([shutil.which("node"), str(project / "tools/event-generator/cli.js"), "--config", str(config),
                                "--environment", "--initial-range", "generated", "--output", str(output)], capture_output=True, text=True, timeout=30)
    assert completed.returncode == 0, completed.stderr
    settings = load_launch_configuration(output / "yaml/timeline.yml")
    repository = PartitionedLegacyRepository(options(settings), settings["state_root"])
    try:
        repository.open()
        captured = repository.capture_query_domain({"domain": repository.meta["settings"]["range"]})
        parents = [record for record in captured["records"] if not record["parentSessionId"]]
        assert len(parents) == 4
        assert repository.meta["manifest"]["legacy"]["launch"]["version"] == 2
        for record in parents:
            descriptor = repository.reader.descriptor(record)
            assert descriptor["status"] == "current"
    finally:
        repository.close()


def test_migration_creates_valid_separate_environment_and_preserves_identity(environment):
    path, _, _ = environment
    root = path.parent.parent
    source = {"namespace": "SOURCE1", "type": "json_file", "enable": True, "data_model": "data/yyyy/mm/dd"}
    original = {"version": 1, "server": {"host": "127.0.0.1", "port": 8771, "local_browser": True, "state_root": "../old-state"},
                "legacy": {"root": "..", "allow_roots": ["../data"], "model": "models/test.json"}, "data_sources": [source],
                "loading": {"initial_range": {"from": "2024-03-18T19:00:00Z", "to": "2024-03-18T21:00:00Z"}}}
    path.write_text(yaml.safe_dump(original), encoding="utf-8")
    before = path.read_bytes()
    script = Path(__file__).resolve().parents[2] / "scripts/migrate-launch.py"
    spec = importlib.util.spec_from_file_location("migrate_launch_test", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    destination = root / "migrated"
    migrated = module.migrate_profile(path, destination)
    settings = load_launch_configuration(migrated)
    original_sources = load_legacy_sources(path, legacy_root=root, allow_roots=[root / "data"], document={"data_sources": [source]})
    assert settings["launch"]["sourceAliases"] == {"source1": original_sources.sources[0].id}
    assert settings["launch"]["initialRange"]["from"] == "2024-03-18T19:00:00.000Z"
    assert path.read_bytes() == before
    assert not (root / "old-state").exists()
    with pytest.raises(FileExistsError):
        module.migrate_profile(path, destination)
    with pytest.raises((ValueError, DomainError)):
        module.migrate_profile(path, root / "rejected", initial_range={"from": "bad", "to": "bad"})
    assert not (root / "rejected").exists()
    assert not list(root.glob(".openbexi-migrate-*"))


def test_source_reorder_retains_publication_and_preference_authorities(environment):
    path, document, selected_filter = environment
    second = {**document["data_sources"][0], "id": "source2", "namespace": "SOURCE2", "identity_path": "tests/data/SOURCES2/yyyy/mm/dd"}
    document["data_sources"].append(second)
    selected_filter["source_ids"].append("source2")
    write_filter(environment)
    saved_ids = None
    for _ in range(2):
        path.write_text(yaml.safe_dump(document), encoding="utf-8")
        settings = load_launch_configuration(path)
        repository = LegacyRepository(options(settings), settings["state_root"])
        preferences = None
        try:
            repository.open()
            preferences = LegacyPreferencesRepository(repository, settings["preferences_root"])
            ids = set(repository.meta["manifest"]["scope"]["sourceIds"])
            if saved_ids is not None:
                assert ids == saved_ids
            saved_ids = ids
        finally:
            if preferences:
                preferences.close()
            repository.close()
        document["data_sources"].reverse()


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is needed to exercise the generator CLI")
def test_multisource_generated_environment_rehomes_all_descriptor_sidecars(tmp_path):
    project = Path(__file__).resolve().parents[2]
    config = tmp_path / "sources.json"
    config.write_text(json.dumps({"data_sources": [
        {"namespace": "SOURCE1", "data_model": "data/first/yyyy/mm/dd"},
        {"namespace": "SOURCE2", "data_model": "data/second/yyyy/mm/dd"},
    ]}), encoding="utf-8")
    output = tmp_path / "generated"
    completed = subprocess.run([shutil.which("node"), str(project / "tools/event-generator/cli.js"), "-data_conf", str(config),
                                "--days", "1", "--seed", "descriptor-routing", "--environment", "--initial-range", "generated", "--output", str(output)],
                               capture_output=True, text=True, timeout=30)
    assert completed.returncode == 0, completed.stderr
    settings = load_launch_configuration(output / "yaml/timeline.yml")
    repository = LegacyRepository(options(settings), settings["state_root"])
    try:
        repository.open()
        matched = set()
        sidecars = {path.stem for path in output.glob("data/*/*/**/descriptors/*.json")}
        for record in repository.records.values():
            identity = record["extensions"]["legacy"]["id"]
            if identity in sidecars:
                assert repository.reader.descriptor(record)["status"] == "current"
                matched.add(record["sourceId"])
        assert len(matched) == 2
    finally:
        repository.close()


@pytest.mark.parametrize(("template", "date", "descriptor_folder"), [("yyyy/mm", "2024-02-15T00:00:00Z", "2024/02"), ("yyyy", "2023-12-15T00:00:00Z", "2023")])
def test_descriptors_use_selected_calendar_template_even_when_event_file_is_later(environment, template, date, descriptor_folder):
    path, document, _ = environment
    root = path.parent.parent
    source = document["data_sources"][0]
    source.update(data_model=template, identity_path="tests/data/SOURCES1/" + template)
    path.write_text(yaml.safe_dump(document), encoding="utf-8")
    event_file = root / "data/2024/03/18/events.json"
    event_file.write_text(json.dumps({"events": [{"id": "one", "start": date, "data": {"title": "Earlier event"}}]}), encoding="utf-8")
    sidecar = root / "data" / descriptor_folder / "descriptors/one.json"
    sidecar.parent.mkdir(parents=True)
    sidecar.write_text(json.dumps({"event_descriptor": [{"id": "one", "start": date, "data": {"namespace": "SOURCE1", "description": "Earlier details"}}]}), encoding="utf-8")
    settings = load_launch_configuration(path)
    repository = LegacyRepository(options(settings), settings["state_root"])
    try:
        repository.open()
        record = next(iter(repository.records.values()))
        descriptor = repository.reader.descriptor(record)
        assert descriptor["status"] == "current"
        assert descriptor["file"] == descriptor_folder + "/descriptors/one.json"
    finally:
        repository.close()
