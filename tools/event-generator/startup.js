/** Read JSON or the block-style YAML data_sources format used by this repository.
 * This deliberately is not a general YAML parser: unsupported scalar forms fail
 * with an actionable error rather than being guessed. Nested source settings
 * are ignored, as generation uses only namespace and data_model (including
 * disabled sources, exactly as Java main does).
 */
export function parseStartup(text) {
  if (/^\s*[\[{]/.test(text)) return JSON.parse(text);
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const sources = [];
  let inSources = false, source = null, itemIndent;
  function scalar(raw) {
    raw = raw.trim();
    if (raw.startsWith('"')) {
      const match = raw.match(/^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/);
      if (!match) throw new Error('Invalid quoted YAML scalar');
      return JSON.parse(match[1]);
    }
    if (raw.startsWith("'")) {
      const match = raw.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
      if (!match) throw new Error('Invalid quoted YAML scalar');
      return match[1].replaceAll("''", "'");
    }
    if (!raw || /^[!&*|>{[\]}]/.test(raw)) throw new Error('Unsupported YAML scalar; use plain/quoted strings or a JSON startup configuration');
    return raw.replace(/\s+#.*$/, '').trim();
  }
  for (const [index, line] of lines.entries()) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (line.includes('\t')) throw new Error(`YAML tabs are not supported (line ${index + 1})`);
    if (!inSources) {
      if (/^data_sources:\s*(?:#.*)?$/.test(line)) { inSources = true; continue; }
      throw new Error('Expected a block-style data_sources YAML list or JSON startup configuration');
    }
    const item = line.match(/^(\s*)-\s+([A-Za-z_]+):\s*(.*)$/);
    if (item && (itemIndent === undefined || item[1].length === itemIndent)) {
      itemIndent = item[1].length;
      source = {};
      sources.push(source);
      if (['namespace', 'data_model'].includes(item[2])) source[item[2]] = scalar(item[3]);
      continue;
    }
    const property = line.match(/^(\s*)([A-Za-z_]+):\s*(.*)$/);
    if (property && source && property[1].length === itemIndent + 2) {
      if (['namespace', 'data_model'].includes(property[2])) {
        if (Object.hasOwn(source, property[2])) throw new Error(`Duplicate YAML property on line ${index + 1}`);
        source[property[2]] = scalar(property[3]);
      }
    } else if (!source || line.search(/\S/) <= itemIndent) {
      throw new Error(`Unsupported YAML structure on line ${index + 1}; use a JSON startup configuration`);
    }
  }
  if (!sources.length || sources.some(source => !source.namespace || !source.data_model)) throw new Error('Each YAML source requires namespace and data_model');
  return { data_sources: sources };
}
