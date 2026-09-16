# Generation parameters

Generated from config.js by `node examples/build.js`. All times and calendars use UTC. Probability controls accept numbers from 0 to 1. Relative weights may be zero but their sum must be positive. Invalid or misspelled fields fail validation.

| Parameter | Default | Effect |
| --- | --- | --- |
| `mode` | `"configurable"` | Configurable mode uses the controls below. Legacy modes reproduce the Java generation rules; only namespace, seed, reference date, legacy counts and output path affect those modes. |
| `namespace` | `"generated"` | Namespace copied into each event and its data object. |
| `seed` | `"openbexi"` | A string or finite number makes every random choice reproducible. JSON null selects fresh randomness. The reference date is explicit so repeated runs do not drift with the clock. |
| `pastCount` | `50` | Exact number of top-level events requested before the reference date; nested activities do not count toward this total. |
| `futureCount` | `50` | Exact number of top-level events requested at or after the reference date; recurring occurrences count toward this total. |
| `density` | `"normal"` | Uses 100%, 75%, 40%, or 15% of each past/future interval, respectively, closest to the reference date. Denser settings tighten spacing without changing requested counts. |
| `referenceDate` | `"2026-01-15T00:00:00.000Z"` | Divides past and future events. Enter an ISO date and time with Z or an explicit offset. |
| `rangeStart` | `"2026-01-01T00:00:00.000Z"` | Earliest requested start. Effective limits also respect timeline boundaries. |
| `rangeEnd` | `"2026-02-01T00:00:00.000Z"` | Latest allowed event end. All configurable events and activities fit in the effective date range. |
| `boundaryStart` | `null` | Optional additional lower timeline limit; leave blank to use the date range start. |
| `boundaryEnd` | `null` | Optional additional upper timeline limit; leave blank to use the date range end. |
| `selectedDays` | `[]` | Array of YYYY-MM-DD dates allowed for configurable generation. Empty allows every day in the existing date range. Selected days still respect boundaries, working hours, weekend and holiday exclusions; sessions cannot cross omitted days. Legacy modes ignore this setting. |
| `duration.mode` | `"random"` | Fixed uses one duration; random samples between minimum and maximum; weighted selects a duration using relative weights. |
| `duration.fixedMinutes` | `60` | Duration assigned to each non-point event in fixed mode. |
| `duration.minMinutes` | `5` | Lower duration limit for random-duration sessions. |
| `duration.maxMinutes` | `120` | Upper duration limit for random-duration sessions. |
| `duration.weights` | `[{"minutes":15,"weight":3},{"minutes":60,"weight":1}]` | Array of {"minutes":15,"weight":3} entries. Higher relative weights make a duration more likely; weights need not sum to one. |
| `pointEventProbability` | `0.25` | Chance that an event is a point with an empty end string, matching the legacy timeline representation. |
| `overlapProbability` | `0.2` | Chance of requesting an overlap with another event. Feasible dates and calendar constraints can reduce the observed rate; zero requests non-overlapping placement. |
| `categories` | `[{"value":"type1","weight":1}]` | Array of {"value":"type1","weight":1} entries controlling the event data.type distribution. |
| `priorities` | `[{"value":"0","weight":1},{"value":"1","weight":1},{"value":"2","weight":1},{"value":"3","weight":1},{"value":"4","weight":1}]` | Array of {"value":"0","weight":1} entries controlling importance in data.priority. Values remain strings for legacy compatibility. |
| `resources.mode` | `"fixed"` | Assigns data.system using no resource, the first resource, random choice, or a repeating sequence. |
| `resources.values` | `["system1"]` | Array of resource names such as ["system1","system2"]. The Java generator represents resources with its system field. |
| `businessHours.enabled` | `false` | Restricts entire events to the configured working interval on each permitted day, evaluated in UTC. |
| `businessHours.start` | `"09:00"` | Inclusive start of each working day in HH:mm format. Overnight work intervals are not supported. |
| `businessHours.end` | `"17:00"` | End of each working day in HH:mm format. Sessions must finish by this time. |
| `includeWeekends` | `true` | When disabled, excludes Saturday and Sunday in UTC. |
| `includeHolidays` | `true` | When disabled, excludes the dates listed below. No locale-specific holiday calendar is inferred. |
| `holidays` | `[]` | Array of UTC calendar dates such as ["2026-01-01","2026-01-19"]. Used when holiday inclusion is disabled. |
| `clustering` | `"uniform"` | Uniform spreads starts across available time; bursty favors groups; seasonal favors repeated peaks; realistic mixes 70% bursty and 30% uniform placement. Calendar exclusions are configured separately. Plugins may register extra strategies. |
| `complexity` | `"moderate"` | Simple adds one activity without tolerance; moderate adds 1–3 activities and tolerance up to 100; complex adds 1–6 activities, tolerance up to 1000 and planned dates alongside actual dates. |
| `recurrence.probability` | `0` | Chance of repeating an existing event after the recurrence interval. Repetitions keep unique IDs and count toward the requested totals. |
| `recurrence.intervalDays` | `7` | UTC day interval between recurring occurrences, subject to calendar and timeline limits. |
| `dependencies.probability` | `0` | Chance of linking an event to eligible earlier events. The engine creates an acyclic graph of event IDs. |
| `dependencies.maxParents` | `2` | Upper bound on how many earlier events a dependent event may reference. |
| `descriptorProbability` | `0.5` | Chance of generating a legacy-compatible descriptor artifact for an event. |
| `dataModel` | `"data/yyyy/mm/dd"` | Relative directory template using yyyy/mm/dd, for example data/yyyy/mm/dd. Paths must remain within the output directory. |
| `legacy.eventCount` | `100` | Number of events per daily file in legacy-simple mode. Legacy-full uses the original fixed group count. |
| `legacy.days` | `1` | Number of daily partitions generated in either legacy mode, anchored on the reference date. |

Legacy modes use only mode, namespace, seed, referenceDate, dataModel and legacy.*. The configurable controls do not override Java fixtures. Events and activities use second precision. Impossible placement fails explicitly instead of returning fewer events.
