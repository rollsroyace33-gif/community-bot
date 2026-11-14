// Multi-server test: data separation, plans (free / trial / paid), the feature lock, per-server boss and
// personality, zero AI calls in free servers, auto mod, and knowledge sources.
// Run: node tests/multiserver.test.js
// Fully offline: Discord, Supabase and the AI are faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
const OTHER = '200000000000000002'; // premium (trial) server
const FREE = '300000000000000003'; // free server (trial over)
const REMO = '111111111111111110'; // boss of HOME
const ADMIN_B = '222222222222222220'; // boss of OTHER
const MEMBER = '333333333333333330';
const BOT = '999999999999999999';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, STAFF_ROLE_IDS: '', TRIAL_DAYS: '15', DEFAULT_DAILY_AI_LIMIT: '3',
  SUPPORT_CONTACT: 'Contact remo.sol to pay.', CONTROL_CHANNEL_ID: 'home-ctl', GENERAL_CHANNEL_ID: 'home-general', ASK_CHANNEL_ID: '',
  MARKETPLACE_CHANNEL_ID: 'home-shop', RUMBLE_CHANNEL_ID: '444444444444444444', VERIFIED_ROLE_ID: 'home-verified', TICKET_CHANNEL_ID: 'home-tickets',
  X_DROP_CHANNEL_ID: '', QA_PER_HOUR: '1000', MIN_ACCOUNT_AGE_DAYS: '0', MIN_MESSAGE_LENGTH: '8', MIN_SECONDS_BETWEEN_MESSAGES: '0',
  EXCLUDED_CHANNEL_IDS: '', MESSAGES_PER_POINT: '2', TIMEZONE: 'Asia/Dhaka', ADMIN_ROLE_ID: '', CHAT_CHANNEL_IDS: '', REDEEM_LOGS_CHANNEL_ID: '', RECEIPT_CHANNEL_ID: '', BOSS_OFFLINE_START: '00:00', BOSS_OFFLINE_END: '00:00',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase (real filtering on every column)
const tables = { guilds: [], users: [], point_log: [], items: [], purchases: [], bot_settings: [], scheduled_tasks: [], vexo_knowledge: [], vexo_unanswered: [], messages_log: [], daily_stats: [], daily_runs: [] };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const rpcLog = [];
const fakeDb = {
  async rpc(name, a) {
    rpcLog.push({ name, ...a });
    if (name === 'adjust_points') {
      let u = tables.users.find((r) => r.guild_id === a.p_guild && r.user_id === a.p_user);
      if (!u) tables.users.push((u = { guild_id: a.p_guild, user_id: a.p_user, points: 0 }));
      u.points = Math.max(0, u.points + a.p_amount);
      tables.point_log.push({ id: tables.point_log.length + 1, guild_id: a.p_guild, user_id: a.p_user, amount: a.p_amount, reason: a.p_reason });
      return { data: u.points, error: null };
    }
    if (name === 'count_ai_call') {
      const g = tables.guilds.find((r) => r.guild_id === a.p_guild);
      if (!g) return { data: -1, error: null };
      if (g.ai_calls_day !== a.p_day) Object.assign(g, { ai_calls_day: a.p_day, ai_calls_today: 0 });
      if (a.p_limit > 0 && g.ai_calls_today >= a.p_limit) return { data: -1, error: null };
      g.ai_calls_today += 1;
      return { data: g.ai_calls_today, error: null };
    }
    if (name === 'redeem_item') {
      const item = tables.items.find((i) => i.id === a.p_item && i.guild_id === a.p_guild);
      if (!item || !item.active) return { data: { ok: false, message: 'Item not found.' }, error: null };
      const u = tables.users.find((r) => r.guild_id === a.p_guild && r.user_id === a.p_user) || { points: 0 };
      if (u.points < item.price) return { data: { ok: false, message: 'not enough' }, error: null };
      u.points -= item.price;
      item.stock -= 1;
      const p = { id: tables.purchases.length + 1, guild_id: a.p_guild, user_id: a.p_user, item_id: item.id, item_name: item.name, item_type: item.type, price: item.price, status: 'pending', ticket_channel_id: null };
      tables.purchases.push(p);
      return { data: { ok: true, purchase_id: p.id, item_id: item.id, item_name: item.name, item_type: item.type, role_id: null, price: item.price, stock: item.stock }, error: null };
    }
    return { data: 0, error: null };
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
      if (q.op === 'insert') {
        const r = { id: rows.length + 1, active: true, settings: {}, state: {}, ai_calls_today: 0, ticket_instructions: 'Please open a ticket to claim your prize.', ...clone(q.row) };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      if (q.op === 'upsert') {
        const i = rows.findIndex((r) => r.guild_id === q.row.guild_id && r.key === q.row.key);
        if (i >= 0) rows[i] = { ...q.row };
        else rows.push({ ...q.row });
        return { data: null, error: null };
      }
      const m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- fake AI (counts calls, records prompts)
const aiCalls = [];
let aiText = 'Sure thing.';
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  aiCalls.push({ system: body.messages[0].content, user: body.messages[1].content });
  const content = body.response_format ? '{"intent":"small_talk","reply":"Hi boss."}' : aiText;
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }), text: async () => '' };
};

