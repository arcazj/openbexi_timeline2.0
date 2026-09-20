# Current prompt: simplify OpenBEXI Timeline 2.0

Saved on 2026-09-20. This is the active project direction.

## Execution instruction

The documentation checkpoint is complete. On 2026-09-20 the user authorized
implementation with “can we implement?”. **Implement and validate this prompt.**
Keep this saved prompt current, preserve the source archives, and record actual
tests and remaining qualification limits. No deployment or publication is requested.
Existing uncommitted application changes from earlier work must be preserved.

## Approved documentation organization update

The user approved moving the seven primary guides into `docs/`, keeping this saved
prompt at the repository root, and updating documentation consumers. Detailed
implementation references are retained under `docs/reference/implementation/`;
licenses, release records and verification assets are preserved. This supersedes
the original root-file placement below. The later implementation authorization
supersedes the earlier documentation-only pause.

## Project prompt

Simplify `openbexi_timeline2.0` so its interface, configuration, project
organization, and data-loading behavior closely follow the legacy application
at `C:\projects\openbexi_timeline`.

Use the legacy application as the reference for visual design and everyday
workflows. Preserve working functionality while removing unnecessary complexity.

### 1. Simplify the project structure

- `yaml/`: server startup configurations. **The YAML file is the starting point
  for launching a timeline environment.** It tells the server where to find data
  sources, which model to load from `models/`, and which filter to apply from
  `filters/`.
- `models/`: timeline presentation definitions, including bands, colors, scales,
  and layout.
- `filters/`: reusable filtering and grouping definitions. Each filter may
  specify an `initial_range` that determines the opening time window. **When
  omitted, open around the current time**, using the selected model's time scale
  to determine the visible span.
- `data/`: timeline datasets, equivalent to the legacy `json/` directory. YAML
  configurations must also support external data locations.

Keep responsibilities clear: YAML connects the environment's components, the
model defines its appearance, and the filter defines the selected data and
initial time window. Resolve relative references consistently against the
containing configuration file. Report missing files, invalid references, and
malformed ranges with actionable errors.

### 2. Simplify the timeline interface

- Reproduce the legacy application's compact toolbar, dense event layout,
  timeline bands, overview, and descriptor panel.
- Keep common actions easy to find.
- Keep **Timeline**, **Table**, and **Split** directly in the main toolbar, in
  that order, matching the supplied [view-switch screenshot](docs/ui/legacy-target/view-modes.png).
  Show one active mode clearly. Timeline displays the timeline; Table displays
  matching records as rows; Split displays both with synchronized selection.
  Switching modes preserves the source, inspected interval, filter/search,
  grouping and selected record. Keep table sorting separate from timeline grouping.
  These existing controls must remain visible in the simplified shell, including
  usable keyboard and narrow-screen access; do not move them into Settings.
- Move advanced settings out of the main interface.
- Preserve navigation, search, filtering, selection, and data inspection.

### 3. Preserve legacy REST compatibility and continuous navigation

Inspect and document the legacy application's actual REST interface before
implementing changes. Reuse its endpoint paths, HTTP methods, parameters, date
conventions, and response structures wherever applicable. Use a compatibility
adapter when necessary so existing legacy clients and configurations continue
to work.

Follow the legacy approach to loading data for the requested time window. Users
must be able to navigate continuously into the past or future without manually
selecting daily files, restarting the server, or being restricted to already
loaded records.

- Load the visible interval first, then prefetch adjacent intervals in the
  background.
- Support smooth panning, zooming, and direct date navigation across day, month,
  and year boundaries.
- Cache recent intervals with bounded memory use and avoid duplicate requests.
- Cancel or ignore obsolete requests during rapid navigation so late responses
  cannot replace the current view.
- Keep visible data stable while additional data loads, and keep the overview
  synchronized.
- Preserve sessions that cross interval boundaries and prevent duplicate records
  where requests overlap.
- Treat empty periods as valid navigable intervals. Distinguish missing or
  invalid data from an empty result.
- Support current-time refresh when enabled, without moving users away from a
  historical or future interval they are inspecting.

Keep this behavior automatic and unobtrusive. Avoid loading the entire archive
at startup or adding unnecessary controls to the interface.

### REST API and Swagger documentation requirement

Document the RESTful interface and provide an accessible Swagger/OpenAPI reference
from Help. Cover endpoints, HTTP methods, authentication, request/response schemas,
examples, errors, time-window loading, filtering/grouping, descriptors and
pagination/revision rules. Clearly distinguish implemented native API routes from
planned legacy-compatible routes and SSE behavior.

