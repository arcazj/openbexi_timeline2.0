/** Dependency-free, deterministic ZIP (stored entries) usable in browser and Node. */
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function serialize(document) { return JSON.stringify(document, null, 2) + '\n'; }
export function createZip(files) {
  if (files.length > 65535) throw new RangeError('ZIP supports at most 65535 files; reduce the requested count or use CLI directory output');
  const local = [], central = [];
  let offset = 0, centralSize = 0;
  const paths = new Set();
  for (const file of files) {
    const path = file.path.replaceAll('\\', '/');
    if (!path || /^[\/]/.test(path) || /[:\x00-\x1f]/.test(path) || path.split('/').some(p => p === '..' || p === '.') || paths.has(path)) throw new Error(`Unsafe or duplicate archive path: ${path}`);
    paths.add(path);
    const name = encoder.encode(path), data = encoder.encode(serialize(file.document));
    if (name.length > 65535 || offset + data.length > 0xffffffff) throw new RangeError('ZIP64 is not supported');
    const checksum = crc32(data);
    const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(12, 33, true); // fixed 1980-01-01 DOS date, midnight
    view.setUint32(14, checksum, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true);
    header.set(name, 30);
    const record = new Uint8Array(46 + name.length), recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true); recordView.setUint16(4, 20, true); recordView.setUint16(6, 20, true); recordView.setUint16(8, 0x0800, true);
    recordView.setUint16(14, 33, true); recordView.setUint32(16, checksum, true); recordView.setUint32(20, data.length, true); recordView.setUint32(24, data.length, true); recordView.setUint16(28, name.length, true); recordView.setUint32(42, offset, true);
    record.set(name, 46);
    local.push(header, data); central.push(record); offset += header.length + data.length; centralSize += record.length;
  }
  const footer = new Uint8Array(22), view = new DataView(footer.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + footer.length);
  let cursor = 0;
  for (const part of [...local, ...central, footer]) { output.set(part, cursor); cursor += part.length; }
  return output;
}
