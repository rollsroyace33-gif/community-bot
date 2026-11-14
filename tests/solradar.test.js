// Upgrade phase 4: SOL Radar (market data, calculations, schedule, no duplicates, no invented numbers).
// Run: node tests/solradar.test.js
// Fully offline: Discord, Supabase, CoinGecko and the AI are faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
const A = '200000000000000002'; // customer server in its trial (premium)
const B = '300000000000000003'; // another premium customer server
const FREE = '400000000000000004'; // customer server on the free plan
const REMO = '111111111111111110';
const ADMIN = '222222222222222220';
const BOT = '999999999999999999';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, TRIAL_DAYS: '15', DEFAULT_DAILY_AI_LIMIT: '50', CONTROL_CHANNEL_ID: 'home-ctl',
  REDEEM_LOGS_CHANNEL_ID: 'home-logs', SOL_RADAR_CHANNEL_ID: 'home-sol', COINGECKO_API_KEY: 'demo-key', SOL_RADAR_TIMES: '01:00,06:00,11:00,16:00,21:00',
  SOL_RADAR_TIMEZONE: 'UTC', TIMEZONE: 'Asia/Dhaka',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { guilds: [], sol_radar_posts: [] };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
let dbBroken = false; // true = the sol_radar_posts table "does not exist"
const fakeDb = {
  async rpc(name, a) {
    if (name === 'count_ai_call') {
      const g = tables.guilds.find((r) => r.guild_id === a.p_guild);
      if (!g) return { data: -1, error: null };
      g.ai_calls_today += 1;
      return { data: g.ai_calls_today, error: null };
    }
    return { data: 0, error: null };
  },
  from(table) {
    const q = { op: 'select', f: [], single: false };
    const api = {
      select: () => api, order: () => api, limit: () => api,
      eq: (k, v) => (q.f.push((r) => r[k] === v), api),
      insert: (row) => ((q.op = 'insert'), (q.row = row), api),
      update: (p) => ((q.op = 'update'), (q.p = p), api),
      delete: () => ((q.op = 'delete'), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (table === 'sol_radar_posts' && dbBroken) return { data: null, error: { code: '42P01', message: 'relation "sol_radar_posts" does not exist' } };
      const rows = (tables[table] ||= []);
      if (q.op === 'insert') {
        if (table === 'sol_radar_posts' && rows.some((r) => r.guild_id === q.row.guild_id && r.slot === q.row.slot)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const r = clone(q.row);
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      const m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'delete') {
        for (const r of m) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- fake CoinGecko + AI
const HOUR = 3600000;
const calls = { markets: 0, chart: 0, ai: 0, binance: 0, binanceUrls: [], keys: [] };
const world = { price: 152.34, change: 2.41, high: 155.1, low: 148.2, volume: 3.21e9, marketsFail: false, chartFail: false, binanceFail: false, binanceAge: 0, chart: null, age: 0, ai: null, aiFail: false };
// 7 days of hourly prices: a gentle wave between 140 and 160 that ends at the current price
function defaultChart() {
  const now = Date.now();
  const prices = [];
  const vols = [];
  for (let i = 167; i >= 0; i--) {
    const t = now - i * HOUR;
    prices.push([t, 150 + 10 * Math.sin(i / 9) + (i === 0 ? world.price - 150 : 0)]);
    vols.push([t, 2.5e9 + (167 - i) * 6e6]);
  }
  return { prices, market_caps: [], total_volumes: vols };
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('binance')) {
    calls.binance++;
    if (world.binanceFail) return { ok: false, status: 451, json: async () => ({}) };
    calls.binanceUrls.push(u);
    // the live price endpoint the owner named; Binance sends numbers as text
    if (u.includes('/ticker/price')) return { ok: true, status: 200, json: async () => ({ symbol: 'SOLUSDT', price: world.price.toFixed(8) }) };
    // 24h statistics (its lastPrice is deliberately a little different, to prove the price comes from /ticker/price)
    if (u.includes('/ticker/24hr')) return { ok: true, status: 200, json: async () => ({ symbol: 'SOLUSDT', lastPrice: (world.price - 0.5).toFixed(8), priceChangePercent: world.change.toFixed(3), highPrice: world.high.toFixed(8), lowPrice: world.low.toFixed(8), quoteVolume: '512345678.12', closeTime: Date.now() - 1000 - world.binanceAge }) };
    // 7 days of hourly candles with the same closing prices as the CoinGecko history above
    return { ok: true, status: 200, json: async () => (world.chart || defaultChart()).prices.map(([t, c]) => [t, '0', '0', '0', String(c), '0', t + HOUR - 1, '0', 0, '0', '0', '0']) };
  }
  if (u.includes('api.coingecko.com')) {
    calls.keys.push(opts.headers?.['x-cg-demo-api-key']);
    if (u.includes('/coins/markets')) {
      calls.markets++;
      if (world.marketsFail) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => [{ id: 'solana', current_price: world.price, price_change_percentage_24h: world.change, high_24h: world.high, low_24h: world.low, total_volume: world.volume, last_updated: new Date(Date.now() - world.age).toISOString() }] };
    }
    calls.chart++;
    if (world.chartFail) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => world.chart || defaultChart() };
  }
  calls.ai++;
  if (world.aiFail) return { ok: false, status: 500, text: async () => 'down', json: async () => ({}) };
  const answer = world.ai || { bullish: 'If buyers keep pushing, SOL could climb toward the $155 area.', bearish: 'If selling picks up, SOL may slide back to the $148 area.' };
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }), text: async () => '' };
};

