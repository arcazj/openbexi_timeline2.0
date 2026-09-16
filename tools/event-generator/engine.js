import { DEFAULT_CONFIG, normalizeConfig } from './config.js';
import { createRandom } from './random.js';
import { formatDate, createTimeline, createDescriptor, ICONS } from './model.js';
import { generateLegacySimple, generateLegacyFull } from './legacy.js';
import { strategyRegistry } from './strategies.js';

const DAY = 86400000;
const SECOND = 1000;
const DENSITY_SPAN = { sparse: 1, normal: 0.75, dense: 0.4, 'very-dense': 0.15 };

export class GenerationError extends Error {
  constructor(message) { super(message); this.name = 'GenerationError'; }
}
class PlacementError extends GenerationError {}

/** Paths retain Java's yyyy/mm/dd substitution and descriptor start-day routing. */
export function outputDirectory(template, time, descriptor = false) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) throw new GenerationError('Generated dates must remain in years 1000 through 9999');
  const iso = date.toISOString();
  const model = (descriptor ? template.replaceAll('.json', '') : template).replaceAll('\\', '/');
  // The Java event writer substitutes globally; event_descriptor substitutes
  // only slash-prefixed tokens. Preserve the difference for unusual templates.
  return (descriptor ? model.replaceAll('/yyyy', '/' + iso.slice(0, 4)).replaceAll('/mm', '/' + iso.slice(5, 7)).replaceAll('/dd', '/' + iso.slice(8, 10))
    : model.replaceAll('yyyy', iso.slice(0, 4)).replaceAll('mm', iso.slice(5, 7)).replaceAll('dd', iso.slice(8, 10))).replace(/\/$/, '');
}

function windowsFor(config, start, end) {
  const windows = [];
  const holidays = new Set(config.holidays);
  const selectedDays = new Set(config.selectedDays);
  const clock = value => value.split(':').reduce((hours, part) => hours * 60 + Number(part), 0) * 60000;
  for (let day = Math.floor(start / DAY) * DAY; day < end; day += DAY) {
    const date = new Date(day);
    const dayKey = date.toISOString().slice(0, 10);
    // Empty selection keeps historical range behavior. Omitted days split
    // windows, so even a long session can never span an unselected day.
    if (selectedDays.size && !selectedDays.has(dayKey)) continue;
    if (!config.includeWeekends && [0, 6].includes(date.getUTCDay())) continue;
    if (!config.includeHolidays && holidays.has(dayKey)) continue;
    let low = Math.max(start, day + (config.businessHours.enabled ? clock(config.businessHours.start) : 0));
    let high = Math.min(end, day + (config.businessHours.enabled ? clock(config.businessHours.end) : DAY));
    low = Math.ceil(low / SECOND) * SECOND;
    high = Math.floor(high / SECOND) * SECOND;
    if (high > low) {
      // Join adjacent calendar days so unrestricted sessions can cross midnight.
      if (windows.length && windows.at(-1)[1] === low) windows.at(-1)[1] = high;
      else windows.push([low, high]);
    }
  }
  return windows;
}

function subtract(intervals, low, high) {
  const result = [];
  for (const [start, end] of intervals) {
    if (end <= low || start >= high) result.push([start, end]);
    else {
      if (start < low) result.push([start, low]);
      if (end > high) result.push([high, end]);
    }
  }
  return result;
}

/** Apply density to eligible time when users select individual calendar days.
 * Compressing the wall-clock span first could erase isolated selected dates.
 */
function selectedDayWindows(windows, density, side) {
  let remaining = Math.floor(windows.reduce((sum, [a, b]) => sum + b - a, 0) * density / SECOND) * SECOND;
  const result = [];
  for (const [a, b] of side === 'past' ? [...windows].reverse() : windows) {
    const length = Math.min(b - a, remaining);
    if (length <= 0) break;
    result.push(side === 'past' ? [b - length, b] : [a, a + length]);
    remaining -= length;
  }
  return side === 'past' ? result.reverse() : result;
}

function startSlots(windows, duration) {
  return windows.filter(([a, b]) => b - a >= duration).map(([a, b]) => [a, b - duration]);
}

function selectStart(slots, fraction) {
  const total = slots.reduce((sum, [a, b]) => sum + (b - a) / SECOND + 1, 0);
  let slot = Math.min(total - 1, Math.floor(total * fraction));
  for (const [a, b] of slots) {
    const size = (b - a) / SECOND + 1;
    if (slot < size) return a + slot * SECOND;
    slot -= size;
  }
  throw new GenerationError('No eligible start slots');
}

