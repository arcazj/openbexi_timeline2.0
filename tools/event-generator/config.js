/** Configuration, defaults and validation shared by the browser and Node tools. */
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
export const DEFAULT_CONFIG = deepFreeze({
  mode: 'configurable', namespace: 'generated', seed: 'openbexi',
  referenceDate: '2026-01-15T00:00:00.000Z',
  rangeStart: '2026-01-01T00:00:00.000Z', rangeEnd: '2026-02-01T00:00:00.000Z',
  selectedDays: [],
  boundaryStart: null, boundaryEnd: null, pastCount: 50, futureCount: 50,
  density: 'normal',
  duration: {mode: 'random', fixedMinutes: 60, minMinutes: 5, maxMinutes: 120,
    weights: [{minutes: 15, weight: 3}, {minutes: 60, weight: 1}]},
  overlapProbability: 0.2,
  categories: [{value: 'type1', weight: 1}],
  priorities: Array.from({length: 5}, (_, value) => ({value: String(value), weight: 1})),
  resources: {mode: 'fixed', values: ['system1']},
  businessHours: {enabled: false, start: '09:00', end: '17:00'},
  includeWeekends: true, includeHolidays: true, holidays: [],
  clustering: 'uniform', complexity: 'moderate',
  recurrence: {probability: 0, intervalDays: 7},
  dependencies: {probability: 0, maxParents: 2},
  pointEventProbability: 0.25, descriptorProbability: 0.5,
  legacy: {eventCount: 100, days: 1}, dataModel: 'data/yyyy/mm/dd',
});

