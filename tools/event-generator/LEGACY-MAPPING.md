# Legacy generator compatibility audit

This note records the contracts in [`event_generator.java`](../com/openbexi/timeline/event_generator.java), [`event_descriptor.java`](../../src/com/openbexi/timeline/data_browser/event_descriptor.java), and their existing consumers. Times below are **milliseconds relative to a batch's UTC date**. Java integer random ranges include the lower bound and exclude the upper bound.

## Entrypoints and files

- Java accepts `-data_conf <file>` and actually reads YAML, despite comments in `data_configuration` referring to JSON. The YAML root is `data_sources`, containing objects with `namespace` and `data_model`; `data_configuration` converts this to its internal `"startup configuration"` array. See [`sources_default_test.yml`](../../yaml/sources_default_test.yml).
- `main` invokes `generate_simple`, never the older private `generate` method. Each source gets 30 daily batches, starting at UTC midnight, with a random **50–599 top-level records per batch**. The `enable` flag is not checked.
- Each batch writes `<data_model with yyyy/mm/dd substituted>/events.json`. The original replaces the text `yyyy`, `mm`, and `dd` globally. It overwrites each event file and creates parents as needed.
- Java carries the last batch's `date` into the next source: source two begins **29 days** after source one's first day. This is an observable compatibility quirk, distinct from the usual expectation that all namespaces share dates.
- Java sleeps one second after each batch. Sleeping does not affect the output contract and is unnecessary in the JavaScript port.
- A descriptor uses the **record's actual start date**, which can differ from the batch date: `<data_model>/descriptors/<id>.json`. Its path removes `.json` from the model, then substitutes `/yyyy`, `/mm`, `/dd`. Namespace selection defaults to the first configured source, with subsequent matching entries taking precedence.

Minimal original startup input:

```yaml
data_sources:
  - namespace: SOURCE1
    data_model: tests/data/SOURCES1/yyyy/mm/dd
```

## Java-to-JavaScript module map

| Original responsibility | New module |
| --- | --- |
| `getRandomNumberUsingNextInt` and `UUID.randomUUID` | [`random.js`](random.js): seeded random choices and IDs. |
| `generate_simple` and older `generate` | [`legacy.js`](legacy.js): separate strategies preserving each method's generation rules. |
| Event and descriptor string assembly | [`model.js`](model.js): compatible data objects, dates, descriptors and serialization. |
| `main` source/day loops | [`engine.js`](engine.js): orchestration, legacy startup generation and artifact collection; [`cli.js`](cli.js): arguments and filesystem output. |
| YAML startup input and new user settings | [`startup.js`](startup.js): startup-source loading; [`config.js`](config.js): defaults and validation. |
| Filesystem output and portable browser download (new) | [`cli.js`](cli.js): output directory writing; [`archive.js`](archive.js): valid JSON and a ZIP containing the same artifact tree. |
| Additional interactive generation policies | [`engine.js`](engine.js), [`strategies.js`](strategies.js): configurable engine and plugin registration. |
| Interactive parameter controls (new) | [`ui/tree.sj.js`](ui/tree.sj.js): tree editor backed by the shared field definitions in [`config.js`](config.js). |

## Output model and consumer requirements

| Contract | Original behavior | JavaScript responsibility |
| --- | --- | --- |
| Event document | `{ "dateTimeFormat": "iso8601", "events": [...] }` | Preserve envelope; do not replace it with a configuration/result wrapper in `events.json`. |
| Dates | `Date.toString()` in UTC, e.g. `Thu Oct 15 00:00:00 UTC 2026`, despite the `iso8601` label | Preserve legacy date strings for compatible output; do not silently substitute ISO timestamps. |
| Identity | Fresh UUID per top-level record and child | Preserve UUID-shaped independent IDs; use the supplied seed for repeatability. |
| Event/session distinction | Point event: `end: ""`; session: a dated `end` | Preserve the empty string sentinel. |
| Simple record fields | `id`, `namespace`, `original_start`, `start`, `original_end`, `end`, `data`, `render`, `activities` | Keep empty original dates in the simple event document. |
| Simple parent `data` | `namespace`, `title`, `status`, `type`, `system`, `priority`, optional `tolerance`, `description` | `priority` and `tolerance` are strings, not JSON numbers. Omit event tolerance when it equals `"0"`. |
| Simple child `data` | Same subset without `type` and `system` | Avoid adding those fields to legacy children. |
| Rendering | Six decimal color digits, each **0–8**; optional relative `icon/ob_*.png` image | JSON slash escaping is semantically equivalent; image paths must retain their relative meaning. |
| Activities | At least one child for every simple record; all children share their parent's timing, namespace, status, priority, tolerance, and color | An empty `activities` array is unsafe: the renderer reads `activities[0]`. |
| Descriptor envelope | `{ "dateTimeFormat": "iso8601", "event_descriptor": [record] }` | Preserve the singular key and one-element array. |
| Descriptor fields | `id`, `start`, `end`, optional nonempty `original_start`/`original_end`, `data` | No root `namespace`, `render`, or `activities`. `data` includes namespace/type but no system. Tolerance `"0"` is retained here. |
| Descriptor trigger | Record title gains `_read_descriptor` and description is empty with probability 1/2 | `ob_open_descriptor` fetches by **empty description**, then sends ID, start and namespace. Descriptor title omits that suffix. |

`src/openbexi_timeline.js:1140` constructs descriptor requests. Its `init_sessions` function synthesizes a single child only when `activities` is absent; it does not repair an empty array. The Java JSON-file manager parses dates using `new Date(String)` and searches the date-partitioned directory model. Descriptor directories are excluded from ordinary event discovery.

## Active `generate_simple` rules

