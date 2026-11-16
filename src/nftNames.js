// Typo help for NFT floor questions ("Solblokessociey" -> Sol Blokes Society). Only used AFTER the exact lookup in
// marketAnswers.js found nothing, so exact names never change behaviour.
//
// Magic Eden has no public name search, but its public collection list (no key) can be read page by page
// (/v2/collections?offset=..&limit=500, about 35,000 collections). The list is loaded once in the background when the
// first floor question comes in (one page per ~1.2 s, so Magic Eden's rate limit is respected), kept in memory only
// (symbol + name) and refreshed once a day. Questions asked while it is still loading use the pages loaded so far.
//
// suggest(name) -> { status: 'match', symbol, name }        one clear, close match (confident)
//               |  { status: 'options', options: [{symbol, name}] }  a few close names: Vexo asks "did you mean...?"
//               |  { status: 'none', loading }               nothing close (loading = the list is not complete yet)
const LIST_URL = 'https://api-mainnet.magiceden.dev/v2/collections';
const PAGE = 500;
const MAX_PAGES = 90;
const GAP_MS = 1200;
const REFRESH_MS = 24 * 3600000;
const TIMEOUT_MS = 20000;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

let entries = []; // [{ symbol, name, keys: [normalized name, normalized symbol] }]
let complete = false;
let builtAt = 0;
let building = null;
let fetchPage = defaultFetchPage; // replaced in tests
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function defaultFetchPage(offset) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${LIST_URL}?offset=${offset}&limit=${PAGE}`, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    if (res.status === 400) return []; // past the end of the list
    if (!res.ok) throw new Error(`Magic Eden list HTTP ${res.status}`);
    const j = await res.json();
    return Array.isArray(j) ? j : [];
  } finally {
    clearTimeout(timer);
  }
}

async function build() {
  const next = [];
  const seen = new Set();
  let failures = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    let rows;
    try {
      rows = await fetchPage(p * PAGE);
    } catch (err) {
      if (++failures > 3) {
        console.error('[nft names] collection list stopped:', err.message);
        break;
      }
      await sleep(GAP_MS * 5);
      p--; // try this page again
      continue;
    }
    for (const r of rows) {
      const symbol = String(r?.symbol || '').trim();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      const name = String(r.name || symbol).trim().slice(0, 80);
      next.push({ symbol, name, keys: [...new Set([norm(name), norm(symbol)])].filter((k) => k.length >= 3) });
    }
    if (!entries.length || next.length > entries.length) entries = next.slice(); // usable while loading
    if (rows.length < PAGE) break;
    await sleep(GAP_MS);
  }
  if (next.length) entries = next;
  complete = true;
  builtAt = Date.now();
  console.log(`[nft names] Magic Eden collection list loaded: ${entries.length} collections`);
}

// start loading (or refreshing) the list in the background; never throws
function warm() {
  if (building) return building;
  if (complete && Date.now() - builtAt < REFRESH_MS) return Promise.resolve();
  building = build()
    .catch((err) => console.error('[nft names] load failed:', err.message))
    .finally(() => {
      building = null;
    });
  return building;
}

// Damerau (OSA) edit distance with an early stop above max
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i++) rows.push([i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
  }
  return rows[a.length][b.length];
}
const allowed = (len) => (len <= 4 ? 0 : len <= 7 ? 1 : len <= 12 ? 2 : 3);

function suggest(input) {
  warm();
  const q = norm(input);
  if (q.length < 3) return { status: 'none', loading: !complete };
  const max = allowed(q.length);
  const hits = [];
  for (const e of entries) {
    let d = max + 1;
    for (const k of e.keys) d = Math.min(d, distance(q, k, max));
    if (d <= max) hits.push({ symbol: e.symbol, name: e.name, d });
  }
  hits.sort((a, b) => a.d - b.d || a.name.length - b.name.length);
  if (!hits.length) return { status: 'none', loading: !complete };
  const best = hits[0];
  const tied = hits.filter((h) => h.d === best.d);
  // confident: the only closest name, and close enough (exact after spacing, or a small typo in a long name)
  if (tied.length === 1 && (best.d === 0 || (q.length >= 8 && best.d <= Math.max(1, max - 1)))) return { status: 'match', symbol: best.symbol, name: best.name };
  return { status: 'options', options: hits.slice(0, 3).map(({ symbol, name }) => ({ symbol, name })) };
}

module.exports = {
  suggest,
  warm,
  distance,
  _test: {
    set: (list) => {
      entries = list.map(({ symbol, name }) => ({ symbol, name, keys: [...new Set([norm(name), norm(symbol)])].filter((k) => k.length >= 3) }));
      complete = true;
      builtAt = Date.now();
    },
    reset: () => {
      entries = [];
      complete = false;
      builtAt = 0;
      building = null;
    },
    setFetch: (fn) => {
      fetchPage = fn;
    },
    setSleep: (fn) => {
      sleep = fn;
    },
  },
};
