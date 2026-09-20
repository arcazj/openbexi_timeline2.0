# OpenBEXI Timeline 2.0 — design

Updated: 2026-09-20. The file-based environment, compact toolbar and dynamic
grouping implementation follows the [current prompt](../openbexi_timeline2.0_current_prompt.md).
Requirements below remain acceptance criteria; the test guide records measured
results rather than treating every criterion as automatically certified.

## Purpose

Make the application feel like the legacy timeline at
`C:\projects\openbexi_timeline`: a compact, continuous view of events and sessions,
configured through a small set of understandable files. Keep the existing Python
server and shared browser implementation; simplify the user's workflow rather
than replacing working data and rendering components.

## Project organization

| Directory | Responsibility | Selected by |
| --- | --- | --- |
| `yaml/` | Startup profile: server settings, approved data sources, model and filter references | Server launch command |
| `models/` | Appearance: bands, scales, palette, labels and layout | YAML profile |
| `filters/` | Data selection, grouping, search defaults and optional `initial_range` | YAML profile |
| `data/` | Bundled datasets and generated sample records; equivalent to legacy `json/` | YAML data-source definitions |

External archives remain supported. `server/`, `client/`, `shared/`, `scripts/`
and `tests/` remain implementation directories. `var/` and `runtime/` contain
local state and generated working files, not user-authored timeline definitions.
Do not move real archive files into the repository as part of this reorganization.

YAML is the single entry point. Opening a model alone must not accidentally pick
another source or filter. File formats, reference resolution and migration rules
are defined in [data design](openbexi_timeline2.0_data_design.md).

The seven primary documentation guides live in `docs/`. The saved current prompt
stays at the repository root. Detailed prior contracts live in
`docs/reference/implementation/`; licenses and verification assets are retained.

## Current Help and sharing

Help follows Settings in the current toolbar. Its seven primary guide buttons open
the consolidated documentation offline. The API viewer is also bundled and read-only;
Live API requires an active server. Links to unbundled references may need internet.
Help also offers bundled test datasets; review unsaved local edits before opening one.

Shared view links contain range, filters, search and selection, but no records,
credentials or server filesystem paths. Search text remains readable in the link.
Incoming links require review before application and do not connect or write to a
server automatically. PNG export includes the selected descriptor; diagnostics omit
credentials, private paths and search content. See the retained
[Help and sharing reference](reference/implementation/help-and-sharing.md).

## Timeline workspace

The primary view has a compact toolbar, a large event band, a smaller synchronized
overview, and a descriptor panel that opens when a record is selected.

- Toolbar: connection/user, calendar, reference-time resynchronization, filter, search icon and
  input on the left; title/time in the center; Timeline/Table/Split, overview
  toggle, 2D/3D, settings and Help on the right. Follow the [user manual](openbexi_timeline2.0_user_manual.md)
  icon-by-icon behavior audit. Keep advanced tools inside secondary panels.
- Event band: dense, collision-aware packing; duration bars with nearby labels;
  point markers; original source colors and supported legacy status icons.
- Overview: show the broader time context and selected interval. Dragging its
  window changes the main view. Distinguish individual marks from aggregates.
- Descriptor: readable metadata, original times, status, description and parent
  links. Legacy description line breaks may be converted safely to text; never
  execute imported HTML or scripts.
- Navigation: pan, zoom, direct date selection and Now. Data boundaries do not
  become navigation boundaries. Returning no events must still leave a usable
  calendar and time axis.
- Loading: retain the last confirmed view while requesting the next one. Use one
  quiet status indicator; show actionable errors without replacing real data with
  demonstration data.

**Timeline / Table / Split stay directly in the main toolbar**, in that order,
as shown in the [supplied view-switch reference](ui/legacy-target/view-modes.png).
Use compact text buttons with one clearly selected state, matching the silver/blue
toolbar. They are primary navigation controls, not entries hidden in a secondary
panel. Retain functioning inspection, search and export capabilities.

Timeline shows the event bands and optional overview; Table shows the same query's
records as rows using the chosen table scope (current interval or all filtered
records); Split shows both. Preserve sources, inspected interval, table scope, filter,
search, grouping, selection and descriptor context when switching. Table sorting
does not change timeline group order. Reuse the current provider/query state and
load only missing view resources; a view switch must not reload the whole archive.
Split uses side-by-side panes on wide screens and stacked usable panes on narrow
screens. Both remain accessible; selecting Split must not silently hide the table.
These modes already exist in the current app; retaining them in the redesigned
toolbar and verifying the complete behavior remain part of implementation acceptance.

## Dynamic filtering and grouped timeline

The funnel opens the legacy-style **Sorting & Filtering** panel. Keep Sort by,
Apply and Close above the named filter list and its select/edit/delete/add/help
controls. Sort by is a dynamic choice of metadata fields from the current JSON
datasets, not a hard-coded menu or a table-order dropdown.

