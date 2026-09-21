# OpenBEXI Timeline 2.0 — tests and acceptance

Updated: 2026-09-21. Implementation results and qualification limits are recorded below.
Current checks are separated from the retained documentation checkpoints.
Feature tests do not by themselves establish every supported-scale release target.

## Release 2.0 validation

### Subsequent setup, navigation and CI hardening

The post-release checks add portable IntelliJ configurations, sparse-date
navigation and measured full-archive workloads. Date-availability tests cover
authorized source selection, saved filters, deleted/ongoing records, negative
years, half-open intervals, cache invalidation and stale or unauthorized UI
responses. Browser checks retain filters and viewport span when jumping between
recorded dates. The copied archives remain read-only.

CI failures on `dce557013` exposed a real Now-button defect near UTC midnight,
an oversized SSE contract-test seed, an unsettled Firefox reconnect precondition,
and an outage assertion tied to only one valid error message. The fixes keep
real lifecycle and recovery assertions, use a compact explicit SSE fixture, and
test Now with a fixed clock on both sides of midnight. No retry count or overall
test timeout was increased to hide these failures.

The subsequent Linux Firefox run exposed an empty-date button being replaced
during a layout resize, interrupting a click. A regression holds the pointer
down while the viewport height changes, verifies that the same button survives,
then releases it and checks navigation. It fails against the original build;
the fix retains the controls for layout-only changes and still clears them when
their source, query or range becomes obsolete.

Windows Firefox also exposed an informational loading badge intercepting the
descriptor Close button during relayout. Its regression holds a real pointer
press while a delayed layout displays the badge; status text must not intercept
input. A separate source-race test now waits for a replacement server identity
and ready query before releasing an obsolete editor response, rather than
mistaking the original connection for the newly requested one.

Further browser runs exposed two related races: an adaptive query left obsolete
date actions enabled, and a canceled descriptor resize recorded dimensions that
had never been rendered. Held-request regressions check that date actions remain
disabled until their current query is ready and that record selection during a
pending resize eventually restores the canvas to the actual plot dimensions.
Layout-only changes continue to preserve a date-button press.
A second delayed-layout regression checks that reconciliation lets a newer
pending layout finish instead of repeatedly canceling it. The archive-index test
settles the calendar's resize before releasing its index gate, so its manual
refresh assertion does not race an already completed automatic refresh.
Its held-query check uses explicit refresh: a viewport resize can legitimately
be consumed by a pending layout without creating another query. The check still
requires date actions to remain disabled until the new query is ready, preserving
the selected source and time range.

Backup integrity tests control both detection orders. An external edit detected
during backup capture freezes the workspace and leaves an incomplete archive
marker. An edit detected before backup admission freezes the workspace and
rejects the backup before creating a destination. Both paths use the real
integrity checks; neither publishes a completed backup.
The 92 backup/integrity tests passed locally, and both final detection-order
cases passed on Python 3.9 and 3.14.

The delayed-drag test drains routed background requests before stopping its
server. A controlled reproduction confirms that the earlier teardown reset a
live allocation request after the behavior assertions had passed.
The interceptor also preserves server errors unchanged: a superseded query can
be released while its forwarded layout allocation is still running. It holds
only successful allocations with valid ownership; the drag, partial-coverage
and recovery assertions remain required.
Legacy test fixtures also clear per-test ownership before startup and cleanup. Their health
check uses the ordinary server fixture's 30-second elapsed budget, replacing
120 probes that could stop after roughly 12 seconds on fast connection refusals
or take roughly 42 seconds on slow responses. Process checkpoints and exit
diagnostics make future startup failures observable; the earlier empty-output
failure did not establish an application startup defect.
Descriptor tests give their owned server fixture a separate 60-second allowance
for startup and cleanup, including bounded process shutdown and file-removal
retries. Their API setup and browser assertions keep the normal 30-second test
budget; a failed startup cannot reuse another test's disposed server.
Configuration and scoped-descriptor scenarios use the same separate ownership
for their server startup. Bootstrap diagnostics now cover the initial readiness
wait, recording only the request path, timing, status and native error. Earlier
Windows Firefox traces showed an unavailable startup before any bootstrap
request was recorded; those traces did not establish its native failure cause.
All 51 configuration/scoped-descriptor cases passed locally across Chromium,
Firefox and Edge with the owned fixtures. Request listeners now capture the
reviewed record's identity before cleanup clears fixture data; a late request
during context teardown cannot read the cleared record reference. The six
shared-view cases passed across the three browsers after this correction.

