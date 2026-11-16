// Unprompted answers test: Vexo answers real questions in normal chat WITHOUT a mention (HΛVØCZ and customer
// servers, each from its own knowledge), web3 / general questions, live crypto prices, NFT floors, NFT picks and
// market analysis from fetched data; stays silent for casual chat and members talking to each other.
// Run: node tests/unprompted-qa.test.js
// Fully offline: Discord, Supabase, the AI, Binance, Magic Eden, alternative.me and Tavily are faked.
const assert = require('assert');

const HOME = '100000000000000001';
const BEEE = '200000000000000002'; // customer server in trial (premium)
const OTHER = '400000000000000004'; // another premium customer server (its knowledge must never leak)
const FREE = '300000000000000003'; // customer server on the free plan
const NOKNOW = '500000000000000005'; // premium customer server with no knowledge at all
const REMO = '111111111111111110'; // boss of HOME
const ADMIN_B = '222222222222222220';
const MEMBER = '333333333333333330';
const MEMBER2 = '333333333333333331';
const MEMBER3 = '333333333333333332';
const BOT = '999999999999999999';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, STAFF_ROLE_IDS: '', TRIAL_DAYS: '15', DEFAULT_DAILY_AI_LIMIT: '300',
  SUPPORT_CONTACT: '', CONTROL_CHANNEL_ID: 'home-ctl', GENERAL_CHANNEL_ID: 'home-general', ASK_CHANNEL_ID: 'home-ask', LOGS_CHANNEL_ID: 'home-logs',
  MARKETPLACE_CHANNEL_ID: 'home-shop', RUMBLE_CHANNEL_ID: '444444444444444444', VERIFIED_ROLE_ID: 'home-verified', TICKET_CHANNEL_ID: 'home-tickets',
  X_DROP_CHANNEL_ID: '', QA_PER_HOUR: '1000', MIN_ACCOUNT_AGE_DAYS: '0', MIN_MESSAGE_LENGTH: '8', MIN_SECONDS_BETWEEN_MESSAGES: '0',
  EXCLUDED_CHANNEL_IDS: 'home-excluded', MESSAGES_PER_POINT: '2', TIMEZONE: 'Asia/Dhaka', ADMIN_ROLE_ID: '', CHAT_CHANNEL_IDS: '', REDEEM_LOGS_CHANNEL_ID: '', RECEIPT_CHANNEL_ID: '',
  BOSS_OFFLINE_START: '00:00', BOSS_OFFLINE_END: '00:00', TAVILY_API_KEY: 'test-key',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { guilds: [], users: [], point_log: [], vexo_knowledge: [], vexo_unanswered: [], messages_log: [], scheduled_tasks: [], bot_settings: [], nft_radar_reviews: [], nft_radar_projects: [] };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const dbWrites = [];
const fakeDb = {
  async rpc() {
    return { data: 1, error: null };
  },
  from(table) {
    const q = { op: 'select', f: [], single: false };
    const api = {
      select: () => api, order: () => api, limit: () => api, gt: () => api, gte: () => api, lt: () => api, lte: () => api, not: () => api,
      is: (k, v) => (q.f.push((r) => (r[k] ?? null) === v), api),
      eq: (k, v) => (q.f.push((r) => r[k] === v), api),
      in: (k, vs) => (q.f.push((r) => vs.includes(r[k])), api),
      insert: (row) => ((q.op = 'insert'), (q.row = row), api),
      update: (p) => ((q.op = 'update'), (q.p = p), api),
      upsert: (row) => ((q.op = 'upsert'), (q.row = row), api),
      delete: () => ((q.op = 'noop'), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = (tables[table] ||= []);
      if (q.op !== 'select') dbWrites.push(table);
      if (q.op === 'insert') {
        const r = { id: rows.length + 1, ...clone(q.row) };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      if (q.op === 'upsert' || q.op === 'noop') return { data: null, error: null };
      const m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- fake internet
const aiCalls = []; // { kind: 'route' | 'answer', system, user }
const web = []; // every non-AI URL fetched
let route = null; // the router's JSON for the next checks (null = "not for Vexo")
let aiText = '[SPECIFIC] The mint is on March 3, right after the reveal.';
let down = { binance: false, coingecko: false, magiceden: false };
const ME = {
  mad_lads: { symbol: 'mad_lads', floorPrice: 7846000000, listedCount: 179, avgPrice24hr: 7825420000, volume7d: 345927920000 },
  okay_bears: { symbol: 'okay_bears', floorPrice: 1200000000, listedCount: 300, avgPrice24hr: 1150000000, volume7d: 90000000000 },
  okaybears: { symbol: 'okaybears', floorPrice: 50000000, listedCount: 4, avgPrice24hr: null, volume7d: 1000000000 },
  degods: { symbol: 'degods', floorPrice: 1890000000, listedCount: 410, avgPrice24hr: 1900000000, volume7d: 2500000000000 },
  sol_blokes_society: { symbol: 'sol_blokes_society', floorPrice: 120000000, listedCount: 55, avgPrice24hr: null, volume7d: 9000000000 },
};
const TICKERS = { BTC: { lastPrice: '65049.06', priceChangePercent: '0.445', quoteVolume: '1408360433.7', highPrice: '65696.16', lowPrice: '63905.01' }, SOL: { lastPrice: '142.5', priceChangePercent: '-2.10', quoteVolume: '500000000', highPrice: '148', lowPrice: '140' }, ETH: { lastPrice: '1819.77', priceChangePercent: '0.246', quoteVolume: '9000000', highPrice: '1850', lowPrice: '1800' } };
const kline = (i, p) => [Date.now() - (31 - i) * 86400000, String(p), String(p * 1.02), String(p * 0.98), String(p), '1', 0, '1'];
const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('api.openai.com')) {
    const body = JSON.parse(opts.body);
    const kind = body.response_format ? 'route' : 'answer';
    aiCalls.push({ kind, system: body.messages[0].content, user: body.messages[1].content });
    const content = kind === 'route' ? JSON.stringify(route || { should_answer: false, topic: 'none' }) : aiText;
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }), text: async () => '' };
  }
  web.push(url);
  if (url.includes('binance')) {
    if (down.binance) return res(503, 'down');
    const sym = (/symbol=([A-Z0-9]+)USDT/.exec(url) || [])[1];
    if (url.includes('/klines')) return res(200, Array.from({ length: 31 }, (_, i) => kline(i, 60000 + i * 200)));
    if (!TICKERS[sym]) return res(400, { code: -1121, msg: 'Invalid symbol.' });
    return res(200, { symbol: `${sym}USDT`, ...TICKERS[sym], closeTime: Date.now() });
  }
  if (url.includes('coingecko')) return down.coingecko ? res(503, 'down') : res(200, []);
  if (url.includes('alternative.me')) return res(200, { data: [{ value: '10', value_classification: 'Extreme Fear' }] });
  if (url.includes('magiceden')) {
    if (down.magiceden) return res(429, 'You have exceeded the requests in 1 min limit!');
    const sym = (/collections\/([^/]+)\/stats/.exec(url) || [])[1];
    return res(200, ME[sym] || { symbol: sym, listedCount: 0 });
  }
  if (url.includes('tavily')) return res(200, { results: [{ title: 'Solana upgrade ships', url: 'https://news.example/sol', content: 'The Solana network shipped an upgrade this week.' }] });
  return res(404, 'unknown');
};