// Field help is rendered beside controls and serves as parameter documentation.
export const CONFIG_FIELDS = [
  {group: 'Generation', path: 'mode', label: 'Generation mode', type: 'select', options: ['configurable', 'legacy-simple', 'legacy-full'], description: 'Configurable mode uses the controls below. Legacy modes reproduce the Java generation rules; only namespace, seed, reference date, legacy counts and output path affect those modes.'},
  {group: 'Generation', path: 'namespace', label: 'Namespace', type: 'text', description: 'Namespace copied into each event and its data object.'},
  {group: 'Generation', path: 'seed', label: 'Randomization seed', type: 'seed', description: 'A string or finite number makes every random choice reproducible. JSON null selects fresh randomness. The reference date is explicit so repeated runs do not drift with the clock.'},
  {group: 'Generation', path: 'pastCount', label: 'Past events / sessions', type: 'integer', min: 0, max: 30000, description: 'Exact number of top-level events requested before the reference date; nested activities do not count toward this total.'},
  {group: 'Generation', path: 'futureCount', label: 'Future events / sessions', type: 'integer', min: 0, max: 30000, description: 'Exact number of top-level events requested at or after the reference date; recurring occurrences count toward this total.'},
  {group: 'Generation', path: 'density', label: 'Event density', type: 'select', options: ['sparse', 'normal', 'dense', 'very-dense'], description: 'Uses 100%, 75%, 40%, or 15% of each past/future interval, respectively, closest to the reference date. Denser settings tighten spacing without changing requested counts.'},
  {group: 'Dates and boundaries', path: 'referenceDate', label: 'Reference date (UTC)', type: 'date', description: 'Divides past and future events. Enter an ISO date and time with Z or an explicit offset.'},
  {group: 'Dates and boundaries', path: 'rangeStart', label: 'Date range start (UTC)', type: 'date', description: 'Earliest requested start. Effective limits also respect timeline boundaries.'},
  {group: 'Dates and boundaries', path: 'rangeEnd', label: 'Date range end (UTC)', type: 'date', description: 'Latest allowed event end. All configurable events and activities fit in the effective date range.'},
  {group: 'Dates and boundaries', path: 'boundaryStart', label: 'Timeline lower boundary (optional)', type: 'nullable-date', description: 'Optional additional lower timeline limit; leave blank to use the date range start.'},
  {group: 'Dates and boundaries', path: 'boundaryEnd', label: 'Timeline upper boundary (optional)', type: 'nullable-date', description: 'Optional additional upper timeline limit; leave blank to use the date range end.'},
  {group: 'Dates and boundaries', path: 'selectedDays', label: 'Selected calendar days (UTC)', type: 'json', description: 'Array of YYYY-MM-DD dates allowed for configurable generation. Empty allows every day in the existing date range. Selected days still respect boundaries, working hours, weekend and holiday exclusions; sessions cannot cross omitted days. Legacy modes ignore this setting.'},
  {group: 'Duration and overlap', path: 'duration.mode', label: 'Duration distribution', type: 'select', options: ['fixed', 'random', 'weighted'], description: 'Fixed uses one duration; random samples between minimum and maximum; weighted selects a duration using relative weights.'},
  {group: 'Duration and overlap', path: 'duration.fixedMinutes', label: 'Fixed duration (minutes)', type: 'number', min: 0.001, description: 'Duration assigned to each non-point event in fixed mode.'},
  {group: 'Duration and overlap', path: 'duration.minMinutes', label: 'Minimum random duration (minutes)', type: 'number', min: 0.001, description: 'Lower duration limit for random-duration sessions.'},
  {group: 'Duration and overlap', path: 'duration.maxMinutes', label: 'Maximum random duration (minutes)', type: 'number', min: 0.001, description: 'Upper duration limit for random-duration sessions.'},
  {group: 'Duration and overlap', path: 'duration.weights', label: 'Weighted durations (JSON)', type: 'json', description: 'Array of {"minutes":15,"weight":3} entries. Higher relative weights make a duration more likely; weights need not sum to one.'},
  {group: 'Duration and overlap', path: 'pointEventProbability', label: 'Point-event probability', type: 'number', min: 0, max: 1, step: 0.05, description: 'Chance that an event is a point with an empty end string, matching the legacy timeline representation.'},
  {group: 'Duration and overlap', path: 'overlapProbability', label: 'Overlap probability', type: 'number', min: 0, max: 1, step: 0.05, description: 'Chance of requesting an overlap with another event. Feasible dates and calendar constraints can reduce the observed rate; zero requests non-overlapping placement.'},
  {group: 'Categories and resources', path: 'categories', label: 'Category / type distribution (JSON)', type: 'json', description: 'Array of {"value":"type1","weight":1} entries controlling the event data.type distribution.'},
  {group: 'Categories and resources', path: 'priorities', label: 'Priority distribution (JSON)', type: 'json', description: 'Array of {"value":"0","weight":1} entries controlling importance in data.priority. Values remain strings for legacy compatibility.'},
  {group: 'Categories and resources', path: 'resources.mode', label: 'Resource assignment', type: 'select', options: ['none', 'fixed', 'random', 'round-robin'], description: 'Assigns data.system using no resource, the first resource, random choice, or a repeating sequence.'},
  {group: 'Categories and resources', path: 'resources.values', label: 'Resources (JSON)', type: 'json', description: 'Array of resource names such as ["system1","system2"]. The Java generator represents resources with its system field.'},
  {group: 'Working calendar', path: 'businessHours.enabled', label: 'Business-hours mode', type: 'boolean', description: 'Restricts entire events to the configured working interval on each permitted day, evaluated in UTC.'},
  {group: 'Working calendar', path: 'businessHours.start', label: 'Workday start (UTC)', type: 'time', description: 'Inclusive start of each working day in HH:mm format. Overnight work intervals are not supported.'},
  {group: 'Working calendar', path: 'businessHours.end', label: 'Workday end (UTC)', type: 'time', description: 'End of each working day in HH:mm format. Sessions must finish by this time.'},
  {group: 'Working calendar', path: 'includeWeekends', label: 'Include weekends', type: 'boolean', description: 'When disabled, excludes Saturday and Sunday in UTC.'},
  {group: 'Working calendar', path: 'includeHolidays', label: 'Include listed holidays', type: 'boolean', description: 'When disabled, excludes the dates listed below. No locale-specific holiday calendar is inferred.'},
  {group: 'Working calendar', path: 'holidays', label: 'Holiday dates (JSON)', type: 'json', description: 'Array of UTC calendar dates such as ["2026-01-01","2026-01-19"]. Used when holiday inclusion is disabled.'},
  {group: 'Patterns and relationships', path: 'clustering', label: 'Clustering pattern', type: 'select', options: ['uniform', 'bursty', 'seasonal', 'realistic'], description: 'Uniform spreads starts across available time; bursty favors groups; seasonal favors repeated peaks; realistic mixes 70% bursty and 30% uniform placement. Calendar exclusions are configured separately. Plugins may register extra strategies.'},
  {group: 'Patterns and relationships', path: 'complexity', label: 'Timeline complexity', type: 'select', options: ['simple', 'moderate', 'complex'], description: 'Simple adds one activity without tolerance; moderate adds 1–3 activities and tolerance up to 100; complex adds 1–6 activities, tolerance up to 1000 and planned dates alongside actual dates.'},
  {group: 'Patterns and relationships', path: 'recurrence.probability', label: 'Recurrence probability', type: 'number', min: 0, max: 1, step: 0.05, description: 'Chance of repeating an existing event after the recurrence interval. Repetitions keep unique IDs and count toward the requested totals.'},
  {group: 'Patterns and relationships', path: 'recurrence.intervalDays', label: 'Recurrence interval (days)', type: 'integer', min: 1, max: 3660, description: 'UTC day interval between recurring occurrences, subject to calendar and timeline limits.'},
  {group: 'Patterns and relationships', path: 'dependencies.probability', label: 'Dependency probability', type: 'number', min: 0, max: 1, step: 0.05, description: 'Chance of linking an event to eligible earlier events. The engine creates an acyclic graph of event IDs.'},
  {group: 'Patterns and relationships', path: 'dependencies.maxParents', label: 'Maximum dependency parents', type: 'integer', min: 1, max: 100, description: 'Upper bound on how many earlier events a dependent event may reference.'},
  {group: 'Output and legacy', path: 'descriptorProbability', label: 'Descriptor probability', type: 'number', min: 0, max: 1, step: 0.05, description: 'Chance of generating a legacy-compatible descriptor artifact for an event.'},
  {group: 'Output and legacy', path: 'dataModel', label: 'Output directory template', type: 'text', description: 'Relative directory template using yyyy/mm/dd, for example data/yyyy/mm/dd. Paths must remain within the output directory.'},
  {group: 'Output and legacy', path: 'legacy.eventCount', label: 'Legacy simple events per day', type: 'integer', min: 0, max: 30000, description: 'Number of events per daily file in legacy-simple mode. Legacy-full uses the original fixed group count.'},
  {group: 'Output and legacy', path: 'legacy.days', label: 'Legacy day span', type: 'integer', min: 1, max: 3660, description: 'Number of daily partitions generated in either legacy mode, anchored on the reference date.'},
];