For every batch, indices restart at zero. At most 30,000 records are emitted. Initial values are `type1`, `system1`, tolerance `"100"`, empty original dates, and status probabilities **STARTED 1/4, RUNNING 1/4, FINISHED 1/2**. Priority is uniformly `"0"` through `"4"`.

| Index | Start | End | Original start | Original end | Child count |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 1,000,000 | 0 | 100,000 | 4 |
| 1 | 0 | 1,000,000 | 0 | 100,000 | 3 |
| 3 | −1,500,000 | 1,500,000 | −1,800,000 | 1,400,000 | 1 |
| 4 | 2,000,000 | 3,000,000 | 2,000,000 | 300,000 | 6 |
| 5 | 2,000,000 | 3,000,000 | 2,000,000 | 300,000 | 2 |
| 6 | 2,000,000 | 5,500,000 | empty | empty | 1 |
| 7 | 2,500,000 | 3,000,000 | 2,400,000 | 290,000 | 1 |
| 8, 10, 12 | −1,000,000 | empty | empty | empty | 1 |
| 20 | 5,000,000 | empty | empty | empty | 1 |
| 21–23, 25–28 | 4,000,000 | empty | empty | empty | 1 |
| 24 | 4,000,000 | empty | empty | empty | 2 |
| 30 | 5,000,000 | 8,000,000 | 5,000,000 | 800,000 | 12 |
| 51–59 | 600,000 | empty | empty | empty | 1 |
| 61–71 | 5,200,000 | empty | empty | empty | 1 |

Index 3 changes tolerance to `"1000"`. Some original end dates precede actual starts; those values are deliberate compatibility fixtures and must survive the port.

All other indices, including **2, 29, 31–50 and 60**, use the random branch:

- Choose `t` in `[2,30)` and `t2` in `[0,20)`. Start offset is `t * (1,000,000 + t2 * 100,000)`.
- If `t2 < 10`, end is empty. Otherwise duration is `t2 * 200,000`, and original start is earlier by `t2 * 2,000`. Original end remains empty.
- Tolerance is the product of two independently drawn integers in `[0,30)`.
- Child count is one with probability 9/10; otherwise it is uniformly two through five.

Parent titles are `Events<j>` for a point, `Session_<j>` for a session, or `Activity_<j>` whenever child count exceeds one. Parent description is `description_<j> <title>`. Children use `Events_<j>_<a>`, `Session_<j>_<a>`, or `Activity_<j>_<a>`. For inline child descriptions, a probability of 2/9 adds `_long_text` between one and fourteen times to the title. Child description is `description_<title>_activity_<a>`.

Descriptor selection is independent for every parent and child. Descriptors retain the unsuffixed title and append `_read_descriptor_in_file` to the description. Their `platform` is empty, so it is omitted. Parent session renders have no image. A batch record chooses one icon index in `[0,40)`; indices **0–24 only** are accepted (the last of the 26 icons is deliberately unused by this code). Point children share that image. Session children can include it with probability 2/9.

## Older, uncalled `generate` rules

The private method generates **650 groups of eight**, not the active main's daily random count. Every group shares a start; after group zero, the clock advances by `3600 * random(10,500)` **milliseconds**, not hours. Odd positions are points and even positions are sessions lasting `random(1,20) * 100,000` milliseconds.

It chooses `system0`–`system7`, `type0`–`type4`, priority `"0"` or `"1"`, and STARTED/COMPLETED/SCHEDULE with probabilities 1/4, 1/4, 1/2. Position 2 gets tolerance 10–399 and probabilistic original-date adjustments. Titles are `title<group>_<position>`. Finite sessions receive one to four independently timed activities with probability 1/6. Original dates are omitted when unchanged; descriptors are never generated. This method has no real resource-capacity model: `system` is its only resource-like assignment.

## Defects and compatibility boundaries

1. Both event writers emit trailing commas, which are invalid strict JSON. The old uncalled method additionally writes a `namespace` member outside the child object. Serialize valid JSON while preserving the intended field values and hierarchy; do not reproduce malformed syntax.
2. The old uncalled method selects an icon from `[0,27)` despite having only 26 icons, which can throw `ArrayIndexOutOfBoundsException`. Bound selection by the actual array size.
3. Java constructs a new `Random` for every draw and uses independent random UUIDs; it has no seed contract. A seeded JavaScript run can preserve rules and distributions, but cannot reproduce a particular unseeded Java run byte-for-byte.
4. Java's descriptor writer creates a directory named after the target file before removing it. Create the parent directory directly instead.
5. Java uses manual unescaped string concatenation. JSON serialization must escape user-supplied strings correctly.
6. The new duration, working-calendar, recurrence, dependencies, clustering and complexity controls extend the original behavior. Keep a distinct legacy generation strategy so these additions do not silently modify its hardcoded scenarios.

## Independent fixture checks

The tracked [`tests/data/SOURCES1/2024/03/18/events.json`](../../tests/data/SOURCES1/2024/03/18/events.json) contains **50 records** and fails native `JSON.parse` because of trailing commas. Removing commas immediately before `}` or `]` allows inspection of this specific fixture. Its anchor is `Mon Mar 18 19:27:24 UTC 2024`; records confirm the table above, including child counts 4/3/6/2 and index 3 starting 1,500,000 milliseconds earlier. Such normalization is only a test-fixture accommodation, not an input parser recommendation.

Useful compatibility assertions are: exact special-index timing and child counts; valid envelopes; UTC legacy date strings; omitted versus empty original dates; string priorities/tolerances; point end sentinels; nonempty activities; descriptor file lookup by the record's day and UUID; shared child rendering/timing; deterministic repeatability with a seed; and unchanged special scenarios when generic UI defaults change.