// ---------------------------------------------------------------- fake Discord
const { PermissionFlagsBits: P } = require('discord.js');
const sent = [];
const channels = {};
const noWrite = new Set();
function chan(id, guildId) {
  return (channels[id] ||= {
    id, guildId, isTextBased: () => true, guild: { members: { me: { id: BOT } } },
    permissionsFor: () => ({ has: (bit) => !(noWrite.has(id) && bit === P.SendMessages) }),
    send: async (m) => {
      const rec = { id: `s${sent.length + 1}`, ch: id, content: m.content || '', embeds: (m.embeds || []).map((e) => e.toJSON?.() || e), allowedMentions: m.allowedMentions };
      sent.push(rec);
      return rec;
    },
  });
}
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };
function slash(guildId, userId, name, sub, opts = {}, { manage = true } = {}) {
  const it = {
    guildId, guild: { id: guildId, name: 'G' }, client, commandName: name, user: { id: userId }, member: { roles: { cache: { has: () => false } } },
    memberPermissions: { has: (p) => manage && p === P.ManageGuild },
    options: { getSubcommand: () => sub, getString: (k) => opts[k] ?? null },
    out: [],
    reply: async (m) => it.out.push(m), deferReply: async () => {}, editReply: async (m) => it.out.push(m),
  };
  return it;
}

// ---------------------------------------------------------------- load the bot
const guilds = require(src('guilds.js'));
const config = require(src('config.js'));
const plans = require(src('plans.js'));
const cache = require(src('web3/cache.js'));
const market = require(src('web3/market.js'));
const solRadar = require(src('solRadar.js'));
const command = require(src('commands/solradar.js'));

