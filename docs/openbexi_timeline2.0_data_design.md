# OpenBEXI Timeline 2.0 — data and configuration design

Updated: 2026-09-20. Version-2 file environments are implemented alongside version 1.
The validation profile selects both legacy test sources, a repository-owned model
and a filter containing the explicit historical range.

## Configuration ownership

The server starts from one YAML file. That file selects the sources, one model
and one filter. The model determines presentation. The filter determines source
selection, predicates, grouping, search defaults and the opening time window.
Source records remain independent of all three configuration files.

Use `filters/` (plural), matching the legacy repository. Keep `data/`; do not
rename it to `json/`. External archive paths remain external.

## Version-2 launch profile

The following is an accepted profile shape; adjust external source paths locally.
Version 2 makes changed path/range ownership explicit instead of reinterpreting
existing version-1 YAML silently.

```yaml
# Version-2 environment example
version: 2
server:
  host: 127.0.0.1
  port: 8771
  local_browser: true
  state_root: ../var/default-test
  startup_mode: background
  data_loading: lazy
model: ../models/legacy_test.json
filter: ../filters/legacy_test.json
data_sources:
  - id: source1
    namespace: SOURCE1
    type: json_file
    enable: true
    data_path: C:/projects/openbexi_timeline/tests/data/SOURCES1
    data_model: yyyy/mm/dd
    identity_path: tests/data/SOURCES1/yyyy/mm/dd
    timezone: UTC
    dialect: legacy-json
  - id: source2
    namespace: SOURCE2
    type: json_file
    enable: true
    data_path: C:/projects/openbexi_timeline/tests/data/SOURCES2
    data_model: yyyy/mm/dd
    identity_path: tests/data/SOURCES2/yyyy/mm/dd
    timezone: UTC
    dialect: legacy-json
loading:
  buffer_ratio: 0.25
  cache_mib: 64
  index_refresh_seconds: 30
```

`model` and `filter` are required file references in a generated version-2
environment. A tool choosing “no conditions” creates an explicit ALL filter.
Source IDs are stable logical identifiers. Their migration must preserve the
existing source identity/provenance mapping rather than regenerate record IDs.
`id` is a friendly YAML alias. `identity_path` preserves the original logical
legacy path used to derive canonical source/record IDs; changing the friendly
alias does not rename records. Keep `identity_path` stable when relocating data.
Models and filters are validated by the checked-in launch schemas, imported as
immutable publications, and retained in application-owned launch history.

Path rules:

- Resolve YAML-relative `model`, `filter`, `state_root` and `data_path` references
  against the directory containing that YAML file, never the IDE working directory.
- Resolve `data_model` as a partition template beneath that source's `data_path`.
  A version-2 relative template is intentionally different from the legacy
  absolute logical-path spelling.
- Resolve any file reference inside a model or filter against that file's own
  directory. Do not introduce implicit dependencies on the sibling legacy checkout.
- Accept absolute Windows paths for local installations; generated portable
  examples use relative paths. Keep workstation-specific profiles in ignored
  local directories when appropriate.
- Validate source roots and approved model/filter paths separately. Writable state
  must remain disjoint from read-only data authorities. Preserve existing path,
  symlink/reparse-point and traversal protections.
- The browser selects configured source IDs, not arbitrary server filesystem paths.

Only implemented source types can be selected. A legacy `connector` string or
converter class name is not permission to load Java code or open a new connector.

## Model file

Preserve the recognizable legacy `params`/`bands` representation through the
existing presentation adapter. The initial implementation should support the
primary band and overview, UTC/named timezone, colors, label size, interval unit,
interval pixels and supported compact presentation. Unsupported fields produce
named diagnostics rather than silent approximations.

The legacy `tests/models/regular_timeline.json` is the validation migration input.
Its current light presentation is not the supplied screenshot target. Define the
black-background target explicitly during implementation and keep the original
fixture unchanged. Preserve per-record colors and approved status icons. Do not discard
canonical model history or saved-view pins when importing a file-based model.

In version 2, a legacy `params.date` is migration metadata; it does not override
the selected filter's `initial_range`. Interval unit/pixels and viewport width
determine the span when the opening center is current time. Calendar units must
use calendar arithmetic in the model timezone rather than fixed month lengths.

## Filter file and initial range

Portable filter envelope:

```json
{
  "version": 1,
  "name": "Legacy sources March 18",
  "source_ids": ["source1", "source2"],
  "group_by": "none",
  "expression": null,
  "search": {"text": "", "mode": "any"},
  "initial_range": {
    "from": "2024-03-18T19:00:00Z",
    "to": "2024-03-18T21:00:00Z"
  }
}
```

This file wrapper is distinct from the published runtime catalog envelope.
Compile it into the existing validated filter/search definitions. Keep typed
field checks, safe regular expressions, source authorization and schema pins.
`expression: null` means no additional predicate. `source_ids` refers to the
selected YAML sources; unknown or disabled references are errors.

Rules for `initial_range`:

| Value | Meaning on a fresh launch |
| --- | --- |
| Omitted | Center on current time and use the selected model's visible span |
| `"current_time"` | Explicit spelling of the same default |
| `{ "from": ..., "to": ... }` | Open exactly that interval |
| Null, empty object, unknown string or one missing bound | Validation error |

