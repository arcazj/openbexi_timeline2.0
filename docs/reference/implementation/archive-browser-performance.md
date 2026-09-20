# Full-archive browser performance sample

This diagnostic run exercised the full `yaml/multiple_sources_test.yml` archive
through a real browser and loopback Python server. It complements the
[ASGI measurement](archive-performance.md). It is a single-workstation sample,
not a release performance qualification or a guarantee for other machines.

## Reproduce

Run from the checkout with the project Python environment and npm dependencies:

```powershell
npm run build
npx playwright install chromium
npm run measure:archive -- --runs 3
```

`OPENBEXI_BROWSER` can select another Chromium executable. The script reports its
actual browser version. It starts the existing YAML profile with fresh temporary
server state, launches a fresh headless browser context at 1600 × 900, and stops
the server and removes its temporary state afterward. Source archives are read
only. Run without another benchmark or test suite competing for the machine.

The default ignored outputs are `artifacts/performance/archive-browser.json`
and `archive-browser.png`. Use `--output <file.json>` under the checkout's ignored
`artifacts/` or `runtime/` directories to retain another sample.
The receipt helper comes from `scripts/benchmark-archive.py`.

Startup observations include the real HTTP server, loopback transfer, browser
execution and rendering. Browser launch and the initial integrity scan happen
before the startup clock. The server health timer includes Python process
startup; the page-ready timer starts at browser navigation and stops when the
application's first ready state is observed on an animation frame. These differ
from the in-process ASGI timings. Filesystem caches are uncontrolled and the
integrity scan itself reads partition files before startup.

After index completion, each of three rounds navigates to November 11 and back
to March 17–25, selects SOURCE1 and then all sources, and groups by dynamically
discovered status, namespace and NONE. Operation timings start at the submitted
UI action and stop at a changed, ready query/layout. Range-dialog editing is
excluded. A separate fixed 48-step drag records animation-frame intervals and
application navigation diagnostics. No artificial CPU/network slowdown or
forced garbage collection is applied.

## Observations: September 20, 2026

Measured at `2026-09-20T22:11:21.755Z` on Windows `10.0.26200`, an Intel i7-9700
with eight logical CPUs and about 31.8 GiB RAM; Python 3.14.7, Node 24.19.0 and
Playwright Chromium 153.0.8010.12. The measured HTML SHA-256 is
`9256389f772195a4781a76e84955fcfde5e7893a345c8d773a1c33bf8a53bf7f`.
This identifies the measured build; subsequent date-boundary fixes and rebuilds
must not be described as having this exact performance measurement.

| Observation | Time |
| --- | ---: |
| Server health ready after process launch | 4.20 s |
| First timeline ready after browser navigation | 14.09 s |
| First timeline ready after server launch | 18.33 s |
| Full index complete after server launch | 86.38 s |

The complete index found 124,049 records in 149 partition files with no rejected
files. The ready March window contained 1,153 records, with 90 records loaded in
the initial row page. November navigation displayed 308 records. No uncaught
browser errors occurred, and all measured operations reached a ready view.
Fresh-state startup remains a performance follow-up: the first browser view took
14.09 seconds despite a small initial row page. This sample did not profile which
startup stages account for that delay.

| Operation | Samples | Sample median | Sample minimum–maximum |
| --- | ---: | ---: | ---: |
| November/March navigation | 6 | 1,010.66 ms | 864.43–1,414.83 ms |
| SOURCE1/all filtering | 6 | 980.54 ms | 862.91–1,196.21 ms |
| Status/namespace/NONE grouping | 9 | 627.63 ms | 412.29–1,311.83 ms |

These small sample sets describe this workload, not a population latency
distribution. The full report retains every operation and record count.

The fixed drag produced 127 `requestAnimationFrame` intervals: median and
sample p95 16.7 ms, maximum 50 ms. The complete drag-and-settle action took
5.69 s. These intervals measure animation callback scheduling during automated
dragging, not input latency, GPU presentation or complete data coverage.

Application coverage diagnostics separately reported unready, partial or error
edge spans in 170 of 171 coverage checks during the gesture. This `lateFrames`
counter counts incomplete coverage checks, not slow animation frames. Two speculative preparation
failures were already present before the gesture and did not increase during
it. The application's own navigation timing sample p95 was 50.5 ms. The viewport
eventually recovered, but these observations leave continuous preview coverage
as a performance follow-up; the smooth animation callbacks alone do not
establish that every newly exposed region was ready. This run did not identify
the cause of the earlier preparation failures.

Main-target JavaScript heap usage was 21.17 MiB at first ready, 22.12 MiB after
the third operation round and 44.31 MiB immediately after the drag. These are
unforced-GC samples, excluding Python, browser native/GPU memory and separate
worker heaps; they are not total process memory or evidence of a leak. The final
server parser cache was 66,886,769 bytes against its 67,108,864-byte limit.

## Source preservation

Before/after receipts matched for all 120,831 archive files (97,676,740 bytes).
The check compares names, sizes and modification times for every file and hashes
all 149 event/zone partition payloads. It does not individually hash descriptor
contents. The JSON report retains every partition payload hash.

| Archive | Files | Metadata inventory SHA-256 |
| --- | ---: | --- |
| SOURCES1 | 120,641 | `b25a098baaedc7eb00bd2b6dc1ae129a46305dc6f2f18f0afb2f28355dce2b46` |
| SOURCES2 | 190 | `e04e771bd555b628a6dd5257efd801fe548fc33560a04ca418d9f6d342caf95f` |

Receipt scans run outside the measured browser workload. The source YAML, model
and filter are used through a generated temporary profile; persistent test state
is kept outside their directories and removed when the process stops.
