# OpenBEXI JavaScript event generator

An ES module implementation of `tools/com/openbexi/timeline/event_generator.java`, with a browser configuration tree, a pure generation API, and a Node CLI. It requires no additional npm dependencies. Node 20+ and a modern browser are supported.

## Run the interactive tool

From the repository root:

```sh
node tools/event-generator/serve.js
```

Open **http://127.0.0.1:8089/**. Follow Environment, Data, Model, Filter and Review / save, then select **Generate timeline**. Advanced data settings remain available in a collapsed section. Generation runs in a cancellable worker. The preview includes a timeline, event table, and sample JSON. **Download environment (ZIP)** produces a complete version-2 environment with `yaml/`, `models/`, `filters/` and `data/`. Extract it into a new folder and launch `python scripts/start.py -- --yaml <folder>/yaml/timeline.yml` from this project. **Download data files (ZIP)** retains the data-only export, including descriptors; **Download events JSON** contains the aggregate timeline only.

In **Dates and boundaries**, use the calendar instead of typing timestamps. **Clear selection** starts a new selection; click days to add or remove them, or Shift-click to select a continuous range. The earliest and latest selected days set both range and timeline boundaries, including the entire last day. Generation skips gaps between selected days. Select **Reference date** and click a day to split past/future events at noon UTC; its ring marks that date. Month/year controls let you jump to other dates. Existing imported timestamp precision is retained until the calendar is edited. Clearing all days asks you to select a day before generating.

The request's name **tree.sj** did not identify an existing dependency in this repository. `ui/tree.sj.js` therefore supplies a self-contained tree definition (`TREE_SJ`) and accessible disclosure editor (`TreeSJEditor`). This is a local implementation, not an integration with an unidentified third-party package. Its renderer can be replaced independently of the configuration schema and engine.

All work occurs locally. Serve the page over HTTP; browser ES modules and workers do not work reliably from `file://` URLs. The included server listens only on loopback. `PORT=...` can select another port through the environment.

## Generate files from the CLI

```sh
node tools/event-generator/cli.js --config tools/event-generator/examples/business.json --output generated
node tools/event-generator/cli.js --config tools/event-generator/examples/legacy.json --zip timeline.zip
node tools/event-generator/cli.js -data_conf tools/event-generator/examples/sources_default_test.yml --output generated-legacy --seed demo --reference-date 2026-01-15T00:00:00Z
node tools/event-generator/cli.js --config tools/event-generator/examples/business.json --environment --output generated-environment
```

The environment workflow has **Environment**, **Data**, **Model**, **Filter** and
**Review / save** steps. The model controls black/light appearance, 2D/3D, compact
activities and overview visibility. Sort by choices come from generated metadata.
The filter owns title search and the opening interval: current time by default,
the generated data interval, or explicit offset-bearing ISO bounds. Advanced data
controls and the calendar remain available in a collapsed section.

`--environment` adds a runnable profile, model and filter. Add
`--initial-range generated` to open the generated interval instead of current
time. Directory export writes immutable versions below `models/`, `filters/` and
`data/`, then activates `yaml/timeline.yml` with one atomic filesystem operation.
`--force` allows replacing that YAML activation; published version files are never
overwritten. A failed preparation keeps the previous active environment intact.
Each generated version receives separate application state under `var/`. A ZIP
has the same linked files and must be extracted into a new directory. Data-only
exports remain available without `--environment`.

Legacy multi-source generator output sometimes stores a descriptor under another
source's directory. Environment export routes each descriptor beside its owning
record and preserves source identity when configured source order changes. The
data-only legacy export continues to reproduce the legacy paths.

Run `node tools/event-generator/cli.js --help` for all options. Existing artifacts cause an error unless `--force` is explicitly provided. Output paths must be relative and stay inside the selected directory. For startup files containing absolute Java `data_model` paths (such as `/data/...`), copy the configuration and make those paths relative to `--output`.

`-data_conf` accepts JSON (`data_sources` or `startup configuration` arrays) and the repository's block-style YAML source lists. Only `namespace` and `data_model` influence generation. Plain and quoted scalar values are supported; YAML anchors, aliases, flow lists, and block scalar values for these fields are rejected. Nested unrelated source settings are ignored. This parser is intentionally limited to the existing source configuration format.

## Generation modes and compatibility

| Mode | Rules |
| --- | --- |
| `configurable` | Uses all requested calendar, distribution, relationship, and placement controls. Defaults to 50 past and 50 future top-level events. |
| `legacy-simple` | Ports `generate_simple`: special event indices and offsets, 1–12 activities, random fixture sessions/points, descriptor files, long activity titles, statuses, icons, original timestamps, and string fields. |
| `legacy-full` | Ports the alternate `generate`: 650 groups of eight events, its actual millisecond increments, alternating sessions/points, five types, eight systems, status and tolerance distributions, and optional activities. |
| CLI `-data_conf` | Ports Java `main`: 30 daily files per source by default, each with 50–599 simple events. Disabled sources still generate. The original date carryover between sources is preserved. |