Retain offline Swagger, live authenticated OpenAPI inspection and specification
downloads. Explain where users access them and whether request execution is enabled.
Keep the generated OpenAPI contract synchronized with registered handlers/shared
schemas and verify it in tests. Do not claim a server `/docs` page or unimplemented
endpoint exists. Verify each implemented route against its generated contract.

### 3a. Preserve legacy filtering and dynamic timeline grouping

Reproduce the legacy Sorting & Filtering workflow and visible grouping behavior.
Generate the Sort by choices dynamically from eligible metadata fields in the
selected JSON datasets; never hard-code status, namespace or magnitude type as the
complete list. Support newly encountered fields without application-code changes.
Discover fields across the relevant query/source data before display pagination.

Applying status, namespace or earthquake magType creates labeled timeline bands
with the corresponding values, colors and parent/activity layout. NONE restores
the ungrouped view. Keep the inspected interval, active filter/search and record
identity stable. Preserve first-encounter group order for legacy compatibility;
table row sorting is a separate operation. Retain the panel's Apply/Close and
named-filter selection/add/edit/save/delete/help workflow.

Audit `build_model`, `ob_get_all_sorting_options`, `ob_apply_timeline_sorting`,
`create_new_bands`, `update_timeline_model`, band assignment and the Java filter
pipeline. Document and correct the first-record discovery bug, comma/string
heuristics, arbitrary option limits and unsafe field evaluation without claiming
those defects as required parity. Handle missing/null/mixed types explicitly.

Use the supplied status/namespace screenshots with SOURCE1/SOURCE2 as the primary
comparison and the September 16, 2026 earthquake magType screenshot as supplementary
evidence of dataset-dependent choices. Save all references in the user manual.
Source inspection and discovery probes alone do not establish implementation parity.

### 4. Simplify the configuration tools

Provide a straightforward workflow to create, edit, validate, and save a complete
timeline environment. Generate coordinated files in `yaml/`, `models/`,
`filters/`, and `data/`, with valid references between them.

Users should be able to select data sources, choose a model and filter, and
optionally configure the filter's `initial_range`. Launching the generated YAML
file must start the complete environment without manual file repair.

### 5. Consolidate documentation

Replace fragmented and redundant project documentation with these seven Markdown
guides under `docs/` (the current prompt stays at the repository root):

- `openbexi_timeline2.0_prompt_history.md`
- `openbexi_timeline2.0_design.md`
- `openbexi_timeline2.0_data_design.md`
- `openbexi_timeline2.0_architecture.md`
- `openbexi_timeline2.0_tests.md`
- `openbexi_timeline2.0_deployment.md`
- `openbexi_timeline2.0_user_manual.md`

Migrate useful content before removing obsolete documents, update references,
and retain required licensing and security files. Keep the README short,
covering quick start and links to these documents.

### 6. Verify the simplified application

Inspect both projects before making changes. Compare the result with the legacy
interface using `C:\projects\openbexi_timeline\tests\data\SOURCES1` and
`C:\projects\openbexi_timeline\tests\data\SOURCES2` (actual folder spelling).
Use the supplied screenshots: March 18, 2024 at 20:00 UTC, 1500 × 795 pixels.
Retire the previous production validation profile and archive-specific references.
Audit the legacy code for every toolbar icon and document its complete behavior in
the user manual. Preserve icon order, search field, central time label, overview
toggle, 2D/3D switch, settings and Help. Source inspection alone is not runtime parity.

Test:

- YAML-driven startup, model and filter selection, explicit `initial_range`
  values, and the current-time default.
- Compatibility with the legacy REST requests and responses.
- Continuous past/future navigation, boundary-crossing sessions, empty periods,
  rapid navigation, and delayed or failed requests.
- The complete workflow for generating and launching a new environment.
- Main-toolbar Timeline/Table/Split switching, shared query/selection state,
  independent table sorting, and usable Split layout on desktop and narrow screens.

Preserve existing configurations through compatibility support or a documented
migration path. Maintain compatibility with supported Python versions from 3.9
onward and the IntelliJ startup workflow.

Deliver the implementation, updated documentation, and test results. Clearly
identify any remaining differences from the legacy application. The execution
instruction above now authorizes implementation and its verification.

### 7. Publish version 2.0

Add README live-demo links for all six bundled test datasets. Extend the default
dataset with deterministic sessions and events before and after the original
sample day, preserving its original records. Remove unnecessary generated PDFs
and obsolete PDF-only tooling while retaining useful Markdown, licensing,
provenance, tests and reference screenshots. Keep machine-specific test profiles
untracked. Validate the result, push the source and `v2.0.0` tag to GitHub, publish
the stable release, and deploy the standalone demos through GitHub Pages.
