import { createRandom } from './random.js';
import { createDescriptor, createTimeline, formatDate, ICONS } from './model.js';

const color = rng => `#${Array.from({ length: 6 }, () => rng.int(0, 9)).join('')}`;
const dateValue = referenceDate => {
  const value = new Date(referenceDate).getTime();
  if (!Number.isFinite(value)) throw new RangeError('A valid referenceDate is required.');
  return value;
};

/**
 * Port of generate_simple. Counts, event/session distinctions, string-valued
 * priorities/tolerances, title rules and the intentionally unusual original
 * dates are retained. The original silently emits no events after index 29999.
 * Random draws are reproducible but do not reproduce Java's unseeded stream.
 */
export function generateLegacySimple({ namespace = 'default', referenceDate, eventCount = 50 }, rng = createRandom()) {
  if (!Number.isSafeInteger(eventCount) || eventCount < 0) {
    throw new RangeError('eventCount must be a nonnegative safe integer.');
  }
  const base = dateValue(referenceDate);
  const events = [];
  const descriptors = [];
  color(rng); // Java computes an unused initial color before entering its loop.
  for (let j = 0; j < Math.min(eventCount, 30000); j += 1) {
    const eventColor = color(rng);
    const status = ['FINISHED', 'STARTED', 'RUNNING', 'FINISHED'][rng.int(0, 4)];
    const priority = String(rng.int(0, 5));
    const type = 'type1';
    let tolerance = '100';
    let originalStart = '';
    let originalEnd = '';
    let start;
    let end;
    let count = 1;
    const at = offset => formatDate(base + offset);

    if (j === 0 || j === 1) {
      count = j === 0 ? 4 : 3;
      start = at(0); end = at(1000000);
      originalStart = at(0); originalEnd = at(100000);
    } else if (j === 3) {
      start = at(-1500000); end = at(1500000);
      originalStart = at(-1800000); originalEnd = at(1400000);
      tolerance = '1000';
    } else if (j === 4 || j === 5) {
      count = j === 4 ? 6 : 2;
      start = at(2000000); end = at(3000000);
      originalStart = at(2000000); originalEnd = at(300000);
    } else if (j === 6) {
      start = at(2000000); end = at(5500000);
    } else if (j === 7) {
      start = at(2500000); end = at(3000000);
      originalStart = at(2400000); originalEnd = at(290000);
    } else if ([8, 10, 12].includes(j)) {
      start = at(-1000000); end = '';
    } else if (j === 20) {
      start = at(5000000); end = '';
    } else if (j > 20 && j < 29) {
      count = j === 24 ? 2 : 1;
      start = at(4000000); end = '';
    } else if (j === 30) {
      count = 12;
      start = at(5000000); end = at(8000000);
      originalStart = at(5000000); originalEnd = at(800000);
    } else if (j > 50 && j < 60) {
      start = at(600000); end = '';
    } else if (j >= 61 && j <= 71) {
      start = at(5200000); end = '';
    } else {
      const a = rng.int(2, 6);
      count = rng.int(0, 10) === 0 ? a : 1;
      const t = rng.int(2, 30);
      const t2 = rng.int(0, 20);
      const time = base + t * (1000000 + t2 * 100000);
      start = formatDate(time);
      tolerance = String(rng.int(0, 30) * rng.int(0, 30));
      end = t2 < 10 ? '' : formatDate(time + t2 * 200000);
      if (end !== '') originalStart = formatDate(time - t2 * 2000);
    }

    const makeEvent = (title, activity = false) => {
      const data = { namespace, title, status };
      if (!activity) Object.assign(data, { type, system: 'system1' });
      data.priority = priority;
      if (tolerance !== '0') data.tolerance = tolerance;
      return {
        id: rng.uuid(), namespace, original_start: originalStart, start,
        original_end: originalEnd, end, data, render: { color: eventColor },
      };
    };
    const describe = (event, title, description, descriptor) => {
      if (descriptor) {
        event.data.title = `${title}_read_descriptor`;
        event.data.description = '';
        descriptors.push({ event, document: createDescriptor(event, {
          title, type, tolerance, description: `${description}_read_descriptor_in_file`,
        }) });
      } else {
        event.data.title = title;
        event.data.description = description;
      }
    };

    const title = count > 1 ? `Activity_${j}` : end === '' ? `Events${j}` : `Session_${j}`;
    const event = makeEvent(title);
    describe(event, title, `description_${j} ${title}`, rng.int(0, 2) === 0);
    const icon = rng.int(0, 40);
    // The simple writer excludes the last icon as well as indices >= length.
    if (end === '' && icon < ICONS.length - 1) event.render.image = ICONS[icon];
    event.activities = [];
    for (let a = 0; a < count; a += 1) {
      let activityTitle = count > 1 ? `Activity_${j}_${a}` :
        end === '' ? `Events_${j}_${a}` : `Session_${j}_${a}`;
      const activity = makeEvent(activityTitle, true);
      const descriptor = rng.int(0, 2) === 0;
      if (!descriptor) {
        const longText = rng.int(1, 10);
        const repetitions = rng.int(1, 15);
        if (longText > 7) activityTitle += '_long_text'.repeat(repetitions);
      }
      describe(activity, activityTitle, `description_${activityTitle}_activity_${a}`, descriptor);
      if (end === '') {
        if (icon < ICONS.length - 1) activity.render.image = ICONS[icon];
      } else if (rng.int(1, 10) > 7 && icon < ICONS.length - 1) {
        activity.render.image = ICONS[icon];
      }
      event.activities.push(activity);
    }
    events.push(event);
  }
  return { timeline: createTimeline(events), descriptors };
}

