/** Complete portable launch environment; no source archive is read or modified. */
import { serialize } from './archive.js';

function validInstant(value) {
  const parts = typeof value === 'string' && /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(?:Z|([+-])(\d\d):(\d\d))$/.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const offsetHour = Number(parts[8] ?? 0), offsetMinute = Number(parts[9] ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 23 && offsetMinute <= 59 && Number.isFinite(Date.parse(value)) && Date.parse(value) <= 253402300799999;
}

export async function createEnvironment(result, { name = 'timeline', initialRange = 'current_time', theme = 'dark', camera = 'Orthographic',
  compact = true, overviewVisible = false, groupBy = 'none', search = '' } = {}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('Environment name requires 1 to 64 letters, digits, underscores or hyphens');
  if (!result || !Array.isArray(result.files) || !result.files.length || result.files.length > 65531) throw new Error('Generate a bounded dataset before exporting an environment');
  if (!['dark', 'light'].includes(theme) || !['Orthographic', 'Perspective'].includes(camera) || typeof compact !== 'boolean' || typeof overviewVisible !== 'boolean') throw new Error('Choose a supported model appearance');
  if (typeof groupBy !== 'string' || !/^(?:none|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,7})$/.test(groupBy) || groupBy.length > 128) throw new Error('Choose a supported metadata grouping field');
  if (groupBy.split('.').some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('Grouping fields cannot address prototype properties');
  if (typeof search !== 'string' || search.length > 512) throw new Error('Filter search must contain at most 512 characters');
  const inputs = result.config.data_sources ?? [{ namespace: result.config.namespace, data_model: result.config.dataModel }];
  if (!inputs.length || inputs.length > 100) throw new Error('An environment requires 1 to 100 sources');
  const sources = inputs.map((source, index) => {
    const model = source.data_model?.replaceAll('\\', '/');
    const match = typeof model === 'string' && /^(.*)\/(yyyy(?:\/mm(?:\/dd)?)?)$/.exec(model);
    if (!match || !match[1] || match[1].split('/').some(part => !part || part === '.' || part === '..') || /[:\x00-\x1f]/.test(match[1])) {
      throw new Error('Runnable environments require a relative data model ending in yyyy, yyyy/mm or yyyy/mm/dd');
    }
    return { id: `source${index + 1}`, namespace: source.namespace, prefix: match[1], template: match[2] };
  });
  if (new Set(sources.map(source => source.prefix)).size !== sources.length) throw new Error('Each environment source requires a distinct data directory');
  const sortedSources = [...sources].sort((a, b) => b.prefix.length - a.prefix.length);
  const sourceForPath = path => sortedSources.find(candidate => path.startsWith(`${candidate.prefix}/`));
  // The legacy generator can put another namespace's descriptor beneath its
  // first source. Runnable environments route it beside its owning record.
  const recordSources = new Map();
  const remember = (record, source) => {
    const owners = recordSources.get(record.id) ?? [];
    owners.push({ source, start: record.start, namespace: record.namespace ?? record.data?.namespace ?? source.namespace });
    recordSources.set(record.id, owners);
    for (const child of record.activities ?? []) remember(child, source);
  };
  for (const file of result.files) if (Array.isArray(file.document.events)) {
    const source = sourceForPath(file.path.replaceAll('\\', '/'));
    if (!source) throw new Error(`Generated records have no configured source: ${file.path}`);
    for (const record of file.document.events) remember(record, source);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialize({ name, initialRange, theme, camera, compact, overviewVisible, groupBy, search, config: result.config, files: result.files })));
  const version = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
  const files = result.files.map(file => {
    const path = file.path.replaceAll('\\', '/');
    const source = sourceForPath(path);
    if (!source || path.split('/').some(part => !part || part === '.' || part === '..') || /[:\x00-\x1f]/.test(path)) throw new Error(`Generated artifact has no safe source: ${path}`);
    if (Array.isArray(file.document.event_descriptor)) {
      if (file.document.event_descriptor.length !== 1) throw new Error('A generated descriptor must identify one record');
      const descriptor = file.document.event_descriptor[0];
      const owners = (recordSources.get(descriptor.id) ?? []).filter(owner => owner.namespace === descriptor.data?.namespace);
      if (owners.length !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(descriptor.id)) throw new Error('Generated descriptor ownership is ambiguous');
      const owner = owners[0], stamp = new Date(owner.start).toISOString();
      const folder = owner.source.template.replace('yyyy', stamp.slice(0, 4)).replace('mm', stamp.slice(5, 7)).replace('dd', stamp.slice(8, 10));
      return { path: `data/${version}/${owner.source.id}/${folder}/descriptors/${descriptor.id}.json`, document: file.document };
    }
    return { path: `data/${version}/${source.id}/${path.slice(source.prefix.length + 1)}`, document: file.document };
  });
  if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length) throw new Error('Environment data paths collide');
  let range = 'current_time';
  if (initialRange === 'generated') {
    let low = Infinity, high = -Infinity;
    const visit = event => {
      const start = Date.parse(event.start), end = Date.parse(event.end || event.start);
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Generated event has invalid dates');
      low = Math.min(low, start); high = Math.max(high, start + 1, end);
      for (const child of event.activities ?? []) visit(child);
    };
    for (const event of result.timeline.events) visit(event);
    if (Number.isFinite(low)) range = { from: new Date(low).toISOString(), to: new Date(high).toISOString() };
  } else if (initialRange !== 'current_time') {
    if (!initialRange || typeof initialRange !== 'object' || Object.keys(initialRange).sort().join(',') !== 'from,to') throw new Error('Choose current time, generated interval or two fixed bounds');
    if (!validInstant(initialRange.from) || !validInstant(initialRange.to) || Date.parse(initialRange.from) >= Date.parse(initialRange.to)) throw new Error('Fixed filter bounds require offset ISO dates and from before to');
    range = { from: new Date(initialRange.from).toISOString(), to: new Date(initialRange.to).toISOString() };
  }
  const model = {
    params: [{ name, title: `${name} timeline`, date: 'current_time', timeZone: 'UTC', fontSize: 12, camera, compact, overviewVisible }],
    bands: [
      { name: 'primary', height: '75%', color: '#000000', textColor: '#ffffff', dateColor: '#ffffff', SessionColor: '#0099ff', eventColor: '#0099ff', intervalPixels: 200, intervalUnit: 'HOUR', intervalUnitPos: 'TOP' },
      { name: 'overview', height: '25%', color: '#101010', textColor: '#ffffff', dateColor: '#ffffff', SessionColor: '#0099ff', eventColor: '#0099ff', intervalPixels: 200, intervalUnit: 'DAY' },
    ],
  };
  if (theme === 'light') for (const band of model.bands) Object.assign(band, { color: '#ffffff', textColor: '#111111', dateColor: '#111111' });
  const filter = { version: 1, name: `${name} filter`, source_ids: sources.map(source => source.id), group_by: groupBy, expression: null,
    search: { text: search, mode: 'any' }, initial_range: range };
  const activation = { path: `yaml/${name}.yml`, document: { version: 2,
    server: { host: '127.0.0.1', port: 8771, local_browser: true, state_root: `../var/${name}/${version}`, startup_mode: 'background', data_loading: 'lazy' },
    model: `../models/${version}/${name}.json`, filter: `../filters/${version}/${name}.json`,
    data_sources: sources.map(source => ({ id: source.id, namespace: source.namespace, type: 'json_file', enable: true,
      data_path: `../data/${version}/${source.id}`, data_model: source.template,
      identity_path: `${name}/${source.prefix}/${source.template}`, timezone: 'UTC', dialect: 'legacy-json' })),
    loading: { buffer_ratio: 0.25, cache_mib: 64, index_refresh_seconds: 30 },
  } };
  files.push({ path: `models/${version}/${name}.json`, document: model }, { path: `filters/${version}/${name}.json`, document: filter },
    { path: `data/${version}/generator.config.json`, document: result.config });
  return { version, activation, files: [...files, activation] };
}