Compatibility means the same consumer-facing JSON envelopes, field types, omission rules, timestamp syntax, descriptor routing, and legacy scenario rules. Java creates a new unseeded `Random` for each draw and uses random UUIDs, so matching a prior Java run byte for byte is not possible. Both Java methods manually write malformed JSON; this implementation emits valid JSON while preserving their intended objects. The alternate method's icon index overflow and misplaced activity namespace are repaired. Legacy planned dates that precede actual starts, and activities that extend outside parent sessions, remain unchanged in legacy modes. See [the complete Java mapping](LEGACY-MAPPING.md).

The data format remains:

```json
{
  "dateTimeFormat": "iso8601",
  "events": [{
    "id": "seeded UUID",
    "namespace": "generated",
    "original_start": "",
    "start": "Thu Jan 15 09:00:00 UTC 2026",
    "original_end": "",
    "end": "Thu Jan 15 10:00:00 UTC 2026",
    "data": { "namespace": "generated", "title": "Session_0", "status": "STARTED", "type": "type1", "priority": "0", "system": "system1", "description": "..." },
    "render": { "color": "#123456" },
    "activities": [{
      "id": "independent seeded UUID", "namespace": "generated",
      "original_start": "", "start": "Thu Jan 15 09:00:00 UTC 2026",
      "original_end": "", "end": "Thu Jan 15 10:00:00 UTC 2026",
      "data": { "namespace": "generated", "title": "Session_0_0", "status": "STARTED", "priority": "0", "description": "..." },
      "render": { "color": "#123456" }
    }]
  }]
}
```

The example above illustrates the shape; actual generated examples are linked below. Despite the `iso8601` label, date strings retain Java's English UTC `Date.toString()` format. Points have `end: ""`. Simple/configurable events always carry an activities array; activity data omits the parent's type and system just as Java does. Descriptors use `{dateTimeFormat, event_descriptor: [...]}` and the event UUID as filename.

Configurable files are partitioned by actual start date. Legacy batch files use their batch day, even when an event starts on an adjacent day. All descriptors use the event's actual start day. The browser's aggregate JSON deliberately combines daily files for convenience.

## Architecture

```text
CONFIG_FIELDS / DEFAULT_CONFIG -> TREE_SJ -> browser editor -> worker
               |                                           |
               +-> normalizeConfig <------------------------+
                         |
                    engine.js <--- strategies / plugins
                    /       \
          configurable       legacy.js
                    \       /
                 model.js + random.js
                         |
          {config, timeline, files, warnings, stats}
                     /             \
           browser ZIP/preview     Node CLI/files
```

| Module | Responsibility |
| --- | --- |
| `config.js` | Shared defaults, schema metadata, field help, strict validation and normalization. |
| `model.js` | Legacy event envelope, descriptor envelope, UTC timestamp formatter and icon table. |
| `random.js` | Seed hashing, stable 32-bit PRNG, weighted choices and deterministic UUIDs. |
| `legacy.js` | Pure ports of both Java generation methods. |
| `engine.js` | Calendar windows, constrained placement, relationships, activity construction and output file manifest. Also implements legacy startup workflow. |
| `strategies.js` | Built-in clustering distributions and plugin registry. |
| `ui/tree.sj.js` | Declarative tree definition and schema-driven form renderer. |
| `ui/app.js`, `ui/worker.js` | Interactive generation, cancellation, validation feedback, preview and export. |
| `archive.js` | Valid deterministic UTF-8 ZIP output, using stored entries and stable archive timestamps. |
| `startup.js`, `cli.js`, `serve.js` | Startup configuration adapter, filesystem boundary and local UI server. |

## Parameters and semantics

[PARAMETERS.md](PARAMETERS.md) documents every field and default; the same help appears beside the controls. Default dates are fixed around **2026-01-15 UTC**, so supplying a seed without dates still gives reproducible output. To reproduce Java's current-day workflow, supply the desired current UTC date explicitly. Returned configurations replace a `null` seed with the generated seed for replay. UUIDs, dates, descriptors, metadata and archive timestamps are deterministic; IDs are fixture identifiers, not security tokens.

Counts include recurring occurrences and exclude nested activities. Events are wholly before the reference date or start at/after it. Effective boundaries are the intersection of `rangeStart`/`rangeEnd` and optional timeline boundaries. Density keeps counts constant and uses the fraction of each side's available date span closest to the reference: sparse 100%, normal 75%, dense 40%, very dense 15%.

