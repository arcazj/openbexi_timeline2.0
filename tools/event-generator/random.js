/** Stable seeded randomness shared by every generation strategy. */
export function createRandom(seed) {
  // An omitted seed deliberately requests fresh data. Explicit values, including
  // zero and the empty string, always create a reproducible stream.
  const text = seed === undefined || seed === null
    ? `${Date.now()}:${Math.random()}` : String(seed);
  let state = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    state = Math.imul(state ^ text.charCodeAt(index), 16777619) >>> 0;
  }

  const random = {
    // Mulberry32 uses explicitly defined 32-bit operations in all JS runtimes.
    next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    /** Like Java nextInt: minimum included, maximum excluded. */
    int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min) {
        throw new RangeError('Random integer bounds must be safe integers with max > min.');
      }
      return min + Math.floor(random.next() * (max - min));
    },
    /** Seeded RFC 4122 version-4 UUID shape; intended for generated data IDs. */
    uuid() {
      const bytes = Array.from({ length: 16 }, () => random.int(0, 256));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = bytes.map(value => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    /** Returns an entry itself, so plugins may attach any payload to it. */
    pickWeighted(entries) {
      if (!Array.isArray(entries) || entries.length === 0 || entries.some(entry =>
        !entry || !Number.isFinite(entry.weight) || entry.weight < 0)) {
        throw new TypeError('Weighted entries require finite, nonnegative weights.');
      }
      const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
      if (!(total > 0) || !Number.isFinite(total)) {
        throw new RangeError('Weighted entries must have a finite positive total weight.');
      }
      let remaining = random.next() * total;
      for (const entry of entries) {
        remaining -= entry.weight;
        if (remaining < 0) return entry;
      }
      // Defend against floating-point rounding at the upper boundary.
      return entries.findLast ? entries.findLast(entry => entry.weight > 0)
        : [...entries].reverse().find(entry => entry.weight > 0);
    },
  };
  return random;
}
