// Upgrade phase 3: NFT Radar (discovery, research, fact check, admin approval, no duplicates, nothing invented).
// Run: node tests/nftradar.test.js
// Fully offline: Discord, Supabase, Tavily, Magic Eden and the AI are faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
const A = '200000000000000002'; // customer server in its trial (premium)
const B = '300000000000000003'; // another premium customer server
const FREE = '400000000000000004'; // customer server on the free plan
const REMO = '111111111111111110';
const ADMIN = '222222222222222220';
const MEMBER = '333333333333333330';
const BOT = '999999999999999999';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, TRIAL_DAYS: '15', DEFAULT_DAILY_AI_LIMIT: '50', CONTROL_CHANNEL_ID: 'home-ctl',
  REDEEM_LOGS_CHANNEL_ID: 'home-logs', LOGS_CHANNEL_ID: 'home-logs', NFT_RADAR_CHANNEL_ID: 'home-nft', SOL_RADAR_CHANNEL_ID: '', TAVILY_API_KEY: 'tvly-test', NFT_RADAR_TIMES: '09:00,21:00', TIMEZONE: 'Asia/Dhaka',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { guilds: [], nft_radar_projects: [], nft_radar_reviews: [], nft_radar_runs: [] };
const UNIQUE = { nft_radar_projects: (a, b) => a.project_key === b.project_key, nft_radar_reviews: (a, b) => a.guild_id === b.guild_id && a.project_id === b.project_id, nft_radar_runs: (a, b) => a.slot === b.slot };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
let dbBroken = false; // true = the NFT Radar tables "do not exist"
let nextId = 1;
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
    const q = { op: 'select', f: [], single: false, order: null, limit: null };
    const api = {
      select: () => api,
      order: (k, o = {}) => ((q.order = [k, o.ascending !== false]), api),
      limit: (n) => ((q.limit = n), api),
      eq: (k, v) => (q.f.push((r) => r[k] === v), api),
      gte: (k, v) => (q.f.push((r) => r[k] !== null && r[k] !== undefined && String(r[k]) >= String(v)), api),
      insert: (row) => ((q.op = 'insert'), (q.row = row), api),
      update: (p) => ((q.op = 'update'), (q.p = p), api),
      delete: () => ((q.op = 'delete'), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (table.startsWith('nft_radar') && dbBroken) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
      const rows = (tables[table] ||= []);
      if (q.op === 'insert') {
        const r = { created_at: new Date().toISOString(), ...clone(q.row) };
        if (UNIQUE[table] && rows.some((x) => UNIQUE[table](x, r))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        if (table === 'nft_radar_projects') r.id = nextId++;
        if (table === 'nft_radar_reviews' && !tables.nft_radar_projects.some((p) => p.id === r.project_id)) return { data: null, error: { code: '23503', message: 'foreign key' } };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      let m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'delete') {
        for (const r of m) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      if (q.order) {
        const [k, asc] = q.order;
        m = [...m].sort((x, y) => (String(x[k]) < String(y[k]) ? -1 : String(x[k]) > String(y[k]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (q.limit) m = m.slice(0, q.limit);
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- the fake web
const DAY = 86400000;
const isoDay = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
const words = (d) => new Date(Date.now() + d * DAY).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const calls = { tavily: 0, tavilyQueries: [], tavilyKeys: [], me: 0, ai: 0, aiSystems: [] };
const world = {};
function defaultWorld() {
  return {
    tavilyFail: false,
    aiFail: false,
    me: [],
    // what the discovery searches return
    discovery: [{ title: 'Upcoming Solana NFT mints', url: 'https://nftcalendar.io/solana', content: `Pixel Owls (pixelowls.xyz, @pixelowls) mints on Solana ${words(20)}. Moon Lizards also coming soon.` }],
    // the AI's list of names from those results
    picked: [{ name: 'Pixel Owls', website: 'https://pixelowls.xyz', x: 'pixelowls' }, { name: 'Moon Lizards', website: null, x: null }, { name: 'Invented Apes', website: 'https://inventedapes.io', x: null }],
    // research pages per project
    pages: {
      'pixel owls': [{ title: 'Pixel Owls: 2,222 pixel owls on Solana', url: 'https://pixelowls.xyz', content: `Pixel Owls is a 2,222 piece pixel art NFT collection on Solana. Mint price 0.5 SOL. Mint date: ${words(20)}. Follow @pixelowls on X. Doxxed team, roadmap with staking.` }],
      'moon lizards': [{ title: 'Moon Lizards', url: 'https://someblog.example/moon-lizards', content: 'Moon Lizards: little information, anonymous team, maybe on Solana.' }],
    },
    // the AI's research answer per project
    answers: {
      'pixel owls': { name: 'Pixel Owls', is_solana_nft: true, upcoming: true, mint_date: isoDay(20), supply: 2222, price_sol: 0.5, website: 'https://pixelowls.xyz', x: 'pixelowls', summary: 'A pixel art owl collection on Solana.', reasons: ['Clear pixel art style', 'Team is public', 'Roadmap with staking'], risks: ['New project'], score: 8, suspicious: false },
      'moon lizards': { name: 'Moon Lizards', is_solana_nft: true, upcoming: true, mint_date: null, supply: 5000, price_sol: 2, website: null, x: null, summary: 'Unclear.', reasons: [], risks: ['Anonymous team'], score: 3, suspicious: false },
    },
  };
}
function answerFor(name) {
  return world.answers[String(name || '').toLowerCase()] || { name, is_solana_nft: false, upcoming: false, score: 1, reasons: [], risks: [] };
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.tavily.com/usage')) {
    calls.usage = (calls.usage || 0) + 1;
    if (world.usageFail) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ key: { usage: 12, limit: null }, account: { current_plan: 'Researcher', plan_usage: 37, plan_limit: 1000 } }) };
  }
  if (u.includes('api.tavily.com')) {
    calls.tavily++;
    calls.tavilyKeys.push(opts.headers?.authorization);
    const body = JSON.parse(opts.body);
    calls.tavilyQueries.push(body.query);
    if (world.tavilyFail) return { ok: false, status: 500, json: async () => ({}) };
    const q = body.query.toLowerCase();
    let results;
    if (/upcoming|calendar|mint soon/.test(q) && !q.includes('"')) results = world.discovery;
    else results = Object.entries(world.pages).find(([k]) => q.includes(k) || q.includes(k.replace(/\s/g, '')))?.[1] || [];
    return { ok: true, status: 200, json: async () => ({ results }) };
  }
  if (u.includes('magiceden')) {
    calls.me++;
    return { ok: true, status: 200, json: async () => world.me };
  }
  calls.ai++;
  const body = JSON.parse(opts.body || '{}');
  const system = body.messages?.[0]?.content || '';
  const user = JSON.parse(body.messages?.[1]?.content || '{}');
  calls.aiSystems.push(system.slice(0, 40));
  if (world.aiFail) return { ok: false, status: 500, text: async () => 'down', json: async () => ({}) };
  let answer;
  if (system.includes('list UPCOMING')) answer = { projects: world.picked };
  else {
    const p = user.project || {};
    const key = p.name || Object.keys(world.answers).find((k) => (p.given_website || '').includes(k.replace(/\s/g, '')) || (p.given_x || '').toLowerCase() === k.replace(/\s/g, '')) || '';
    answer = answerFor(key);
  }
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
      if (noWrite.has(id)) throw new Error('Missing Permissions');
      const rec = { id: `s${sent.length + 1}`, ch: id, content: m.content || '', embeds: (m.embeds || []).map((e) => e.toJSON?.() || e), components: (m.components || []).map((c) => c.toJSON?.() || c), allowedMentions: m.allowedMentions };
      sent.push(rec);
      return rec;
    },
  });
}
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };
function slash(guildId, userId, sub, opts = {}, { manage = true } = {}) {
  const it = {
    guildId, guild: { id: guildId, name: 'G' }, client, commandName: 'nftradar', user: { id: userId }, member: { roles: { cache: { has: () => false } } },
    memberPermissions: { has: (p) => manage && p === P.ManageGuild },
    options: { getSubcommand: () => sub, getString: (k) => opts[k] ?? null },
    out: [],
    reply: async (m) => it.out.push(m), deferReply: async () => {}, editReply: async (m) => it.out.push(m),
  };
  return it;
}
// a press of a button under an approval request message
function press(guildId, userId, msg, action, { manage = true } = {}) {
  const projectId = Number(msg.components[0].components[0].custom_id.split(':')[2]);
  const it = {
    guildId, guild: { id: guildId }, client, user: { id: userId }, customId: `nftr:${action}:${projectId}`,
    memberPermissions: { has: (p) => manage && p === P.ManageGuild },
    message: { embeds: msg.embeds },
    replies: [], edits: [], follow: [],
    reply: async (m) => it.replies.push(m), deferUpdate: async () => {}, editReply: async (m) => it.edits.push(m), followUp: async (m) => it.follow.push(m),
  };
  return it;
}
const lastText = (it) => String(it.out.at(-1)?.content || '');