/**
 * Port of the alternate generate(): 650 groups of eight events, millisecond
 * increments of 3600 * [10,500), alternating sessions and instantaneous events.
 * This preserves the actual Java units (not an assumed hour-sized increment).
 */
export function generateLegacyFull({ namespace = 'default', referenceDate }, rng = createRandom()) {
  let time = dateValue(referenceDate);
  const events = [];
  for (let j = 0; j < 650; j += 1) {
    if (j !== 0) time += 3600 * rng.int(10, 500);
    const start = formatDate(time);
    for (let i = 0; i < 8; i += 1) {
      const eventColor = color(rng);
      let end = i % 2 === 1 ? '' : formatDate(time + rng.int(1, 20) * 100000);
      let originalStart = start;
      let originalEnd = end;
      const status = ['SCHEDULE', 'STARTED', 'COMPLETED', 'SCHEDULE'][rng.int(0, 4)];
      const system = `system${rng.int(0, 8)}`;
      const priority = String(rng.int(0, 2));
      const t = rng.int(10, 400);
      let tolerance = '0';
      if (i === 2) {
        tolerance = String(t);
        const offset = rng.int(0, t);
        if (offset > 50) originalStart = formatDate(time - rng.int(1, 5) * 100000);
        if (offset > 100) {
          originalEnd = formatDate(time + rng.int(1, 10) * 100000);
          end = formatDate(time + rng.int(11, 15) * 100000);
        }
      }
      const title = `title${j}_${i}`;
      const type = `type${rng.int(0, 5)}`;
      const originals = {};
      if (start !== originalStart) originals.original_start = originalStart;
      if (end !== originalEnd) originals.original_end = originalEnd;
      const data = { namespace, title, status, type, system, priority };
      if (tolerance !== '0') data.tolerance = tolerance;
      data.description = `description_${title}`;
      const event = {
        id: rng.uuid(), namespace, ...originals, start, end,
        data, render: { color: eventColor },
      };
      const hasIcon = i === 0 || i % 2 === 1;
      // Java nextInt(0,27) could address element 26 of a 26-element array.
      // Use the valid array bound while retaining the same available icons.
      if (hasIcon) event.render.image = ICONS[rng.int(0, ICONS.length)];
      if (rng.int(0, 6) === 5 && end !== '') {
        const activityCount = rng.int(1, 5);
        event.activities = [];
        for (let a = 0; a < activityCount; a += 1) {
          const id = rng.uuid();
          const activityStart = formatDate(time + rng.int(1, 40) * 1000);
          const activityEnd = rng.int(0, 2) === 0 ?
            formatDate(time + rng.int(1, 20) * 100000) : end;
          const activityData = { namespace, title: `activity_${a}`, status, priority };
          if (tolerance !== '0') activityData.tolerance = tolerance;
          activityData.description = `description_${title}_activity_${a}`;
          // The Java writer put namespace outside the activity object, yielding
          // invalid JSON. Place it inside, matching its simple-generator shape.
          const activity = {
            id, namespace, ...originals, start: activityStart, end: activityEnd,
            data: activityData, render: { color: eventColor },
          };
          if (hasIcon) activity.render.image = ICONS[rng.int(0, 20)];
          event.activities.push(activity);
        }
      }
      events.push(event);
    }
  }
  return { timeline: createTimeline(events), descriptors: [] };
}
