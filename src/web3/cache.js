// A tiny in-memory cache with a time limit, shared by the Web3 data modules (market, wallets, NFTs).
// It keeps external API calls (and costs) low: many servers and many questions share one fetched answer.
//
//   const value = await cache.get('sol:snapshot', 5 * 60 * 1000, () => fetchIt());
//
// - While a fetch is running, other callers wait for the same one (no parallel duplicate requests).
// - A failure is remembered for a short time too, so a broken API is not hammered. The error is thrown again.
const entries = new Map(); // key -> { at, value } | { at, error } | { promise }
const FAIL_MS = 2 * 60 * 1000;

async function get(key, ttlMs, load, { failMs = FAIL_MS, now = Date.now } = {}) {
  const e = entries.get(key);
  if (e) {
    if (e.promise) return e.promise;
    if ('value' in e && now() - e.at < ttlMs) return e.value;
    if (e.error && now() - e.at < failMs) throw e.error;
  }
  const promise = (async () => {
    try {
      const value = await load();
      entries.set(key, { at: now(), value });
      return value;
    } catch (error) {
      entries.set(key, { at: now(), error });
      throw error;
    }
  })();
  entries.set(key, { promise });
  return promise;
}

const clear = (prefix = '') => {
  for (const k of [...entries.keys()]) if (k.startsWith(prefix)) entries.delete(k);
};

module.exports = { get, clear };
