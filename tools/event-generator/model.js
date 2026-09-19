/** The timeline reader expects Java Date.toString(), despite its iso8601 label. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Locale/time-zone independent equivalent of Java Date.toString() in UTC. */
export function formatDate(milliseconds) {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid event date.');
  const pad = value => String(value).padStart(2, '0');
  return `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC ` +
    String(date.getUTCFullYear()).padStart(4, '0');
}

export const ICONS = Object.freeze([
  'ob_stop', 'ob_start', 'ob_yellow_flag', 'ob_check', 'ob_red_flag', 'ob_green_flag',
  'ob_info', 'ob_error', 'ob_check_failed', 'ob_warning', 'ob_connect', 'ob_phone',
  'ob_conflict', 'ob_bug', 'ob_lost_connection', 'ob_swap', 'ob_blue_square',
  'ob_orange_square', 'ob_green_square', 'ob_purple_square', 'ob_yellow_square',
  'ob_data_issue', 'ob_data', 'ob_sync', 'ob_out_of_sync', 'ob_loading',
].map(name => `icon/${name}.png`));

/** Serialization uses JSON.stringify, avoiding the Java writer's trailing commas. */
export function createTimeline(events) {
  return { dateTimeFormat: 'iso8601', events };
}

/**
 * Match event_descriptor.write(): no render, activities or top-level namespace;
 * nonempty original dates and optional data values only. A string "0" tolerance
 * is included in descriptors even when omitted from the timeline event.
 */
export function createDescriptor(event, {
  title = event.data.title, type = event.data.type ?? '',
  tolerance = event.data.tolerance ?? '', platform = '',
  description = event.data.description ?? '',
} = {}) {
  const descriptor = { id: event.id, start: event.start, end: event.end };
  if (event.original_start) descriptor.original_start = event.original_start;
  if (event.original_end) descriptor.original_end = event.original_end;
  const data = { namespace: event.namespace ?? event.data.namespace, title };
  for (const [key, value] of Object.entries({
    platform, type, priority: event.data.priority, status: event.data.status, tolerance,
  })) {
    if (value !== '' && value !== undefined && value !== null) data[key] = String(value);
  }
  data.description = description;
  descriptor.data = data;
  return { dateTimeFormat: 'iso8601', event_descriptor: [descriptor] };
}