// ---------------------------------------------------------------- fake Discord
const { PermissionFlagsBits } = require('discord.js');
const sent = []; // { ch, content }
const deleted = [];
const timeouts = [];
function channel(id, guildId) {
  return {
    id, guildId, name: id, type: 0, isTextBased: () => true, sendTyping: async () => {},
    send: async (m) => {
      const rec = { ch: id, content: typeof m === 'string' ? m : m.content || '', embeds: (m.embeds || []).map((e) => e.toJSON?.() || e) };
      sent.push(rec);
      return { id: `s${sent.length}`, delete: async () => {}, edit: async () => {} };
    },
    messages: { fetch: async () => new Map() },
  };
}
const channels = {};
const chan = (id, g) => (channels[id] ||= channel(id, g));
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };
let seq = 0;
function msg(guildId, channelId, authorId, content, { perms = [], mentions = [], bot = false } = {}) {
  const replies = [];
  const m = {
    id: `m${++seq}`, guildId, guild: { id: guildId }, channelId, channel: chan(channelId, guildId), client, content,
    author: { id: authorId, bot, username: `u${authorId.slice(0, 3)}`, tag: `u${authorId.slice(0, 3)}#0`, createdTimestamp: 0 },
    member: { displayName: 'member', roles: { cache: { has: () => false, some: () => false } }, permissions: { has: (p) => perms.includes(p) }, timeout: async (ms, why) => timeouts.push({ authorId, ms, why }) },
    mentions: { users: new Map(mentions.map((id) => [id, {}])), roles: new Map(), repliedUser: null, everyone: false, channels: { first: () => undefined } },
    embeds: [], replies,
    reply: async (r) => (replies.push(typeof r === 'string' ? r : r.content), { id: 'r' }),
    react: async () => {},
    delete: async () => deleted.push(m.id),
  };
  return m;
}
function slash(guildId, userId, name, { sub = null, opts = {}, perms = [] } = {}) {
  const it = {
    guildId, guild: { id: guildId, name: 'G' }, commandName: name, client, user: { id: userId, tag: 'u#0', username: 'u' },
    member: { roles: { cache: { has: () => false, some: () => false } }, displayName: 'u' },
    memberPermissions: { has: (p) => perms.includes(p) },
    inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => true, isButton: () => false, isStringSelectMenu: () => false,
    options: { getSubcommand: () => sub, getInteger: (n) => opts[n] ?? null, getString: (n) => opts[n] ?? null, getBoolean: (n) => opts[n] ?? null, getUser: (n) => opts[n] ?? null },
    replies: [], deferred: false, replied: false,
    reply: async (m) => ((it.replied = true), it.replies.push(m)),
    deferReply: async () => (it.deferred = true),
    editReply: async (m) => it.replies.push(m),
    followUp: async (m) => it.replies.push(m),
  };
  return it;
}
const text = (m) => (typeof m === 'string' ? m : m?.content || JSON.stringify(m?.embeds?.map((e) => e.toJSON?.() || e) || ''));
const last = (it) => text(it.replies.at(-1));

// ---------------------------------------------------------------- load the bot
const config = require(src('config.js'));
const guilds = require(src('guilds.js'));
const plans = require(src('plans.js'));
const points = require(src('points.js'));
const identity = require(src('identity.js'));
const personality = require(src('personality.js'));
const ai = require(src('ai.js'));
const knowledge = require(src('knowledge.js'));
const store = require(src('tasks/store.js'));
const control = require(src('tasks/control.js'));
const automod = require(src('automod.js'));
const learn = require(src('learn.js'));
const expiry = require(src('jobs/expiry.js'));
const onMessage = require(src('events/messageCreate.js'));
const onInteraction = require(src('events/interactionCreate.js'));
const fs = require('fs');
const path = require('path');
client.commands = new Map(fs.readdirSync(path.join(__dirname, '..', 'src', 'commands')).map((f) => {
  const c = require(src(`commands/${f}`));
  return [c.data.name, c];
}));

