// SOL market data from Binance's free public market data API (https://data-api.binance.vision, SOL/USDT,
// no key), with CoinGecko as the backup, and the indicators Vexo calculates from it IN CODE (never by the AI):
//   price, 24h change / high / low / volume  -> straight from the API
//   RSI (14 hours)                           -> calculated from the hourly prices of the last 7 days
//   support / resistance                     -> the nearest recent lows / highs (approximate, said so)
//   volume trend, momentum                   -> simple rules on the numbers above
//
// Rules: nothing is ever invented. A value that cannot be calculated reliably is null and is left out
// of posts. No key is needed for either source; a COINGECKO_API_KEY is used for the CoinGecko calls
// when set. Both sources down = an error and no post. Results are cached and shared by every server.
const config = require('../config');
const cache = require('./cache');

const BASE = 'https://api.coingecko.com/api/v3';
const SNAPSHOT_MS = 5 * 60 * 1000;
const CHART_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 12000;
const HOUR = 3600000;

// Binance's public market data (no key, no account): the first source for the SOL price.
const BINANCE = 'https://data-api.binance.vision/api/v3';

// Market data needs no key: CoinGecko answers without one (lower limits), and Binance is the backup.
// A COINGECKO_API_KEY (free Demo key) is still used when set: it gives higher, more stable limits.
const available = () => true;
const hasKey = () => !!config.solRadar.apiKey;