A subsequent Windows Firefox capture recorded a bootstrap `AbortError` after
5,005 ms, before the test interceptor ran. It did not identify the underlying
browser or interception delay. The cold-bootstrap case now uses a real HTTP
server that delays its 404 response for at least 2.5 seconds and until the test
has checked that no sample records appeared. It leaves native fetch, the
application's five-second deadline and the test's 30-second budget unchanged.
Independent server receipts and browser timings make any future failure
observable. Six fixture checks cover the delay, inspection gate, disconnects,
shutdown and occupied-port failure. Both the previous routed test and a native
HTTP prototype passed one local Windows software-rendering comparison; those
passes do not establish the cause of the hosted failure.
The final six fixture checks and native cold-start case in Chromium, Firefox
and Edge passed locally.
A later Windows Firefox native-HTTP run received no bootstrap request at either
the server or the browser observer. The main document transferred in 4.59 seconds,
but navigation completed after 15.90 seconds with startup already unavailable;
the delayed response handler never ran. Source discovery now completes before
explicit font loading and graphics construction. The regression holds the real
bootstrap response while checking the initial loading status and zero successful
WebGL contexts, then requires the delayed 404, query and rendered canvases.
It fails against the preceding ordering, which created two contexts first.
This separates startup work without changing the five-second deadline; the
underlying hosted browser/network cause remains unproven.

A demo sharing failure exposed a reviewed Apply button remaining enabled during
a background viewport relayout. The application correctly rejected the busy
operation, but the test mistook the original view becoming ready for a successful
apply. Apply now follows loading and pending work, preserving the reviewed link;
a changed query scope still requires reopening Help. A held real layout response
reproduces the old enabled-button defect. The regression requires Apply to be
disabled during the resize, restored availability afterward, explicit application, a new
query and the exact reviewed range. The demo also requires the review dialog to
close and the replacement query to be adopted before checking that range.
Its Apply precondition checks that the painted canvas fits the current plot:
the initial range label can wrap the toolbar and queue a resize after the query
first becomes ready. This uses observed geometry, without a fixed sleep or a
second click after a failed apply.

Firefox CI also checks WebGL2 before running the application suite. Linux uses
Mesa software rendering; the preflight compiles shaders, draws a triangle and
checks the resulting pixel. All twelve Windows/Linux interpreter jobs passed
this graphics check. It fails explicitly when rendering is unavailable instead
of turning an environment failure into an application-test timeout.

Local Windows validation on September 20, 2026 passed 534 client tests,
50 generator tests, 72 provider integration/parity tests and 1,253 Python 3.14
server tests. One server test was skipped because the local account cannot
create symbolic links. Focused Python 3.9 checks also passed. These results
describe the local implementation checks; the full CI matrix below separately
qualifies each operating system and interpreter combination.
The preceding application build passed all 251 local Edge browser cases and all 16
static-demo cases. Focused resize, date-navigation and stale-response coverage
passed 42 cases across Chromium, Firefox and Edge. The delayed smart-drag test
also accepts a valid immediately ready layout allocation before explicitly
holding its owned layout response; its cancellation assertions passed in all
three browsers. These focused checks supplement the full CI matrix below.