// ---------------------------------------------------------------- load the bot
const guilds = require(src('guilds.js'));
const config = require(src('config.js'));
const plans = require(src('plans.js'));
const cache = require(src('web3/cache.js'));
const research = require(src('web3/research.js'));
const nftRadar = require(src('nftRadar.js'));
const command = require(src('commands/nftradar.js'));

const quiet = { log: console.log };
const errors = [];
Object.assign(console, { log: () => {}, debug: () => {}, warn: (...a) => errors.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')) });
const say = (...a) => quiet.log(...a);
let passed = 0;
let failed = 0;
function reset() {
  sent.length = 0;
  errors.length = 0;
  for (const t of ['nft_radar_projects', 'nft_radar_reviews', 'nft_radar_runs']) tables[t].length = 0;
  Object.assign(calls, { tavily: 0, tavilyQueries: [], tavilyKeys: [], me: 0, ai: 0, aiSystems: [], usage: 0 });
  for (const k of Object.keys(world)) delete world[k];
  Object.assign(world, defaultWorld());
  dbBroken = false;
  noWrite.clear();
  cache.clear();
  research._test.used.count = 0;
  nftRadar._test.reset();
  Object.assign(config.nftRadar, { tavilyKey: 'tvly-test', times: ['09:00', '21:00'], maxNewPerDay: 5, maxSearchesPerDay: 30, maxRequestsPerGuildPerDay: 3, minScore: 6 });
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
const iso = (d) => new Date(Date.now() + d * DAY).toISOString();
const hhmm = (ms, offsetMin) => new Date(ms + offsetMin * 60000).toISOString().slice(11, 16);
const requestsIn = (ch) => sent.filter((m) => m.ch === ch && m.embeds[0]?.title?.startsWith('📡 NFT Radar: approve'));
const postsIn = (ch) => sent.filter((m) => m.ch === ch && m.content.includes('NFT RADAR'));

(async () => {
  tables.guilds.push(
    { guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: {}, ai_calls_today: 0 },
    { guild_id: A, name: 'Moon Cats', status: 'active', boss_user_id: ADMIN, trial_ends_at: iso(14), ai_calls_today: 0, settings: { channels: { logs: 'a-logs', nftRadar: 'a-nft' } } },
    { guild_id: B, name: 'Sun Dogs', status: 'active', boss_user_id: ADMIN, trial_ends_at: iso(14), ai_calls_today: 0, settings: { channels: { logs: 'b-logs', nftRadar: 'b-nft' } } },
    { guild_id: FREE, name: 'Free Frogs', status: 'active', boss_user_id: ADMIN, trial_ends_at: iso(-5), ai_calls_today: 0, settings: { channels: { logs: 'f-logs', nftRadar: 'f-nft' } } }
  );
  for (const [id, g] of [['home-nft', HOME], ['home-logs', HOME], ['a-nft', A], ['a-logs', A], ['b-nft', B], ['b-logs', B], ['f-nft', FREE], ['f-logs', FREE]]) chan(id, g);
  await guilds.load();

  say('== 1. Fact checks (done in code, the AI cannot add numbers) ==');
  await test('numbers, dates and handles are only accepted when they are really written in the text', () => {
    assert.ok(nftRadar.numberInText(2222, 'a 2,222 piece collection'));
    assert.ok(nftRadar.numberInText(2222, 'supply 2222.'));
    assert.ok(nftRadar.numberInText(0.5, 'mint price 0.5 SOL'));
    assert.ok(!nftRadar.numberInText(5000, 'a 2,222 piece collection'));
    assert.ok(!nftRadar.numberInText(2, 'price 0.25 SOL'), '2 is not the same as 0.25');
    assert.ok(nftRadar.dateInText('2026-12-03', 'Mint date: December 3, 2026'));
    assert.ok(nftRadar.dateInText('2026-12-03', 'minting on 3rd Dec'));
    assert.ok(!nftRadar.dateInText('2026-12-03', 'Mint date: December 13, 2026'));
    assert.equal(nftRadar.xHandle('https://x.com/pixelowls/status/1'), 'pixelowls');
    assert.equal(nftRadar.xHandle('@pixelowls'), 'pixelowls');
    assert.equal(nftRadar.xHandle('https://x.com/solana'), '', 'a generic account is not a project');
    assert.equal(nftRadar.slug('Pixel Owls NFT'), 'pixelowls');
  });

  await test('the research answer: facts not in the sources become "Not announced"; links not in the sources are dropped', () => {
    const sources = [{ url: 'https://news.example/a', title: 'Shadow Cats', content: 'Shadow Cats, a Solana NFT collection. Website shadowcats.io. Supply 3,333.' }];
    const corpus = 'Shadow Cats\nhttps://news.example/a\nShadow Cats, a Solana NFT collection. Website shadowcats.io. Supply 3,333.';
    const r = nftRadar.check({ name: 'Shadow Cats', source: 'web' }, { name: 'Shadow Cats', is_solana_nft: true, upcoming: true, mint_date: isoDay(10), supply: 3333, price_sol: 1.2, website: 'https://shadowcats.io', x: 'madeuphandle', score: 7, reasons: ['Clear theme'], risks: [] }, sources, corpus);
    assert.equal(r.status, 'selected');
    assert.equal(r.data.supply, 3333, 'the supply is in the sources');
    assert.equal(r.data.priceSol, null, 'the price is NOT in the sources');
    assert.equal(r.data.mintAt, null, 'the date is NOT in the sources');
    assert.equal(r.data.website, 'https://shadowcats.io');
    assert.equal(r.data.x, '', 'an X handle that is not in the sources is dropped');
    assert.ok(r.data.risks.includes('Mint price not announced') && r.data.risks.includes('Mint date not announced'));
    const post = nftRadar.buildPost(r.data);
    assert.ok(post.includes('**Mint Price:** Not announced') && post.includes('**Mint:** Not announced') && post.includes('**Supply:** 3,333'));
  });

  await test('filtered out: suspicious, fake-brand link, not Solana, mint over, no official link, low score', () => {
    const src1 = [{ url: 'https://u.example', title: 't', content: 'phantom-wallet-claim.app Solana NFT' }];
    const corpus = 'phantom-wallet-claim.app solana nft news.example';
    const base = { name: 'X Proj', is_solana_nft: true, upcoming: true, score: 8, website: null, x: null, reasons: [], risks: [] };
    const drop = (j, c = {}) => nftRadar.check({ name: 'X Proj', source: 'web', ...c }, { ...base, ...j }, src1, corpus);
    assert.match(drop({ suspicious: true, suspicious_reason: 'connect wallet to claim' }).dropReason, /suspicious/);
    assert.match(drop({ website: 'https://phantom-wallet-claim.app' }).dropReason, /unsafe link/);
    assert.match(drop({ is_solana_nft: false, website: 'https://phantom-wallet-claim.app' }).dropReason, /unsafe|Solana/);
    assert.match(drop({ is_solana_nft: false }).dropReason, /Solana/);
    assert.match(drop({}).dropReason, /no official link/);
    const late = nftRadar.check({ name: 'Old', source: 'magiceden', trusted: { mintAt: iso(-3), mintHasTime: true, magicEden: 'https://magiceden.io/launchpad/old' } }, base, src1, corpus);
    assert.match(late.dropReason, /passed/);
    const weak = nftRadar.check({ name: 'Weak', source: 'magiceden', trusted: { mintAt: iso(5), mintHasTime: true, magicEden: 'https://magiceden.io/launchpad/weak' } }, { ...base, score: 4 }, src1, corpus);
    assert.match(weak.dropReason, /score 4\/10/);
    // added by an admin: shown anyway (with the risks), unless unsafe
    const mine = nftRadar.check({ name: 'Weak', source: 'admin', website: 'https://weakproj.io' }, { ...base, score: 2, is_solana_nft: false }, src1, corpus);
    assert.equal(mine.status, 'selected');
    assert.ok(mine.data.risks[0].includes('Not clearly a Solana NFT'));
  });

  say('== 2. Missing key / missing tables ==');
  await test('no TAVILY_API_KEY: NFT Radar is off with a clear reason, the timer does not start, nothing is searched', async () => {
    config.nftRadar.tavilyKey = '';
    assert.equal(research.available(), false);
    assert.match(nftRadar.blocker(A), /TAVILY_API_KEY/);
    assert.equal(nftRadar.startTimer(client), false);
    assert.ok(errors.some((e) => e.includes('TAVILY_API_KEY is not set')));
    await assert.rejects(research.search('x'), (e) => e.code === 'NO_KEY');
    await nftRadar.tick(client);
    assert.equal(calls.tavily + calls.ai + calls.me, 0);
    const it = slash(A, ADMIN, 'add', { project: 'https://pixelowls.xyz' });
    await command.execute(it);
    assert.match(lastText(it), /TAVILY_API_KEY/);
  });

  await test('the tables are missing (SQL not run yet): no request is sent, the log says to run migration_radar.sql', async () => {
    dbBroken = true;
    const out = await nftRadar.run(client);
    assert.ok(out.error);
    assert.equal(sent.length, 0);
    assert.ok(errors.some((e) => e.includes('migration_radar.sql')));
    const it = slash(A, ADMIN, 'add', { project: 'https://pixelowls.xyz' });
    await command.execute(it);
    assert.match(lastText(it), /migration_radar\.sql/);
  });

  say('== 3. The scheduled search and the approval requests ==');
  await test('a due time: one search run; only good projects become approval requests in each premium server\'s logs; nothing is posted publicly', async () => {
    const now = Date.now();
    config.nftRadar.times = [hhmm(now, -10)];
    await nftRadar.tick(client, now);
    // Pixel Owls passes; Moon Lizards (score 3, no link) and Invented Apes (name not in the results) do not
    const projects = tables.nft_radar_projects;
    assert.ok(projects.find((p) => p.name === 'Pixel Owls' && p.status === 'selected'));
    assert.ok(projects.find((p) => p.name === 'Moon Lizards' && p.status === 'dropped'));
    assert.ok(!projects.find((p) => p.name === 'Invented Apes'), 'a name the AI made up is never researched');
    for (const ch of ['home-logs', 'a-logs', 'b-logs']) assert.equal(requestsIn(ch).length, 1, `one request in ${ch}`);
    assert.equal(requestsIn('f-logs').length, 0, 'the free server gets nothing');
    assert.equal(sent.filter((m) => m.content.includes('NFT RADAR')).length, 0, 'nothing public without approval');
    const req = requestsIn('a-logs')[0];
    const fields = Object.fromEntries(req.embeds[0].fields.map((f) => [f.name, f.value]));
    assert.equal(fields.Supply, '2,222');
    assert.equal(fields['Mint price'], '0.5 SOL');
    assert.ok(fields['Official links'].includes('https://pixelowls.xyz') && fields['Official links'].includes('https://x.com/pixelowls'));
    assert.ok(fields['Why Vexo selected it'].includes('Clear pixel art style'));
    assert.ok(fields['Risk indicators'] && fields.Score === '8/10');
    assert.deepEqual(req.components[0].components.map((b) => b.label), ['Approve', 'Reject']);
    assert.deepEqual(req.allowedMentions, { parse: [] });
    assert.ok(calls.tavilyKeys.every((k) => k === 'Bearer tvly-test'), 'the key is only sent to Tavily');
  });

  await test('more ticks, a restart or a second process never repeat the run (no extra searches, no second request)', async () => {
    const now = Date.now();
    config.nftRadar.times = [hhmm(now, -10)];
    await nftRadar.tick(client, now);
    const searches = calls.tavily;
    const requests = sent.length;
    await nftRadar.tick(client, now + 60000);
    nftRadar._test.reset(); // a restart forgets everything in memory
    await nftRadar.tick(client, now + 120000);
    assert.equal(calls.tavily, searches);
    assert.equal(sent.length, requests);
    assert.equal(tables.nft_radar_runs.length, 1);
    // a later run finds the same project again: it is not researched or sent again
    nftRadar._test.reset();
    await nftRadar.run(client);
    assert.equal(tables.nft_radar_projects.filter((p) => p.name === 'Pixel Owls').length, 1);
    assert.equal(requestsIn('a-logs').length, 1);
  });

  await test('after sleeping more than 3 hours past the time, the run is skipped; nobody uses NFT Radar = no searches at all', async () => {
    const now = Date.now();
    config.nftRadar.times = [hhmm(now, -200)];
    await nftRadar.tick(client, now);
    assert.equal(calls.tavily, 0);
    config.nftRadar.times = [hhmm(now, -10)];
    for (const id of [HOME, A, B]) await nftRadar.saveSettings(id, { enabled: false });
    await nftRadar.tick(client, now);
    assert.equal(calls.tavily + calls.ai, 0);
    assert.equal(tables.nft_radar_runs.length, 0);
    for (const id of [HOME, A, B]) await nftRadar.saveSettings(id, { enabled: true });
  });

  await test('Magic Eden launchpad: only Solana projects whose launch is ahead; its date, supply and price are used', async () => {
    world.discovery = [];
    world.me = [
      { name: 'Star Foxes', symbol: 'star_foxes', chainId: 'solana', launchDatetime: iso(7), price: 1.5, size: 3333, description: 'Foxes in space, hand drawn.' },
      { name: 'Old Drop', symbol: 'old_drop', chainId: 'solana', launchDatetime: iso(-30), price: 1, size: 100 },
      { name: 'Eth Thing', symbol: 'eth_thing', chainId: '1', launchDatetime: iso(5), price: 0.1, size: 100 },
    ];
    world.answers['star foxes'] = { name: 'Star Foxes', is_solana_nft: true, upcoming: true, mint_date: null, supply: null, price_sol: null, summary: 'Hand drawn foxes.', reasons: ['Hand drawn art'], risks: [], score: 7 };
    const out = await nftRadar.run(client);
    assert.equal(out.selected, 1);
    const p = tables.nft_radar_projects.find((x) => x.name === 'Star Foxes');
    assert.equal(p.data.supply, 3333);
    assert.equal(p.data.priceSol, 1.5);
    assert.ok(p.data.mintHasTime && p.data.magicEden.includes('star_foxes'));
    assert.ok(!tables.nft_radar_projects.find((x) => x.name === 'Old Drop' || x.name === 'Eth Thing'));
  });

  await test('daily limits: at most 3 requests per server per day (the rest come the next day), at most 5 new projects researched per day', async () => {
    world.discovery = [];
    world.me = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((n, i) => ({ name: `${n} Club`, symbol: n.toLowerCase(), chainId: 'solana', launchDatetime: iso(10 + i), price: 1, size: 1000, description: `${n} Club art` }));
    for (const n of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']) world.answers[`${n.toLowerCase()} club`] = { name: `${n} Club`, is_solana_nft: true, upcoming: true, reasons: ['Art'], risks: [], score: 7 };
    const out = await nftRadar.run(client);
    assert.equal(out.researched, 5, 'only 5 researched today');
    assert.equal(requestsIn('a-logs').length, 3);
    assert.equal(requestsIn('b-logs').length, 3);
    // the next day: the remaining 2 are sent, nothing twice
    for (const r of tables.nft_radar_reviews) r.created_at = iso(-1);
    await nftRadar.distribute(client, (await fakeDb.from('nft_radar_projects').select('*').order('created_at', { ascending: false })).data);
    assert.equal(requestsIn('a-logs').length, 5);
    const ids = tables.nft_radar_reviews.filter((r) => r.guild_id === A).map((r) => r.project_id);
    assert.equal(new Set(ids).size, ids.length);
  });

  await test('daily web search stop: when the limit is reached, no more searches are sent', async () => {
    config.nftRadar.maxSearchesPerDay = 2;
    await nftRadar.run(client);
    assert.equal(calls.tavily, 2);
    assert.ok(errors.some((e) => e.includes('daily web search limit')));
  });

  say('== 4. Approve / Reject ==');
  await test('Approve: only admins; the post goes to THAT server\'s NFT Radar channel in the spec format; the second press does nothing', async () => {
    const now = Date.now();
    config.nftRadar.times = [hhmm(now, -10)];
    await nftRadar.tick(client, now);
    const req = requestsIn('a-logs')[0];
    const member = press(A, MEMBER, req, 'approve', { manage: false });
    await nftRadar.handleButton(member);
    assert.match(String(member.replies[0].content), /Only admins/);
    assert.equal(postsIn('a-nft').length, 0);

    const admin = press(A, ADMIN, req, 'approve');
    await nftRadar.handleButton(admin);
    const posts = postsIn('a-nft');
    assert.equal(posts.length, 1);
    const t = posts[0].content;
    for (const line of ['📡 **NFT RADAR**', '**Project:** Pixel Owls', '**Supply:** 2,222', '**Mint Price:** 0.5 SOL', "**Why it caught Vexo's attention:**", '• Clear pixel art style', '**Official:** [Website](https://pixelowls.xyz) · [X](https://x.com/pixelowls)', nftRadar.DISCLAIMER]) assert.ok(t.includes(line), `post has: ${line}`);
    assert.deepEqual(posts[0].allowedMentions, { parse: [] });
    const decision = admin.edits[0].embeds[0].toJSON().fields.find((f) => f.name === 'Decision').value;
    assert.match(decision, /Approved by/);
    assert.ok(admin.edits[0].components[0].toJSON().components.every((b) => b.disabled));
    assert.equal(tables.nft_radar_reviews.find((r) => r.guild_id === A).status, 'approved');

    const again = press(A, REMO, req, 'approve');
    await nftRadar.handleButton(again);
    assert.match(String(again.follow[0].content), /already handled: \*\*approved\*\*/);
    assert.equal(postsIn('a-nft').length, 1, 'posted once');
    assert.equal(postsIn('b-nft').length + postsIn('home-nft').length, 0, 'other servers decide for themselves');
  });

  await test('Reject: nothing is posted; the boss of the server may also decide; a request of another server cannot be decided here', async () => {
    const now = Date.now();
    config.nftRadar.times = [hhmm(now, -10)];
    await nftRadar.tick(client, now);
    const reqB = requestsIn('b-logs')[0];
    const boss = press(B, ADMIN, reqB, 'reject', { manage: false }); // ADMIN is the boss of B
    await nftRadar.handleButton(boss);
    assert.match(boss.edits[0].embeds[0].toJSON().fields.find((f) => f.name === 'Decision').value, /Rejected/);
    assert.equal(postsIn('b-nft').length, 0);
    assert.equal(tables.nft_radar_reviews.find((r) => r.guild_id === B).status, 'rejected');
    // FREE never got this project: pressing a copied button there does nothing
    const other = press(FREE, ADMIN, reqB, 'approve');
    await nftRadar.handleButton(other);
    assert.match(String(other.follow[0]?.content || ''), /not for this server|plan/);
    assert.equal(postsIn('f-nft').length, 0);
  });

  await test('the bot cannot write in the NFT Radar channel: not posted, the request stays open, the admin is told', async () => {
    const now = Date.now();
    config.nftRadar.times = [hhmm(now, -10)];
    await nftRadar.tick(client, now);
    noWrite.add('a-nft');
    const it = press(A, ADMIN, requestsIn('a-logs')[0], 'approve');
    await nftRadar.handleButton(it);
    assert.match(String(it.follow[0].content), /Not posted.*still open/s);
    assert.equal(tables.nft_radar_reviews.find((r) => r.guild_id === A).status, 'pending');
    noWrite.delete('a-nft');
    const retry = press(A, ADMIN, requestsIn('a-logs')[0], 'approve');
    await nftRadar.handleButton(retry);
    assert.equal(postsIn('a-nft').length, 1);
  });

  await test('the mint date passed before anyone pressed Approve: nothing is posted', async () => {
    const now = Date.now();
    config.nftRadar.times = [hhmm(now, -10)];
    await nftRadar.tick(client, now);
    const p = tables.nft_radar_projects.find((x) => x.name === 'Pixel Owls');
    p.data.mintAt = iso(-3);
    const it = press(A, ADMIN, requestsIn('a-logs')[0], 'approve');
    await nftRadar.handleButton(it);
    assert.equal(postsIn('a-nft').length, 0);
    assert.equal(tables.nft_radar_reviews.find((r) => r.guild_id === A).status, 'expired');
  });

  say('== 5. /nftradar ==');
  await test('add: an admin\'s link is researched and goes to THAT server only; adding it again does not repeat it; another server reuses the research', async () => {
    const it = slash(A, ADMIN, 'add', { project: 'https://pixelowls.xyz' });
    await command.execute(it);
    assert.match(lastText(it), /Researched \*\*Pixel Owls\*\*.*a-logs/s);
    assert.equal(requestsIn('a-logs').length, 1);
    assert.equal(requestsIn('b-logs').length + requestsIn('home-logs').length, 0);
    const searches = calls.tavily;
    const again = slash(A, ADMIN, 'add', { project: 'Pixel Owls' });
    await command.execute(again);
    assert.match(lastText(again), /already sent to this server/);
    const fromB = slash(B, ADMIN, 'add', { project: 'pixelowls.xyz' });
    await command.execute(fromB);
    assert.match(lastText(fromB), /b-logs/);
    assert.equal(calls.tavily, searches, 'no new web search for a project that was already researched');
    assert.equal(tables.nft_radar_projects.length, 1);
    // the next scheduled run does not offer an admin-added project to other servers
    await nftRadar.distribute(client, tables.nft_radar_projects.map(clone));
    assert.equal(requestsIn('home-logs').length, 0);
  });

  await test('add: a fake-brand or shortened link is refused before any search; nothing found = said plainly', async () => {
    const bad = slash(A, ADMIN, 'add', { project: 'https://phantom-wallet-mint.app' });
    await command.execute(bad);
    assert.match(lastText(bad), /will not research/);
    const short = slash(A, ADMIN, 'add', { project: 'https://bit.ly/abc' });
    await command.execute(short);
    assert.match(lastText(short), /will not research/);
    assert.equal(calls.tavily, 0);
    const none = slash(A, ADMIN, 'add', { project: 'Totally Unknown Thing' });
    await command.execute(none);
    assert.match(lastText(none), /found nothing/);
    assert.equal(sent.length, 0);
  });

  await test('status: last run, projects found, pending approvals and the Tavily credits used this month', async () => {
    const now = Date.now();
    config.nftRadar.times = [hhmm(now, -10)];
    await nftRadar.tick(client, now);
    const it = slash(A, ADMIN, 'status');
    await command.execute(it);
    const t = lastText(it);
    assert.match(t, /NFT Radar is ON/);
    assert.match(t, /Automatic runs: every day at `09:00`|Automatic runs: every day at `\d\d:\d\d`/);
    assert.match(t, /Last run: <t:\d+:R>, new candidates found: \*\*2\*\*/);
    assert.match(t, /Projects researched so far: \*\*2\*\* \(good enough: 1, filtered out: 1\)/);
    assert.match(t, /Waiting for approval in this server: \*\*1\*\*/);
    assert.match(t, /\*\*37\*\* of 1000 this month \(Researcher plan\)/);
    assert.match(t, /Approval requests go to: <#a-logs>/);
    world.usageFail = true;
    const it2 = slash(A, ADMIN, 'status');
    await command.execute(it2);
    assert.match(lastText(it2), /not available from Tavily right now \(searches since the bot started: \d+\)/);
  });

  await test('pending lists this server\'s open requests with a link; preview shows the post privately and posts nothing', async () => {
    const empty = slash(A, ADMIN, 'pending');
    await command.execute(empty);
    assert.match(lastText(empty), /No projects are waiting/);
    const ex = slash(A, ADMIN, 'preview');
    await command.execute(ex);
    assert.match(lastText(ex), /made-up example/);
    assert.ok(lastText(ex).includes('📡 **NFT RADAR**') && lastText(ex).includes(nftRadar.DISCLAIMER));
    const now = Date.now();
    config.nftRadar.times = [hhmm(now, -10)];
    await nftRadar.tick(client, now);
    const before = sent.length;
    const pend = slash(A, ADMIN, 'pending');
    await command.execute(pend);
    assert.match(lastText(pend), /1\. \*\*Pixel Owls\*\*.*score 8\/10.*\[open request\]\(https:\/\/discord\.com\/channels\/200000000000000002\/a-logs\/s\d+\)/);
    const pv = slash(A, ADMIN, 'preview');
    await command.execute(pv);
    assert.match(lastText(pv), /how \*\*Pixel Owls\*\* would look/);
    assert.ok(lastText(pv).includes('**Supply:** 2,222'));
    assert.equal(sent.length, before, 'preview and pending post nothing');
    // after a decision it is no longer pending
    await nftRadar.handleButton(press(A, ADMIN, requestsIn('a-logs')[0], 'reject'));
    const pend2 = slash(A, ADMIN, 'pending');
    await command.execute(pend2);
    assert.match(lastText(pend2), /No projects are waiting/);
  });

  await test('run: the bot owner can start a run any time (for testing); admins at most once per 6 hours', async () => {
    const a1 = slash(A, ADMIN, 'run');
    await command.execute(a1);
    assert.match(lastText(a1), /Run finished/);
    const a2 = slash(B, ADMIN, 'run');
    await command.execute(a2);
    assert.match(lastText(a2), /already happened/);
    const owner = slash(A, REMO, 'run');
    await command.execute(owner);
    assert.match(lastText(owner), /Run finished/);
  });

  await test('admins only; free server locked; status, on / off; run at most once per 6 hours for all servers', async () => {
    const member = slash(A, MEMBER, 'status', {}, { manage: false });
    await command.execute(member);
    assert.match(String(member.out[0].content), /Only admins/);
    const free = slash(FREE, ADMIN, 'add', { project: 'pixelowls.xyz' });
    await command.execute(free);
    assert.match(lastText(free), /premium/);
    const st = slash(A, ADMIN, 'status');
    await command.execute(st);
    assert.match(lastText(st), /NFT Radar is ON/);
    await command.execute(slash(A, ADMIN, 'off'));
    assert.match(nftRadar.blocker(A), /switched off/);
    await command.execute(slash(A, ADMIN, 'on'));
    assert.equal(nftRadar.blocker(A), '');
    const s1 = slash(A, ADMIN, 'run');
    await command.execute(s1);
    assert.match(lastText(s1), /Run finished\. New candidates/);
    const s2 = slash(B, ADMIN, 'run');
    await command.execute(s2);
    assert.match(lastText(s2), /already happened/);
  });

  await test('feature map: nftRadar is premium; /help and /status still build', async () => {
    assert.equal(config.features.nftRadar, 'premium');
    assert.equal(plans.hasFeature(FREE, 'nftRadar'), false);
    assert.equal(plans.hasFeature(A, 'nftRadar'), true);
    assert.equal(plans.componentFeature('nftr:approve:1'), 'nftRadar');
    assert.equal(plans.COMMAND_FEATURES.nftradar, 'nftRadar');
    for (const [name, guildId] of [['help', A], ['status', A], ['help', FREE], ['status', FREE]]) {
      const cmd = require(src(`commands/${name}.js`));
      const it = slash(guildId, ADMIN, null);
      it.commandName = name;
      it.memberPermissions = { has: () => true };
      await cmd.execute(it);
      const out = JSON.stringify(it.out);
      assert.ok(out.length > 50, `${name} answered`);
      if (name === 'help') assert.ok(out.includes('/nftradar status|pending|preview|run|add|on|off'));
    }
  });

  quiet.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