async function getJson(url, headers, name) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? `${name} did not answer in time` : /HTTP \d+/.test(err.message) ? err.message : `${name}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}
const api = (pathAndQuery) => getJson(`${BASE}${pathAndQuery}`, hasKey() ? { 'x-cg-demo-api-key': config.solRadar.apiKey } : {}, 'CoinGecko');
const binance = (pathAndQuery) => getJson(`${BINANCE}${pathAndQuery}`, {}, 'Binance');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------------------------------------------------------------- calculations (pure, tested)
// Wilder's RSI over `period` steps. closes: oldest -> newest. null when there is not enough data.
function rsi(closes, period = 14) {
  const c = (closes || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (c.length < period * 2) return null; // needs warm-up to be meaningful
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (gain === 0 && loss === 0) return 50;
  if (loss === 0) return 100;
  return Math.round((100 - 100 / (1 + gain / loss)) * 10) / 10;
}

// [[ms, price], ...] -> one closing price per hour (the last point of each hour), oldest -> newest.
// null when the data is not roughly hourly and complete (then no indicator is calculated from it).
function hourlyCloses(points) {
  const byHour = new Map();
  for (const p of points || []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    byHour.set(Math.floor(p[0] / HOUR), p[1]);
  }
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  if (hours.length < 30) return null;
  const span = hours[hours.length - 1] - hours[0] + 1;
  if (hours.length / span < 0.9) return null; // too many gaps
  return hours.map((h) => ({ at: h * HOUR, price: byHour.get(h) }));
}

// nearest recent low below the price (support) and high above it (resistance), at least 0.5% away
function levels(price, candidates) {
  const gap = price * 0.005;
  const below = candidates.lows.filter((v) => v !== null && v < price - gap).sort((a, b) => b - a);
  const above = candidates.highs.filter((v) => v !== null && v > price + gap).sort((a, b) => a - b);
  return { support: below.length ? below[0] : null, resistance: above.length ? above[0] : null };
}

// 'Increasing' | 'Decreasing' | 'Steady' | null (24h volume now against 24h volume one day earlier)
function volumeTrend(volumes, nowMs) {
  const v = (volumes || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0);
  if (v.length < 30) return null;
  const last = v[v.length - 1];
  if (nowMs - last[0] > 3 * HOUR) return null; // stale
  const target = last[0] - 24 * HOUR;
  let prev = null;
  for (const p of v) if (Math.abs(p[0] - target) <= 2 * HOUR && (!prev || Math.abs(p[0] - target) < Math.abs(prev[0] - target))) prev = p;
  if (!prev) return null;
  const change = (last[1] - prev[1]) / prev[1];
  return change > 0.1 ? 'Increasing' : change < -0.1 ? 'Decreasing' : 'Steady';
}

// 'Positive' | 'Negative' | 'Mixed' from the 24h change and the RSI (RSI may be missing)
function momentum(change24h, rsiValue) {
  if (change24h === null) return null;
  const up = change24h >= 1 && (rsiValue === null || rsiValue >= 50);
  const down = change24h <= -1 && (rsiValue === null || rsiValue <= 50);
  return up ? 'Positive' : down ? 'Negative' : 'Mixed';
}

// ---------------------------------------------------------------- data
// Everything a SOL Radar post or a "what is the SOL price" answer needs. Throws when the price itself is
// not available (then nothing is posted). Optional parts (rsi, levels, trend) are null when not reliable.
// price, 24h change / high / low / volume from CoinGecko
const coingeckoMarket = () =>
  cache.get('cg:sol:markets', SNAPSHOT_MS, async () => {
    const rows = await api('/coins/markets?vs_currency=usd&ids=solana&price_change_percentage=24h');
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r || num(r.current_price) === null || r.current_price <= 0) throw new Error('CoinGecko returned no SOL price');
    const m = {
      price: r.current_price,
      change24h: num(r.price_change_percentage_24h),
      high24h: num(r.high_24h),
      low24h: num(r.low_24h),
      volume24h: num(r.total_volume),
      updatedAt: Date.parse(r.last_updated) || Date.now(),
      source: 'CoinGecko',
      volumeSource: 'CoinGecko',
    };
    if (Date.now() - m.updatedAt > 2 * HOUR) throw new Error('CoinGecko SOL price is too old');
    return m;
  });
// the same from Binance's SOL/USDT market (its volume is that one exchange only, said so in the post)
const str = (v) => (v === null || v === undefined || v === '' ? null : num(Number(v)));
const binanceMarket = () =>
  cache.get('bn:sol:ticker', SNAPSHOT_MS, async () => {
    // the live price: /ticker/price · the 24h high, low, change and volume: /ticker/24hr (same free public API)
    const [p, r] = await Promise.all([binance('/ticker/price?symbol=SOLUSDT'), binance('/ticker/24hr?symbol=SOLUSDT')]);
    const price = str(p?.price);
    if (price === null || price <= 0) throw new Error('Binance returned no SOL price');
    const m = {
      price,
      change24h: str(r.priceChangePercent),
      high24h: str(r.highPrice),
      low24h: str(r.lowPrice),
      volume24h: str(r.quoteVolume),
      updatedAt: num(r.closeTime) || Date.now(),
      source: 'Binance (SOL/USDT)',
      volumeSource: 'Binance',
    };
    if (Date.now() - m.updatedAt > 2 * HOUR) throw new Error('Binance SOL price is too old');
    return m;
  });
// hourly history: { prices: [[ms, price]...], total_volumes | null }
const coingeckoChart = () => cache.get('cg:sol:chart7d', CHART_MS, () => api('/coins/solana/market_chart?vs_currency=usd&days=7'));
const binanceChart = () =>
  cache.get('bn:sol:klines7d', CHART_MS, async () => {
    const rows = await binance('/klines?symbol=SOLUSDT&interval=1h&limit=168');
    if (!Array.isArray(rows) || !rows.length) throw new Error('Binance returned no hourly history');
    return { prices: rows.map((k) => [Number(k[0]), Number(k[4])]), total_volumes: null }; // [open time, closing price]
  });

async function solSnapshot() {
  const now = Date.now();
  // Binance's free public market data first (no key); if it does not answer, CoinGecko. Both down = an
  // error and no post.
  let market;
  try {
    market = await binanceMarket();
  } catch (first) {
    try {
      market = await coingeckoMarket();
      console.error(`[market] Binance not available (${first.message}): using CoinGecko for this update`);
    } catch (second) {
      throw new Error(`no SOL market data right now (${first.message}; ${second.message})`);
    }
  }

  // the hourly history is a bonus: if it fails everywhere, the post still goes out without RSI / levels
  let chart = null;
  for (const load of market.source === 'CoinGecko' ? [coingeckoChart, binanceChart] : [binanceChart, coingeckoChart]) {
    try {
      chart = await load();
      break;
    } catch (err) {
      console.error('[market] SOL hourly history not available:', err.message);
    }
  }

  // The volume line shows the whole market (all exchanges) and its trend, which only CoinGecko has. It is
  // an extra: when CoinGecko does not answer, Binance's own SOL/USDT volume is shown and labelled as such.
  let volumeChart = market.source === 'CoinGecko' ? chart : null;
  if (market.source !== 'CoinGecko') {
    try {
      const cg = await coingeckoMarket();
      if (cg.volume24h !== null) {
        market = { ...market, volume24h: cg.volume24h, volumeSource: 'CoinGecko' };
        volumeChart = await coingeckoChart().catch(() => null);
      }
    } catch {
      // keep Binance's volume
    }
  }
  const closes = chart ? hourlyCloses(chart.prices) : null;
  const fresh = closes && now - closes[closes.length - 1].at < 3 * HOUR;
  const prices = fresh ? closes.map((c) => c.price) : null;
  const rsi14 = prices ? rsi(prices, 14) : null;
  const windowLow = (h) => (prices ? Math.min(...prices.slice(-h)) : null);
  const windowHigh = (h) => (prices ? Math.max(...prices.slice(-h)) : null);
  const lv = levels(market.price, {
    lows: [market.low24h, windowLow(72), windowLow(168)],
    highs: [market.high24h, windowHigh(72), windowHigh(168)],
  });
  return {
    ...market,
    rsi: rsi14,
    support: lv.support,
    resistance: lv.resistance,
    volumeTrend: volumeChart && market.volumeSource === 'CoinGecko' ? volumeTrend(volumeChart.total_volumes, now) : null,
    momentum: momentum(market.change24h, rsi14),
  };
}

module.exports = { available, hasKey, solSnapshot, rsi, hourlyCloses, levels, volumeTrend, momentum };