The Windows/Linux CPython 3.9–3.14 matrix remains the qualification source for
each commit: [Candidate Verification](https://github.com/arcazj/openbexi_timeline2.0/actions/workflows/verify.yml).
Successful dependency installation alone does not qualify the application.

### Original release evidence

The release adds dataset deep links and expands the default sample to 1,008
records. Validation on September 20, 2026 includes:

- 517 JavaScript unit tests passed on Node 24.19.0 and Node 22.23.2. All 71
  client/server parity tests and 50 generator tests passed. A formerly timing-dependent
  retry-deadline assertion now uses a controlled clock; its 25-test suite passed.
- Python 3.9: 55 setup, environment, legacy API and shipped-dataset tests passed.
- The full Python run passed 1,229 tests with one Windows symlink-permission skip
  and one old assertion equating original and generated sample counts. The
  assertion was corrected to account for synthetic additions; all 13 dataset
  tests then passed, including a fresh writable workspace and both surrounding months.
- All 14 static-demo scenarios passed, including six direct links, invalid and
  duplicate selections, reviewed sharing, offline/mobile use and past/future navigation.
- The full browser run recorded 238 passes and one mobile touch-test failure.
  The test assumed its target was on the first page of rows; it now locates that
  target using the actual paging controls. The corrected test passed, including
  the touch threshold, time edit and canonical JSON export. The full 239-test
  suite was not repeated after this test-only correction.
- The explicit SOURCE1/SOURCE2 reference check passed with source hashes unchanged.
- Locked dependency consistency, OpenAPI regeneration, deterministic dataset
  regeneration, lint, publication boundaries and build-input checks passed.

Contract tests explicitly select `shared/fixtures/initial-snapshot.json` so
filter/sort expectations do not silently change when demonstration data grows.
Dedicated dataset and browser checks use the full shipped snapshots. Historical
sources in `data/original/` and the other five normalized datasets are unchanged.
Local release logs are retained under `runtime/release-*.log`; they are not published.
No Docker image build or untested future Python compatibility is claimed.

## Running the legacy reference check

The self-contained browser suite runs with `npm run test:e2e`. Comparison against
the separate legacy checkout is explicit: `npm run test:reference` requires
`../openbexi_timeline/tests/data/SOURCES1` and `SOURCES2`. It fails clearly when
those external fixtures are missing and checks that their source hashes remain
unchanged. A fresh clone can run its normal suite without the sibling checkout.
`npm run test:demo` checks the packaged static site and all seven dataset deep links.

## Implementation checkpoint

The authorized implementation now covers version-2 YAML environments, separate
model/filter files, filter-owned opening time, observed JSON grouping fields,
legacy family grouping, REST/SSE translation, compact toolbar controls and complete
environment generation. Later test runs below supersede the documentation-only
checkpoints retained at the end of this guide.

Validation on Windows used Python 3.14.7, Python 3.9.13, Node 24.19.0 and installed
Edge/Chrome. The Python 3.9 environment was independently synchronized from the
lockfile; all 67 targeted setup, environment, partitioned-loading and legacy API
tests passed. The full Python suite passed 1,219 tests; one Windows symlink test
was skipped because the process lacks permission to create symlinks. The two
reported warnings are upstream test-client deprecations. The final JavaScript
unit suite passed 515 tests, and all 71
Local/HTTP parity tests passed. The generator passed 50 tests and its real Chrome
workflow check, including complete environment ZIP output.

The complete browser run recorded 233 passes and seven failures. Two failures
were outdated assertions (dynamic grouping authorization and the reported version);
the others exposed mobile scale-control visibility, two narrow Split geometry
cases, an authored single-band overview default and a transient bootstrap network
failure. All seven failing cases passed on focused reruns: two corrected assertion
tests, 13 affected UI tests and three startup tests. These sets overlap; their
counts must not be added as unique coverage. The startup test now injects a failed
bootstrap fetch and verifies bounded recovery without sample-data fallback.
The complete 240-test run was not repeated. Its original log remains in
`runtime/implementation-browser-final.log`; startup evidence is in
`runtime/implementation-startup-transport-retry.log`.

Final visual review added explicit non-overlap and complete-table-row assertions
for a 390 × 700 Split view. All four final short-screen checks passed. Responsive
logs are `runtime/implementation-responsive-final.log` and
`runtime/implementation-short-mobile-final.log`.

After the packaging audit, 46 focused candidate/publication tests passed. Candidate
verification now includes generator tests and hashes the model/filter, generator
and IntelliJ configuration inputs. Docker inputs were updated; an image build was
not performed. Local logs are retained as `runtime/implementation-server-final.log`,
`runtime/implementation-client-final.log` and `runtime/implementation-python39-tests.log`.

The live SOURCE1/SOURCE2 test opens the exact March 18, 2024, 19:00–21:00 UTC
interval with a uniform axis centered at 20:00, black appearance and hidden
overview. It checks SOURCE1 alone (63 records), SOURCE2 alone (67), both together
(130), dynamic status/namespace grouping,
Timeline/Table/Split, both cameras, authenticated legacy HTTP/SSE and unchanged
source hashes. Generated environments are also passed through the real Python
launch parser and reader, including descriptor lookup and version-1 migration.

Regression fixes found during implementation include chronological row packing
inside encounter-ordered groups, source-scoped aliases and styles, atomic
generator activation cleanup, descriptor routing and preservation of the
version-2 model's scale settings. Read/capture budgets, cancellable lock waits,
indexed window selection and foreground priority have targeted regression tests.

The full interpreter/OS CI matrix, container image, performance p95 targets and
hard process-RSS limits are separate qualification gates. No claim is made that
all future Python versions, every old browser mutation or arbitrary legacy regex
expressions are supported. See the REST compatibility limits in the manual.

## Original documentation checkpoint checks

- Confirm the saved prompt and all seven requested guides under `docs/` exist.
- Check relative Markdown links and referenced source paths.
- Parse proposed YAML/JSON examples for syntax; clearly label them as proposed
  contracts rather than configurations accepted by the current parser.
- Compare the documented legacy HTTP surface with its Java/client source.
- Check consistency: YAML selects model/filter; filter owns `initial_range`;
  omission means current time; the range never restricts later navigation.
- Check README and contributor links lead to the consolidated documents.
- Preserve earlier application changes, operational data and license/security
  documents. Do not restart, deploy or refactor the application in this phase.

Run `npm run check:repo` and `git diff --check`. These check publication paths,
links/basic text hygiene and existing credential patterns; they do not qualify
the implementation. Targeted checks of the new files supplement the repository
check, which only checks links in selected entry documents.

## Reproduce existing implementation checks

From the repository root on Windows:

```powershell
python scripts/start.py --setup-only
npm test
.venv/Scripts/python.exe -m pytest tests/server -q
.venv/Scripts/python.exe -m ruff check server tests/server scripts
npm run test:parity
npm run build
npm run test:e2e
```

Use `py -3` if `python` is unavailable on Windows, or `python3` and
`.venv/bin/python` on macOS/Linux. Node 22+ is required for the project build.
No globally installed `uv` is required by the bootstrap launcher.

Windows browser tests use installed Microsoft Edge by default. For the bundled
Playwright browser on other platforms, install Chromium first with
`npx playwright install chromium`. `npm run test:matrix` provides the configured
additional-engine matrix after its browser dependencies are installed.

For a frozen candidate, the existing verifier is:

```powershell
.venv/Scripts/python.exe scripts/verify-candidate.py --matrix --output artifacts/verification/simplification-candidate-01
```

Use a new output directory. Preserve command exits, logs, source/lockfile hashes,
browser captures and skipped/failing cases. A workflow definition or successful
build alone is not evidence that all tests or a remote deployment passed.

## Required acceptance after implementation

| Area | Cases and pass condition |
| --- | --- |
| Environment startup | Launch from a different working directory and a checkout with spaces; YAML resolves the intended model/filter/data |
| Validation | Missing files, unsupported versions, unknown source IDs, invalid filters and reversed ranges report the responsible file/key |
| Initial range | Fixed historical interval opens exactly; omitted and `current_time` center on one captured clock value using model scale |
| Timezone | UTC, named-zone DST transition and calendar month/year scales produce consistent main/overview bounds |
| Precedence | New profiles reject competing YAML/filter ranges; migration preserves explicit version-1 historical windows |
| Filter application | Ordinary filter changes retain the inspected interval; explicit open-initial-range action changes it |
| Legacy REST | Golden requests/responses for sessions, descriptors and filter reads; method, path, encoding, types and nested activities agree |
| Writes/streams | Authorized filter/event operations preserve read-only boundaries; SSE frames, reconnect, replacement and cancellation are tested |
| Continuous navigation | Past/future pan, zoom and date jumps cross day/month/year boundaries without manual file selection or restart |
| Request races | Reverse navigation with delayed responses cannot restore an obsolete interval/source/filter |
| Boundaries | A long session stored in an earlier folder remains discoverable; overlapping fetches do not duplicate identities |
| Empty/error states | Empty intervals remain navigable; missing/unreadable/invalid data is not reported as successful absence |
| Coverage | Cold indexing reports provisional counts; verified refresh preserves selection and does not force a jump |
| Resource use | First visible window does not wait for a full scan; cache and concurrent prefetch remain bounded |
| UI | Dense readable rows, correct icons/colors, nonblank canvases, usable toolbar, overview and descriptor at desktop/narrow sizes |
| View controls | Timeline, Table and Split are directly in the main toolbar, in screenshot order, with one announced active state and pointer/keyboard access |
| View continuity | Switching modes retains source/query, time, filter/search, table scope, grouping and selection; row sorting does not regroup the timeline |
| Split | Both panes are usable side by side on desktop and stacked on narrow screens; shared selection works, off-screen selection does not force navigation, and repeated switches do not leak resources or rescan the archive |
| Selection | Matching parent/activity overlay remains one mark while both identities stay accessible in tables, search and parent links |
| Generator | Create all four directory outputs, validate references, launch emitted YAML, and round-trip edits without hand repair |
| Save failure | Interrupted or invalid environment generation leaves the previous environment runnable |
| Compatibility | Existing version-1 profiles, offline snapshots, model/filter pins and IntelliJ startup still work |

Capture actual legacy HTTP traffic in a controlled local fixture before asserting
wire compatibility. Java source inspection in the architecture document is an
audit input, not a replacement for runtime contract tests. Do not copy dummy
error responses or unsafe mutation behavior just to make a comparison pass.

## Two-source comparison fixture

Use the legacy checkout's `tests/data/SOURCES1` and `tests/data/SOURCES2`;
both contain `2024/03/18/events.json`. Run `yaml/default_test.yml` with both
sources enabled and March 18, 2024, 19:00–21:00 UTC (center 20:00).
`SORCES1`/`SORCES2` are spelling errors, not alternative configured directories.

The [user manual](openbexi_timeline2.0_user_manual.md) preserves both supplied
screenshots and the handler audit. Match the 1500 × 795 viewport, black background,
light labels, bar geometry, icon colors, long titles, nested activities and hidden
overview. The version-2 profile now selects the repository-owned black model;
the live reference test verifies real data, grouping and toolbar behavior.

- Check SOURCE1 only, SOURCE2 only and both together; record canonical counts and
  source/record identities separately from visual marks. Do not reuse old archive counts.
- Check named screenshot records, times and parent/descriptor relationships.
- Exercise every toolbar action in the manual through pointer and keyboard input:
  user panel, calendar and creation form, now/resync, filter CRUD/sort, search/Enter,
  overview toggle, both cameras, geometry settings, Help/manual and the
  [Timeline/Table/Split controls](openbexi_timeline2.0_user_manual.md#timeline-table-and-split).
- Confirm continuous earlier/later loading, empty windows, boundary-crossing sessions,
  source changes, stale responses and return to the historical validation range.
- Hash source files before/after; reads, camera changes and filters must not rewrite them.

Use isolated writable state for validation. Add synthetic cases for delayed responses
and changed/deleted files rather than modifying the external fixtures. Data loading
checks do not establish screenshot or toolbar parity.

## Dynamic Sort by and filtering acceptance

Use all four [grouping screenshots](openbexi_timeline2.0_user_manual.md#supplied-grouping-references).
The SOURCE1/SOURCE2 status/namespace examples remain the primary baseline;
the earthquake magType view is supplementary and requires matching source data
before any claim of visual reproduction.

| Case | Required result after implementation |
| --- | --- |
| Status Apply | Labeled FINISHED/STARTED/RUNNING bands as applicable; retain times, records and active filter/search |
| Namespace Apply | Separate SOURCE1/SOURCE2 bands and source palettes; both sources remain represented |
| Earthquake magType | Dataset-derived choices and groups such as ml/md/mb/mww; no fixed status-only menu |
| New JSON field | Appears without code changes, including keys absent from the first record/source/page |
| NONE and regrouping | Restore ungrouped layout and usable overview control; preserve the inspected interval and data identity |
| Family membership | Parent and nested activities stay in the parent's group even when child metadata differs |
| Ordering | Verify legacy first-encounter group order; keep table ordering separate |
| Difficult values | Cover commas, long keys/values, 15+ values, null, missing, zero, false, mixed types and nested paths without silent loss |
| Changing scope | No stale fields from an unrelated dataset; preserve an unavailable selection with an explanation; mark partial discovery |
| Paging/loading | Same eligible field inventory and group identities before/after paging, bounded prefetch and reload |
| Saved filters | Select/add/edit/save/delete and stored sortBy work; ALL/BY_NAMESPACE names cannot override the saved definition |
| Predicate parity | Test include/exclude, alternatives/conjunctions, contextual search and ambiguous syntax through the documented migration rules |
| Read-only inputs | Grouping/filter changes and preset saves never rewrite source archives |

[Six extracted-method probes](ui/legacy-target/filtering-audit.json) passed for
the legacy discovery functions: ordinary status/namespace, synthetic earthquake
magType, constant field, later-only key, 15-value suppression and a comma-containing
value. Their scope is discovery behavior and known defects; they are not a runtime
certification of the new grouping UI or an earthquake archive validation.

## REST and Swagger acceptance

- Verify `shared/openapi.json` matches registered handlers and schemas with
  `python scripts/export-openapi.py --check` and `pytest tests/server/test_openapi.py -q`.
- Check implemented paths, payloads, success/error responses, authentication and
  read-only restrictions against the contract. Planned legacy routes must not be
  advertised as implemented; test them separately when their adapter is added.
- Verify Help's Swagger viewer works offline, expands endpoint/schema details and
  does not offer Try it out or make external requests.
- Verify Live API requires a connection, uses its authentication, displays the
  server contract and supports Download JSON; verify bundled Download OpenAPI too.
- Retain route examples and tests for time intervals, filtering/grouping, query
  cursors/revisions and descriptors. Qualify SSE lifecycle separately when implemented.

## Efficiency qualification

Reproduce the copied-archive server workload with
`.venv/Scripts/python.exe scripts/benchmark-archive.py --rounds 3` (use
`.venv/bin/python` on POSIX). After `npm run build`, run the complementary
browser workload with `npm run measure:archive -- --runs 3`.
See the [API measurements](reference/implementation/archive-performance.md) and
[browser measurements](reference/implementation/archive-browser-performance.md)
for the workloads, observations, source receipts and limitations. These samples
do not replace the larger acceptance targets below.

Retain the [original performance targets](../OpenBEXI_Timeline_Rebuild_Prompt.md#17-performance-targets-and-supported-scale)
and freeze the measurement environment before tuning. They are acceptance targets,
not results established by this review. The typical fixture is 100,000 records and
100 groups with dense overlap, nested activities and ongoing sessions.

| Measurement | Target or required evidence |
| --- | --- |
| Recovery-free cold readiness | At most 30 seconds on the reference environment |
| Warm visible query | p95 at most 300 ms for a 1,000-record page with supported indexed predicates |
| Useful workspace | At most 3 seconds after readiness for Uniform/prepared layout; cold Adaptive preparation p95 at most 10 seconds, with overview/status within 3 seconds |
| Pan/zoom/table trace | p95 frame time at most 33 ms over a fixed 10-second trace with at most 2,000 visible primitives; no repeated main-thread stalls over 200 ms |
| Concurrent memory | Server RSS at most 2 GiB for the typical fixture with 20 clients and five writers at the specified aggregate rate; no sustained growth across repeated cycles |
| Loading contention | Record foreground latency and cancellation/release time while slow prefetch, indexing and export compete; compare with an idle baseline |
| Archive indexing | Include 1,000- and 10,000-file fixtures, unchanged refresh cycles, sparse history and long overlapping sessions; measure idle work and lookup cost |
| Discovery/grouping | Same fields, typed group IDs, family membership and encounter order across page sizes, reloads and reversed asynchronous completion |

Record OS/filesystem, hardware, runtime/browser versions, fixture hashes, cold/warm
cache state, repetition counts and latency distributions. Qualify Windows and
Linux separately. Measure API preparation/serialization and browser interaction
as well as direct service calls. Do not remove records, truncate fields silently
or restrict navigation to meet a timing target. The million-record stress tier
remains unsupported until measured. The original save/update targets also remain.

### Historical readiness review evidence

The 2026-09-20 focused backend run passed 86 tests for query preparation, resources
and launch configuration. The focused window-loading/query-work run passed 21
client tests. A parallel frontend review passed 62 relevant client tests, including
overlapping loading tests; these counts must not be added as unique coverage.
These results exercised the implementation before the simplification changes.

One diagnostic run used Python 3.9 on Windows, a generated 1,000-record versioned
fixture and sharded JSON storage. Repository startup took 387 ms, adaptive query
preparation 156 ms, and a six-hour layout 27 ms. All executed phases completed;
source state was unchanged and the isolated temporary dataset was removed.
The ignored local report is `runtime/readiness-small-review.json`.

This was one uncontrolled direct-service sample, not an HTTP/browser benchmark
or a p95 result. Full-domain layout was skipped and grouping exercised source IDs,
not all 100 fixture groups. It does not qualify typical/stress scale, concurrent
navigation, toolbar parity or process memory limits. Reproduce with a fresh output
filename:

```powershell
.venv/Scripts/python.exe scripts/benchmark-server.py --fixture-tier small --storage-layout shards --skip-full-layout --phase-timeout 30 --output runtime/readiness-small-review-repeat.json
```

## Evidence status at the documentation pause

Previous compact-rendering results are not acceptance evidence for this two-source
reference. Use the new fixture report and separate visual/toolbar checks.

The existing CI configuration covers Windows/Linux and Python 3.9–3.14.
`requires-python >=3.9` expresses the package floor; it does not prove support
for every future Python release. Extend the matrix and dependency qualification
as newer interpreters become part of the supported set.

At this checkpoint, only documentation/reference checks are newly run. No new
runtime test result should be attributed to the proposed API, directory migration,
tool redesign or filter-owned range behavior.

Before the approved documentation reorganization, checks on 2026-09-20 passed: all seven requested root files and the
three navigation documents exist; 78 relative links and two configuration examples
were checked without errors. `npm run check:repo` and `git diff --check` also passed.
The ignored local report is `runtime/simplification-docs-check.json`. No application
suite, build, server restart or deployment was run for this documentation phase.

## Approved documentation reorganization checks

The earlier organization change moved the six guides into `docs/`, retained
57 detailed documents under `docs/reference/implementation/`, and updated Help,
build, Docker and release-packaging references. Feature implementation was paused
at that checkpoint; the subsequent authorization and results are recorded above.

Checks on 2026-09-20:

- Ten primary/navigation documents: 88 relative links and two configuration examples passed.
- All 106 Markdown documents: no new missing targets compared with the committed
  baseline. The 88 existing missing historical targets remain recorded references,
  including local-only artifacts and older archived specification links.
- Release packaging: 18 Python tests passed; documentation/shared-view helpers:
  10 JavaScript tests passed.
- API documentation: 11 tests passed after regenerating the bundled contract from
  existing schemas. This also incorporated earlier rendering schema changes.
- Offline Help: desktop (1600 px) and mobile (390 px) browser checks passed, opening
  all six original consolidated guides without network requests or page errors.
- Standalone build, sorting/filtering documentation evidence check, repository
  publication/build-input check and whitespace check passed.

Docker documentation inputs were updated and inspected; no container image was built.
These checks validate documentation consumers, not the proposed feature redesign.

## User manual and two-source checkpoint

The [read-only fixture report](ui/legacy-target/validation.json) records the current
source hashes and a bounded 19:00–21:00 UTC read on March 18, 2024. Both namespaces
are represented: 130 canonical records (102 sessions and 28 events), with 130
unique IDs. Source files remained unchanged. The complete input files contain
50 top-level records each, plus 73 and 80 activities respectively; these totals
are different from viewport membership and the number of drawn marks.

The bounded probe did not run a full archive reconciliation, so coverage remains
provisional. All 24 sampled descriptor lookups were missing; descriptor availability
is not certified. These limitations do not erase the successful two-source read.

The manual records each legacy toolbar handler and preserves both supplied
screenshots. Toolbar redesign and screenshot parity were pending at this checkpoint. The focused
presentation/profile suite passed 64 tests after replacing the retired profile's
regression with the shared test model. Help includes the seventh guide and embeds
both reference images for offline use.

Manual checkpoint checks passed: 11 documents, 100 relative links and two parsed
configuration examples; standalone build and repository build-input checks; two
offline Help browser tests at desktop/mobile sizes, including both reference images.

The subsequent dynamic-sorting addition preserves four more screenshots (six
embedded manual images in total). Its checks passed: six legacy discovery probes,
11 documents with 111 relative links and two configuration examples, standalone
build, repository build-input checks, and desktop/mobile offline Help with all six
images decoded. These results concern documentation and discovery evidence;
the dynamic grouping workflow had not yet been implemented at that checkpoint.