function durationMs(config, rng) {
  const duration = config.duration;
  let minutes = duration.fixedMinutes;
  if (duration.mode === 'random') minutes = duration.minMinutes + rng.next() * (duration.maxMinutes - duration.minMinutes);
  if (duration.mode === 'weighted') minutes = rng.pickWeighted(duration.weights).minutes;
  return Math.max(SECOND, Math.round(minutes * 60) * SECOND);
}

function resource(config, rng, index) {
  const { mode, values } = config.resources;
  if (mode === 'none') return undefined;
  if (mode === 'random') return values[rng.int(0, values.length)];
  return values[mode === 'round-robin' ? index % values.length : 0];
}

function configurable(config, rng, strategy) {
  const events = [], descriptors = [], warnings = [];
  const reference = Date.parse(config.referenceDate);
  const low = Math.max(Date.parse(config.rangeStart), config.boundaryStart === null ? -Infinity : Date.parse(config.boundaryStart));
  const high = Math.min(Date.parse(config.rangeEnd), config.boundaryEnd === null ? Infinity : Date.parse(config.boundaryEnd));
  let recurrenceMisses = 0, overlapMisses = 0;

  function addDescriptor(event, title, type, tolerance, description) {
    if (rng.next() >= config.descriptorProbability) return;
    descriptors.push({ event, document: createDescriptor(event, { title, type, tolerance, description: `${description}_read_descriptor_in_file` }) });
    event.data.title += '_read_descriptor';
    event.data.description = '';
  }

  for (const [side, count, initialStart, initialEnd] of [
    ['past', config.pastCount, low, Math.min(reference, high)],
    ['future', config.futureCount, Math.max(reference, low), high]
  ]) {
    if (!count) continue;
    const span = (initialEnd - initialStart) * DENSITY_SPAN[config.density];
    const start = side === 'past' ? initialEnd - span : initialStart;
    const end = side === 'past' ? initialEnd : initialStart + span;
    const windows = config.selectedDays.length
      ? selectedDayWindows(windowsFor(config, initialStart, initialEnd), DENSITY_SPAN[config.density], side)
      : windowsFor(config, start, end);
    let free = windows.map(window => [...window]);
    const records = [];
    for (let i = 0; i < count; i++) {
      const index = events.length;
      const recurringRequested = records.length && rng.next() < config.recurrence.probability;
      let template = recurringRequested ? records[rng.int(0, records.length)] : null;
      const point = template ? template.point : rng.next() < config.pointEventProbability;
      const duration = template ? template.duration : point ? 0 : durationMs(config, rng);
      // Points reserve a second for placement, but continue to serialize end as ''.
      const occupiedDuration = Math.max(SECOND, duration);
      const allowOverlap = rng.next() < config.overlapProbability;
      let slots = startSlots(allowOverlap ? windows : free, occupiedDuration);
      if (!slots.length) throw new PlacementError(`Cannot place ${side} event ${i + 1}/${count}: duration, density, calendar and overlap constraints leave no space. Widen the range or reduce the count/duration.`);

      let eventStart;
      if (template) {
        const candidate = template.start + config.recurrence.intervalDays * DAY;
        if (slots.some(([a, b]) => candidate >= a && candidate <= b)) eventStart = candidate;
        else { template = null; recurrenceMisses++; }
      }
      if (eventStart === undefined) {
        if (allowOverlap && records.length) {
          // A requested overlap is sampled from starts intersecting an existing event.
          const overlapSlots = [];
          for (const [a, b] of slots) {
            for (const previous of records) {
              const left = Math.max(a, previous.start - occupiedDuration + SECOND);
              const right = Math.min(b, previous.start + Math.max(SECOND, previous.duration) - SECOND);
              if (left <= right) overlapSlots.push([left, right]);
            }
          }
          if (overlapSlots.length) slots = overlapSlots;
          else overlapMisses++;
        }
        const fraction = strategy.sample({ rng, config: structuredClone(config), side, index: i, count, windows: windows.map(w => [...w]) });
        if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) throw new GenerationError('Strategy sample(context) must return a finite number in [0, 1)');
        eventStart = selectStart(slots, fraction);
      }
      const eventEnd = eventStart + duration;
      free = subtract(free, eventStart, eventStart + occupiedDuration);
      const id = rng.uuid();
      const title = `${point ? 'Events' : 'Session_'}${index}`;
      const type = template ? template.event.data.type : String(rng.pickWeighted(config.categories).value);
      const priority = template ? template.event.data.priority : String(rng.pickWeighted(config.priorities).value);
      const status = ['FINISHED', 'STARTED', 'RUNNING', 'FINISHED'][rng.int(0, 4)];
      const tolerance = config.complexity === 'simple' ? '0' : String(rng.int(0, config.complexity === 'complex' ? 1001 : 101));
      const description = `description_${index} ${title}`;
      const color = '#' + Array.from({ length: 6 }, () => rng.int(0, 9)).join('');
      const event = {
        id, namespace: config.namespace, original_start: '', start: formatDate(eventStart), original_end: '', end: point ? '' : formatDate(eventEnd),
        data: { namespace: config.namespace, title, status, type, priority, description }, render: { color }, activities: []
      };
      const system = template ? template.event.data.system : resource(config, rng, index);
      if (system !== undefined) event.data.system = system;
      if (tolerance !== '0') event.data.tolerance = tolerance;
      if (point) event.render.image = ICONS[rng.int(0, ICONS.length)];
      if (config.complexity === 'complex' && !point) {
        // Planned times remain inside the allowed interval; actual times never change.
        event.original_start = event.start;
        event.original_end = formatDate(eventStart + Math.floor(duration * 0.8 / SECOND) * SECOND);
      }
      if (template) event.data.recurrence = { seriesId: template.event.data.recurrence?.seriesId ?? template.event.id, previousId: template.event.id, intervalDays: config.recurrence.intervalDays };
      if (rng.next() < config.dependencies.probability) {
        const predecessors = events.filter(previous => Date.parse(previous.end || previous.start) <= eventStart);
        if (predecessors.length) {
          const ids = [];
          const amount = rng.int(1, Math.min(config.dependencies.maxParents, predecessors.length) + 1);
          for (let p = 0; p < amount; p++) ids.push(predecessors.splice(rng.int(0, predecessors.length), 1)[0].id);
          event.data.dependencies = ids;
        }
      }
      addDescriptor(event, title, type, tolerance, description);
      const activities = config.complexity === 'simple' ? 1 : rng.int(1, config.complexity === 'complex' ? 7 : 4);
      for (let a = 0; a < activities; a++) {
        const activityTitle = `${activities > 1 ? 'Activity_' : point ? 'Events_' : 'Session_'}${index}_${a}`;
        const activity = {
          id: rng.uuid(), namespace: config.namespace, original_start: event.original_start, start: event.start, original_end: event.original_end, end: event.end,
          data: { namespace: config.namespace, title: activityTitle, status, priority, description: `description_${activityTitle}_activity_${a}` }, render: { ...event.render }
        };
        if (tolerance !== '0') activity.data.tolerance = tolerance;
        addDescriptor(activity, activityTitle, type, tolerance, activity.data.description);
        event.activities.push(activity);
      }
      events.push(event);
      records.push({ event, start: eventStart, duration, point });
    }
  }
  if (recurrenceMisses) warnings.push(`${recurrenceMisses} recurrence requests could not fit their interval and were generated as independent events.`);
  if (overlapMisses) warnings.push(`${overlapMisses} overlap requests had no eligible predecessor and used regular placement.`);
  return { timeline: createTimeline(events), descriptors, warnings };
}

