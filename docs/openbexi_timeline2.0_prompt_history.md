# OpenBEXI Timeline 2.0 — prompt history and decisions

Updated: 2026-09-20. The
[saved current prompt](../openbexi_timeline2.0_current_prompt.md) is the active
direction. This history records requirements and status; it does not recreate
missing conversation text or claim earlier tests were rerun.

## Release 2.0 request

The owner subsequently requested live-demo links for every bundled dataset, more
default sessions and events in the past and future, removal of unnecessary PDFs
and obsolete tooling, and publication to GitHub as release 2.0. This authorizes
the source push, stable `v2.0.0` release and standalone Pages deployment. Local
test overrides remain excluded from publication.

The expanded default fixture preserves all 48 original records and adds 960
deterministic synthetic records. Contract tests use their explicit stable fixture;
dedicated dataset tests validate the complete shipped sample in both directions.

## Requirements in sequence

| Request | Result or current decision |
| --- | --- |
| Install dependencies; resolve missing uv/re2 | Bootstrap launcher and locked project environment were added before this phase |
| Support Python 3.9 onward and IntelliJ fresh-clone startup | Preserve bootstrap setup; qualify supported interpreters rather than promise every future release |
| Simplify the project and interface | Adopt YAML/model/filter/data responsibilities and a compact legacy-style shell |
| Make YAML the server entry point | YAML selects data sources, model and filter |
| Put `initial_range` in the filter; default to current time | New profiles use filter-owned range; omission means now, not newest partition |
| Preserve legacy REST loading and continuous past/future visualization | Audit servlet behavior, add an adapter, retain bounded window loading |
| Execute but pause after documentation; save the prompt | End this phase after documents and checks, before implementation or deployment |
| Resume: “can we implement?” | User authorized implementation after the documentation checkpoint; the earlier pause is lifted |

## Implementation authorization and result

The 2026-09-20 request to implement supersedes the earlier pause recorded below.
Version-2 YAML environments, filter-owned opening ranges, dynamic observed-field
grouping with family/encounter policies, legacy REST/SSE translation, the compact
toolbar and complete environment exports are implemented. Read-only source ownership,
version-1 inputs and existing provider/query contracts are retained.

The live SOURCE1/SOURCE2 browser check loaded 130 canonical records in the requested
March 18 historical window, exercised status/namespace groups and view/camera
switching, and verified unchanged input hashes. Full-suite and targeted results
are recorded in the test guide. The remaining entries are historical checkpoint
decisions; their pause statements do not reimpose the superseded pause.

## Latest requirements: toolbar and validation sources

- Add [the user manual](openbexi_timeline2.0_user_manual.md) as the seventh primary guide.
- Audit every legacy toolbar icon against its handler, preserving both appearance
  and user-visible behavior; include overview and 2D/3D controls.
- Use only the legacy `tests/data/SOURCES1` and `tests/data/SOURCES2` directories
  for this comparison, centered on March 18, 2024 at 20:00 UTC.
- Retire the earlier production profile and its archive-specific validation claims.
  The supplied screenshots are acceptance targets, not results of the current build.
- Keep feature implementation paused; updating docs, test inputs and documentation
  consumers does not authorize claiming the toolbar redesign is complete.

## Decisions in this documentation phase

