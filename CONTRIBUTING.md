# Contributing

The active direction and documentation-only pause are recorded in the
[current prompt](openbexi_timeline2.0_current_prompt.md). Start with the consolidated
[design](docs/openbexi_timeline2.0_design.md),
[architecture](docs/openbexi_timeline2.0_architecture.md) and
[test plan](docs/openbexi_timeline2.0_tests.md); older detailed references remain available
until their application consumers are migrated.

OpenBEXI Timeline 2.0 is released as version 1.0.0. Discuss large changes in an issue before changing storage, provider contracts, migration behavior, or interaction semantics. Project code and authored documentation use [PolyForm Noncommercial 1.0.0](LICENSE); commercial use requires a separate written license from the copyright holder. Preserve [NOTICE](NOTICE) and all third-party notices. Dependency licenses do not license this repository's code or data.

## Development

Use Node.js 22+ and Python 3.9 or newer. From the repository root:

```sh
python scripts/start.py --setup-only
npm run dev
```

Use `py -3` on Windows or `python3` on macOS/Linux if `python` is not available. The launcher installs a private copy of uv, synchronizes all Python dependency groups from `uv.lock`, installs npm dependencies and builds the client. To install Python dependencies alone, add `--python-only`.

For Python-backed browsing, follow the [README](README.md). The included `yaml/test-data/` profiles need no external legacy installation. Place private profiles in ignored `yaml/local/` or `config/local/` directories. The shared `.run` configuration inherits the project Python SDK and prepares dependencies before starting. After first setup, select this checkout's `.venv` interpreter for IDE analysis, tests and debugging.

## Change Checklist

- Keep client rendering independent of server availability. Do not duplicate the application for offline use.
- Keep linked legacy files read-only. Do not add SQL/database storage or execute legacy converter classes.
- Update shared schemas and provider parity tests together when changing contracts.
- Test labels, zones, overview, selection, and pagination when changing timeline geometry. Include desktop/mobile screenshots for visual changes.
- Preserve original fixture bytes under `data/original/`. Change the catalog or converter, run `scripts/normalize-test-data.py`, and review the generated reports.
- Avoid real source exports, private paths, credentials, or customer data in tests, screenshots, issues, and commits.
- Keep changes focused and describe the behavior, tests, and remaining limitations in the pull request.

Run the [test commands](README.md#testing) relevant to your change. For a candidate-wide verification, use `.venv/Scripts/python.exe scripts/verify-candidate.py --matrix --output artifacts/verification/my-candidate` on Windows (`.venv/bin/python` on macOS/Linux) with a new output directory. Skipped cases and unresolved release gates are not passes.

Before committing, run `npm run check:repo`. After staging, run `npm run check:repo -- --staged --build` against a fresh build. This checks the actual staged files and their publication dependencies; it is not a substitute for manual secret and license review.

## Reports

For a bug, include the build/version, browser/OS, operating mode, minimal sanitized JSON example, expected behavior, actual behavior, and reproduction steps. Use **Help and sharing** for sanitized diagnostics. Report security issues privately as described in [SECURITY.md](SECURITY.md).