When `selectedDays` is nonempty, these fractions apply to eligible time inside selected days rather than the empty gaps between them. An empty `selectedDays` array in an API/CLI configuration retains the original behavior of allowing all days within the range. The UI prevents an empty calendar selection from accidentally enabling every date. Working-hour, weekend and holiday settings still apply to selected days; legacy modes retain their original rules.

Duration choices apply to sessions; point probability selects empty-ended events. Durations and placement use whole seconds. Non-overlap reserves one second for points, and zero overlap prohibits intersections among top-level events. Activities intentionally mirror their parent interval. Positive overlap probability requests overlap with a prior event when feasible; the first event has no predecessor. Sampling probabilities are not exact quotas.

Calendar rules apply to the full actual event duration. Weekend means Saturday/Sunday UTC. Holidays are an explicit date list; there is no inferred national calendar. Working intervals are same-day UTC only. Unrestricted events can cross midnight. If random starts fragment the remaining space, generation replays once using the earliest eligible starts and reports that clustering was overridden. This handles fully booked intervals without relaxing any calendar, duration or overlap limits. If that retry also fails, the engine throws `GenerationError` instead of dropping events or exceeding boundaries. It does not exhaustively solve variable-duration packing across multiple workdays.

Uniform samples all eligible start seconds. Bursty favors three peaks. Seasonal uses four recurring peaks over eligible time, not a geographic weather model. Realistic mixes 70% bursty with 30% uniform; enable the working calendar separately. Constraints can change the resulting distribution.

Simple complexity creates one activity and no tolerance; moderate creates 1–3 activities with tolerance 0–100; complex creates 1–6 with tolerance 0–1000 and planned end dates for sessions. Zero tolerances are omitted from timeline data. Recurrence attempts to copy an earlier event within the same past/future partition after an integer UTC day interval; it preserves duration, category, priority and resource, and adds `data.recurrence = {seriesId, previousId, intervalDays}`. An occurrence that cannot fit becomes independent and produces a warning. Dependencies are stored as `data.dependencies: [id, ...]`, reference only previously generated events that have finished, and cannot form cycles. These two optional data extensions are not emitted by legacy modes and do not imply that the existing timeline renderer draws relationship links.

The Java resource model is a `data.system` string, not a capacity scheduler. Fixed, random and round-robin options assign this field; `none` omits it. Resource capacity is not enforced. Recurring events keep their original resource even in round-robin mode.

## API and plugins

```js
import { generateTimeline } from './tools/event-generator/engine.js';
import earlyHeavy from './tools/event-generator/examples/plugin.js';

const result = generateTimeline({
  seed: 'demo', pastCount: 10, futureCount: 20, clustering: 'early-heavy'
}, { plugins: [earlyHeavy] });
console.log(result.timeline); // legacy-compatible aggregate document
console.log(result.files);    // [{path, document}], including descriptors
```

A placement plugin has a unique lowercase `name` and `sample(context)` returning a finite fraction in `[0, 1)`. Context includes `rng`, normalized `config`, `side`, `index`, `count`, and allowed UTC `windows`. The fraction selects from eligible start seconds after duration and overlap constraints. Use only the supplied RNG and avoid external mutable state for deterministic output. Plugins cannot bypass calendar limits. Register plugins through the API; applications embedding the UI can add the same plugin to their worker and extend the tree definition's clustering choices. Imported JSON never executes arbitrary code.

## Examples and verification

| Scenario | Configuration | Generated output |
| --- | --- | --- |
| Three simple 30-minute sessions | [minimal.json](examples/minimal.json) | [minimal.output.json](examples/minimal.output.json) |
| Working calendar, weighted durations, resources and relationships | [business.json](examples/business.json) | [business.output.json](examples/business.output.json) |
| Java's special fixture scenarios | [legacy.json](examples/legacy.json) | [legacy.output.json](examples/legacy.output.json), [descriptor example](examples/legacy.descriptor.json) |

Regenerate examples and field documentation with `node tools/event-generator/examples/build.js`. To save all descriptors for any example, use the CLI's directory or ZIP export.

```sh
node --test tools/event-generator/tests/*.test.js
node tools/event-generator/tests/browser-smoke.js
```

Tests cover legacy fixture compatibility, deterministic generation, calendars, limits, overlap, weighted choices, recurrence/dependencies, plugins, descriptor paths, CLI behavior and ZIP structure. The optional browser smoke test requires Node 22+ and installed Chromium via CDP, without installing a browser dependency. Set `CHROME_PATH` to override executable detection.

Validation caps a configurable run at 30,000 top-level events and 3,660 days. Legacy interactive/API modes cap total events at 30,000. Startup CLI batches cap source-days at 120. The browser ZIP supports at most 65,535 files and does not use ZIP64; larger runs can use CLI directory output. These limits bound local resource use and are explicit differences from the unrestricted Java loop.
