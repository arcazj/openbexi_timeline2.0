import copy

import pytest
import yaml

from server.app.repositories.legacy_repository import LegacyRepository
from server.app.repositories.partitioned_legacy_repository import PartitionedLegacyRepository
from server.app.services.launch_configuration import load_launch_configuration
from test_launch_environment import environment, options  # noqa: F401


@pytest.mark.parametrize("repository_type", [LegacyRepository, PartitionedLegacyRepository])
@pytest.mark.parametrize("empty", [False, True])
def test_launch_aliases_and_all_settings_source_styles_follow_scope(environment, repository_type, empty):  # noqa: F811
    path, document, _ = environment
    source = {**document["data_sources"][0], "id": "secret", "namespace": "SECRET", "identity_path": "private/yyyy/mm/dd"}
    document["data_sources"].append(source)
    path.write_text(yaml.safe_dump(document), encoding="utf-8")
    repository = repository_type(options(load_launch_configuration(path)), path.parent.parent / "var")
    try:
        repository.open()
        before = copy.deepcopy(repository.meta)
        aliases = before["manifest"]["legacy"]["launch"]["sourceAliases"]
        allowed = [] if empty else [aliases["source1"]]
        expected_aliases = {} if empty else {"source1": aliases["source1"]}
        for payload in [repository.metadata(), copy.deepcopy(repository.meta)]:
            projected = repository.project_scope(payload, allowed)
            legacy = projected.get("legacy", projected.get("manifest", {}).get("legacy"))
            assert legacy["configuration"]["sourceAliases"] == expected_aliases
            assert legacy["launch"]["sourceAliases"] == expected_aliases
            assert [entry["sourceId"] for entry in projected["settings"]["presentation"]["sourceStyles"]] == allowed
            assert [entry["sourceId"] for entry in legacy["launch"]["settings"]["presentation"]["sourceStyles"]] == allowed
            assert projected["settings"]["range"] == before["settings"]["range"]
            assert legacy["launch"]["settings"]["range"] == before["settings"]["range"]
        assert repository.meta == before
    finally:
        repository.close()