function generateConfigurable(config, rng, strategy) {
  try { return configurable(config, rng, strategy); }
  catch (error) {
    if (!(error instanceof PlacementError)) throw error;
    // Random placement can fragment a feasible interval (e.g. two half-hour
    // events in one hour). Replay once, packing at each earliest eligible start.
    // Still invoke the selected strategy to consume its random draws and reject
    // invalid plugins. This fallback never relaxes calendar/overlap constraints.
    const packing = { sample(context) {
      const fraction = strategy.sample(context);
      if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) throw new GenerationError('Strategy sample(context) must return a finite number in [0, 1)');
      return 0;
    } };
    const result = configurable(config, createRandom(config.seed), packing);
    result.warnings.unshift('Random placement ran out of contiguous space; events were deterministically packed at the earliest eligible starts. Clustering was overridden for this run.');
    return result;
  }
}

/** Pure browser/Node entry point. Seed + complete configuration + pure plugins fix all output bytes. */
export function generateTimeline(input = {}, { plugins = [] } = {}) {
  const registry = strategyRegistry(plugins);
  const config = normalizeConfig(input, { strategies: [...registry.keys()] });
  if (config.seed === null) {
    config.seed = Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
  }
  const rng = createRandom(config.seed);
  const allEvents = [], files = [], warnings = [];
  const days = config.mode === 'configurable' ? 1 : config.legacy.days;
  for (let day = 0; day < days; day++) {
    const date = Date.parse(config.referenceDate) + day * DAY;
    const result = config.mode === 'configurable' ? generateConfigurable(config, rng, registry.get(config.clustering))
      : config.mode === 'legacy-simple' ? generateLegacySimple({ namespace: config.namespace, referenceDate: new Date(date).toISOString(), eventCount: config.legacy.eventCount }, rng)
        : generateLegacyFull({ namespace: config.namespace, referenceDate: new Date(date).toISOString() }, rng);
    allEvents.push(...result.timeline.events);
    warnings.push(...result.warnings ?? []);
    if (config.mode === 'configurable') {
      const buckets = new Map();
      for (const event of result.timeline.events) {
        const path = `${outputDirectory(config.dataModel, Date.parse(event.start))}/events.json`;
        if (!buckets.has(path)) buckets.set(path, []);
        buckets.get(path).push(event);
      }
      // An empty request still produces a usable events.json document.
      if (!buckets.size) buckets.set(`${outputDirectory(config.dataModel, date)}/events.json`, []);
      for (const [path, events] of buckets) files.push({ path, document: createTimeline(events) });
    } else files.push({ path: `${outputDirectory(config.dataModel, date)}/events.json`, document: result.timeline });
    for (const { event, document } of result.descriptors) files.push({ path: `${outputDirectory(config.dataModel, Date.parse(event.start), true)}/descriptors/${event.id}.json`, document });
  }
  if (new Set(files.map(file => file.path)).size !== files.length) throw new GenerationError('dataModel produces duplicate paths; include yyyy/mm/dd when generating multiple days');
  return {
    config, timeline: createTimeline(allEvents), files, warnings,
    stats: { events: allEvents.length, activities: allEvents.reduce((sum, event) => sum + (event.activities?.length ?? 0), 0), descriptors: files.filter(file => file.document.event_descriptor).length, files: files.length }
  };
}

