# OpenBEXI Timeline 2.0 — setup and deployment

Updated: 2026-09-20. The launcher supports both existing version-1 profiles and
the version-2 file environments in [data design](openbexi_timeline2.0_data_design.md).
Use the launcher below to prepare and run a checkout.

## Run the current application

Prerequisites: Python 3.9+ from the project's supported/tested interpreter set,
Node 22+ with npm, and package-registry access for first setup. From the checkout:

```powershell
python scripts/start.py
```

This installs a private bootstrap copy of uv, synchronizes Python dependency
groups into `.venv`, installs locked npm dependencies when required, builds the
client, and launches the bundled default dataset. A global `uv` command is not
needed. Use `py -3` on Windows or `python3` on macOS/Linux when appropriate.

To prepare dependencies without starting the server:

```powershell
python scripts/start.py --setup-only
```

For the legacy SOURCE1/SOURCE2 validation profile:

```powershell
python scripts/start.py -- --yaml yaml/default_test.yml
```

Its current URL is `http://127.0.0.1:8771/`; the external archive must exist at
`C:/projects/openbexi_timeline/tests/data/SOURCES1` and `SOURCES2`.
Both sources are enabled; the initial validation range is March 18, 2024,
19:00–21:00 UTC. See the [user manual](openbexi_timeline2.0_user_manual.md). Other `yaml/test-data/` profiles use bundled datasets and
do not require the sibling legacy checkout. Use the printed URL for each profile.

The direct `scripts/serve-legacy.py` entry point assumes dependencies and the
client build already exist. Use the bootstrap launcher for a fresh clone or after
dependency changes. Rebuild/restart after application changes and refresh the
browser to replace an old bundled client.

## Access the REST and Swagger documentation

In the running timeline, open **Help → Developer docs → Swagger (offline)**.
Use **Live API** after connecting to inspect the active server specification, or
**Download OpenAPI** for the bundled JSON contract. The native authenticated
endpoint is `/api/v1/workspaces/default/openapi.json` on the selected server port.
The viewer is read-only; the server's default `/docs` and `/redoc` pages are disabled.

From the project root, verify that the bundled API contract matches the code:

```powershell
.venv/Scripts/python.exe scripts/export-openapi.py --check
```

