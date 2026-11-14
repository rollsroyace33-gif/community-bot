// Giveaways: /giveaway, the Join button, winners, the @everyone announcement, reroll, cancel, restart, orders.
// Run: node tests/giveaway.test.js
// Fully offline: Discord, Supabase and the AI are faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
const OTHER = '200000000000000002'; // customer server in its trial (premium)
const FREE = '300000000000000003'; // customer server on the free plan
const REMO = '111111111111111110';
const OWNER_B = '222222222222222220'; // owner + boss of OTHER
const ADMIN_F = '333333333333333330'; // admin of FREE
const BOT = '999999999999999999';
const U = (n) => `5000000000000000${String(n).padStart(2, '0')}`; // members
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, STAFF_ROLE_IDS: '', TRIAL_DAYS: '15', DEFAULT_DAILY_AI_LIMIT: '50',
  SUPPORT_CONTACT: 'Contact remo.sol to pay.', CONTROL_CHANNEL_ID: 'home-ctl', GENERAL_CHANNEL_ID: 'home-general', REDEEM_LOGS_CHANNEL_ID: 'home-logs',
  GIVEAWAY_CHANNEL_ID: 'home-gw', TICKET_CHANNEL_ID: 'home-ticket', TIMEZONE: 'Asia/Dhaka', BOSS_TIMEZONE: 'Asia/Dhaka', ADMIN_ROLE_ID: '', VERIFIED_ROLE_ID: 'home-verified',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { guilds: [], users: [], point_log: [], giveaways: [], giveaway_entries: [] };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
let nextGiveawayId = 1;
const fakeDb = {
  async rpc(name, a) {
    if (name === 'adjust_points') {
      let u = tables.users.find((r) => r.guild_id === a.p_guild && r.user_id === a.p_user);
      if (!u) tables.users.push((u = { guild_id: a.p_guild, user_id: a.p_user, points: 0 }));
      u.points += a.p_amount;
      tables.point_log.push({ id: tables.point_log.length + 1, guild_id: a.p_guild, user_id: a.p_user, amount: a.p_amount, reason: a.p_reason });
      return { data: u.points, error: null };
    }
    if (name === 'count_ai_call') {
      const g = tables.guilds.find((r) => r.guild_id === a.p_guild);
      if (!g) return { data: -1, error: null };
      if (a.p_limit > 0 && g.ai_calls_today >= a.p_limit) return { data: -1, error: null };
      g.ai_calls_today += 1;
      return { data: g.ai_calls_today, error: null };
    }
    return { data: 0, error: null };
  },
  from(table) {
    const q = { op: 'select', f: [], single: false, head: false };
    const api = {
      select: (_c, o) => ((q.head = !!o?.head), api), order: () => ((q.desc = true), api), limit: () => api,
      eq: (k, v) => (q.f.push((r) => r[k] === v), api),
      lte: (k, v) => (q.f.push((r) => r[k] <= v), api),
      insert: (row) => ((q.op = 'insert'), (q.row = row), api),
      update: (p) => ((q.op = 'update'), (q.p = p), api),
      delete: () => ((q.op = 'delete'), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = (tables[table] ||= []);
      if (q.op === 'insert') {
        // the primary key the migration creates: one entry per member per giveaway
        if (table === 'giveaway_entries' && rows.some((r) => r.giveaway_id === q.row.giveaway_id && r.user_id === q.row.user_id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const r = table === 'giveaways' ? { id: nextGiveawayId++, message_id: null, settled: false, winner_ids: [], past_winner_ids: [], ended_at: null, ...clone(q.row) } : { id: rows.length + 1, ...clone(q.row) };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      let m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'delete') {
        for (const r of m) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      if (q.head) return { count: m.length, data: null, error: null };
      if (q.desc) m = [...m].sort((a, b) => b.id - a.id);
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- fake AI + picture download
const aiCalls = [];
const downloads = [];
let aiAnswer = { action: 'other' };
global.fetch = async (url, opts) => {
  if (String(url).includes('api.openai.com')) {
    const body = JSON.parse(opts.body);
    aiCalls.push({ system: body.messages[0].content, user: body.messages[1].content });
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(aiAnswer) } }] }), text: async () => '' };
  }
  downloads.push(String(url));
  return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer };
};