Explicit bounds require offset-bearing ISO timestamps, `from < to`, and values
within the supported timeline date domain. Normalize stored instants to UTC;
display them in the model's timezone. Capture “now” once for the initial request
so the main view and overview agree. Evaluate it again on a fresh launch or an
explicit Now action, not on every asynchronous response.

The initial range is a **viewport setting**, not an enduring data predicate.
Panning outside it must still retrieve past/future records allowed by the filter.
An empty current-time window stays empty and navigable; it does not fall back to
the newest archive directory. Filter changes preserve the current viewport unless
the user explicitly asks to open the new filter's initial range.

## Dynamic grouping-field discovery

Discover Sort by fields from permitted record metadata in the selected datasets.
Legacy `data.status`, `data.namespace` and `data.magType` map to safe canonical
paths such as `/data/status`; the dropdown label remains recognizable. This is a
runtime metadata inventory, distinct from the authored visual model file. Custom
eligible scalar fields must be discoverable without manually registering every
dataset's dropdown items. Typed filter operators still require validated field
types; discovery does not authorize arbitrary expressions or write access.

Scope the inventory to selected sources, their revision and the relevant query
interval/filter scope, before display pagination. Report partial coverage while
loading. Merge keys across heterogeneous records and sources, excluding internal
and descriptive-only fields. Do not split values on commas or coerce distinct
types to the same group identity. Null, missing, boolean, numeric and string values
need explicit typed rules; nested scalar paths need unambiguous names. Objects and
arrays are not executable grouping expressions. Use bounded metadata indexing or
incremental summaries, not an archive-wide blocking scan.

Keep a selected field visible as unavailable if the current scope no longer
contains it; require an explicit replacement. Newly found fields extend the menu
without silently resetting the selection. Missing/null values require visible
groups rather than dropped records. High-cardinality fields require scalable
group handling or an explained resource limit, not the legacy hidden 14-value cap.

For the legacy grouped timeline, resolve the group from the parent event/session's
metadata and keep its nested activities with that family. Keep this distinct from
independent canonical activity queries and table row ordering. A migrated `sortBy`
must preserve that relationship policy and first-encounter group ordering; do not
silently map it to a differently ordered generic table sort. `NONE` maps to an
ungrouped timeline. The [manual](openbexi_timeline2.0_user_manual.md#filtering-and-dynamic-sort-by)
records legacy limitations and deliberate corrections.

## Records, files and response boundaries

Keep the current canonical record/snapshot schemas under `shared/schemas/`.
Canonical records preserve stable IDs, source identity, title, kind, UTC start/end,
original times, render overrides, metadata and parent/activity relationships.
Preserve legacy IDs and file/pointer provenance separately from canonical IDs.
Do not rewrite source archives while reading or translating them.

Canonical interval membership uses `[from, to)`: a point belongs when
`from <= start < to`; a positive duration overlaps when `start < to` and
`end > from`. Handle ongoing sessions explicitly. The REST compatibility adapter
must separately qualify any legacy endpoint boundary differences against fixtures.

Legacy data commonly uses `dateTimeFormat`, `scene`, `events`, and nested
`activities`. That wire envelope is not a canonical snapshot. Preserve its
consumer-facing fields through a dedicated serializer; never return a paginated
canonical row response where a legacy client expects all matching sessions.

Discover long sessions using actual indexed bounds, including records stored in
earlier date folders. Merge overlapping requests by stable source/record identity.
Do not deduplicate distinct records solely because their titles and times match.
Visual parent/activity overlays do not merge or delete their underlying records.

An empty interval, unreadable source, invalid file and incomplete index are
different states. Keep counts provisional until coverage is verified. A malformed
file affecting the requested window must not become a successful empty response.

## Current-to-target migration

| Current input | Target behavior |
| --- | --- |
| `legacy.model` resolved under `legacy.root` | Version-2 YAML `model` resolves relative to YAML under an approved model root |
| YAML `loading.initial_range` | Migration writes the same bounds into the selected filter |
| Legacy model fixed date, no explicit opening range | Migration offers an explicit historical range; new environments default to now |
| Latest-partition lazy fallback | Retained only for existing version-1 compatibility; not the version-2 default |
| Legacy `sortBy`, `filter_value`, include/exclude text | Parse through the audited legacy adapter; report unsupported/ambiguous semantics |
| Existing saved filters/views and preferences | Preserve IDs, history and pins; do not silently overwrite with imported files |
| Generated data ZIP/configuration | Add linked YAML/model/filter files and validate the complete environment |

Keep version-1 profiles runnable while version 2 is introduced. A migration creates
new reviewed files and a report; it must not overwrite the working source profile
or a private archive. Reject contradictory version-2 range ownership, such as a
filter range plus YAML `loading.initial_range`, with a clear migration message.

## Generated environment integrity

Validate model, filter, source references, range, writable destination and sample
records before saving. Stage the files as one environment, then activate its YAML
only after the complete set is present. On failure, retain the prior environment
and report the failing file/key. A data-only generator export remains a valid
separate operation, but must not be labeled a complete runnable environment.

Source evidence: [launch parser](../server/app/services/launch_configuration.py),
[legacy source adapter](../server/app/services/legacy_sources.py),
[reader](../server/app/services/legacy_reader.py),
[presentation adapter](../server/app/services/legacy_presentation.py),
[shared schemas](../shared/schemas), and [existing generator](../tools/event-generator/README.md).