const DAY = 86400000;
const iso = (days) => new Date(Date.now() + days * DAY).toISOString();
const quiet = { log: console.log, debug: console.debug, warn: console.warn, error: console.error };
Object.assign(console, { log: () => {}, debug: () => {}, warn: () => {} });
const say = (...a) => quiet.log(...a);

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    say(`PASS  ${name}`);
  } catch (err) {
    failed++;
    say(`FAIL  ${name}\n      ${err.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

(async () => {
  // rows: HOME (as the migration creates it), OTHER in trial, FREE with an ended trial
  tables.guilds.push(
    { guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: {}, ai_calls_today: 0, ticket_instructions: 'Please open a ticket to claim your prize.' },
    { guild_id: OTHER, name: 'Moon Cats', status: 'active', boss_user_id: ADMIN_B, trial_started_at: iso(-1), trial_ends_at: iso(14), ai_calls_today: 0, ticket_instructions: 'DM a mod to claim.', settings: { channels: { control: 'b-ctl', marketplace: 'b-shop', rumble: '555555555555555555', logs: 'b-logs' }, knowledgeSources: ['b-news'] } },
    { guild_id: FREE, name: 'Free Frogs', status: 'active', boss_user_id: MEMBER, trial_started_at: iso(-20), trial_ends_at: iso(-5), ai_calls_today: 0, ticket_instructions: 'Please open a ticket to claim your prize.', settings: { channels: { control: 'f-ctl', rumble: '666666666666666666', logs: 'f-logs' } } }
  );
  for (const [id, g] of [['home-ctl', HOME], ['home-general', HOME], ['b-ctl', OTHER], ['b-logs', OTHER], ['b-chat', OTHER], ['b-news', OTHER], ['f-ctl', FREE], ['f-chat', FREE], ['555555555555555555', OTHER], ['666666666666666666', FREE]]) chan(id, g);
  await guilds.load();

  say('== 1. Settings per server ==');
  await test('HΛVØCZ reads its channels, boss and roles from .env; other servers from their row', () => {
    const h = guilds.settings(HOME);
    assert.deepEqual([h.isHome, h.channels.control, h.channels.general, h.bossUserId, h.verifiedRoleId, h.ticketInstructions], [true, 'home-ctl', 'home-general', REMO, 'home-verified', null]);
    const o = guilds.settings(OTHER);
    assert.deepEqual([o.isHome, o.channels.control, o.channels.general, o.bossUserId, o.verifiedRoleId, o.ticketInstructions], [false, 'b-ctl', '555555555555555555', ADMIN_B, '', 'DM a mod to claim.']);
    assert.equal(guilds.settings(undefined).guildId, HOME); // no server given = the home server
  });
  await test('the boss of one server is a regular member everywhere else', () => {
    assert.equal(identity.isBoss(REMO, HOME), true);
    assert.equal(identity.isBoss(REMO, OTHER), false);
    assert.equal(identity.isBoss(ADMIN_B, OTHER), true);
    assert.equal(identity.isBoss(ADMIN_B, HOME), false);
  });

  say('== 2. Plans ==');
  await test('HΛVØCZ has everything; trial unlocks all; a free server keeps only the free games', () => {
    for (const f of Object.keys(config.features)) assert.equal(plans.hasFeature(HOME, f), true, f);
    for (const f of Object.keys(config.features)) assert.equal(plans.hasFeature(OTHER, f), true, f);
    assert.deepEqual(plans.featureList(FREE), { rumble: true, numberGuess: true, aiChat: false, knowledgeQa: false, automod: false, points: false, marketplace: false, giveaway: true, giveaway_orders: false, solRadar: false, nftRadar: false });
    assert.equal(plans.plan(OTHER).kind, 'trial');
    assert.equal(plans.plan(OTHER).daysLeft, 14);
    assert.equal(plans.hasFeature('404404404404404404', 'rumble'), false); // a server without a row: nothing
  });
  await test('one trial per server: leaving and joining again keeps the old (ended) trial', async () => {
    await guilds.leave(FREE);
    assert.equal(guilds.get(FREE).status, 'left');
    assert.equal(tables.guilds.filter((g) => g.guild_id === FREE).length, 1); // row kept
    const { created, row } = await guilds.join({ id: FREE, name: 'Free Frogs', ownerId: MEMBER });
    assert.equal(created, false);
    assert.equal(row.status, 'active');
    assert.equal(plans.plan(FREE).kind, 'free');
    const fresh = await guilds.join({ id: '777777777777777777', name: 'New', ownerId: MEMBER });
    assert.equal(fresh.created, true);
    assert.equal(plans.plan('777777777777777777').kind, 'trial');
    assert.equal(plans.plan('777777777777777777').daysLeft, 15);
    assert.equal(guilds.get('777777777777777777').boss_user_id, MEMBER);
  });
  await test('/admin: owner only, home server only; activate / deactivate / extendtrial / list', async () => {
    const admin = client.commands.get('admin');
    const notOwner = slash(HOME, ADMIN_B, 'admin', { sub: 'list' });
    await admin.execute(notOwner);
    assert.match(last(notOwner), /Only the bot owner/);
    const elsewhere = slash(OTHER, REMO, 'admin', { sub: 'list' });
    await admin.execute(elsewhere);
    assert.match(last(elsewhere), /Only the bot owner/);
    const act = slash(HOME, REMO, 'admin', { sub: 'activate', opts: { guild_id: FREE, days: 30 } });
    await admin.execute(act);
    assert.equal(plans.plan(FREE).kind, 'paid');
    assert.equal(plans.plan(FREE).daysLeft, 30);
    assert.equal(plans.hasFeature(FREE, 'marketplace'), true);
    const de = slash(HOME, REMO, 'admin', { sub: 'deactivate', opts: { guild_id: FREE } });
    await admin.execute(de);
    assert.equal(plans.plan(FREE).kind, 'free');
    const ext = slash(HOME, REMO, 'admin', { sub: 'extendtrial', opts: { guild_id: OTHER, days: 5 } });
    await admin.execute(ext);
    assert.equal(plans.plan(OTHER).daysLeft, 19);
    await guilds.update(OTHER, { trial_ends_at: iso(14) });
    const list = slash(HOME, REMO, 'admin', { sub: 'list' });
    await admin.execute(list);
    assert.match(last(list), /Moon Cats/);
    assert.match(last(list), /trial, 14 days left/);
    assert.match(last(list), /Free Frogs.*free/);
  });

  say('== 3. Data separation ==');
  await test('points: the same member has a separate balance in every server', async () => {
    await points.adjustPoints(MEMBER, 50, 'test', HOME);
    await points.adjustPoints(MEMBER, 7, 'test', OTHER);
    assert.equal(await points.getBalance(MEMBER, HOME), 50);
    assert.equal(await points.getBalance(MEMBER, OTHER), 7);
    assert.equal(await points.getBalance(MEMBER, FREE), null);
    assert.equal(await points.getBalance(MEMBER), 50); // no server given = home
  });
  await test('every points / shop database call carries the server', () => {
    for (const c of rpcLog.filter((r) => r.name !== 'count_ai_call')) assert.ok(c.p_guild, `${c.name} without p_guild`);
  });
  await test('shop: items of one server are invisible and unbuyable in another', async () => {
    tables.items.push({ id: 1, guild_id: HOME, name: 'Home prize', price: 5, stock: 3, type: 'other', active: true, description: '' });
    tables.items.push({ id: 2, guild_id: OTHER, name: 'Cat prize', price: 5, stock: 3, type: 'other', active: true, description: '' });
    const list = slash(OTHER, ADMIN_B, 'listitems', { perms: [PermissionFlagsBits.ManageGuild] });
    await client.commands.get('listitems').execute(list);
    assert.match(last(list), /Cat prize/);
    assert.doesNotMatch(last(list), /Home prize/);
    const r = await fakeDb.rpc('redeem_item', { p_guild: OTHER, p_user: MEMBER, p_item: 1 });
    assert.equal(r.data.ok, false);
    const lb = slash(OTHER, MEMBER, 'leaderboard');
    await client.commands.get('leaderboard').execute(lb);
    assert.match(last(lb), /— 7/);
    assert.doesNotMatch(last(lb), /— 50/);
  });
  await test('taught facts and unanswered questions are per server', async () => {
    await knowledge.addFact('Home mint is in May', REMO, HOME);
    await knowledge.addFact('Cats mint is in June', ADMIN_B, OTHER);
    assert.deepEqual(knowledge.getFacts(HOME).map((f) => f.fact), ['Home mint is in May']);
    assert.deepEqual(knowledge.getFacts(OTHER).map((f) => f.fact), ['Cats mint is in June']);
    assert.equal(knowledge.findSameFact('home mint is in may', OTHER), null);
    await knowledge.recordUnanswered('when is the cats staking live', OTHER);
    assert.equal((await knowledge.topUnanswered(10, OTHER)).length, 1);
    assert.equal((await knowledge.topUnanswered(10, HOME)).length, 0);
    assert.equal(await knowledge.forgetFact(knowledge.getFacts(HOME)[0].id, OTHER), undefined); // cannot forget another server's fact
    assert.equal(knowledge.getFacts(HOME).length, 1);
  });
  await test('scheduled games are per server', async () => {
    await store.create({ guild_id: OTHER, type: 'number_guess', run_at: iso(1), channel_id: '555555555555555555', params: {}, status: 'pending', created_by: ADMIN_B, state: {} });
    await store.create({ type: 'number_guess', run_at: iso(1), channel_id: 'home-general', params: {}, status: 'pending', created_by: REMO, state: {} });
    assert.equal((await store.listActive(OTHER)).length, 1);
    assert.equal((await store.listActive(HOME)).length, 1);
    assert.equal((await store.listActive(FREE)).length, 0);
    assert.equal((await store.listActive()).length, 2); // the scheduler sees all
    tables.scheduled_tasks.length = 0;
  });

  say('== 4. Personality and knowledge per server ==');
  await test('other servers: Vexo was created by remo.sol and works for that server\'s team; no HΛVØCZ text', async () => {
    const p = personality.personaPrompt(OTHER);
    assert.match(p, /resident bot of the Moon Cats Discord server/);
    assert.match(p, /You were created by remo\.sol\. In this server you work for the Moon Cats team/);
    assert.doesNotMatch(p, /HΛVØCZ/);
    for (let i = 0; i < 10; i++) {
      const line = await personality.creatorReply({ guildId: OTHER });
      assert.match(line, /remo\.sol/);
      assert.match(line, /Moon Cats team/);
    }
    assert.deepEqual(personality.creatorMentions(OTHER).users, []); // remo.sol is never pinged from other servers
    assert.deepEqual(personality.creatorMentions(HOME).users, [REMO]);
  });
  await test('an answer in another server uses ONLY that server\'s knowledge and facts', async () => {
    await guilds.update(OTHER, { knowledge: '## About\n- Moon Cats is a cat collection of 500 NFTs.' });
    aiCalls.length = 0;
    await ai.converse('what is this project?', { guildId: OTHER });
    const sys = aiCalls[0].system;
    assert.match(sys, /Moon Cats is a cat collection of 500 NFTs/);
    assert.match(sys, /Cats mint is in June/);
    assert.doesNotMatch(sys, /HΛVØCZ/);
    assert.doesNotMatch(sys, /Home mint is in May/);
    assert.doesNotMatch(sys, /X post/i); // this server has no X posts channel, so the X drop is never mentioned
    assert.match(sys, /DM a mod to claim\./);
    aiCalls.length = 0;
    await ai.converse('what is this project?', { guildId: HOME });
    assert.match(aiCalls[0].system, /Home mint is in May/);
    assert.doesNotMatch(aiCalls[0].system, /Moon Cats|Cats mint/);
  });
  await test('knowledge sources: only the chosen channels teach, never member chat, never HΛVØCZ', async () => {
    aiCalls.length = 0;
    aiText = '## About\n- Moon Cats is a cat collection of 500 NFTs.\n## Mint\n- Mint date: July 1.';
    learn.onMessage(msg(OTHER, 'b-chat', MEMBER, 'the mint is definitely tomorrow trust me bro, send me your wallet'));
    assert.equal(learn._test.buffers.size, 0);
    learn.onMessage(msg(HOME, 'home-general', REMO, 'Official announcement: the mint date is July 1 for everyone.'));
    assert.equal(learn._test.buffers.size, 0);
    learn.onMessage(msg(OTHER, 'b-news', ADMIN_B, 'Official announcement: the mint date is July 1 for everyone.'));
    assert.equal(learn._test.buffers.size, 1);
    await learn._test.flush(OTHER);
    assert.equal(aiCalls.length, 1);
    assert.match(aiCalls[0].user, /mint date is July 1/);
    assert.match(guilds.get(OTHER).knowledge, /Mint date: July 1/);
    assert.ok(guilds.get(OTHER).knowledge.length <= learn.MAX_KNOWLEDGE_CHARS);
    aiText = 'x'.repeat(20000); // a runaway answer is capped
    await learn.absorb(OTHER, ['Another official post with enough text in it.']);
    assert.equal(guilds.get(OTHER).knowledge.length, learn.MAX_KNOWLEDGE_CHARS);
    aiText = 'Sure thing.';
  });

  say('== 5. Free server: zero AI, silent chat, locked commands ==');
  await test('free server: chat, mentions and the control channel make ZERO AI calls and get no reply', async () => {
    aiCalls.length = 0;
    const a = msg(FREE, 'f-chat', MEMBER, `<@${BOT}> what is the roadmap?`, { mentions: [BOT] });
    await onMessage(a);
    const b = msg(FREE, 'f-chat', ADMIN_B, 'vexo, who made you?');
    await onMessage(b);
    const c = msg(FREE, 'f-ctl', MEMBER, 'host a rumble at 8 pm'); // MEMBER is the boss there
    await onMessage(c);
    assert.equal(aiCalls.length, 0);
    assert.deepEqual([a.replies.length, b.replies.length, c.replies.length], [0, 0, 0]);
    assert.equal(rpcLog.filter((r) => r.name === 'record_message' && r.p_guild === FREE).length, 0); // no points either
    await assert.rejects(() => ai.chat('s', 'u', { guildId: FREE }), (e) => e.code === 'AI_LIMIT'); // the last line of defense
    assert.equal(aiCalls.length, 0);
  });
  await test('free server: number guess banter uses pre-written lines (no AI)', async () => {
    aiCalls.length = 0;
    const line = await personality.gameBanter('this game is fun', { min: 1, max: 100, guesses: 1, players: 1, useAi: plans.hasFeature(FREE, 'aiChat'), guildId: FREE });
    assert.ok(line.length > 3);
    assert.equal(aiCalls.length, 0);
  });
  await test('locked command: admins see the premium note with the contact text, members a short line', async () => {
    const adminTry = slash(FREE, MEMBER, 'additem', { perms: [PermissionFlagsBits.ManageGuild] });
    await onInteraction(adminTry);
    assert.match(last(adminTry), /premium feature/);
    assert.match(last(adminTry), /Contact remo\.sol to pay\./);
    const memberTry = slash(FREE, ADMIN_B, 'points');
    await onInteraction(memberTry);
    assert.match(last(memberTry), /not available in this server/);
    assert.doesNotMatch(last(memberTry), /premium/);
    const free = slash(FREE, MEMBER, 'status', { perms: [PermissionFlagsBits.ManageGuild] });
    await onInteraction(free); // /status always works
    assert.match(last(free), /Free plan/);
    const home = slash(HOME, MEMBER, 'points');
    await onInteraction(home); // never locked in HΛVØCZ
    assert.match(last(home), /Balance: \*\*50\*\*/);
  });
  await test('free server: /guess and /rumble are allowed, but a points prize is refused', async () => {
    const g = slash(FREE, MEMBER, 'guess', { sub: 'start', opts: { start_in: 5 }, perms: [PermissionFlagsBits.ManageGuild] });
    await onInteraction(g);
    assert.match(last(g), /Scheduled!/);
    assert.equal((await store.listActive(FREE)).length, 1);
    assert.equal((await store.listActive(FREE))[0].channel_id, '666666666666666666'); // no games channel chosen: the rumble channel
    const again = slash(FREE, MEMBER, 'guess', { sub: 'start', opts: { start_in: 5, prize: '50 points' }, perms: [PermissionFlagsBits.ManageGuild] });
    await onInteraction(again);
    assert.match(last(again), /needs the Points feature/);
    const r = slash(FREE, MEMBER, 'rumble', { sub: 'start', opts: { prize: '100 points' }, perms: [PermissionFlagsBits.ManageGuild] });
    await onInteraction(r);
    assert.match(last(r), /needs the Points feature/);
    const stranger = slash(FREE, ADMIN_B, 'guess', { sub: 'status' });
    await onInteraction(stranger);
    assert.match(last(stranger), /Only admins and staff/);
    tables.scheduled_tasks.length = 0;
  });

  say('== 6. Premium server ==');
  await test('premium server: Vexo answers a mention, with that server\'s persona', async () => {
    aiCalls.length = 0;
    await guilds.update(OTHER, { ai_calls_today: 0 });
    const m = msg(OTHER, 'b-chat', MEMBER, `<@${BOT}> hello there`, { mentions: [BOT] });
    await onMessage(m);
    assert.equal(aiCalls.length, 1);
    assert.equal(m.replies.length, 1);
    assert.match(aiCalls[0].system, /Moon Cats/);
    assert.match(aiCalls[0].system, /WHO IS TALKING: a regular member/);
    assert.equal(rpcLog.filter((r) => r.name === 'record_message' && r.p_guild === OTHER).length, 1); // points on
  });
  await test('premium server: its admin is "boss" there; remo.sol is a regular member there', async () => {
    aiCalls.length = 0;
    await guilds.update(OTHER, { ai_calls_today: 0 });
    const boss = msg(OTHER, 'b-chat', ADMIN_B, `<@${BOT}> how are things`, { mentions: [BOT] });
    await onMessage(boss);
    assert.match(aiCalls[0].system, /WHO IS TALKING: your boss in this server/);
    assert.match(boss.replies[0], /boss/i);
    aiCalls.length = 0;
    const remo = msg(OTHER, 'b-chat', REMO, `<@${BOT}> how are things`, { mentions: [BOT] });
    await onMessage(remo);
    assert.match(aiCalls[0].system, /WHO IS TALKING: a regular member/);
  });
  await test('daily AI limit: after DEFAULT_DAILY_AI_LIMIT calls Vexo goes silent; HΛVØCZ is never limited', async () => {
    await guilds.update(OTHER, { ai_calls_today: 0, ai_calls_day: null });
    aiCalls.length = 0;
    const replies = [];
    for (let i = 0; i < 5; i++) {
      const m = msg(OTHER, 'b-chat', `40000000000000000${i}`, `<@${BOT}> hello number ${i}`, { mentions: [BOT] });
      await onMessage(m);
      replies.push(m.replies.length);
    }
    assert.equal(aiCalls.length, 3); // the limit in this test
    assert.deepEqual(replies, [1, 1, 1, 0, 0]);
    aiCalls.length = 0;
    for (let i = 0; i < 6; i++) await ai.converse(`hello ${i}`, { guildId: HOME });
    assert.equal(aiCalls.length, 6);
    await guilds.update(OTHER, { ai_calls_today: 0, ai_calls_day: null });
  });
  await test('control channels are separate: an order pending in one server cannot be confirmed from another', async () => {
    const chB = chan('b-ctl', OTHER);
    const before = sent.length;
    await control.handleMessage(msg(OTHER, 'b-ctl', ADMIN_B, 'hello vexo'));
    assert.equal(sent.length, before); // replies go through message.reply
    const stranger = msg(OTHER, 'b-ctl', MEMBER, 'teach: fake fact'); // not boss, not staff there
    aiCalls.length = 0;
    assert.equal(await control.handleMessage(stranger), true);
    assert.equal(aiCalls.length, 0);
    assert.equal(stranger.replies.length, 0);
    assert.equal(await control.handleMessage(msg(OTHER, 'b-chat', ADMIN_B, 'hello')), false); // not the control channel
    assert.equal(await control.handleMessage(msg(HOME, 'b-ctl', REMO, 'hello')), false); // another server's channel id is nothing in HOME
    assert.ok(chB);
  });

  say('== 7. Tickets wording ==');
  await test('other servers use their ticket_instructions; HΛVØCZ keeps its wording', async () => {
    const t = slash(OTHER, MEMBER, 'ticket', { opts: { purchase_id: 1 } });
    await onInteraction(t);
    assert.equal(last(t), 'DM a mod to claim.');
    const numberGuess = require(src('tasks/numberGuess.js'));
    assert.ok(numberGuess);
    assert.equal(guilds.settings(HOME).ticketInstructions, null);
    assert.equal(guilds.settings(HOME).channels.ticket, 'home-tickets');
  });

  say('== 8. Auto mod ==');
  await test('off by default everywhere (HΛVØCZ included): nothing is ever removed', async () => {
    deleted.length = 0;
    assert.equal(await automod.handle(msg(HOME, 'home-general', MEMBER, 'join discord.gg/abc123 now')), false);
    assert.equal(await automod.handle(msg(OTHER, 'b-chat', MEMBER, 'join discord.gg/abc123 now')), false);
    assert.equal(deleted.length, 0);
  });
  await test('/automod switches rules per server; invite, word, link, mention and spam rules work', async () => {
    const am = client.commands.get('automod');
    const M = [PermissionFlagsBits.ManageGuild];
    for (const name of ['invites', 'words', 'links', 'mentions', 'spam']) await am.execute(slash(OTHER, ADMIN_B, 'automod', { sub: 'rule', opts: { name, on: true }, perms: M }));
    await am.execute(slash(OTHER, ADMIN_B, 'automod', { sub: 'blockword', opts: { word: 'scamcoin' }, perms: M }));
    await am.execute(slash(OTHER, ADMIN_B, 'automod', { sub: 'allowlink', opts: { domain: 'https://x.com/' }, perms: M }));
    await am.execute(slash(OTHER, ADMIN_B, 'automod', { sub: 'action', opts: { type: 'timeout', timeout_minutes: 5 }, perms: M }));
    const r = automod.rules(OTHER);
    assert.deepEqual([r.invites, r.words, r.links, r.action, r.timeoutMinutes, r.blockedWords, r.allowedDomains], [true, true, true, 'timeout', 5, ['scamcoin'], ['x.com']]);
    assert.equal(automod.rules(HOME).invites, undefined); // HΛVØCZ untouched
    const v = (content, extra) => automod.verdict(msg(OTHER, 'b-chat', MEMBER, content, extra), r)?.rule || null;
    assert.equal(v('come to discord.gg/abc123'), 'invites');
    assert.equal(v('buy SCAMCOIN today'), 'words');
    assert.equal(v('scamcoins are fine as a longer word'), null);
    assert.equal(v('look https://evil.example/path'), 'links');
    assert.equal(v('look https://x.com/someone/status/1 and https://tenor.com/gif'), null);
    assert.equal(v('hi all', { mentions: ['1', '2', '3', '4', '5', '6'] }), 'mentions');
    automod._test.recent.clear();
    assert.equal(v('same line'), null);
    assert.equal(v('same line'), null);
    assert.equal(v('same line'), 'spam');
  });
  await test('a rule break is deleted, timed out and logged; admins and the boss are never moderated', async () => {
    deleted.length = 0;
    timeouts.length = 0;
    sent.length = 0;
    aiCalls.length = 0;
    const bad = msg(OTHER, 'b-chat', MEMBER, 'join discord.gg/abc123 now');
    await onMessage(bad);
    assert.deepEqual(deleted, [bad.id]);
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0].ms, 5 * 60 * 1000);
    assert.ok(sent.some((s) => s.ch === 'b-logs' && JSON.stringify(s.embeds).includes('Auto mod')));
    assert.equal(bad.replies.length, 0);
    assert.equal(aiCalls.length, 0); // rule-based: no AI
    deleted.length = 0;
    await onMessage(msg(OTHER, 'b-chat', ADMIN_B, 'join discord.gg/abc123 now')); // the boss
    await onMessage(msg(OTHER, 'b-chat', '888888888888888888', 'join discord.gg/abc123 now', { perms: [PermissionFlagsBits.ManageMessages] }));
    assert.equal(deleted.length, 0);
    // the same message in HΛVØCZ and in the free server: untouched
    await onMessage(msg(HOME, 'home-general', MEMBER, 'join discord.gg/abc123 now'));
    await onMessage(msg(FREE, 'f-chat', ADMIN_B, 'join discord.gg/abc123 now'));
    assert.equal(deleted.length, 0);
  });

  say('== 9. Trial reminders ==');
  await test('3 days before the end and on the end day: one notice each, with the payment text', async () => {
    sent.length = 0;
    await guilds.update(OTHER, { trial_ends_at: iso(10) });
    await expiry.checkGuild(client, guilds.get(OTHER));
    assert.equal(sent.length, 0);
    await guilds.update(OTHER, { trial_ends_at: iso(2.5) });
    await expiry.checkGuild(client, guilds.get(OTHER));
    await expiry.checkGuild(client, guilds.get(OTHER)); // not twice
    assert.equal(sent.length, 1);
    assert.equal(sent[0].ch, 'b-ctl');
    assert.match(sent[0].content, /free trial\*\* ends/);
    assert.match(sent[0].content, /Contact remo\.sol to pay\./);
    await guilds.update(OTHER, { trial_ends_at: iso(-0.01) });
    await expiry.checkGuild(client, guilds.get(OTHER));
    await expiry.checkGuild(client, guilds.get(OTHER));
    assert.equal(sent.length, 2);
    assert.match(sent[1].content, /has ended/);
    assert.match(sent[1].content, /keep working for free/);
    assert.equal(plans.hasFeature(OTHER, 'aiChat'), false); // locked
    assert.equal(plans.hasFeature(OTHER, 'rumble'), true); // free games keep working
    sent.length = 0;
    await expiry.checkGuild(client, guilds.get(HOME)); // never for HΛVØCZ
    assert.equal(sent.length, 0);
  });

  Object.assign(console, quiet);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