// ---------------------------------------------------------------- fake Discord
const { PermissionFlagsBits: P } = require('discord.js');
const sent = []; // every message the bot posted: { id, ch, content, embeds, components, files, allowedMentions, edits }
const channels = {};
const ALL = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.MentionEveryone];
const chanPerms = {}; // channel id -> Set of permission bits the bot has there (default: all)
const flat = (m) => ({
  content: m.content || '',
  embeds: (m.embeds || []).map((e) => e.toJSON?.() || e),
  components: (m.components || []).map((c) => c.toJSON?.() || c),
  files: (m.files || []).map((f) => f.name),
  allowedMentions: m.allowedMentions || null,
});
function chan(id, guildId) {
  return (channels[id] ||= {
    id, guildId, type: 0, name: id, isTextBased: () => true,
    permissionsFor: () => ({ has: (bit) => (chanPerms[id] || new Set(ALL)).has(bit) }),
    sendTyping: async () => {},
    send: async (m) => {
      const rec = { id: `s${sent.length + 1}`, ch: id, edits: [], ...flat(m) };
      rec.edit = async (e) => (rec.edits.push(flat(e)), rec);
      sent.push(rec);
      return rec;
    },
    messages: {
      fetch: async (mid) => {
        const rec = sent.find((r) => r.id === mid && r.ch === id);
        if (!rec) throw new Error('Unknown Message');
        return rec;
      },
    },
  });
}
const members = { [HOME]: {}, [OTHER]: {}, [FREE]: {} }; // guild -> user id -> { roles: [..], bot }
const guildsFake = {};
const client = { user: { id: BOT, username: 'Vexo' }, channels: { fetch: async (id) => channels[id] || null }, guilds: { cache: { get: (id) => guildsFake[id] } } };
function guildOf(id, roleNames) {
  const roles = new Map(Object.entries(roleNames).map(([rid, name]) => [rid, { id: rid, name, mentionable: false }]));
  roles.find = (fn) => [...roles.values()].find(fn);
  const chCache = { find: (fn) => Object.values(channels).filter((c) => c.guildId === id).find(fn) };
  return {
    id, name: id === OTHER ? 'Moon Cats' : id === FREE ? 'Free Frogs' : 'HΛVØCZ', ownerId: id === OTHER ? OWNER_B : REMO, client,
    roles: { cache: roles }, channels: { cache: chCache },
    members: {
      me: { id: BOT },
      fetch: async (uid) => {
        const m = members[id][uid];
        if (!m) throw new Error('Unknown Member');
        return { id: uid, user: { id: uid, bot: !!m.bot }, roles: { cache: { has: (r) => m.roles.includes(r) } } };
      },
    },
  };
}
Object.assign(guildsFake, { [HOME]: guildOf(HOME, { 'home-verified': 'Verified' }), [OTHER]: guildOf(OTHER, { 'b-verified': 'Verified', 'b-ping': 'Giveaway Pings' }), [FREE]: guildOf(FREE, {}) });

// a button press
function press(guildId, userId, customId) {
  const it = {
    guildId, guild: guildsFake[guildId], client, customId, user: { id: userId }, replied: false, deferred: false,
    member: { roles: { cache: { has: (r) => (members[guildId][userId]?.roles || []).includes(r) } } },
    memberPermissions: { has: () => false },
    inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false, isRepliable: () => true,
    out: [],
    reply: async (m) => ((it.replied = true), it.out.push(flat(m))), update: async (m) => it.out.push(flat(m)), followUp: async (m) => it.out.push(flat(m)),
  };
  return it;
}
// a /giveaway command
function slash(guildId, userId, sub, opts = {}, { manage = true } = {}) {
  const it = {
    guildId, guild: guildsFake[guildId], client, commandName: 'giveaway', user: { id: userId }, member: { roles: { cache: { has: () => false } } },
    memberPermissions: { has: (p) => manage && p === P.ManageGuild },
    options: {
      getSubcommand: () => sub, getString: (k) => opts[k] ?? null, getInteger: (k) => opts[k] ?? null, getAttachment: (k) => opts[k] ?? null,
      getRole: (k) => (opts[k] ? { id: opts[k] } : null), getChannel: (k) => (opts[k] ? { id: opts[k] } : null), getUser: (k) => (opts[k] ? { id: opts[k] } : null),
    },
    out: [],
    reply: async (m) => it.out.push(flat(typeof m === 'string' ? { content: m } : m)), deferReply: async () => {},
    editReply: async (m) => it.out.push(flat(typeof m === 'string' ? { content: m } : m)),
  };
  return it;
}
// a control channel message
function order(guildId, channelId, authorId, content, attachments = []) {
  const m = {
    id: `o${Math.random()}`, guildId, guild: guildsFake[guildId], channelId, channel: chan(channelId, guildId), client, content,
    author: { id: authorId, bot: false, username: 'boss' }, member: { roles: { cache: { some: () => false, has: () => false } } },
    mentions: { roles: new Map(), channels: { first: () => null } },
    attachments: new Map(attachments.map((a, i) => [String(i), a])),
    replies: [],
    reply: async (r) => (m.replies.push(typeof r === 'string' ? r : r.content), { id: 'r' }),
  };
  return m;
}

