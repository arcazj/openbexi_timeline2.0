"""Prepare this checkout's dependencies, then start the timeline server."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]
UV_VERSION = "0.12.13"


def environment_python(directory):
    return directory / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(command, **kwargs):
    return subprocess.run([str(part) for part in command], cwd=ROOT, check=True, **kwargs)


def uv_command():
    # Keep the package manager outside .venv: syncing must not uninstall itself.
    directory = ROOT / "runtime/bootstrap/uv"
    python = environment_python(directory)
    if not python.is_file():
        print("Preparing the local Python package manager...", flush=True)
        venv.EnvBuilder(with_pip=True).create(directory)
    version = subprocess.run(
        [str(python), "-m", "uv", "--version"], capture_output=True, text=True,
    )
    if version.returncode or version.stdout.split()[:2] != ["uv", UV_VERSION]:
        run([python, "-m", "pip", "install", "--disable-pip-version-check", f"uv=={UV_VERSION}"])
    return [directory / ("Scripts/uv.exe" if os.name == "nt" else "bin/uv")]


def prepare_python(requested_python=None):
    directory = ROOT / ".venv"
    python = environment_python(directory)
    if requested_python and Path(sys.prefix).resolve() == directory.resolve():
        raise RuntimeError("To change Python versions, run this launcher with a base Python outside .venv.")
    # Keep an existing project interpreter; on a fresh clone use the selected SDK.
    selected = requested_python or (str(python) if python.is_file() else sys.executable)
    env = dict(os.environ, UV_PROJECT_ENVIRONMENT=str(directory))
    env.pop("VIRTUAL_ENV", None)
    print("Synchronizing all locked Python dependencies...", flush=True)
    run([*uv_command(), "sync", "--locked", "--all-groups", "--all-extras", "--python", selected], env=env)
    run([python, "-c", "import fastapi, uvicorn, re2, jsonschema_rs, yaml; "
         "import sys; print('Project Python:', sys.executable, sys.version.split()[0])"])
    return python


def node_commands():
    node = shutil.which("node")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not node or not npm:
        raise RuntimeError("Install Node.js 22+ with npm, then restart IntelliJ or your terminal. "
                           "For Python dependencies only, use --setup-only --python-only.")
    version = run([node, "--version"], capture_output=True, text=True).stdout.strip()
    if int(version.lstrip("v").split(".")[0]) < 22:
        raise RuntimeError(f"Node.js 22+ is required; found {version}.")
    return npm, version


def prepare_client(npm, node_version, reinstall=False):
    # Reinstall when dependency declarations, Node, npm, or the checkout path change.
    npm_version = run([npm, "--version"], capture_output=True, text=True).stdout.strip()
    digest = hashlib.sha256()
    for value in (str(ROOT), node_version, npm_version):
        digest.update(value.encode())
        digest.update(b"\0")
    for name in ("package.json", "package-lock.json"):
        digest.update((ROOT / name).read_bytes())
    stamp = ROOT / "node_modules/.openbexi-setup"
    expected = digest.hexdigest()
    if reinstall or not stamp.is_file() or stamp.read_text() != expected:
        # Invalidate first, so a failed npm install is retried next time.
        stamp.unlink(missing_ok=True)
        print("Installing locked client dependencies...", flush=True)
        run([npm, "ci", "--include=dev", "--ignore-scripts"])
        stamp.write_text(expected)
    # Always rebuild so edited/new inputs cannot leave the served client stale.
    print("Building the timeline client...", flush=True)
    run([npm, "run", "build"])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--setup-only", action="store_true", help="Install/build without starting the server")
    parser.add_argument("--python", help="Python version or executable for .venv (default: preserve it, or use this Python)")
    parser.add_argument("--python-only", action="store_true", help="Skip client installation/build; requires --setup-only")
    parser.add_argument("--reinstall-client", action="store_true", help="Repair/reinstall npm dependencies")
    parser.add_argument("server_args", nargs=argparse.REMAINDER, help="Server arguments after --")
    args = parser.parse_args(argv)
    if sys.version_info[:2] < (3, 9):
        parser.error(f"Python >=3.9 is required; selected interpreter: {sys.executable}")
    if args.python_only and not args.setup_only:
        parser.error("--python-only requires --setup-only")
    server_args = args.server_args
    if server_args[:1] == ["--"]:
        server_args = server_args[1:]
    if args.setup_only and server_args:
        parser.error("Server arguments cannot be used with --setup-only")
    try:
        client = None if args.python_only else node_commands()
        python = prepare_python(args.python)
        if client:
            prepare_client(*client, reinstall=args.reinstall_client)
        if args.setup_only:
            print(f"Setup complete. IntelliJ Python interpreter: {python}", flush=True)
            return 0
        script = ROOT / "scripts/serve-legacy.py"
        server_args = server_args or ["--yaml", "yaml/test-data/default-dataset.yml"]
        if Path(sys.prefix).resolve() == (ROOT / ".venv").resolve():
            # Once the IDE uses .venv, preserve its debugger in the current process.
            os.chdir(ROOT)
            sys.argv = [str(script), *server_args]
            runpy.run_path(str(script), run_name="__main__")
            return 0
        return subprocess.call([str(python), str(script), *server_args], cwd=ROOT)
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Setup failed: {error}\nFix the error above and rerun this command. "
              "First setup requires internet access to the package registries.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
