import importlib.util
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
import xml.etree.ElementTree as ET

import pytest


@pytest.fixture
def setup(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[2] / "scripts/start.py"
    spec = importlib.util.spec_from_file_location("project_setup_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    return module


def test_sync_targets_checkout_even_with_another_active_environment(setup, monkeypatch):
    calls = []
    monkeypatch.setattr(setup, "uv_command", lambda: ["local-uv"])
    monkeypatch.setattr(setup, "run", lambda command, **kwargs: calls.append((command, kwargs)))
    monkeypatch.setenv("VIRTUAL_ENV", "another-project")
    monkeypatch.setenv("UV_PROJECT_ENVIRONMENT", "another-project")
    python = setup.prepare_python("3.9")
    sync, options = calls[0]
    assert sync == ["local-uv", "sync", "--locked", "--all-groups", "--all-extras", "--python", "3.9"]
    assert options["env"]["UV_PROJECT_ENVIRONMENT"] == str(setup.ROOT / ".venv")
    assert "VIRTUAL_ENV" not in options["env"]
    assert calls[1][0][0] == python


def test_repeated_setup_keeps_existing_interpreter(setup, monkeypatch):
    python = setup.environment_python(setup.ROOT / ".venv")
    python.parent.mkdir(parents=True)
    python.touch()
    calls = []
    monkeypatch.setattr(setup, "uv_command", lambda: ["local-uv"])
    monkeypatch.setattr(setup, "run", lambda command, **kwargs: calls.append(command))
    setup.prepare_python()
    assert calls[0][-1] == str(python)


def test_cannot_replace_the_running_environment(setup, monkeypatch):
    monkeypatch.setattr(sys, "prefix", str(setup.ROOT / ".venv"))
    with pytest.raises(RuntimeError, match="outside .venv"):
        setup.prepare_python("3.12")


def test_client_install_cache_invalidates_on_lock_change_and_failure(setup, monkeypatch):
    for name in ("package.json", "package-lock.json"):
        (setup.ROOT / name).write_text("{}")
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if "ci" in command:
            (setup.ROOT / "node_modules").mkdir(exist_ok=True)
        return SimpleNamespace(stdout="10.0.0")

    monkeypatch.setattr(setup, "run", run)
    setup.prepare_client("npm", "v22.0.0")
    setup.prepare_client("npm", "v22.0.0")
    assert sum("ci" in command for command in calls) == 1
    assert sum("build" in command for command in calls) == 2
    (setup.ROOT / "package-lock.json").write_text('{"changed":true}')

    def fail_install(command, **kwargs):
        if "ci" in command:
            raise subprocess.CalledProcessError(1, command)
        return SimpleNamespace(stdout="10.0.0")

    monkeypatch.setattr(setup, "run", fail_install)
    with pytest.raises(subprocess.CalledProcessError):
        setup.prepare_client("npm", "v22.0.0")
    assert not (setup.ROOT / "node_modules/.openbexi-setup").exists()
    monkeypatch.setattr(setup, "run", run)
    setup.prepare_client("npm", "v22.0.0")
    assert sum("ci" in command for command in calls) == 2


def test_launcher_uses_checkout_python_and_preserves_arguments_and_exit_code(setup, monkeypatch):
    python = setup.environment_python(setup.ROOT / ".venv")
    monkeypatch.setattr(setup, "node_commands", lambda: ("npm", "v22.0.0"))
    monkeypatch.setattr(setup, "prepare_python", lambda requested: python)
    monkeypatch.setattr(setup, "prepare_client", lambda *args, **kwargs: None)
    captured = {}

    def call(command, **kwargs):
        captured.update(command=command, **kwargs)
        return 7

    monkeypatch.setattr(setup.subprocess, "call", call)
    assert setup.main(["--", "--yaml", "yaml/local/profile with spaces.yml"]) == 7
    assert captured == {
        "command": [str(python), str(setup.ROOT / "scripts/serve-legacy.py"),
                    "--yaml", "yaml/local/profile with spaces.yml"],
        "cwd": setup.ROOT,
    }


def test_setup_failure_never_starts_server(setup, monkeypatch):
    monkeypatch.setattr(setup, "node_commands", lambda: ("npm", "v22.0.0"))

    def failed_sync(requested):
        raise subprocess.CalledProcessError(1, ["uv", "sync"])

    monkeypatch.setattr(setup, "prepare_python", failed_sync)
    monkeypatch.setattr(setup.subprocess, "call", lambda *args, **kwargs: pytest.fail("Started after failure"))
    assert setup.main([]) == 1


def test_project_interpreter_keeps_debugger_in_same_process(setup, monkeypatch):
    python = setup.environment_python(setup.ROOT / ".venv")
    monkeypatch.setattr(sys, "prefix", str(setup.ROOT / ".venv"))
    monkeypatch.setattr(sys, "argv", ["start.py"])
    monkeypatch.chdir(setup.ROOT)
    monkeypatch.setattr(setup, "node_commands", lambda: ("npm", "v22.0.0"))
    monkeypatch.setattr(setup, "prepare_python", lambda requested: python)
    monkeypatch.setattr(setup, "prepare_client", lambda *args, **kwargs: None)
    captured = {}

    def run_path(path, run_name):
        captured.update(path=path, run_name=run_name, argv=list(sys.argv))

    monkeypatch.setattr(setup.runpy, "run_path", run_path)
    assert setup.main([]) == 0
    assert captured["run_name"] == "__main__"
    assert captured["argv"][1:] == ["--yaml", "yaml/test-data/default-dataset.yml"]


def test_python_only_setup_needs_no_node_or_npm(setup, monkeypatch):
    monkeypatch.setattr(setup, "prepare_python", lambda requested: "project-python")
    monkeypatch.setattr(setup, "node_commands", lambda: pytest.fail("Node should not be required"))
    assert setup.main(["--setup-only", "--python-only"]) == 0


@pytest.mark.parametrize(("name", "profile"), [
    ("test sources", "yaml/test-data/default-dataset.yml"),
    ("legacy comparison", "yaml/default_test.yml"),
    ("multiple_sources_test", "yaml/multiple_sources_test.yml"),
])
def test_shared_ide_configuration_does_not_require_a_preexisting_venv(name, profile):
    root = Path(__file__).resolve().parents[2]
    config = ET.parse(root / f".run/OpenBEXI Timeline {name}.run.xml").find("configuration")
    options = {item.attrib["name"]: item.attrib["value"] for item in config.findall("option")}
    assert options["SDK_HOME"] == ""
    assert "SDK_NAME" not in options
    assert options["IS_MODULE_SDK"] == "true"
    assert options["SCRIPT_NAME"] == "$PROJECT_DIR$/scripts/start.py"
    assert options["WORKING_DIRECTORY"] == "$PROJECT_DIR$"
    assert options["PARAMETERS"] == f"-- --yaml {profile}"
    assert (root / profile).is_file()
