# Copied-archive performance sample

The archive benchmark measures the full `yaml/multiple_sources_test.yml` server
profile. It uses the original copied files, the selected model and filter, the
normal asynchronous query coordinator, and a fresh disposable state directory.
The profile's zero buffer ratio, 64 MiB parser cache and 30-second index refresh
remain unchanged.

Run from the project root with the development dependencies installed:

```powershell
.venv/Scripts/python.exe scripts/benchmark-archive.py --rounds 3
```

The command prints progress and the report location. It retains the JSON report
and disposable index under ignored `runtime/archive-benchmark-*/`; it never
writes to the data, model, filter or YAML directories. The supervisor stops a run
after 300 seconds. Index completion has a 180-second deadline and individual API
preparations have a 45-second deadline. A failed or timed-out phase is reported
as a failure rather than accepted as a timing sample.

## Workload and interpretation

The two copied archives contain 120,831 files and 97,676,740 bytes. The index
reads 148 event files and one zone file, finding 124,049 records: 123,922 in
SOURCE1 and 127 in SOURCE2. Descriptor payloads remain available for inspection
but their loading is outside this measurement.

The initial view covers March 17–25, 2024. Once indexing completes, each of three
rounds visits March 17, March 24, March 25 and November 11 with one-day windows;
selects each source; and groups the initial window by status and namespace.
Each view prepares a fresh query and the actual model presentation, fetches its
first row page, and releases the query. A separate pinned query sorts the first
100 table records by title, status and start time in each round. Full timeline
row pagination and browser painting are outside these API timings.

`fresh-state-startup` measures configuration loading through service readiness,
after Python dependencies have imported. Import time is recorded separately.
Neither includes the preflight archive receipt scan. The first visible query
runs while the index is provisional; subsequent samples wait for complete
coverage. The first window contains 1,145 records. Complete indexing also finds
eight additional overlapping records stored in other partitions, giving 1,153
(1,026 SOURCE1 records and 127 SOURCE2 records).

The FastAPI TestClient exercises ASGI routing, authorization, asynchronous
preparation and response serialization in the server process. It excludes TCP
and browser overhead. This is one workstation run with a few repeated samples,
not a percentile, concurrency, physical-disk or release performance guarantee.
Preflight hashes and earlier activity can warm the operating system's file
cache. Process memory includes the test client, index and Python runtime;
the parser cache budget is not a total process-memory limit.

The report preserves per-phase read-byte deltas, cache sizes, index progress,
25 ms sampled resident memory, operating-system peak memory, response sizes,
record counts and preparation polling counts. `bytesRead` means payload bytes
reported by the archive reader, including background indexing during a phase;
it does not measure physical disk transfers or metadata operations. On platforms
where current RSS is unavailable, sampled RSS is null and process peak remains
available.

The before/after receipt hashes all 149 partition payloads and compares names,
sizes and modification times for every archive file. Descriptor contents are
not individually hashed. Server Python sources, the benchmark, YAML, model and
filter are hashed before and after execution. A changed archive receipt or
source snapshot fails the run. Reports include their aggregate receipt hashes
and the base Git commit, making the measured worktree distinguishable from a
later build.

## Measured result: September 20, 2026

The command above completed all 36 phases successfully on Windows 11
10.0.26200, Python 3.14.7, with eight logical Intel processors. Python dependency
imports took 547 ms. A small browser fixture test matrix ran during part of this
sample, so competing CPU and filesystem activity was not controlled. The separate
browser timing experiment must not be combined with these numbers as one run.

| API phase | Samples | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Fresh-state service readiness, after imports | 1 | 231 ms | 231 ms | 231 ms |
| First visible March 17–25 window | 1 | 2,356 ms | 2,356 ms | 2,356 ms |
| Remaining background index completion | 1 | 60.1 s | 60.1 s | 60.1 s |
| One-day pan, four dates over three rounds | 12 | 64 ms | 916 ms | 1,891 ms |
| Source filter, two sources over three rounds | 6 | 135 ms | 612 ms | 1,356 ms |
| Status/namespace grouping | 6 | 1,124 ms | 1,228 ms | 1,749 ms |
| First table page, title/status/start sorting | 9 | 262 ms | 274 ms | 295 ms |

Index completion found all 149 partition files and rejected none. The one-day
windows contained 31, 1,020, 1,024 and 308 records respectively, so the combined
pan distribution mixes sparse and dense work. The table query contained 1,153
records. These are successful functional observations, not latency targets.

Windows reported a 198.8 MiB process peak working set. The 25 ms sampler observed
181.6 MiB; short peaks can fall between samples. The parser cache ended at
25.7 MiB of its 64 MiB limit. The query resource ledger returned to zero retained
bytes and zero artifacts after all queries were released; Python process RSS
does not have to return to its original value when these objects are freed.

The reader reported 52,390,259 payload bytes across foreground requests and
background indexing. All eight repeat one-day pans in rounds two and three
reported **zero additional payload bytes read**, as did the measured source
filters, grouping changes and table sorts. Both the source-code and archive
receipts remained unchanged.

The first useful view completed while full index coverage was still being built.
Repeated views reused parsed files without additional payload reads, and the
cache remained below half its configured budget. These observations do not
justify increasing the cache or widening the query buffer, so neither setting
was changed. Further optimization should first profile CPU work in index
construction and repeated query/layout preparation. A controlled browser and
concurrency study is needed before setting responsiveness or capacity limits.

### Receipt

- Measurement started: `2026-09-20T22:08:19.824011+00:00`.
- Base Git commit: `dce557013577e362ba0e21f8c486b036504c5490`; the measured worktree includes the subsequent availability-index changes.
- Source snapshot SHA-256: `cd169e42c5e4f24e0b26fe5e3448ece263b1e8edfbed0a54518885376bb18bd4`.
- Archive receipt SHA-256: `0cca4a26291a0c546b445fc4454b3637ec7693498c35a839e409505d00d0a06c`.
- Local report: `runtime/archive-benchmark-ngoou5nd/report.json` (generated and intentionally ignored by Git).
- Report SHA-256: `6ab744f1b92817b0e43efd78e51db5cd6a310880078ec0b59b43d91a569f5910`.

The source-snapshot and archive-receipt digests hash their corresponding report
objects encoded with sorted keys and compact JSON separators. Individual source
and partition-file digests remain in the report for local verification. The
archive receipt includes modification times, so it identifies this checkout's
measured state rather than asserting that every clone has identical metadata.