// ---------------------------------------------------------------- fake Discord
const sentElsewhere = []; // channel.send calls (answers must be replies in the same channel instead)
function channel(id, guildId, name = id) {
  return { id, guildId, name, type: 0, isTextBased: () => true, sendTyping: async () => {}, send: async (m) => (sentElsewhere.push({ id, m }), { id: 's' }), messages: { fetch: async () => new Map() } };
}
const channels = {};
const chan = (id, g, name) => (channels[id] ||= channel(id, g, name));
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };
let seq = 0;
function msg(guildId, channelId, authorId, content, { mentions = [], bot = false, repliedUser = null } = {}) {
  const replies = [];
  const m = {
    id: `m${++seq}`, guildId, guild: { id: guildId }, channelId, channel: chan(channelId, guildId), client, content,
    author: { id: authorId, bot, username: `u${authorId.slice(-2)}`, tag: `u#0`, createdTimestamp: 0 },
    member: { displayName: `member${authorId.slice(-2)}`, roles: { cache: { has: () => false, some: () => false } }, permissions: { has: () => false } },
    mentions: { users: new Map(mentions.map((id) => [id, {}])), roles: new Map(), repliedUser, everyone: false, channels: { first: () => undefined } },
    embeds: [], replies, reference: null, reactions: [],
    reply: async (r) => (replies.push({ channelId, text: typeof r === 'string' ? r : r.content }), { id: 'r' }),
    react: async (e) => m.reactions.push(e),
    delete: async () => {},
  };
  return m;
}

// ---------------------------------------------------------------- load the bot
const config = require(src('config.js'));
const guilds = require(src('guilds.js'));
const clock = require(src('clock.js'));
const cache = require(src('web3/cache.js'));
const unprompted = require(src('unprompted.js'));
const aboutVexo = require(src('aboutVexo.js'));
const marketAnswers = require(src('marketAnswers.js'));
const webAnswers = require(src('webAnswers.js'));
const onMessage = require(src('events/messageCreate.js'));

const DAY = 86400000;
const iso = (days) => new Date(Date.now() + days * DAY).toISOString();
const quiet = { log: console.log };
const logs = []; // the bot's log lines (to check that they name the blocking rule)
Object.assign(console, { log: (...a) => logs.push(a.join(' ')), debug: () => {}, warn: () => {}, error: () => {} });
const say = (...a) => quiet.log(...a);
let fakeNow = Date.now();
clock.now = () => fakeNow;
const later = (sec) => (fakeNow += sec * 1000);
const LIMITS = { ...config.unprompted };

