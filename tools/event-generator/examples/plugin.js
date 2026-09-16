/** A plugin can inspect config/side/index/count/windows without changing them.
 * No wall clock, Math.random, IO or mutable external state: keep seeded replay.
 */
export default {
  name: 'early-heavy',
  sample: ({ rng }) => rng.next() ** 3
};