The overall implementation review concludes that the existing foundation can be
reused, with contract and performance work before claiming a solid optimized
release. [Architecture](openbexi_timeline2.0_architecture.md#implementation-readiness-review)
records prioritized findings and implementation order; the
[test guide](openbexi_timeline2.0_tests.md#efficiency-qualification) distinguishes
passed focused checks and a small diagnostic benchmark from pending scale gates.
No feature implementation or performance fix was made by this review.

The additional toolbar screenshot requires **Timeline / Table / Split** directly
in the main toolbar, with a clear active state. Preserve these existing 2.0 modes
in the simplified shell, shared selection, time/filter/search state and explicit
table scope. The screenshot is saved in the manual and embedded in offline Help.
This supersedes describing Table/Split as secondary controls; implementation
remains paused.

Additional documentation requirement: describe the RESTful interface and the
Swagger/OpenAPI interface, their access paths, authentication, offline/live modes,
contract validation and the boundary between implemented native routes and planned
legacy compatibility. The user manual, architecture, deployment and tests now own
these details; no new API endpoint is introduced by this documentation update.

Additional requirement: preserve the legacy Sorting & Filtering workflow, with
Sort by fields generated dynamically from JSON metadata. Status/namespace and
earthquake magType screenshots demonstrate labeled timeline grouping. The manual
now records four additional references, source handlers, discovery limitations and
the correction boundary; the test plan covers dynamic fields and filter/grouping
interaction. SOURCE1/SOURCE2 remain the primary validation inputs. Implementation
remains paused.

- Use `filters/` (plural), as in the legacy checkout. Keep `data/` as the equivalent
  of legacy `json/`.
- Propose version-2 launch profiles so new path/range semantics do not silently
  change existing version-1 profiles.
- Treat `initial_range` as the initial viewport, not a permanent data predicate.
- Keep the Python/browser/provider architecture and read-only archive boundary.
  Translate legacy REST through shared services.
- Distinguish source-inspected compatibility from live HTTP verification.
- Following the approved organization update, place the seven primary guides in
  `docs/` and keep the saved prompt at the repository root.
- Preserve earlier local changes. Limit follow-up code changes to documentation
  consumers in Help, build, verification and packaging; leave feature work paused.

## Primary documentation

| Document | Owns |
| --- | --- |
| [Design](openbexi_timeline2.0_design.md) | Project organization, timeline UI, tool workflow and current/target gap |
| [Data design](openbexi_timeline2.0_data_design.md) | Formats, references, initial range, record invariants and migration |
| [Architecture](openbexi_timeline2.0_architecture.md) | Legacy HTTP audit, adapter, continuous loading and implementation sequence |
| [Tests](openbexi_timeline2.0_tests.md) | Reproduction commands, acceptance cases and evidence boundaries |
| [Deployment](openbexi_timeline2.0_deployment.md) | Setup, IntelliJ, ownership, operations and deployment boundary |
| [User manual](openbexi_timeline2.0_user_manual.md) | User workflows, toolbar feature audit and screenshot acceptance |
| This history | Requirement evolution and checkpoint decisions |

The root file, `openbexi_timeline2.0_current_prompt.md`, contains the
requested saved prompt rather than another design guide.

## Consolidation and retained references

The seven guides under `docs/` are the primary reading path. README, contributor
navigation and the in-app Help menu point to them. Detailed prior contracts and
historical reports are retained in [implementation references](reference/implementation/).
Their links and active Help/build/package readers now use the new locations.

Licenses, source provenance, release records, images and machine-readable evidence
remain at their existing paths. Historical report hashes and results retain their
original meaning; moving a report does not recertify its conclusions. The
[documentation index](README.md) separates the current direction from this evidence.

## Earlier specifications and evidence

- [Original rebuild prompt](../OpenBEXI_Timeline_Rebuild_Prompt.md) and
  [archived revisions](reference) preserve earlier requirements.
- [Sorting/filtering prompt](../OpenBEXI_Timeline_Sorting_Filtering_Prompt.md)
  and [analysis](sorting-filtering/analysis.md) preserve earlier behavior audits.
- [Release history](release-history.md) preserves publication history;
  it does not authorize another release.

## Historical pause checkpoint

The prompt is saved; the seven requested documents describe current behavior,
the proposed simplification, migration constraints and acceptance. Documentation
checks are recorded in the completion response. No new API, configuration schema,
configuration-directory migration, timeline redesign, environment generator, archive write, server
restart or deployment is executed in this phase. Documentation moves and the
associated Help navigation, build and package path updates are complete.

At that checkpoint, the next step was version-2 schemas and environment resolution.
The later authorization lifted this pause; the current implementation accepts the
version-2 examples and is covered by the results at the start of this document.