const clone = value => JSON.parse(JSON.stringify(value));
const plainObject = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const set = (object, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((object, key) => object[key], object)[last] = value;
};

export class ConfigError extends Error {
  constructor(errors) {
    super(`Invalid generator configuration:\n${errors.map(error => `- ${error}`).join('\n')}`);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

/** Deeply apply defaults; reject ambiguous dates, typos and impossible limits. */
export function normalizeConfig(input = {}, {strategies = []} = {}) {
  const errors = [];
  if (!plainObject(input)) throw new ConfigError(['Configuration must be a JSON object.']);
  const merge = (defaults, source, prefix = '') => {
    const output = clone(defaults);
    for (const [key, value] of Object.entries(source)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!Object.hasOwn(defaults, key)) { errors.push(`${path}: unknown parameter.`); continue; }
      if (plainObject(defaults[key])) {
        if (!plainObject(value)) { errors.push(`${path}: expected an object.`); continue; }
        output[key] = merge(defaults[key], value, path);
      } else output[key] = clone(value);
    }
    return output;
  };
  // Reject undefined and non-JSON numbers before cloning to avoid silent coercion.
  const ancestors = new WeakSet();
  const inspect = (value, path = 'configuration') => {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || (typeof value === 'number' && !Number.isFinite(value))) {
      errors.push(`${path}: expected a finite JSON value.`);
    } else if (value && typeof value === 'object') {
      if (ancestors.has(value)) { errors.push(`${path}: circular references are not valid JSON.`); return; }
      if (!Array.isArray(value) && !plainObject(value)) { errors.push(`${path}: expected a plain JSON object.`); return; }
      ancestors.add(value);
      for (const [key, item] of Object.entries(value)) inspect(item, `${path}.${key}`);
      ancestors.delete(value);
    }
  };
  inspect(input);
  if (errors.length) throw new ConfigError(errors);
  const config = merge(DEFAULT_CONFIG, input);
  for (const field of CONFIG_FIELDS) {
    const value = get(config, field.path);
    const fail = message => errors.push(`${field.path}: ${message}`);
    if (field.type === 'select') {
      const options = field.path === 'clustering' ? [...field.options, ...strategies] : field.options;
      if (!options.includes(value)) fail(`must be one of ${options.join(', ')}.`);
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') fail('must be true or false.');
    } else if (field.type === 'number' || field.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number.');
      else if (field.type === 'integer' && !Number.isInteger(value)) fail('must be an integer.');
      else if (field.min !== undefined && value < field.min) fail(`must be at least ${field.min}.`);
      else if (field.max !== undefined && value > field.max) fail(`must be at most ${field.max}.`);
    } else if (field.type === 'text') {
      if (typeof value !== 'string' || !value.trim()) fail('must be a non-empty string.');
      else if (value.length > 1024) fail('must be at most 1024 characters.');
    } else if (field.type === 'seed') {
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') fail('must be a string, finite number, or null.');
    } else if (field.type === 'date' || field.type === 'nullable-date') {
      if (value === null && field.type === 'nullable-date') continue;
      const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/);
      const timestamp = match ? Date.parse(value) : NaN;
      if (!match || !Number.isFinite(timestamp) || !validDay(value.slice(0, 10)) || new Date(timestamp).getUTCFullYear() < 1000 || new Date(timestamp).getUTCFullYear() > 9999) fail('must be a valid ISO date/time in years 1000–9999 with Z or an explicit time-zone offset.');
      else set(config, field.path, new Date(timestamp).toISOString());
    } else if (field.type === 'time') {
      if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('must use 24-hour HH:mm format.');
    } else if (field.type === 'json' && !Array.isArray(value)) fail('must be an array.');
  }
  const distribution = (path, valueKey) => {
    const values = get(config, path);
    if (!Array.isArray(values)) return;
    if (!values.length || values.length > 1000) errors.push(`${path}: must contain between 1 and 1000 entries.`);
    let total = 0;
    values.forEach((entry, index) => {
      const prefix = `${path}[${index}]`;
      if (!plainObject(entry)) { errors.push(`${prefix}: must be an object.`); return; }
      for (const key of Object.keys(entry)) if (key !== valueKey && key !== 'weight') errors.push(`${prefix}.${key}: unknown parameter.`);
      if (valueKey === 'minutes') {
        if (typeof entry.minutes !== 'number' || !Number.isFinite(entry.minutes) || entry.minutes <= 0 || entry.minutes > 5270400) errors.push(`${prefix}.minutes: must be greater than zero and at most 5270400.`);
      } else if (typeof entry.value !== 'string' || !entry.value.trim() || entry.value.length > 1024) errors.push(`${prefix}.value: must be a non-empty string of at most 1024 characters.`);
      if (typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight < 0) errors.push(`${prefix}.weight: must be a finite non-negative number.`);
      else total += entry.weight;
    });
    if (!(total > 0) || !Number.isFinite(total)) errors.push(`${path}: total weight must be positive and finite.`);
  };
  distribution('duration.weights', 'minutes');
  distribution('categories', 'value');
  distribution('priorities', 'value');
  if (Array.isArray(config.resources.values)) {
    if (config.resources.values.length > 1000 || config.resources.values.some(value => typeof value !== 'string' || !value.trim() || value.length > 1024)) errors.push('resources.values: use at most 1000 non-empty resource names.');
    if (config.resources.mode !== 'none' && !config.resources.values.length) errors.push('resources.values: at least one resource is required for this assignment mode.');
  }
  if (Array.isArray(config.holidays) && (config.holidays.length > 3660 || config.holidays.some(value => typeof value !== 'string' || !validDay(value)))) errors.push('holidays: use at most 3660 valid YYYY-MM-DD dates.');
  if (Array.isArray(config.selectedDays)) {
    if (config.selectedDays.length > 3660 || config.selectedDays.some(value =>
      typeof value !== 'string' || !validDay(value) || Number(value.slice(0, 4)) < 1000)) {
      errors.push('selectedDays: use at most 3660 valid YYYY-MM-DD dates in years 1000 through 9999.');
    } else {
      // Canonical order makes equivalent calendar selections replay identically.
      config.selectedDays = [...new Set(config.selectedDays)].sort();
    }
  }
  if (config.pastCount + config.futureCount > 30000) errors.push('pastCount + futureCount: total must not exceed 30000.');
  if (config.duration.minMinutes > config.duration.maxMinutes) errors.push('duration.minMinutes: must not exceed duration.maxMinutes.');
  if (config.duration.fixedMinutes > 5270400 || config.duration.maxMinutes > 5270400) errors.push('duration: durations must not exceed 5270400 minutes.');
  if (config.businessHours.start >= config.businessHours.end) errors.push('businessHours.end: must be after the workday start (overnight intervals are not supported).');
  const start = Date.parse(config.rangeStart), end = Date.parse(config.rangeEnd), reference = Date.parse(config.referenceDate);
  if (start >= end) errors.push('rangeEnd: must be after rangeStart.');
  if ((end - start) / 86400000 > 3660) errors.push('rangeEnd: date range must span at most 3660 days.');
  const boundaryStart = config.boundaryStart === null ? start : Date.parse(config.boundaryStart);
  const boundaryEnd = config.boundaryEnd === null ? end : Date.parse(config.boundaryEnd);
  const effectiveStart = Math.max(start, boundaryStart), effectiveEnd = Math.min(end, boundaryEnd);
  if (boundaryStart >= boundaryEnd) errors.push('boundaryEnd: must be after boundaryStart.');
  if (effectiveStart >= effectiveEnd) errors.push('boundaries: timeline boundaries must intersect the date range.');
  if (config.mode === 'configurable') {
    if (config.pastCount > 0 && reference <= effectiveStart) errors.push('referenceDate: no past interval is available for the requested pastCount.');
    if (config.futureCount > 0 && reference >= effectiveEnd) errors.push('referenceDate: no future interval is available for the requested futureCount.');
  }
  if (config.mode === 'legacy-simple' && config.legacy.eventCount * config.legacy.days > 30000) errors.push('legacy: eventCount × days must not exceed 30000.');
  if (config.mode === 'legacy-full' && 5200 * config.legacy.days > 30000) errors.push('legacy.days: legacy-full allows at most five days (5200 events per day).');
  if (typeof config.dataModel === 'string' && (/^[\\/]/.test(config.dataModel) || /[:<>"|?*\x00-\x1f]/.test(config.dataModel) || config.dataModel.split(/[\\/]/).some(part => !part || part === '..' || part === '.'))) errors.push('dataModel: must be a safe relative directory path without empty/dot segments, drive letters or reserved path characters.');
  if (errors.length) throw new ConfigError(errors);
  return config;
}

function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