After an intentional route/schema change, regenerate it with
`.venv/Scripts/python.exe scripts/export-openapi.py`, run the API contract tests,
then rebuild with `npm run build` so offline Swagger includes the current contract.
Use the [architecture guide](openbexi_timeline2.0_architecture.md#rest-api-and-openapiswagger)
for the REST routes, authentication and compatibility limits.

## IntelliJ and fresh clones

The shared **OpenBEXI Timeline test sources** run configuration opens the bundled
dataset. **OpenBEXI Timeline legacy comparison** opens the SOURCE1/SOURCE2 profile
and requires the adjacent legacy archive. Both use the bootstrap launcher.

Cloning alone does not execute installation commands. Configure the launch action
to use `scripts/start.py`, the checkout as working directory, and parameters
`-- --yaml yaml/default_test.yml` (or the desired bundled profile). The first launch performs
setup. Select this checkout's `.venv/Scripts/python.exe` afterward; on POSIX use
`.venv/bin/python`.

The launcher preserves the debugger process when it is already running inside
the project's `.venv`. Old configurations that call `serve-legacy.py` directly or
select another project's interpreter do not provide automatic setup.

Exclude `.venv/`, `venv/`, `runtime/`, `var/` and `node_modules/` from IDE source
roots. A generated test environment's `site-packages` must not shadow the selected
interpreter. The previously reported missing `re2` module comes from the
`google-re2` dependency; install the locked environment and choose its interpreter
rather than installing an unrelated package named `re2`.

## Current profile and state boundaries

Version-1 YAML keeps its existing legacy model and `loading.initial_range`
semantics. Version 2 selects explicit `model` and `filter` files and source aliases;
the filter owns `initial_range`, defaulting to current time. The test profile is
version 2. It preserves canonical source identities through `identity_path`.
Fresh launch honors YAML selections even when old personal view preferences exist.

Application state, preferences, identities and indexes live beneath the selected
`state_root`. Keep that directory separate from read-only source/model authorities.
Run one owning server per state root. Independent test servers need different
ports **and** different writable roots.

Bind to loopback for local use. Keep credentials out of source files and browser
artifacts. Retain current bearer authentication, capability checks and explicit
CORS settings when adding compatibility endpoints. Do not copy legacy certificates
or credentials into a new environment.

## Generate an environment

The generator's **Download environment (ZIP)** creates linked YAML/model/filter
files and partitioned data. Extract to a new folder, then launch its YAML using
`python scripts/start.py -- --yaml <folder>/yaml/timeline.yml`.

The equivalent CLI is:

```powershell
node tools/event-generator/cli.js --config tools/event-generator/examples/business.json --environment --output generated-environment
```

Use the chosen environment name in the emitted YAML path. Existing output is not
overwritten without `--force`. Immutable version files are staged before one YAML
activation; failed activation retains the previous runnable environment. See the
[generator guide](../tools/event-generator/README.md) for advanced options.

Opening time defaults to current time. Add `--initial-range generated` to open
the interval containing generated records. The browser workflow provides
Environment, Data, Model, Filter and Review / save steps, including fixed opening
bounds, dynamic grouping, camera and overview choices.

## Migrate a version-1 profile

Create a separate version-2 environment without replacing the existing profile:

```powershell
.venv/Scripts/python.exe scripts/migrate-launch.py --yaml yaml/test-data/default-dataset.yml --output migrated-environment
```

The destination must be new. The command writes `yaml/timeline.yml`,
`models/timeline.json`, `filters/timeline.json` and `migration-report.json`.
Canonical source identities remain stable; external data stays read-only. The
new environment has fresh state, while the original state and history remain
at their original location. Use `--initial-from <ISO>` and `--initial-to <ISO>`
together to set an explicit opening interval. Unsupported source predicates
require an explicit migration and produce an error before publishing files.

## Connect an existing legacy browser client

Serve the legacy page on the configured loopback origin and install the scoped
transport before its timeline initialization:

```javascript
import { installLegacyTransport } from '/openbexi_timeline/transport.js';
const transport = installLegacyTransport({ baseUrl: location.origin });
```

The adapter adds the required local header to the two session routes and replaces
EventSource for those routes with a header-capable streaming fetch. It leaves other
URLs alone. For a bearer-authenticated connection use `{baseUrl, token, local: false}`
with the server's explicit origin policy; credentials stay in memory. Call
`transport.updateCredentials(newToken)` after authentication changes and
`transport.uninstall()` when removing the legacy view. Native EventSource alone
cannot send these authentication headers. The server does not automatically
host the old project's entire static application.

A complete environment export includes coordinated configuration files and any
generated data/descriptor files. A reference to external data does not make that
archive part of the export. Explain missing external requirements before launch.

## Standalone, containers and publication

`npm run build` produces `dist/index.html`, a standalone client with an embedded
complete sample snapshot and bundled dependencies/assets. Opening that file does
not browse a server archive. Server-backed YAML loading requires the Python server.
An explicit full snapshot export can be imported into standalone mode subject to
its validation/capacity limits.

The existing Dockerfile has runtime and verification targets. Its runtime is a
single Python service with a separate persistent JSON-state volume; do not mount
the same writable root into multiple writers. The retained
[container reference](reference/implementation/container.md) contains the current operational commands.

The owner authorized version 2.0 publication on `master`, the `v2.0.0` tag and
the [stable release](https://github.com/arcazj/openbexi_timeline2.0/releases/tag/v2.0.0).
The [standalone demo](https://arcazj.github.io/openbexi_timeline2.0/) is deployed by
the existing GitHub Pages workflow after its build and browser checks pass.
The README links directly to all six datasets using `?dataset=<catalog-id>`.
Configured servers keep their YAML-selected sources when that parameter is present.
See [publication details](reference/implementation/publishing.md) and the
[validation record](openbexi_timeline2.0_tests.md).

## Backup and recovery

A timeline snapshot export is not a complete server-root backup. Preserve state,
identity, command outcomes and recovery metadata through the existing offline
backup/restore tools. Stop the relevant writer first, use a new destination, and
do not delete metadata to force startup or bypass an ownership lock.

Retained operational references: [backup/restore](reference/implementation/backup-restore.md),
[identity recovery](reference/implementation/identity.md), [security](../SECURITY.md).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `uv` is not recognized | Run `python scripts/start.py`; it owns a private uv installation |
| `No module named re2` | Run setup and select the resulting `.venv` interpreter in the IDE |
| Empty historical archive on startup | Version 2: configure `initial_range` in the selected filter; version 1: configure YAML `loading.initial_range` |
| Green timeline but sparse rows | Check model selection, compact mode, viewport/time range and vertical page |
| Port already in use or state already locked | Identify the existing owner; do not launch a second writer over the same state root |
| Provisional coverage | Inspect source diagnostics; an unrelated invalid file can affect archive completeness while a valid window still loads |
| Package installation fails | Fix registry/network/interpreter errors and rerun; cloning cannot guarantee external services are available |

Project code/documentation licensing is described by [LICENSE](../LICENSE) and
[NOTICE](../NOTICE). Retain [third-party notices](third-party-notices.md),
[data provenance](data-licensing.md), and bundled legacy asset licenses.