// ---------------------------------------------------------------- load the bot
const guilds = require(src('guilds.js'));
const plans = require(src('plans.js'));
const config = require(src('config.js'));
const giveaway = require(src('giveaway.js'));
const command = require(src('commands/giveaway.js'));
const setup = require(src('setup.js'));

const quiet = { log: console.log };
Object.assign(console, { log: () => {}, debug: () => {}, warn: () => {}, error: () => {} });
const say = (...a) => quiet.log(...a);
let passed = 0;
let failed = 0;
const reset = () => {
  [sent, aiCalls, downloads].forEach((a) => (a.length = 0));
  for (const k of Object.keys(chanPerms)) delete chanPerms[k];
  giveaway._test.pendings.clear();
};
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
const DAY = 86400000;
const iso = (d) => new Date(Date.now() + d * DAY).toISOString();
const row = (id) => tables.giveaways.find((g) => g.id === id);
const entries = (id) => tables.giveaway_entries.filter((e) => e.giveaway_id === id).map((e) => e.user_id);
const join = async (guildId, userId, id) => {
  const it = press(guildId, userId, `gw:join:${id}`);
  await giveaway.handleButton(it);
  return it.out[0];
};
const fieldOf = (embed, name) => (embed.fields || []).find((f) => f.name.includes(name))?.value;
// start one in OTHER and return its row
async function host(opts = {}, guildId = OTHER, userId = OWNER_B) {
  const it = slash(guildId, userId, 'start', { prize: '1 NFT', duration: '1h', ...opts });
  await command.execute(it);
  const g = tables.giveaways[tables.giveaways.length - 1];
  return { it, g, box: sent.find((m) => m.id === g?.message_id) };
}
const announcements = (g) => sent.filter((m) => m.ch === g.channel_id && m.id !== g.message_id && /GIVEAWAY (WINNER|REROLL)|Giveaway over/.test(m.content));
const logs = (ch) => sent.filter((m) => m.ch === ch).map((m) => `${m.embeds[0]?.title}\n${m.embeds[0]?.description}`);