/** Java main's multi-source daily workflow, including its source-date carryover.
 * A fixed default anchor makes --seed sufficient for reproducibility; callers
 * wanting Java's current-day behavior can explicitly supply today's UTC date.
 */
export function generateLegacyStartup(startup, { seed = 'openbexi', referenceDate = DEFAULT_CONFIG.referenceDate, days = 30 } = {}) {
  const sources = Array.isArray(startup) ? startup : startup?.['startup configuration'] ?? startup?.data_sources;
  if (!Array.isArray(sources) || !sources.length) throw new GenerationError('Startup configuration requires a nonempty data_sources or startup configuration array');
  if (!Number.isInteger(days) || days < 1 || days > 3660 || days * sources.length > 120) throw new GenerationError('Startup generation requires 1..3660 days and at most 120 source-days per run');
  const settings = normalizeConfig({ mode: 'legacy-simple', seed, referenceDate });
  if (settings.seed === null) settings.seed = Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
  const rng = createRandom(settings.seed);
  let date = Math.floor(Date.parse(settings.referenceDate) / DAY) * DAY;
  const files = [], events = [];
  for (const source of sources) {
    if (!source || typeof source.namespace !== 'string' || typeof source.data_model !== 'string') throw new GenerationError('Each source needs namespace and data_model strings');
    normalizeConfig({ namespace: source.namespace, dataModel: source.data_model });
    // event_descriptor defaults to source zero, then the last matching namespace.
    const descriptorModel = sources.slice(1).filter(candidate => candidate.namespace === source.namespace).at(-1)?.data_model ?? sources[0].data_model;
    const sourceStart = date;
    for (let day = 0; day < days; day++) {
      date = sourceStart + day * DAY;
      const result = generateLegacySimple({ namespace: source.namespace, referenceDate: date, eventCount: rng.int(50, 600) }, rng);
      events.push(...result.timeline.events);
      files.push({ path: `${outputDirectory(source.data_model, date)}/events.json`, document: result.timeline });
      for (const { event, document } of result.descriptors) files.push({ path: `${outputDirectory(descriptorModel, Date.parse(event.start), true)}/descriptors/${event.id}.json`, document });
    }
  }
  if (new Set(files.map(file => file.path)).size !== files.length) throw new GenerationError('Startup data_model paths collide between sources/days');
  return { config: { seed: settings.seed, referenceDate: settings.referenceDate, days, data_sources: structuredClone(sources) }, timeline: createTimeline(events), files, warnings: [], stats: { events: events.length, activities: events.reduce((sum, e) => sum + e.activities.length, 0), descriptors: files.filter(f => f.document.event_descriptor).length, files: files.length } };
}
