/** Plugins return a fraction in [0, 1) of eligible time, using only the supplied RNG.
 * The engine retains responsibility for counts, calendars, durations and boundaries.
 */
export const BUILTIN_STRATEGIES = {
  uniform: { sample: ({ rng }) => rng.next() },
  bursty: {
    sample: ({ rng }) => Math.min(0.999999, Math.max(0, [0.15, 0.5, 0.85][rng.int(0, 3)] + (rng.next() - 0.5) * 0.08))
  },
  seasonal: {
    // Rejection sampling favors the middle of a repeating four-season cycle.
    sample: ({ rng }) => {
      for (let i = 0; i < 100; i++) {
        const value = rng.next();
        if (rng.next() < 0.15 + 0.85 * Math.sin(value * Math.PI * 4) ** 2) return value;
      }
      return rng.next();
    }
  },
  realistic: {
    // Most work happens near a few busy periods; some arrivals remain uniform.
    sample: (context) => context.rng.next() < 0.7
      ? BUILTIN_STRATEGIES.bursty.sample(context) : context.rng.next()
  }
};

export function strategyRegistry(plugins = []) {
  if (!Array.isArray(plugins)) throw new TypeError('plugins must be an array');
  const registry = new Map(Object.entries(BUILTIN_STRATEGIES));
  for (const plugin of plugins) {
    if (!plugin || !/^[a-z][a-z0-9-]*$/.test(plugin.name) || typeof plugin.sample !== 'function') {
      throw new TypeError('A strategy plugin needs a lowercase name and sample(context) function');
    }
    if (registry.has(plugin.name)) throw new Error(`Duplicate strategy: ${plugin.name}`);
    registry.set(plugin.name, plugin);
  }
  return registry;
}