let passed = 0;
let failed = 0;
async function test(name, fn) {
  aiCalls.length = 0;
  web.length = 0;
  logs.length = 0;
  sentElsewhere.length = 0;
  config.qa.perHour = 1000;
  require(src('ratelimit.js'))._test.reset();
  route = null;
  aiText = '[SPECIFIC] The mint is on March 3, right after the reveal.';
  down = { binance: false, coingecko: false, magiceden: false };
  Object.assign(config.unprompted, LIMITS);
  config.nftRadar.tavilyKey = 'test-key';
  unprompted._test.reset();
  cache.clear('');
  webAnswers._test.used.count = 0;
  later(3600); // every test starts after all cooldowns
  try {
    await fn();
    passed++;
    say(`PASS  ${name}`);
  } catch (err) {
    failed++;
    say(`FAIL  ${name}\n      ${err.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}
async function send(...args) {
  const m = msg(...args);
  await onMessage(m);
  return m;
}
const R = (topic, extra = {}) => ({ should_answer: true, topic, coins: [], collections: [], prediction: false, needs_search: false, ...extra });
const text = (m) => m.replies.map((r) => r.text).join('\n');
const answers = () => aiCalls.filter((c) => c.kind === 'answer');
const routes = () => aiCalls.filter((c) => c.kind === 'route');

(async () => {
  tables.guilds.push(
    { guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: {}, knowledge: 'HOME_SECRET_FACT: HΛVØCZ mint is in phase two.' },
    { guild_id: BEEE, name: 'Beee', status: 'active', boss_user_id: ADMIN_B, trial_started_at: iso(-1), trial_ends_at: iso(14), knowledge: 'BEEE_SECRET_FACT: Beee mint is March 3.', settings: { channels: { control: 'b-ctl', marketplace: 'b-shop', rumble: 'b-rumble', logs: 'b-logs', giveaway: 'b-giveaways', solRadar: 'b-sol', nftRadar: 'b-nft' } } },
    { guild_id: OTHER, name: 'Moon Cats', status: 'active', boss_user_id: MEMBER3, trial_started_at: iso(-1), trial_ends_at: iso(14), knowledge: 'MOON_SECRET_FACT: Moon Cats mint is in May.', settings: { channels: { control: 'o-ctl', logs: 'o-logs' } } },
    { guild_id: NOKNOW, name: 'Blank Birds', status: 'active', boss_user_id: MEMBER3, trial_started_at: iso(-1), trial_ends_at: iso(14), knowledge: '', settings: { channels: { control: 'n-ctl', logs: 'n-logs' } } },
    { guild_id: FREE, name: 'Free Frogs', status: 'active', boss_user_id: MEMBER3, trial_started_at: iso(-20), trial_ends_at: iso(-5), knowledge: 'FROG_SECRET_FACT', settings: { channels: { control: 'f-ctl', logs: 'f-logs' } } }
  );
  tables.nft_radar_projects.push({ id: 1, name: 'Sky Foxes', status: 'selected', data: { name: 'Sky Foxes', mintAt: null, supply: 2222, priceSol: 0.5, score: 7, risks: ['New team'] } }, { id: 2, name: 'OTHER_SERVER_PROJECT', status: 'selected', data: { name: 'OTHER_SERVER_PROJECT' } });
  tables.nft_radar_reviews.push({ guild_id: BEEE, project_id: 1, status: 'approved' }, { guild_id: OTHER, project_id: 2, status: 'approved' });
  chan('b-vexo-logs', BEEE, 'vexo-logs');
  await guilds.load();

  say('== 1. Project questions without a mention (own knowledge only, same channel, English) ==');
  await test('HΛVØCZ: "when is the mint?" answered in the same channel from HΛVØCZ knowledge', async () => {
    route = R('project');
    const m = await send(HOME, 'home-chat', MEMBER, 'when is the mint?');
    assert.equal(m.replies.length, 1);
    assert.equal(m.replies[0].channelId, 'home-chat', 'answered where it was asked');
    assert.equal(sentElsewhere.length, 0, 'nothing sent to another channel');
    assert.deepEqual([routes().length, answers().length], [0, 1], 'a clear mint question needs no AI check (rule)');
    assert.ok(answers()[0].system.includes('HOME_SECRET_FACT'));
  });
  await test('customer server (Beee): answered from BEEE knowledge, never HΛVØCZ / another server', async () => {
    route = R('project');
    const m = await send(BEEE, 'b-chat', MEMBER, "what's the roadmap?");
    assert.equal(m.replies.length, 1);
    const sys = answers()[0].system;
    assert.ok(sys.includes('BEEE_SECRET_FACT'));
    for (const other of ['HOME_SECRET_FACT', 'MOON_SECRET_FACT', 'FROG_SECRET_FACT']) assert.ok(!sys.includes(other), other);
  });
  await test('another customer server uses ITS knowledge only', async () => {
    route = R('project');
    await send(OTHER, 'o-chat', MEMBER, 'is there a whitelist for the mint?');
    const sys = answers()[0].system;
    assert.ok(sys.includes('MOON_SECRET_FACT'));
    for (const other of ['HOME_SECRET_FACT', 'BEEE_SECRET_FACT']) assert.ok(!sys.includes(other), other);
  });
  await test('Banglish question ("mint kobe hobe?") is understood and answered in English', async () => {
    route = R('project');
    const m = await send(HOME, 'home-chat', MEMBER, 'mint kobe hobe?');
    assert.equal(m.replies.length, 1);
    assert.equal(routes().length, 0, 'routed by the rules');
    route = R('general');
    await send(HOME, 'home-chat9', MEMBER2, 'internet keno slow hoy?'); // unclear -> the AI check, which reads Banglish
    assert.match(routes()[0].system, /Banglish/);
    assert.match(answers()[0].system, /English, even if they write in another language/);
  });
  await test('not in the knowledge: a short "don\'t know yet" line (no guessing)', async () => {
    route = R('project');
    aiText = 'UNKNOWN: what is the mint price?';
    const m = await send(HOME, 'home-chat', MEMBER, 'what is the mint price?');
    assert.equal(m.replies.length, 1);
    assert.ok(require(src('ai.js')).lines.UNKNOWN_REPLIES.includes(m.replies[0].text));
  });
  await test('the #ask channel works exactly as before (no router call)', async () => {
    const m = await send(HOME, 'home-ask', MEMBER, 'when is the mint happening');
    assert.equal(m.replies.length, 1);
    assert.equal(routes().length, 0);
  });
  await test('HΛVØCZ works even with NO guilds row at all (missing setting never means "off")', async () => {
    const row = tables.guilds.shift();
    await guilds.load();
    try {
      route = R('project');
      const m = await send(HOME, 'home-chat', MEMBER, 'when is the mint?');
      assert.equal(m.replies.length, 1);
    } finally {
      tables.guilds.unshift(row);
      await guilds.load();
    }
  });

  say('== 2. Silence: casual chat, people talking to each other, no AI call when the prefilter fails ==');
  await test('statements, casual chat and social questions: no reply and NO OpenAI call at all', async () => {
    for (const t of ['the mint art looks sick', 'lol nice', 'gm everyone', 'how are you all doing?', 'anyone watching the match tonight?', 'ok', 'tumi kemon acho?']) {
      const m = await send(BEEE, 'b-chat', MEMBER, t);
      assert.equal(m.replies.filter((r) => !/morning/i.test(r.text)).length, 0, t);
    }
    assert.equal(aiCalls.length, 0, 'not one AI call');
  });
  await test('the router says "not for Vexo" (casual / for a member): silent, no answer call', async () => {
    route = { should_answer: false, topic: 'none' };
    const m = await send(BEEE, 'b-chat', MEMBER, 'what is everyone doing with their points this weekend?');
    assert.equal(m.replies.length, 0);
    assert.deepEqual([routes().length, answers().length], [1, 0]);
  });
  await test('reply to another member / mentioning a member: silent, no AI call', async () => {
    route = R('project');
    const a = await send(BEEE, 'b-chat', MEMBER, 'when is the mint?', { repliedUser: { id: MEMBER2 } });
    const b = await send(BEEE, 'b-chat', MEMBER, `<@${MEMBER2}> when is the mint?`, { mentions: [MEMBER2] });
    assert.equal(a.replies.length + b.replies.length, 0);
    assert.equal(aiCalls.length, 0);
  });
  await test('two members chatting back and forth ("bro what is your floor plan?"): silent, no AI call', async () => {
    route = R('nft_floor');
    await send(BEEE, 'b-chat5', MEMBER, 'just bought my first nft lol');
    await send(BEEE, 'b-chat5', MEMBER2, 'nice which one');
    const m = await send(BEEE, 'b-chat5', MEMBER, 'bro what is your floor plan?');
    assert.equal(m.replies.length, 0);
    assert.equal(aiCalls.length, 0);
  });
  await test('control, logs, vexo-logs, shop, rumble, giveaways, radar, tickets, excluded: nothing', async () => {
    route = R('project');
    const places = [[BEEE, 'b-ctl'], [HOME, 'home-ctl'], [BEEE, 'b-logs'], [BEEE, 'b-vexo-logs'], [BEEE, 'b-shop'], [BEEE, 'b-rumble'], [BEEE, 'b-giveaways'], [BEEE, 'b-sol'], [BEEE, 'b-nft'], [HOME, 'home-logs'], [HOME, 'home-shop'], [HOME, '444444444444444444'], [HOME, 'home-excluded'], [HOME, 'home-tickets']];
    for (const [g, ch] of places) assert.equal((await send(g, ch, MEMBER, 'when is the mint?')).replies.length, 0, ch);
    assert.equal(routes().length, 0, 'no router call in any of them');
  });
  await test('bots and Vexo itself never get an answer', async () => {
    route = R('project');
    const a = await send(BEEE, 'b-chat', '888888888888888888', 'when is the mint?', { bot: true });
    const b = await send(BEEE, 'b-chat', BOT, 'when is the mint?', { bot: true });
    assert.equal(a.replies.length + b.replies.length, 0);
    assert.equal(aiCalls.length, 0);
  });
  await test('free-plan customer server: silent, zero AI calls, no advertising', async () => {
    route = R('price', { coins: ['BTC'] });
    const m = await send(FREE, 'f-chat', MEMBER, 'what is the btc price?');
    assert.equal(m.replies.length, 0);
    assert.equal(aiCalls.length + web.length, 0);
  });
  await test('the boss gate is unchanged (boss not talking to Vexo: no answer)', async () => {
    route = R('project');
    const m = await send(HOME, 'home-chat', REMO, 'when is the mint?');
    assert.equal(m.replies.length, 0);
    assert.equal(aiCalls.length, 0);
  });

  say('== 3. Cooldowns ==');
  await test(`customer server: per member ${LIMITS.userCooldownSec}s, per channel / per server per hour; a blocked question gets ONE ⏳`, async () => {
    const a = await send(BEEE, 'c-1', MEMBER, 'when is the mint?');
    const b = await send(BEEE, 'c-1', MEMBER2, 'what is the supply?'); // same channel right away: no channel cooldown any more
    const c = await send(BEEE, 'c-2', MEMBER, 'what is the supply?'); // same member within 5s
    const c2 = await send(BEEE, 'c-2', MEMBER, 'what is the roadmap?'); // again: no second ⏳ in the same window
    assert.deepEqual([a, b, c, c2].map((m) => m.replies.length), [1, 1, 0, 0]);
    assert.deepEqual([c.reactions, c2.reactions], [['⏳'], []], 'one polite ⏳, never a silent drop, never spam');
    later(LIMITS.userCooldownSec + 1);
    assert.equal((await send(BEEE, 'c-1', MEMBER, 'what is the roadmap?')).replies.length, 1, 'after the member cooldown');
    config.unprompted.channelMaxPerHour = 3;
    later(LIMITS.userCooldownSec + 1);
    assert.equal((await send(BEEE, 'c-1', MEMBER3, 'what is the roadmap?')).replies.length, 0, 'channel limit (3 answers sent this hour)');
    config.unprompted.channelMaxPerHour = LIMITS.channelMaxPerHour;
    config.unprompted.guildMaxPerHour = 4;
    assert.equal((await send(BEEE, 'c-3', MEMBER3, 'what is the roadmap?')).replies.length, 1, '4th answer in the server');
    later(LIMITS.userCooldownSec + 1);
    assert.equal((await send(BEEE, 'c-4', MEMBER2, 'what is the roadmap?')).replies.length, 0, 'server limit');
    assert.ok(logs.some((l) => /limit server answers per hour \(4 \/ 4\)/.test(l)), 'the log names the rule, the count and the limit');
    assert.ok(logs.some((l) => /limit member cooldown \(last answer 0s ago, limit 5s\)/.test(l)));
  });
  await test('the default customer limits are generous (hundreds per hour, a few seconds per member)', () => {
    assert.ok(LIMITS.userCooldownSec <= 10 && LIMITS.channelMaxPerHour >= 100 && LIMITS.guildMaxPerHour >= 300 && LIMITS.classifierMaxPerChannelPerHour >= 100);
  });

  say('== 4. About Vexo ==');
  await test('"what can this bot do?" without a mention: answered with the ABOUT VEXO block', async () => {
    route = R('vexo');
    aiText = '[BROAD] I host Rumble and guess games, run giveaways, points and a shop, and post SOL and NFT Radar updates.';
    const m = await send(BEEE, 'b-chat', MEMBER, 'what can this bot do?');
    assert.equal(m.replies.length, 1);
    assert.ok(answers()[0].system.includes('=== ABOUT VEXO'));
    assert.ok(answers()[0].system.includes('BEEE_SECRET_FACT') && !answers()[0].system.includes('HOME_SECRET_FACT'));
  });
  await test('mentioned / by name: "@Vexo what can you do?", "what is vexo?" get the block; "vexo when mint?" does not', async () => {
    await send(HOME, 'home-chat', MEMBER, `<@${BOT}> what can you do?`, { mentions: [BOT] });
    await send(BEEE, 'b-chat4', MEMBER, 'what is vexo?');
    await send(HOME, 'home-chat3', MEMBER, 'vexo when mint?');
    const a = answers();
    assert.equal(a.length, 3);
    assert.ok(a[0].system.includes('=== ABOUT VEXO') && a[1].system.includes('=== ABOUT VEXO'));
    assert.ok(!a[2].system.includes('ABOUT VEXO'));
  });
  await test('the ABOUT VEXO block: every feature from the live feature map, trial days, commands, planned only, no dates', () => {
    const b = aboutVexo.block();
    const [free, rest] = b.split('Premium features');
    const premium = rest.split('Plans:')[0];
    const NAMES = { rumble: 'Rumble Royale', numberGuess: 'Number Guess', aiChat: 'AI chat', knowledgeQa: 'Knowledge Q&A', automod: 'Auto mod', points: 'Points:', marketplace: 'Marketplace', giveaway: 'Giveaways:', giveaway_orders: 'Giveaway orders', solRadar: 'SOL Radar', nftRadar: 'NFT Radar' };
    for (const [k, level] of Object.entries(config.features)) assert.ok((level === 'free' ? free : premium).includes(NAMES[k]), `${k} listed as ${level}`);
    assert.match(b, /15-day free trial/);
    for (const cmd of ['/setup', '/status', '/help']) assert.ok(b.includes(cmd));
    assert.ok(!/\b20\d\d\b/.test(b));
  });

  say('== 5. Web3 / general questions ==');
  await test('web3 question without a mention ("how does staking work?"): answered in English, same channel', async () => {
    route = R('web3');
    aiText = 'Staking means locking tokens to help secure a network, and you earn rewards for it.';
    const m = await send(BEEE, 'b-chat', MEMBER, 'how does staking work?');
    assert.equal(m.replies.length, 1);
    assert.equal(m.replies[0].channelId, 'b-chat');
    assert.match(answers()[0].system, /ALWAYS answer in simple, short, friendly English/);
    assert.ok(!answers()[0].system.includes('BEEE_SECRET_FACT'), 'no server knowledge needed');
  });
  await test('current info: Tavily web search, answer only from results, source linked', async () => {
    route = R('general', { needs_search: true });
    aiText = 'Solana shipped a network upgrade this week.';
    const m = await send(HOME, 'home-chat', MEMBER, "what's new with solana this week?");
    assert.ok(web.some((u) => u.includes('tavily')));
    assert.match(text(m), /<https:\/\/news\.example\/sol>/);
    assert.match(answers()[0].user, /WEB RESULTS/);
  });
  await test('web search not set up: a polite "can\'t search the web right now", never a made-up answer', async () => {
    config.nftRadar.tavilyKey = '';
    route = R('general', { needs_search: true });
    const m = await send(HOME, 'home-chat', MEMBER, "what's new with solana this week?");
    assert.match(text(m), /can't search the web right now/);
    assert.equal(answers().length, 0);
  });

  say('== 6. Crypto prices and NFT floors: live data only ==');
  await test('price: BTC and SOL from Binance (live numbers, 24h change), no AI-written numbers', async () => {
    route = R('price', { coins: ['BTC', 'SOL'] });
    const m = await send(BEEE, 'b-chat', MEMBER, 'btc ar sol er dam koto?');
    const t = text(m);
    assert.match(t, /BTC\*\*: \$65,049\.06 \(\+0\.45% in 24h\)/);
    assert.match(t, /SOL\*\*: \$142\.50 \(-2\.10% in 24h\)/);
    assert.match(t, /Live prices \(Binance, \d\d:\d\d UTC\)/);
    assert.equal(answers().length, 0, 'the numbers never come from the AI');
    assert.ok(!t.includes(marketAnswers.PREDICTION_LINE), 'no forecast line on a plain price');
  });
  await test('price fetch fails (Binance and the CoinGecko backup down): clear "not available right now"', async () => {
    down.binance = true;
    down.coingecko = true;
    route = R('price', { coins: ['SOL'] });
    const m = await send(BEEE, 'b-chat', MEMBER, 'sol price?');
    assert.equal(text(m), marketAnswers.NO_LIVE);
  });
  await test('an unknown coin is said plainly', async () => {
    const m = await send(BEEE, 'b-chat', MEMBER, 'price of btc and $fakecoin?');
    assert.match(text(m), /FAKECOIN\*\*: I couldn't find a live price/);
  });
  await test('NFT floor: "Mad Lads" resolved on Magic Eden, floor in SOL, listed, fetched time', async () => {
    route = R('nft_floor', { collections: ['Mad Lads'] });
    const m = await send(BEEE, 'b-chat', MEMBER, 'mad lads floor koto?');
    const t = text(m);
    assert.match(t, /Mad Lads\*\* \(`mad_lads`\) on Magic Eden, fetched \d\d:\d\d UTC/);
    assert.match(t, /Floor: \*\*7\.846 SOL\*\*/);
    assert.match(t, /Listed: 179/);
    assert.equal(answers().length, 0);
  });
  await test('ambiguous NFT name: Vexo asks which collection instead of guessing', async () => {
    route = R('nft_floor', { collections: ['okay bears'] });
    const m = await send(BEEE, 'b-chat', MEMBER, 'okay bears floor?');
    assert.match(text(m), /more than one collection .*okay_bears.*okaybears.*Which one do you mean\?/);
    assert.ok(!/Floor:/.test(text(m)));
  });
  await test('unknown NFT name: Vexo asks which collection', async () => {
    route = R('nft_floor', { collections: ['zzz unknown apes'] });
    const m = await send(BEEE, 'b-chat', MEMBER, 'zzz unknown apes floor?');
    assert.match(text(m), /couldn't find .*Which collection do you mean\?/);
  });
  await test('Magic Eden down / rate limited: clear failure message', async () => {
    down.magiceden = true;
    route = R('nft_floor', { collections: ['Mad Lads'] });
    const m = await send(BEEE, 'b-chat', MEMBER, 'mad lads floor?');
    assert.match(text(m), /live floor data from Magic Eden is not available right now/);
  });

  say('== 7. Forecasts: data first, honest analysis, the "not certain" line ==');
  await test('"which nft can grow?": live Magic Eden numbers + THIS server\'s NFT Radar, ends with the line', async () => {
    route = R('nft_pick', { collections: ['Mad Lads'], prediction: true });
    aiText = 'Mad Lads looks steady: floor 7.846 SOL with 179 listed and 345.928 SOL of 7-day volume. Sky Foxes is unproven before its mint.';
    const m = await send(BEEE, 'b-chat', MEMBER, 'which nft can grow?');
    const t = text(m);
    assert.ok(t.endsWith(marketAnswers.PREDICTION_LINE));
    const user = answers()[0].user;
    assert.ok(user.includes('"floor":7.846') && user.includes('Sky Foxes'), 'real data given to the AI');
    assert.ok(!user.includes('OTHER_SERVER_PROJECT'), 'never another server\'s NFT Radar');
  });
  await test('market forecast ("when bull run?"): data + Fear & Greed, ends with the "not certain" line', async () => {
    route = R('market', { coins: ['BTC'], prediction: true });
    aiText = 'BTC is at $65,049.06 and up 0.45% today, while Fear & Greed sits at 10 (Extreme Fear). Nobody knows the date of a bull run.';
    const m = await send(HOME, 'home-chat', MEMBER, 'bull run kobe ashbe?');
    const t = text(m);
    assert.ok(t.startsWith('BTC is at $65,049.06'));
    assert.ok(t.endsWith(marketAnswers.PREDICTION_LINE));
    assert.ok(answers()[0].user.includes('"fear_and_greed":{"value":10'));
  });
  await test('the AI invents a price: the answer is replaced by the plain live numbers', async () => {
    route = R('market', { coins: ['BTC'], prediction: true });
    aiText = 'BTC will reach $99,999 next week for sure.';
    const m = await send(HOME, 'home-chat', MEMBER, 'how high can btc go?');
    const t = text(m);
    assert.ok(!t.includes('99,999'));
    assert.match(t, /Live market \(\d\d:\d\d UTC\):\n• BTC: \$65,049\.06/);
    assert.ok(t.endsWith(marketAnswers.PREDICTION_LINE));
  });
  await test('market data down: clear failure message, no AI analysis', async () => {
    down.binance = true;
    down.coingecko = true;
    route = R('market', { coins: ['BTC'] });
    const m = await send(HOME, 'home-chat', MEMBER, 'why is btc down today?');
    assert.equal(text(m), marketAnswers.NO_LIVE);
    assert.equal(answers().length, 0);
  });

  say('== 8. Mentioning Vexo still works (and gets live data) ==');
  await test('"@Vexo what\'s the btc price?" (mention): live Binance price', async () => {
    route = R('price', { coins: ['BTC'] });
    const m = await send(OTHER, 'o-chat', MEMBER, `<@${BOT}> what's the btc price?`, { mentions: [BOT] });
    assert.match(text(m), /\$65,049\.06/);
  });
  await test('a mention that is not a crypto / web3 question goes to the normal chat exactly as before (no router call)', async () => {
    aiText = 'Ha, fair enough.';
    const m = await send(OTHER, 'o-chat', MEMBER, `<@${BOT}> you are funny`, { mentions: [BOT] });
    assert.equal(m.replies.length, 1);
    assert.equal(routes().length, 0);
  });
  say('== 9. Follow-up (unprompted-qa-fix-v2): the exact sentences that failed in the test server ==');
  const nftNames = require(src('nftNames.js'));
  nftNames._test.set([
    { symbol: 'degods', name: 'DeGods' },
    { symbol: 'sol_blokes_society', name: 'Sol Blokes Society' },
    { symbol: 'mad_lads', name: 'Mad Lads' },
    { symbol: 'okay_bears', name: 'Okay Bears' },
    { symbol: 'solana_monkey_business', name: 'Solana Monkey Business' },
    { symbol: 'ape_lords', name: 'Ape Lords' },
    { symbol: 'ape_lards', name: 'Ape Lards' },
  ]);
  const floorOf = (t) => /DeGods|Degods/.test(t) && /Floor: \*\*1\.89 SOL\*\*/.test(t);
  await test('"Degods er floor koto?" -> the DeGods floor (exact match unchanged), no AI call at all', async () => {
    const m = await send(BEEE, 'b-chat', MEMBER, 'Degods er floor koto?');
    assert.ok(floorOf(text(m)), text(m));
    assert.match(text(m), /\(`degods`\) on Magic Eden/);
    assert.equal(aiCalls.length, 0);
  });
  await test('floor wordings: "<name> nft floor?", "<name> floor", "floor of <name>", "<name> floor price", "flooe" typo, "floor koto"', async () => {
    const lines = ['Degods nft floor?', 'Degods nft er flooe koto?', 'degods floor', 'floor of degods', 'degods floor price', 'DeGods floor koto', "what's the degods floor right now?"];
    for (const [i, t] of lines.entries()) {
      later(10);
      const m = await send(BEEE, `fl-${i}`, MEMBER, t);
      assert.ok(floorOf(text(m)), `${t} -> ${text(m)}`);
    }
    assert.equal(aiCalls.length, 0, 'no AI check, no persona');
  });
  await test('"Solblokessociey er floor koto?" (typo): confident match, says which collection it used', async () => {
    const m = await send(BEEE, 'b-chat', MEMBER, 'Solblokessociey er floor koto?');
    const t = text(m);
    assert.match(t, /couldn't find "solblokessociey" exactly, so I matched it to \*\*Sol Blokes Society\*\*/);
    assert.match(t, /Floor: \*\*0\.12 SOL\*\*/);
  });
  await test('two close names ("ape lurds"): Vexo asks "Did you mean ...?" and never guesses', async () => {
    const m = await send(BEEE, 'b-chat', MEMBER, 'ape lurds floor?');
    assert.match(text(m), /Did you mean \*\*Ape L[ao]rds\*\* .* or \*\*Ape L[ao]rds\*\*/);
    assert.ok(!/Floor:/.test(text(m)));
  });
  await test('the boss replying to Vexo with "Degods nft floor?" gets the live floor, never the chat persona', async () => {
    await send(HOME, 'home-chat', REMO, 'back again'); // he was "away" (fake clock): the welcome-back line goes here
    aiCalls.length = 0;
    const m = await send(HOME, 'home-chat', REMO, 'Degods nft floor?', { repliedUser: { id: BOT } });
    assert.ok(floorOf(text(m)), text(m));
    assert.ok(!/boss|in the dark/i.test(text(m)));
    assert.equal(answers().length, 0);
  });
  await test('"Wen mint?" WITH knowledge: answered from THIS server\'s knowledge, no AI check', async () => {
    const m = await send(BEEE, 'b-chat', MEMBER, 'Wen mint?');
    assert.equal(m.replies.length, 1);
    assert.equal(routes().length, 0);
    assert.ok(answers()[0].system.includes('BEEE_SECRET_FACT'));
  });
  await test('"Wen mint?" WITHOUT knowledge: "No mint date has been announced yet", never silent, never invented', async () => {
    aiText = 'NO_REPLY';
    const m = await send(NOKNOW, 'n-chat', MEMBER, 'Wen mint?');
    assert.equal(text(m), "No mint date has been announced yet, so it's not in my knowledge. Keep an eye on the official announcements.");
    aiText = 'UNKNOWN: when is the mint?';
    later(10);
    const m2 = await send(NOKNOW, 'n-chat', MEMBER, 'Wen mint?');
    assert.ok(require(src('ai.js')).lines.UNKNOWN_REPLIES.includes(text(m2)), 'the short "not known yet" line');
  });
  await test('"What\'s eth price now?" -> live Binance ETH price (no ⏳, no AI), also in the Ask channel', async () => {
    const m = await send(BEEE, 'b-chat', MEMBER, "What's eth price now?");
    assert.match(text(m), /ETH\*\*: \$1,819\.77 \(\+0\.25% in 24h\)/);
    assert.deepEqual(m.reactions, []);
    const a = await send(HOME, 'home-ask', MEMBER2, "What's eth price now?");
    assert.match(text(a), /ETH\*\*: \$1,819\.77/);
    assert.equal(aiCalls.length, 0);
  });
  await test('HΛVØCZ: 30 questions in a row from one member in one channel are ALL answered (no limits at home)', async () => {
    config.qa.perHour = 2; // even a tiny QA_PER_HOUR changes nothing at home
    const qs = ['Wen mint?', "What's eth price now?", 'Degods floor?', 'what is the roadmap?', 'btc price?'];
    let answered = 0;
    for (let i = 0; i < 30; i++) {
      const m = await send(HOME, 'home-chat', MEMBER, qs[i % qs.length]);
      if (m.replies.length === 1) answered++;
    }
    assert.equal(answered, 30);
  });
  await test('customer server: routed answers do NOT use the QA_PER_HOUR bucket (casual chat keeps its own limit)', async () => {
    config.qa.perHour = 1;
    for (const t of ['Wen mint?', "What's eth price now?", 'Degods floor?', 'what is the roadmap?', 'btc price?']) {
      later(LIMITS.userCooldownSec + 1);
      assert.equal((await send(BEEE, 'b-chat', MEMBER, t)).replies.length, 1, t);
    }
    aiText = 'Ha, fair enough.';
    const c1 = await send(BEEE, 'b-chat', MEMBER, `<@${BOT}> you are funny`, { mentions: [BOT] });
    const c2 = await send(BEEE, 'b-chat', MEMBER, `<@${BOT}> you are so funny`, { mentions: [BOT] });
    assert.equal(c1.replies[0].text, 'Ha, fair enough.', 'casual chat still has its QA_PER_HOUR slot');
    assert.match(c2.replies[0].text, /breather/, 'the second casual chat hits QA_PER_HOUR = 1');
    assert.ok(logs.some((l) => /QA_PER_HOUR casual chat limit \(1 \/ 1 this hour for this member\)/.test(l)));
  });
  await test('still silent for humans chatting with each other at home (a reply to a member)', async () => {
    const m = await send(HOME, 'home-chat', MEMBER, 'Wen mint?', { repliedUser: { id: MEMBER2 } });
    assert.equal(m.replies.length, 0);
    assert.ok(logs.some((l) => /unprompted rule "talking to someone else/.test(l)), 'the log says which rule');
  });
  await test('the same message is never answered twice', async () => {
    const m = msg(HOME, 'home-chat', MEMBER, 'Wen mint?');
    await onMessage(m);
    await onMessage(m);
    assert.equal(m.replies.length, 1);
  });

  await test('nothing here writes to the database except the normal points / chat bookkeeping', () => {
    assert.ok(!dbWrites.some((t) => t.startsWith('nft_radar')), 'NFT Radar tables are only read');
  });

  say(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