Applying a field creates labeled timeline bands: status values, SOURCE1/SOURCE2
namespaces, or earthquake magnitude types are examples. NONE removes the grouping.
Preserve first-encounter group order for compatibility, namespace palettes and
alternating backgrounds for other groups, and parent/activity placement. Retain
the inspected interval, search and active filter when regrouping. Saved presets
retain their actual grouping definition rather than deriving it from their names.

Discover eligible fields across the relevant query before pagination, refresh the
list when source metadata changes, and expose incomplete/unavailable states. Avoid
the legacy first-record and string-length/cardinality heuristics; newly encountered
eligible fields must work without code edits. See the [manual's source audit and
four grouping references](openbexi_timeline2.0_user_manual.md#filtering-and-dynamic-sort-by).
The earthquake example supplements the two-source fixture. Provider parity and
live two-source browser checks cover dynamic grouping; visual reproduction of
the separate earthquake archive requires that archive.

## Opening time and filter changes

On a fresh YAML-driven launch, apply the selected filter's `initial_range`.
If absent, center on current time in the model's timezone and derive the visible
span from its primary-band scale. A historical archive can therefore open on an
empty current-day interval; it must not silently jump to the newest file.

Applying another filter normally preserves the user's inspected interval. Provide
an explicit action to open that filter's initial range. Manual past/future
navigation exits follow-now behavior; background updates do not pull the view
back to today. Restore of a saved view is a separate explicit action.

## Configuration tool

Use one short environment workflow:

1. **Environment:** name and destination, or open an existing YAML profile.
2. **Data:** choose bundled/generated data or approved external sources and check
   readability. Show detected time coverage separately from the opening range.
3. **Model:** choose a preset and edit bands, colors, scales and compact layout.
4. **Filter:** choose sources, conditions, grouping and an optional initial range.
5. **Review and save:** preview the timeline and show the exact files/references
   to be saved, then validate and save the complete environment.

The result contains `yaml/<name>.yml`, `models/<name>.json` and
`filters/<name>.json`; generated data goes under `data/<name>/`. External-data
environments reference their existing archive without copying or rewriting it.
Reuse the existing event generator behind this workflow instead of duplicating
its engine. Advanced generation controls stay available in an expandable section.

Preview must not modify the running environment. Stage and validate generated
files before activating a profile. Failed saves leave the previous environment
runnable. Browser downloads produce a complete environment bundle; direct server
saves are limited to an explicitly chosen writable destination.

## Current implementation and remaining work

| Area | Current evidence | Required next change |
| --- | --- | --- |
| Startup | `scripts/start.py` prepares dependencies and launches version-1 or version-2 YAML | Continue the supported Python/OS installation matrix |
| Legacy rendering | Compact packing, matching parent/activity overlays and legacy checks were implemented before this phase | Simplify the surrounding toolbar and tool panels; retain regression coverage |
| Model files | Repository-owned `models/legacy_test.json` gives the black compact reference appearance | Retain source palettes, immutable publication history and saved pins |
| Filter files | Version-2 file adapter imports the YAML-selected filter | Preserve typed validation and explicit saved-view restoration |
| Opening range | Version 2 uses filter `initial_range`, default now; version 1 retains prior semantics | Qualify additional timezone/calendar edge cases through the existing suites |
| Transport | Legacy REST/SSE adapter shares authorized query and configuration services | Keep authenticated transport and documented mutation/search differences explicit |
| Generator | Complete environment ZIP and atomic CLI activation accompany data-only export | Validate emitted environments before use and retain failure recovery tests |

## Visual acceptance

Use the [supplied two-source screenshots](openbexi_timeline2.0_user_manual.md#expected-validation-view)
with `tests/data/SOURCES1` and `tests/data/SOURCES2` from the legacy checkout.
Match March 18, 2024 at 20:00 UTC, a 19:00–21:00 window, 1500 × 795 viewport,
black background, light labels, nested colored bars and the hidden overview state.
The version-2 test profile now selects this black, initially hidden-overview model.
Advanced controls open through Workspace tools in compact environments; the primary
toolbar retains the requested controls. Full screenshot comparison remains distinct
from validating data counts and behavior.

Validate each source separately and both together. Preserve source identity,
parent/activity relationships, point icons, original times and descriptor lookup.
Do not derive unique-record counts from drawn marks or hide records to increase
visual similarity. Every toolbar control needs a behavior test, including 2D/3D,
overview visibility, user preferences and calendar event creation.

See [tests](openbexi_timeline2.0_tests.md) for measurable acceptance and
[architecture](openbexi_timeline2.0_architecture.md) for continuous loading.