const quiet = { log: console.log };
Object.assign(console, { log: () => {}, debug: () => {}, warn: () => {}, error: () => {} });
const say = (...a) => quiet.log(...a);
let passed = 0;
let failed = 0;
function reset() {
  sent.length = 0;
  tables.sol_radar_posts.length = 0;
  Object.assign(calls, { markets: 0, chart: 0, ai: 0, binance: 0, binanceUrls: [], keys: [] });
  Object.assign(world, { price: 152.34, change: 2.41, high: 155.1, low: 148.2, volume: 3.21e9, marketsFail: false, chartFail: false, binanceFail: false, binanceAge: 0, chart: null, age: 0, ai: null, aiFail: false });
  dbBroken = false;
  noWrite.clear();
  cache.clear();
  solRadar._test.reset();
  config.solRadar.apiKey = 'demo-key';
}
async function test(name, fn) {
  reset();
  try {
    await fn();
    passed++;
    say(`PASS  ${name}`);
  } catch (err) {
    failed++;
    say(`FAIL  ${name}\n      ${err.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString();
// "HH:MM" in UTC, `offsetMin` minutes from the given moment
const hhmm = (ms, offsetMin) => new Date(ms + offsetMin * 60000).toISOString().slice(11, 16);
// times where the newest slot started `minAgo` minutes ago (the other slots are hours away)
const timesWithSlot = (now, minAgo) => [hhmm(now, -minAgo), hhmm(now, 180), hhmm(now, 420), hhmm(now, 660), hhmm(now, 900)];
async function setTimes(guildId, times, timezone = 'UTC', enabled = true) {
  await guilds.patchSettings(guildId, { solRadar: { enabled, times: [...times].sort(), timezone } });
}
const inChannel = (ch) => sent.filter((m) => m.ch === ch && m.content.includes('SOL RADAR'));

(async () => {
  tables.guilds.push(
    { guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: {}, ai_calls_today: 0 },
    { guild_id: A, name: 'Moon Cats', status: 'active', boss_user_id: ADMIN, trial_ends_at: iso(14), ai_calls_today: 0, settings: { channels: { logs: 'a-logs', solRadar: 'a-sol' } } },
    { guild_id: B, name: 'Sun Dogs', status: 'active', boss_user_id: ADMIN, trial_ends_at: iso(14), ai_calls_today: 0, settings: { channels: { logs: 'b-logs', solRadar: 'b-sol' } } },
    { guild_id: FREE, name: 'Free Frogs', status: 'active', boss_user_id: ADMIN, trial_ends_at: iso(-5), ai_calls_today: 0, settings: { channels: { logs: 'f-logs', solRadar: 'f-sol' } } }
  );
  for (const [id, g] of [['home-sol', HOME], ['home-logs', HOME], ['a-sol', A], ['a-logs', A], ['b-sol', B], ['b-logs', B], ['f-sol', FREE], ['f-logs', FREE]]) chan(id, g);
  await guilds.load();
  // by default no server has a slot that is due (each test sets what it needs)
  const park = async () => {
    const now = Date.now();
    for (const id of [HOME, A, B, FREE]) await setTimes(id, timesWithSlot(now, 300));
  };

  say('== 1. Calculations (done in code, never by the AI) ==');
  await test('RSI: only rising prices = 100, only falling = 0, flat = 50, a known series = the known value, too little data = not available', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const down = Array.from({ length: 40 }, (_, i) => 200 - i);
    assert.equal(market.rsi(up), 100);
    assert.equal(market.rsi(down), 0);
    assert.equal(market.rsi(Array(40).fill(100)), 50);
    assert.equal(market.rsi([1, 2, 3, 4, 5]), null);
    // Wilder's textbook example (14 periods): the first RSI value is 70.46
    const wilder = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const first = (() => {
      let g = 0;
      let l = 0;
      for (let i = 1; i <= 14; i++) {
        const d = wilder[i] - wilder[i - 1];
        if (d >= 0) g += d;
        else l -= d;
      }
      return 100 - 100 / (1 + g / l);
    })();
    assert.ok(Math.abs(first - 70.46) < 0.1, `textbook value (${first})`);
    const v = market.rsi([...wilder, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57]);
    assert.ok(v > 30 && v < 60, `continued series stays in a sane range (${v})`);
  });
  await test('support = nearest recent low below the price, resistance = nearest recent high above; none when the price is at the edge', () => {
    assert.deepEqual(market.levels(150, { lows: [148, 140, 135], highs: [155, 160, 170] }), { support: 148, resistance: 155 });
    assert.deepEqual(market.levels(150, { lows: [149.9, 140, null], highs: [150.2, 160, null] }), { support: 140, resistance: 160 }); // closer than 0.5% is ignored
    assert.deepEqual(market.levels(150, { lows: [150, 151], highs: [149, 150] }), { support: null, resistance: null });
  });
  await test('history with gaps or too few hours is refused (no indicator is calculated from it)', () => {
    const now = Date.now();
    const full = Array.from({ length: 100 }, (_, i) => [now - (99 - i) * HOUR, 100 + i]);
    assert.equal(market.hourlyCloses(full).length >= 99, true);
    assert.equal(market.hourlyCloses(full.slice(0, 10)), null);
    assert.equal(market.hourlyCloses(full.filter((_, i) => i % 3 === 0)), null);
  });

  say('== 2. The update ==');
  await test('the post shows the real price, high, low, change, RSI, volume, levels and the "not financial advice" line', async () => {
    const { text, data } = await solRadar.compose();
    assert.match(text, /^📈 \*\*SOL RADAR\*\*/);
    assert.match(text, /\*\*SOL Price:\*\* \$152\.34/);
    assert.match(text, /High: \$155\.10/);
    assert.match(text, /Low: \$148\.20/);
    assert.match(text, /24h Change: \+2\.41%/);
    assert.match(text, /RSI: \d+ \(/);
    assert.match(text, /Volume: (Increasing|Decreasing|Steady) · \$3\.21B traded in 24h/);
    assert.match(text, /Momentum: (Positive|Negative|Mixed)/);
    assert.match(text, /Support \(price floor to watch\): around \$148/);
    assert.match(text, /Resistance \(price ceiling to watch\): around \$155/);
    assert.match(text, /Near-Term Outlook/);
    assert.ok(text.includes(solRadar.DISCLAIMER));
    assert.match(solRadar.DISCLAIMER, /not guaranteed predictions or financial advice/);
    assert.ok(text.length < 1500);
    assert.equal(data.rsi, market.rsi(market.hourlyCloses(defaultChart().prices).map((c) => c.price)));
    assert.ok(calls.keys.every((k) => k === 'demo-key'));
    // the price comes from Binance's free public endpoint, without any key
    assert.equal(data.source, 'Binance (SOL/USDT)');
    assert.equal(data.price, 152.34);
    assert.ok(calls.binanceUrls.includes('https://data-api.binance.vision/api/v3/ticker/price?symbol=SOLUSDT'));
    assert.match(text, /Data: Binance \(SOL\/USDT\), volume: CoinGecko/);
  });
  await test('the outlook is written by the AI only from real levels; an invented number, a percentage or a promise falls back to pre-written lines', async () => {
    let r = await solRadar.compose();
    assert.match(r.text, /If buyers keep pushing, SOL could climb toward the \$155 area\./);
    for (const bad of [
      { bullish: 'If buying continues, SOL could reach $200 soon.', bearish: 'If selling picks up, SOL may slide back to the $148 area.' },
      { bullish: 'If buying continues, SOL could gain another 10% from here.', bearish: 'If selling picks up, SOL may slide back to the $148 area.' },
      { bullish: 'SOL will definitely hit the $155 area, buy now.', bearish: 'If selling picks up, SOL may slide back to the $148 area.' },
      { bullish: '', bearish: '' },
    ]) {
      cache.clear();
      world.ai = bad;
      r = await solRadar.compose();
      assert.doesNotMatch(r.text, /\$200|10%|buy now/);
      assert.match(r.text, /\$155/); // the pre-written line uses the real resistance
      assert.match(r.text, /\$148/);
    }
  });
  await test('AI down: the update still goes out with pre-written sentences and real numbers', async () => {
    world.aiFail = true;
    const { text } = await solRadar.compose();
    assert.match(text, /SOL Price:\*\* \$152\.34/);
    assert.match(text, /Near-Term Outlook\*\*\nIf .*\$155/);
    assert.match(text, /\nIf .*\$148/);
    assert.ok(text.includes(solRadar.DISCLAIMER));
  });
  await test('CoinGecko down: the whole update still comes from Binance alone (price, high, low, change, RSI, its own volume)', async () => {
    world.marketsFail = true;
    world.chartFail = true;
    const { text, data } = await solRadar.compose();
    assert.equal(data.source, 'Binance (SOL/USDT)');
    assert.match(text, /\*\*SOL Price:\*\* \$152\.34/);
    assert.match(text, /High: \$155\.10/);
    assert.match(text, /Low: \$148\.20/);
    assert.match(text, /24h Change: \+2\.41%/);
    assert.match(text, /RSI: \d+ \(/);
    assert.match(text, /Volume: \$512M traded in 24h on Binance/);
    assert.match(text, /Data: Binance \(SOL\/USDT\) · /);
    assert.ok(text.includes(solRadar.DISCLAIMER));
  });
  await test('Binance down: CoinGecko is the backup for everything, and the post says where the data is from', async () => {
    world.binanceFail = true;
    world.price = 150.11; // what CoinGecko reports
    const { text, data } = await solRadar.compose();
    assert.equal(data.source, 'CoinGecko');
    assert.match(text, /\*\*SOL Price:\*\* \$150\.11/);
    assert.notEqual(data.rsi, null);
    assert.match(text, /Volume: (Increasing|Decreasing|Steady) · \$3\.21B traded in 24h\n/);
    assert.match(text, /Data: CoinGecko · /);
  });
  await test('hourly history missing everywhere: RSI and levels from history are left out, nothing is made up', async () => {
    world.chartFail = true;
    world.binanceFail = true;
    const { text, data } = await solRadar.compose();
    assert.equal(data.rsi, null);
    assert.doesNotMatch(text, /RSI/);
    assert.equal(data.volumeTrend, null);
    assert.match(text, /Volume: \$3\.21B traded in 24h/);
    assert.match(text, /SOL Price:\*\* \$152\.34/);
  });
  await test('market data is cached: many updates and servers share one API call; the AI is called once per 15 minutes', async () => {
    for (let i = 0; i < 6; i++) await solRadar.compose();
    assert.deepEqual([calls.markets, calls.chart, calls.ai], [1, 1, 1]);
  });

  say('== 3. The schedule ==');
  await test('time slots follow each server\'s own times and time zone', () => {
    const now = Date.UTC(2026, 10, 14, 5, 30); // 05:30 UTC = 11:30 in Dhaka
    const times = ['01:00', '06:00', '11:00', '16:00', '21:00'];
    assert.deepEqual(solRadar.newestSlot(times, 'UTC', now), { slot: '2026-11-14 01:00', ageMin: 270 });
    assert.deepEqual(solRadar.newestSlot(times, 'Asia/Dhaka', now), { slot: '2026-11-14 11:00', ageMin: 30 });
    assert.deepEqual(solRadar.newestSlot(times, 'UTC', Date.UTC(2026, 10, 14, 0, 20)), { slot: '2026-11-13 21:00', ageMin: 200 }); // before today's first one
    assert.deepEqual(solRadar.settingsOf(A).times.length >= 4, true);
  });
  await test('a due time: ONE update in that server\'s channel; more ticks, a restart or a second bot process never post it again', async () => {
    await park();
    const now = Date.now();
    await setTimes(A, timesWithSlot(now, 4));
    for (let i = 0; i < 3; i++) await solRadar.tick(client, now + i * 60000);
    assert.equal(inChannel('a-sol').length, 1);
    assert.deepEqual(inChannel('a-sol')[0].allowedMentions, { parse: [] });
    assert.equal(tables.sol_radar_posts.length, 1);
    assert.equal(tables.sol_radar_posts[0].message_id, inChannel('a-sol')[0].id);
    solRadar._test.reset(); // a restart: memory is empty, the database still knows
    await solRadar.tick(client, now + 5 * 60000);
    assert.equal(inChannel('a-sol').length, 1);
    assert.equal(sent.filter((m) => m.ch !== 'a-sol').length, 0); // no other server got anything
  });
  await test('after sleeping: only the newest time is posted, and only within 2 hours of it (never a burst of old updates)', async () => {
    await park();
    const now = Date.now();
    await setTimes(A, [hhmm(now, -500), hhmm(now, -400), hhmm(now, -300), hhmm(now, -200), hhmm(now, -90)]); // five times passed while asleep
    await solRadar.tick(client, now);
    assert.equal(inChannel('a-sol').length, 1);
    await setTimes(B, [hhmm(now, -500), hhmm(now, -400), hhmm(now, -300), hhmm(now, -200), hhmm(now, -130)]); // newest one is too old
    await solRadar.tick(client, now);
    assert.equal(inChannel('b-sol').length, 0);
  });
  await test('5 times a day = 5 separate updates over the day, each posted once', async () => {
    await park();
    const day = Date.UTC(2026, 10, 14);
    const realNow = Date.now;
    await setTimes(A, ['01:00', '06:00', '11:00', '16:00', '21:00']);
    try {
      for (let m = 0; m < 1440; m += 7) {
        Date.now = () => day + m * 60000; // the whole bot lives through this day
        cache.clear('cg:');
        await solRadar.tick(client, day + m * 60000);
      }
    } finally {
      Date.now = realNow;
    }
    assert.equal(inChannel('a-sol').length, 5);
    assert.deepEqual(tables.sol_radar_posts.filter((r) => r.guild_id === A).map((r) => r.slot).sort(), ['2026-11-14 01:00', '2026-11-14 06:00', '2026-11-14 11:00', '2026-11-14 16:00', '2026-11-14 21:00']);
  });

  say('== 4. Servers and plans ==');
  await test('two premium servers get the update in their own channel from one data fetch; the free server and a switched-off server get nothing', async () => {
    await park();
    const now = Date.now();
    await setTimes(A, timesWithSlot(now, 3));
    await setTimes(B, timesWithSlot(now, 3));
    await setTimes(FREE, timesWithSlot(now, 3));
    await solRadar.tick(client, now);
    assert.deepEqual([inChannel('a-sol').length, inChannel('b-sol').length, inChannel('f-sol').length], [1, 1, 0]);
    assert.deepEqual([calls.markets, calls.chart, calls.ai], [1, 1, 1]);
    assert.equal(plans.hasFeature(FREE, 'solRadar'), false);
    assert.match(solRadar.blocker(FREE), /premium/);
    // AI use is not charged to the customer servers
    assert.deepEqual([tables.guilds.find((g) => g.guild_id === A).ai_calls_today, tables.guilds.find((g) => g.guild_id === B).ai_calls_today], [0, 0]);
    reset();
    await park();
    await setTimes(A, timesWithSlot(Date.now(), 3), 'UTC', false);
    await solRadar.tick(client, Date.now());
    assert.equal(sent.length, 0);
  });
  await test('HΛVØCZ posts in SOL_RADAR_CHANNEL_ID; with no channel it posts nowhere and tells the logs channel ONCE', async () => {
    await park();
    const now = Date.now();
    await setTimes(HOME, timesWithSlot(now, 3));
    await solRadar.tick(client, now);
    assert.equal(inChannel('home-sol').length, 1);
    reset();
    await park();
    await setTimes(HOME, timesWithSlot(Date.now(), 3));
    const keep = config.channels.solRadar;
    config.channels.solRadar = '';
    try {
      await solRadar.tick(client, Date.now());
      await solRadar.tick(client, Date.now() + 60000); // later ticks (and restarts) do not repeat the note
      assert.match(solRadar.blocker(HOME), /SOL_RADAR_CHANNEL_ID/);
    } finally {
      config.channels.solRadar = keep;
    }
    assert.equal(sent.filter((m) => m.content.includes('SOL RADAR')).length, 0, 'no SOL Radar post anywhere');
    assert.equal(sent.length, 1, 'exactly one note');
    assert.equal(sent[0].ch, 'home-logs');
    assert.match(sent[0].content, /SOL Radar\*\* has no channel/);
    // the channel is back: the note is forgotten (no new note while it is set)
    await solRadar.tick(client, Date.now() + 120000);
    assert.equal(guilds.get(HOME).settings.channelNotices.solRadar, undefined);
  });

  say('== 5. When something is missing or broken ==');
  await test('CoinGecko AND Binance down: nothing is posted and nothing is claimed; when data is back the update goes out (still once)', async () => {
    await park();
    const now = Date.now();
    await setTimes(A, timesWithSlot(now, 3));
    world.marketsFail = true;
    world.binanceFail = true;
    await solRadar.tick(client, now);
    assert.equal(sent.length, 0);
    assert.equal(tables.sol_radar_posts.length, 0);
    world.marketsFail = false;
    cache.clear();
    await solRadar.tick(client, now + 60000);
    await solRadar.tick(client, now + 120000);
    assert.equal(inChannel('a-sol').length, 1);
  });
  await test('a stale price (older than 2 hours) is not used: the backup is; when both are stale it counts as no data', async () => {
    world.binanceAge = 3 * HOUR;
    const r = await solRadar.compose();
    assert.equal(r.data.source, 'CoinGecko');
    cache.clear();
    world.age = 3 * HOUR;
    await assert.rejects(() => solRadar.compose(), /too old/);
  });
  await test('no COINGECKO_API_KEY: SOL Radar still runs (no key is sent), posts on schedule in every premium server', async () => {
    await park();
    const now = Date.now();
    await setTimes(A, timesWithSlot(now, 3));
    await setTimes(B, timesWithSlot(now, 3));
    config.solRadar.apiKey = '';
    assert.equal(solRadar.blocker(A), '');
    assert.equal(solRadar.startTimer(client), true);
    solRadar.stopTimer();
    await new Promise((r) => setTimeout(r, 50)); // the tick that startTimer begins
    await solRadar.tick(client, now);
    assert.deepEqual([inChannel('a-sol').length, inChannel('b-sol').length], [1, 1]);
    assert.match(inChannel('a-sol')[0].content, /\*\*SOL Price:\*\* \$152\.34/);
    assert.ok(calls.keys.length > 0 && calls.keys.every((k) => k === undefined));
  });
  await test('the table is missing (SQL not run yet): nothing is posted, because duplicates could not be prevented', async () => {
    await park();
    await setTimes(A, timesWithSlot(Date.now(), 3));
    dbBroken = true;
    await solRadar.tick(client, Date.now());
    assert.equal(sent.length, 0);
  });
  await test('the bot cannot write in the channel: the time slot is given back and the admin gets one note in the logs', async () => {
    await park();
    const now = Date.now();
    await setTimes(A, timesWithSlot(now, 3));
    noWrite.add('a-sol');
    await solRadar.tick(client, now);
    await solRadar.tick(client, now + 60000);
    assert.equal(inChannel('a-sol').length, 0);
    assert.equal(tables.sol_radar_posts.length, 0);
    const notes = sent.filter((m) => m.ch === 'a-logs');
    assert.equal(notes.length, 1);
    assert.match(notes[0].embeds[0].description, /Send Messages/);
    noWrite.clear();
    await solRadar.tick(client, now + 120000);
    assert.equal(inChannel('a-sol').length, 1);
  });

  say('== 6. /solradar ==');
  await test('admins only; status shows the channel, times and time zone', async () => {
    const no = slash(A, 'member', 'solradar', 'status', {}, { manage: false });
    await command.execute(no);
    assert.match(no.out[0].content, /Only admins/);
    await setTimes(A, ['01:00', '06:00', '11:00', '16:00', '21:00']);
    const it = slash(A, ADMIN, 'solradar', 'status');
    await command.execute(it);
    assert.match(it.out[0].content, /SOL Radar is ON/);
    assert.match(it.out[0].content, /<#a-sol>/);
    assert.match(it.out[0].content, /\*\*5\*\* at `01:00`/);
    assert.match(it.out[0].content, /UTC time/);
  });
  await test('times: 4 or 5 valid times are saved for this server only (with the time zone); anything else is refused', async () => {
    await setTimes(A, ['01:00', '06:00', '11:00', '16:00', '21:00']);
    await setTimes(B, ['01:00', '06:00', '11:00', '16:00', '21:00']);
    for (const [times, re] of [['9:00, 13:00', /4 or 5/], ['01:00,02:00,03:00,04:00,05:00,06:00', /4 or 5/], ['morning, noon', /could not read/], ['25:00,01:00,02:00,03:00', /could not read/]]) {
      const bad = slash(A, ADMIN, 'solradar', 'times', { times });
      await command.execute(bad);
      assert.match(bad.out[0].content, re);
    }
    const zone = slash(A, ADMIN, 'solradar', 'times', { times: '08:00 12:00 16:00 20:00', timezone: 'Mars/Base' });
    await command.execute(zone);
    assert.match(zone.out[0].content, /do not know the time zone/);
    assert.deepEqual(solRadar.settingsOf(A).times, ['01:00', '06:00', '11:00', '16:00', '21:00']);
    const ok = slash(A, ADMIN, 'solradar', 'times', { times: '9:00, 13:00, 17:00, 21:30', timezone: 'Asia/Dhaka' });
    await command.execute(ok);
    assert.deepEqual(solRadar.settingsOf(A), { enabled: true, times: ['09:00', '13:00', '17:00', '21:30'], timezone: 'Asia/Dhaka' });
    assert.deepEqual(solRadar.settingsOf(B).times, ['01:00', '06:00', '11:00', '16:00', '21:00']); // the other server is untouched
    assert.equal(solRadar.settingsOf(B).timezone, 'UTC');
    assert.ok(sent.some((m) => m.ch === 'a-logs' && /Update times set/.test(m.embeds[0].description)));
  });
  await test('off / on, preview (private, nothing posted) and now (one extra post); a data failure is said plainly', async () => {
    await park();
    const off = slash(A, ADMIN, 'solradar', 'off');
    await command.execute(off);
    assert.equal(solRadar.settingsOf(A).enabled, false);
    const blocked = slash(A, ADMIN, 'solradar', 'now');
    await command.execute(blocked);
    assert.match(blocked.out[0].content, /switched off/);
    await command.execute(slash(A, ADMIN, 'solradar', 'on'));
    assert.equal(solRadar.settingsOf(A).enabled, true);
    const before = inChannel('a-sol').length;
    const preview = slash(A, ADMIN, 'solradar', 'preview');
    await command.execute(preview);
    assert.match(preview.out[0].content, /SOL RADAR/);
    assert.equal(inChannel('a-sol').length, before);
    const now = slash(A, ADMIN, 'solradar', 'now');
    await command.execute(now);
    assert.match(now.out[0].content, /Posted in <#a-sol>/);
    assert.equal(inChannel('a-sol').length, before + 1);
    cache.clear();
    world.marketsFail = true;
    world.binanceFail = true;
    const fail = slash(A, ADMIN, 'solradar', 'now');
    await command.execute(fail);
    assert.match(fail.out[0].content, /could not get live SOL market data/);
    assert.equal(inChannel('a-sol').length, before + 1);
  });
  await test('/help and /status still build with the new lines (also in a free server where everything is locked)', async () => {
    const help = require(src('commands/help.js'));
    const status = require(src('commands/status.js'));
    for (const g of [HOME, A, FREE]) {
      const h = slash(g, ADMIN, 'help', null);
      await help.execute(h);
      const fields = h.out[0].embeds[0].toJSON().fields;
      assert.ok(fields.every((f) => f.value.length <= 1024));
      assert.ok(fields.some((f) => /\/solradar/.test(f.value)));
      const s = slash(g, ADMIN, 'status', null);
      s.guild.members = { me: { permissions: { has: () => true } }, fetchMe: async () => ({ permissions: { has: () => true } }) };
      await status.execute(s);
      const sf = s.out[0].embeds[0].toJSON().fields;
      assert.ok(sf.some((f) => /SOL Radar \(daily SOL market updates\)/.test(f.value)));
      assert.ok(sf.some((f) => /SOL Radar: <#/.test(f.value)));
    }
  });

  solRadar.stopTimer();
  say(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
