const hashSeed = (seed) => {
  const text = String(seed ?? 'xanadu');
  let hash = 2166136261;

  for (const character of text) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

export const createRng = (seed) => {
  let state = hashSeed(seed);

  const next = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return Object.freeze({
    next,
    integer: (minimum, maximum) => Math.floor(next() * (maximum - minimum + 1)) + minimum,
    pick: (items) => items[Math.floor(next() * items.length)],
  });
};
