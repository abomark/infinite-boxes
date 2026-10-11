// Content providers.
//
// A provider is { id, label, load(x, y, signal) => Promise<Card> }.
// A Card is { kicker, title, body?, image?, svg?, code?, lang?, url? }.
// The grid knows nothing about where content comes from: add a new source by
// adding an object to PROVIDERS. load() may be called for any integer (x, y).
// The sources themselves are the galleries in charts.js and decks.js.

// Stable pseudo-random 32-bit hash of a grid coordinate.
function cellHash(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// --- Mix: each coordinate gets a source, stable per box ----------------------
const mix = {
  id: 'mix',
  label: 'Mix',
  load(x, y, signal) {
    return GALLERIES[cellHash(x, y, 7) % GALLERIES.length].load(x, y, signal);
  },
};

const PROVIDERS = [mix, ...GALLERIES];