(async () => {
  tables.guilds.push(
    { guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: {}, ai_calls_today: 0 },
    { guild_id: OTHER, name: 'Moon Cats', status: 'active', boss_user_id: OWNER_B, trial_ends_at: iso(14), ai_calls_today: 0, ticket_instructions: 'Open a ticket in #support.', settings: { pingRoleId: 'b-ping', channels: { control: 'b-ctl', logs: 'b-logs', giveaway: 'b-gw' } } },
    { guild_id: FREE, name: 'Free Frogs', status: 'active', boss_user_id: ADMIN_F, trial_ends_at: iso(-5), ai_calls_today: 0, settings: { channels: { control: 'f-ctl', logs: 'f-logs', giveaway: 'f-gw' } } }
  );
  for (const [id, g] of [['home-gw', HOME], ['home-logs', HOME], ['home-ctl', HOME], ['b-gw', OTHER], ['b-logs', OTHER], ['b-ctl', OTHER], ['b-other', OTHER], ['f-gw', FREE], ['f-logs', FREE], ['f-ctl', FREE]]) chan(id, g);
  for (let i = 1; i <= 12; i++) {
    members[OTHER][U(i)] = { roles: i <= 6 ? ['b-verified'] : [] };
    members[HOME][U(i)] = { roles: ['home-verified'] };
    members[FREE][U(i)] = { roles: [] };
  }
  await guilds.load();

  say('== 1. Plans and settings ==');
  await test('feature map: "giveaway" is free, "giveaway_orders" is premium; HΛVØCZ has both', () => {
    assert.equal(config.features.giveaway, 'free');
    assert.equal(config.features.giveaway_orders, 'premium');
    assert.deepEqual([plans.hasFeature(FREE, 'giveaway'), plans.hasFeature(FREE, 'giveaway_orders')], [true, false]);
    assert.deepEqual([plans.hasFeature(OTHER, 'giveaway'), plans.hasFeature(OTHER, 'giveaway_orders')], [true, true]);
    assert.deepEqual([plans.hasFeature(HOME, 'giveaway'), plans.hasFeature(HOME, 'giveaway_orders')], [true, true]);
    assert.equal(plans.COMMAND_FEATURES.giveaway, 'giveaway');
    assert.equal(plans.componentFeature('gw:join:5'), 'giveaway');
  });
  await test('giveaway channel: HΛVØCZ from GIVEAWAY_CHANNEL_ID, others from their settings; auto setup creates "giveaways"', () => {
    assert.equal(guilds.settings(HOME).channels.giveaway, 'home-gw');
    assert.equal(guilds.settings(OTHER).channels.giveaway, 'b-gw');
    assert.equal(setup.KEYS.giveaway.name, 'giveaways');
    assert.ok(setup.NEEDED.some(([bit, name]) => bit === P.AttachFiles && name === 'Attach Files'));
    assert.ok(setup.NEEDED.some(([bit]) => bit === P.EmbedLinks));
  });

  say('== 2. /giveaway start ==');
  await test('posts one box with a Join button in the giveaway channel, pings the ping role, saved with guild_id, zero AI calls', async () => {
    const { it, g, box } = await host({ winners: 2 });
    assert.equal(g.guild_id, OTHER);
    assert.equal(g.channel_id, 'b-gw');
    assert.equal(g.status, 'active');
    assert.equal(g.winners_count, 2);
    assert.ok(box, 'box posted');
    assert.match(box.content, /^<@&b-ping> /); // falls back to the server's game ping role
    assert.deepEqual(box.allowedMentions, { parse: [], roles: ['b-ping'] });
    const e = box.embeds[0];
    assert.match(e.title, /GIVEAWAY/);
    assert.match(fieldOf(e, 'Prize'), /1 NFT/);
    assert.equal(fieldOf(e, 'Winners'), '2');
    assert.match(fieldOf(e, 'Ends'), /<t:\d+:R>/);
    assert.equal(fieldOf(e, 'Entries'), '0');
    assert.match(fieldOf(e, 'Hosted by'), new RegExp(OWNER_B));
    const btn = box.components[0].components[0];
    assert.equal(btn.custom_id, `gw:join:${g.id}`);
    assert.ok(!btn.disabled);
    assert.equal(e.image, undefined); // no picture given
    assert.match(it.out[0].content, /giveaway is live/);
    assert.equal(aiCalls.length, 0);
    assert.ok(logs('b-logs').some((l) => /Giveaway started/.test(l)));
  });
  await test('a picture is downloaded and uploaded again on the giveaway message; required role and channel options work', async () => {
    const { g, box } = await host({ image: { url: 'https://cdn.discordapp.com/attachments/1/2/nft.png', name: 'nft.png', contentType: 'image/png', size: 5000 }, required_role: 'b-verified', ping_role: 'b-verified', channel: 'b-other' });
    assert.deepEqual(downloads, ['https://cdn.discordapp.com/attachments/1/2/nft.png']);
    assert.equal(g.channel_id, 'b-other');
    assert.deepEqual(box.files, ['giveaway.png']);
    assert.equal(box.embeds[0].image.url, 'attachment://giveaway.png');
    assert.match(fieldOf(box.embeds[0], 'Required role'), /<@&b-verified>/);
    assert.match(box.content, /^<@&b-verified> /);
  });
  await test('bad input is refused with a clear message and nothing is posted', async () => {
    const before = tables.giveaways.length;
    let r = await host({ duration: null });
    assert.match(r.it.out[0].content, /How long/);
    r = await host({ duration: 'soon' });
    assert.match(r.it.out[0].content, /could not read the duration/);
    r = await host({ duration: '60d' });
    assert.match(r.it.out[0].content, /30 days/);
    r = await host({ image: { url: 'https://cdn.discordapp.com/x/y/file.pdf', name: 'file.pdf', contentType: 'application/pdf', size: 10 } });
    assert.match(r.it.out[0].content, /not a picture/);
    assert.equal(tables.giveaways.length, before);
    assert.equal(sent.filter((m) => m.ch === 'b-gw').length, 0);
  });
  await test('missing Attach Files or Embed Links: the admin is told exactly what to turn on, nothing is posted', async () => {
    const before = tables.giveaways.length;
    chanPerms['b-gw'] = new Set([P.ViewChannel, P.SendMessages]);
    const r = await host({ image: { url: 'https://cdn.discordapp.com/a/b/p.png', name: 'p.png', contentType: 'image/png', size: 10 } });
    assert.match(r.it.out[0].content, /missing \*\*Embed Links, Attach Files\*\*/);
    assert.equal(tables.giveaways.length, before);
    assert.equal(sent.filter((m) => m.ch === 'b-gw').length, 0);
  });
  await test('admins only: a member without Manage Server is refused; the boss is allowed', async () => {
    const it = slash(OTHER, U(1), 'start', { prize: 'x', duration: '1h' }, { manage: false });
    await command.execute(it);
    assert.match(it.out[0].content, /Only admins/);
    const boss = slash(OTHER, OWNER_B, 'list', {}, { manage: false });
    await command.execute(boss);
    assert.match(boss.out[0].content, /Running/);
  });
  await test('free server: /giveaway works (free feature) and makes no AI call; a points prize is refused there', async () => {
    const r = await host({}, FREE, ADMIN_F);
    assert.equal(r.g.guild_id, FREE);
    assert.equal(r.box.ch, 'f-gw');
    assert.equal(r.box.content.startsWith('<@&'), false); // no ping role set there
    const before = tables.giveaways.length;
    const p = await host({ points_prize: 100 }, FREE, ADMIN_F);
    assert.match(p.it.out[0].content, /premium feature/);
    assert.equal(tables.giveaways.length, before);
    assert.equal(aiCalls.length, 0);
    await giveaway.cancel(client, r.g.id, { by: ADMIN_F });
  });

  say('== 3. Join button ==');
  await test('one entry per member (database key); pressing again offers Leave; leaving removes the entry; replies are private', async () => {
    const { g } = await host();
    const first = await join(OTHER, U(1), g.id);
    assert.match(first.content, /You are in/);
    const again = await join(OTHER, U(1), g.id);
    assert.match(again.content, /already in this giveaway/);
    assert.equal(again.components[0].components[0].custom_id, `gw:leave:${g.id}`);
    assert.deepEqual(entries(g.id), [U(1)]);
    const leave = press(OTHER, U(1), `gw:leave:${g.id}`);
    await giveaway.handleButton(leave);
    assert.match(leave.out[0].content, /You left/);
    assert.deepEqual(entries(g.id), []);
    await giveaway.cancel(client, g.id, { by: OWNER_B });
  });
  await test('required role: a member without it gets a short private message naming the role', async () => {
    const { g } = await host({ required_role: 'b-verified' });
    const no = await join(OTHER, U(9), g.id);
    assert.match(no.content, /only for members with the <@&b-verified> role/);
    assert.match((await join(OTHER, U(2), g.id)).content, /You are in/);
    assert.deepEqual(entries(g.id), [U(2)]);
    await giveaway.cancel(client, g.id, { by: OWNER_B });
  });
  await test('the button goes through the normal interaction handler (works after a restart), and not from another server', async () => {
    const { g } = await host();
    const onInteraction = require(src('events/interactionCreate.js'));
    const it = press(OTHER, U(3), `gw:join:${g.id}`);
    await onInteraction(it);
    assert.match(it.out[0].content, /You are in/);
    const other = press(FREE, U(3), `gw:join:${g.id}`);
    await onInteraction(other);
    assert.match(other.out[0].content, /cannot find this giveaway/);
    assert.deepEqual(entries(g.id), [U(3)]);
    await giveaway.cancel(client, g.id, { by: OWNER_B });
  });

  say('== 4. Ending and the winner announcement ==');
  await test('end: winners picked, box shows Ended with the winners and a disabled button, new message pings @everyone and the winners', async () => {
    const { g, box } = await host({ winners: 2 });
    for (let i = 1; i <= 5; i++) await join(OTHER, U(i), g.id);
    // several giveaways are running: without an id Vexo asks which one, and ends nothing
    const ask = slash(OTHER, OWNER_B, 'end');
    await command.execute(ask);
    assert.match(ask.out[0].content, /Tell me which one/);
    assert.equal(row(g.id).status, 'active');
    const it = slash(OTHER, OWNER_B, 'end', { id: g.id });
    await command.execute(it);
    const r = row(g.id);
    assert.equal(r.status, 'ended');
    assert.equal(r.settled, true);
    assert.equal(r.winner_ids.length, 2);
    assert.equal(new Set(r.winner_ids).size, 2);
    for (const w of r.winner_ids) assert.ok(entries(g.id).includes(w));
    const ended = box.edits[box.edits.length - 1];
    assert.match(ended.embeds[0].title, /Ended/);
    for (const w of r.winner_ids) assert.match(fieldOf(ended.embeds[0], 'Winner'), new RegExp(w));
    assert.equal(ended.components[0].components[0].disabled, true);
    assert.deepEqual(ended.allowedMentions, { parse: [] }); // the edit never pings
    const [a] = announcements(r);
    assert.ok(a, 'announcement posted as a new message');
    assert.match(a.content, /^@everyone /);
    assert.deepEqual(a.allowedMentions.parse, ['everyone']);
    assert.deepEqual([...a.allowedMentions.users].sort(), [...r.winner_ids].sort());
    assert.equal(a.allowedMentions.roles, undefined); // the ping role is only for the start
    for (const w of r.winner_ids) assert.match(a.content, new RegExp(`<@${w}>`));
    assert.match(a.content, /1 NFT/);
    assert.match(a.content, /How to claim: Open a ticket in #support\./); // this server's ticket instructions
    assert.ok(logs('b-logs').some((l) => /Giveaway ended/.test(l) && r.winner_ids.every((w) => l.includes(w))));
    assert.match((await join(OTHER, U(6), g.id)).content, /already over/);
  });
  await test('points prize: added to every winner in the same server, exactly once', async () => {
    const { g } = await host({ winners: 2, points_prize: 500, prize: '500 points' });
    for (let i = 1; i <= 3; i++) await join(OTHER, U(i), g.id);
    tables.users.length = 0;
    tables.point_log.length = 0;
    await giveaway.finish(client, g.id, { by: OWNER_B });
    const r = row(g.id);
    assert.equal(tables.point_log.length, 2);
    for (const w of r.winner_ids) assert.equal(tables.users.find((u) => u.guild_id === OTHER && u.user_id === w).points, 500);
    assert.ok(tables.point_log.every((l) => l.guild_id === OTHER && l.amount === 500));
    assert.match(announcements(r)[0].content, /500 points\*\* have been added/);
    // a second end (double click, timer + command at once) pays nobody again
    const again = await giveaway.finish(client, g.id, { by: OWNER_B });
    assert.match(again.error, /already ended/);
    assert.equal(tables.point_log.length, 2);
    assert.equal(announcements(r).length, 1);
  });
  await test('fewer valid entries than winners: as many as possible; members who left or lost the role are skipped', async () => {
    const { g } = await host({ winners: 3, required_role: 'b-verified' });
    for (let i = 1; i <= 4; i++) await join(OTHER, U(i), g.id);
    const keep = { 3: members[OTHER][U(3)], 4: members[OTHER][U(4)] };
    delete members[OTHER][U(3)]; // left the server
    members[OTHER][U(4)] = { roles: [] }; // lost the role
    await giveaway.finish(client, g.id);
    members[OTHER][U(3)] = keep[3];
    members[OTHER][U(4)] = keep[4];
    const r = row(g.id);
    assert.deepEqual([...r.winner_ids].sort(), [U(1), U(2)]);
    assert.match(announcements(r)[0].content, /2 of 3 winners could be picked/);
  });
  await test('nobody joined: Vexo says so, and nobody is pinged for it', async () => {
    const { g, box } = await host();
    await giveaway.finish(client, g.id);
    const r = row(g.id);
    assert.deepEqual(r.winner_ids, []);
    const [a] = announcements(r);
    assert.match(a.content, /Giveaway over/);
    assert.doesNotMatch(a.content, /@everyone/);
    assert.deepEqual(a.allowedMentions, { parse: [] });
    assert.match(fieldOf(box.edits[box.edits.length - 1].embeds[0], 'Winner'), /No winner/);
  });
  await test('no Mention Everyone permission: winners are still announced and mentioned, and the logs say what to fix', async () => {
    const { g } = await host();
    await join(OTHER, U(1), g.id);
    chanPerms['b-gw'] = new Set([P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles]);
    await giveaway.finish(client, g.id);
    const r = row(g.id);
    const [a] = announcements(r);
    assert.doesNotMatch(a.content, /@everyone/);
    assert.match(a.content, new RegExp(`<@${U(1)}>`));
    assert.deepEqual(a.allowedMentions, { parse: [], users: [U(1)] });
    assert.ok(logs('b-logs').some((l) => /Giveaway ended/.test(l) && /@everyone was NOT pinged/.test(l) && /Mention @everyone/.test(l)));
  });

  say('== 5. Reroll and cancel ==');
  await test('reroll: a new winner from the remaining entries, never a previous winner, announced with @everyone and logged', async () => {
    const { g } = await host();
    for (let i = 1; i <= 3; i++) await join(OTHER, U(i), g.id);
    await giveaway.finish(client, g.id);
    const seen = [...row(g.id).winner_ids];
    for (let n = 0; n < 2; n++) {
      const it = slash(OTHER, OWNER_B, 'reroll', { id: g.id });
      await command.execute(it);
      const now = row(g.id).winner_ids;
      assert.equal(now.length, 1);
      assert.ok(!seen.includes(now[0]), 'never a previous winner');
      seen.push(now[0]);
    }
    assert.deepEqual([...seen].sort(), [U(1), U(2), U(3)]);
    const re = sent.filter((m) => /GIVEAWAY REROLL/.test(m.content));
    assert.equal(re.length, 2);
    assert.ok(re.every((m) => m.content.startsWith('@everyone ') && m.allowedMentions.parse[0] === 'everyone'));
    // everyone has won once: nothing left to pick, the winner stays
    const last = slash(OTHER, OWNER_B, 'reroll', { id: g.id });
    await command.execute(last);
    assert.match(last.out[0].content, /no other valid entries left/);
    assert.equal(row(g.id).winner_ids[0], seen[2]);
    assert.ok(logs('b-logs').filter((l) => /Giveaway reroll/.test(l)).length >= 3);
  });
  await test('cancel: the box shows Cancelled, no winner, and no @everyone ping anywhere', async () => {
    const { g, box } = await host();
    await join(OTHER, U(1), g.id);
    const it = slash(OTHER, OWNER_B, 'cancel', { id: g.id });
    await command.execute(it);
    const r = row(g.id);
    assert.equal(r.status, 'cancelled');
    assert.deepEqual(r.winner_ids, []);
    assert.match(box.edits[box.edits.length - 1].embeds[0].title, /Cancelled/);
    assert.equal(sent.filter((m) => m.id !== box.id && /@everyone/.test(m.content)).length, 0);
    assert.equal(announcements(r).length, 0);
    assert.ok(logs('b-logs').some((l) => /Giveaway cancelled/.test(l)));
    assert.match((await giveaway.finish(client, g.id)).error, /cancelled/);
  });
  await test('an admin of one server cannot end, reroll or cancel a giveaway of another server', async () => {
    const { g } = await host();
    for (const sub of ['end', 'cancel', 'reroll']) {
      const it = slash(FREE, ADMIN_F, sub, { id: g.id });
      await command.execute(it);
      assert.match(it.out[0].content, /cannot find giveaway/);
    }
    assert.equal(row(g.id).status, 'active');
    const list = slash(FREE, ADMIN_F, 'list');
    await command.execute(list);
    assert.doesNotMatch(list.out[0].content, new RegExp(`#${g.id}\\b`));
    await giveaway.cancel(client, g.id, { by: OWNER_B });
  });

  say('== 6. Restart ==');
  await test('a giveaway that expired while the bot was offline ends at startup; one that is still running is left alone', async () => {
    const a = await host();
    const b = await host();
    await join(OTHER, U(1), a.g.id);
    row(a.g.id).ends_at = new Date(Date.now() - 60000).toISOString(); // its end time passed while offline
    giveaway._test.countTimers.clear();
    await giveaway.startTimer(client);
    giveaway.stopTimer();
    assert.equal(row(a.g.id).status, 'ended');
    assert.deepEqual(row(a.g.id).winner_ids, [U(1)]);
    assert.equal(announcements(row(a.g.id)).filter((m) => m.content.includes(`Giveaway #${a.g.id}]`)).length, 1);
    assert.equal(row(b.g.id).status, 'active');
    assert.match((await join(OTHER, U(2), b.g.id)).content, /You are in/); // its button still works
    await giveaway.cancel(client, b.g.id, { by: OWNER_B });
  });
  await test('a restart in the middle of ending: the winners are announced once, nothing is done twice', async () => {
    const { g } = await host();
    await join(OTHER, U(1), g.id);
    Object.assign(row(g.id), { status: 'ended', settled: false, ended_at: new Date().toISOString() }); // crashed right after closing it
    await giveaway.tick(client);
    await giveaway.tick(client);
    assert.equal(row(g.id).settled, true);
    assert.equal(announcements(row(g.id)).filter((m) => m.content.includes(`Giveaway #${g.id}]`)).length, 1);
  });

  say('== 7. HΛVØCZ ==');
  await test('HΛVØCZ: posts in GIVEAWAY_CHANNEL_ID, pings its game role at the start, winners are announced with @everyone', async () => {
    const { g, box } = await host({}, HOME, REMO);
    assert.equal(g.guild_id, HOME);
    assert.equal(box.ch, 'home-gw');
    assert.match(box.content, /^<@&home-verified> /);
    await join(HOME, U(1), g.id);
    await giveaway.finish(client, g.id, { by: REMO });
    const [a] = announcements(row(g.id));
    assert.match(a.content, /^@everyone /);
    assert.deepEqual(a.allowedMentions, { parse: ['everyone'], users: [U(1)] });
    assert.match(a.content, /open a ticket in <#home-ticket>/); // its own ticket wording
    assert.ok(logs('home-logs').some((l) => /Giveaway ended/.test(l)));
    assert.equal(aiCalls.length, 0);
  });

  say('== 8. Control channel orders (premium) ==');
  const control = require(src('tasks/control.js'));
  await test('"host a giveaway for 1 NFT, 24 hours, 2 winners, only for the Verified role" + a picture: posted, confirmed with a link', async () => {
    aiAnswer = { action: 'host', prize: '1 NFT', winners: 2, duration_minutes: 1440, points_prize: null, required_role: 'Verified', ping_role: null, channel: null };
    const m = order(OTHER, 'b-ctl', OWNER_B, 'host a giveaway for 1 NFT, 24 hours, 2 winners, only for the Verified role', [{ url: 'https://cdn.discordapp.com/attachments/9/9/nft.jpg', name: 'nft.jpg', contentType: 'image/jpeg', size: 9000 }]);
    assert.equal(await control.handleMessage(m), true);
    const g = tables.giveaways[tables.giveaways.length - 1];
    assert.equal(g.prize, '1 NFT');
    assert.equal(g.winners_count, 2);
    assert.equal(g.required_role_id, 'b-verified');
    assert.equal(g.host_id, OWNER_B);
    const hours = (Date.parse(g.ends_at) - Date.now()) / 3600000;
    assert.ok(hours > 23.9 && hours < 24.1, `ends in 24 hours (${hours})`);
    const box = sent.find((x) => x.id === g.message_id);
    assert.equal(box.ch, 'b-gw');
    assert.deepEqual(box.files, ['giveaway.jpg']);
    assert.equal(m.replies.length, 1);
    assert.match(m.replies[0], new RegExp(`https://discord.com/channels/${OTHER}/b-gw/${g.message_id}`));
    assert.equal(aiCalls.length, 1);
    await giveaway.cancel(client, g.id, { by: OWNER_B });
  });
  await test('prize or duration missing: Vexo asks once, then posts', async () => {
    const before = tables.giveaways.length;
    aiAnswer = { action: 'host', prize: '50 USDT', winners: null, duration_minutes: null, points_prize: null, required_role: null, ping_role: null, channel: null };
    const m1 = order(OTHER, 'b-ctl', OWNER_B, 'host a giveaway for 50 USDT');
    assert.equal(await giveaway.handleControl(m1), true);
    assert.match(m1.replies[0], /how long it should run/);
    assert.equal(tables.giveaways.length, before);
    aiAnswer = { action: 'host', prize: null, winners: null, duration_minutes: 120, points_prize: null, required_role: null, ping_role: null, channel: null };
    const m2 = order(OTHER, 'b-ctl', OWNER_B, '2 hours');
    assert.equal(await giveaway.handleControl(m2), true);
    const g = tables.giveaways[tables.giveaways.length - 1];
    assert.equal(tables.giveaways.length, before + 1);
    assert.equal(g.prize, '50 USDT');
    assert.equal(g.winners_count, 1);
    assert.match(m2.replies[0], /giveaway is live/);
    await giveaway.cancel(client, g.id, { by: OWNER_B });
  });
  await test('not a hosting order (a question, a fact): left to the normal control channel flow; no "giveaway" word: no AI call at all', async () => {
    const before = tables.giveaways.length;
    aiAnswer = { action: 'other' };
    assert.equal(await giveaway.handleControl(order(OTHER, 'b-ctl', OWNER_B, 'remember: the giveaway winners are announced on Friday')), false);
    assert.equal(aiCalls.length, 1);
    assert.equal(await giveaway.handleControl(order(OTHER, 'b-ctl', OWNER_B, 'host a rumble at 8 pm')), false);
    assert.equal(aiCalls.length, 1);
    assert.equal(tables.giveaways.length, before);
  });
  await test('free server: giveaway orders are locked (premium), nothing is posted and no AI call is made', async () => {
    const before = tables.giveaways.length;
    aiAnswer = { action: 'host', prize: '1 NFT', duration_minutes: 60 };
    assert.equal(await giveaway.handleControl(order(FREE, 'f-ctl', ADMIN_F, 'host a giveaway for 1 NFT, 1 hour')), false);
    assert.equal(tables.giveaways.length, before);
    assert.equal(aiCalls.length, 0);
  });

  giveaway.stopTimer();
  say(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
