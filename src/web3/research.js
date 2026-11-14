// Web research through Tavily (https://tavily.com, free plan: 1,000 searches a month, key TAVILY_API_KEY).
// Used by NFT Radar to find upcoming Solana NFT mints and to research one project.
//
//   const results = await research.search('upcoming solana nft mint', { maxResults: 5, timeRange: 'month' });
//   -> [{ title, url, content }]
//
// Rules: no key = available() is false and every call throws NO_KEY (the feature using it turns itself off).
// Each search costs 1 free credit, so: answers are cached for 6 hours, and there is a hard daily stop
// (config.nftRadar.maxSearchesPerDay). The key is only ever sent to Tavily and never logged.
const config = require('../config');
const cache = require('./cache');

const URL = 'https://api.tavily.com/search';
const TIMEOUT_MS = 20000;
const CACHE_MS = 6 * 3600000;

const available = () => !!config.nftRadar.tavilyKey;

const used = { day: '', count: 0, sinceStart: 0 }; // searches sent today (UTC) / since the bot started, in this process
const today = () => new Date().toISOString().slice(0, 10);
function spend() {
  if (used.day !== today()) Object.assign(used, { day: today(), count: 0 });
  if (used.count >= config.nftRadar.maxSearchesPerDay) {
    const err = new Error(`daily web search limit reached (${config.nftRadar.maxSearchesPerDay})`);
    err.code = 'SEARCH_LIMIT';
    throw err;
  }
  used.count++;
  used.sinceStart++;
}

// Credits used this billing month, from Tavily's GET /usage (free, does not use a credit).
// -> { used, limit, plan } (numbers may be null) | null when Tavily does not say
async function usage() {
  if (!available()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch('https://api.tavily.com/usage', { headers: { authorization: `Bearer ${config.nftRadar.tavilyKey}` }, signal: ctrl.signal });
    if (!res.ok) return null;
    const j = await res.json();
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const out = {
      used: n(j?.account?.plan_usage) ?? n(j?.key?.usage),
      limit: n(j?.account?.plan_limit) ?? n(j?.key?.limit),
      plan: typeof j?.account?.current_plan === 'string' ? j.account.current_plan.slice(0, 40) : null,
    };
    return out.used === null && out.limit === null ? null : out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const clean = (t, max) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, max);

// timeRange: 'day' | 'week' | 'month' | 'year' | null (only pages from that period)
async function search(query, { maxResults = 5, timeRange = null } = {}) {
  if (!available()) {
    const err = new Error('TAVILY_API_KEY is not set');
    err.code = 'NO_KEY';
    throw err;
  }
  const q = clean(query, 300);
  const key = `research:${q.toLowerCase()}|${maxResults}|${timeRange || ''}`;
  return cache.get(key, CACHE_MS, async () => {
    spend();
    const body = { query: q, search_depth: 'basic', max_results: Math.min(10, Math.max(1, maxResults)), include_answer: false, include_images: false };
    if (timeRange) body.time_range = timeRange;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.nftRadar.tavilyKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Tavily HTTP ${res.status}${res.status === 401 ? ' (the TAVILY_API_KEY is wrong)' : res.status === 432 || res.status === 429 ? ' (free searches used up or too many at once)' : ''}`);
      const j = await res.json();
      return (Array.isArray(j?.results) ? j.results : [])
        .filter((r) => r && /^https?:\/\//.test(String(r.url || '')))
        .map((r) => ({ title: clean(r.title, 200), url: String(r.url).slice(0, 500), content: clean(r.content, 1200) }));
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'Tavily did not answer in time' : err.message.startsWith('Tavily') ? err.message : `Tavily: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }, { failMs: 10 * 60000 });
}

module.exports = { available, search, usage, used, _test: { used } };
