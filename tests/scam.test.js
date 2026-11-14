// Scam protection + X posts channel per server.
// Run: node tests/scam.test.js
// Fully offline: Discord, Supabase and the AI are faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
const OTHER = '200000000000000002'; // customer server in its trial (premium)
const FREE = '300000000000000003'; // customer server on the free plan
const REMO = '111111111111111110';
const OWNER_B = '222222222222222220'; // owner + boss of OTHER
const MEMBER = '333333333333333330';
const SCAMMER = '444444444444444440';
const BOT = '999999999999999999';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, STAFF_ROLE_IDS: '', TRIAL_DAYS: '15', DEFAULT_DAILY_AI_LIMIT: '50',
  SUPPORT_CONTACT: 'Contact remo.sol to pay.', CONTROL_CHANNEL_ID: 'home-ctl', GENERAL_CHANNEL_ID: 'home-general', REDEEM_LOGS_CHANNEL_ID: 'home-logs',
  X_DROP_CHANNEL_ID: 'home-x', X_DROP_POINTS: '10', X_DROP_MAX_PER_DAY: '2', TIMEZONE: 'Asia/Dhaka', ADMIN_ROLE_ID: '', VERIFIED_ROLE_ID: '',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { guilds: [], users: [], point_log: [], x_post_drops: [], scam_actions: [] };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
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
      select: (_c, o) => ((q.head = !!o?.head), api), order: () => api, limit: () => api, gte: () => api,
      eq: (k, v) => (q.f.push((r) => r[k] === v), api),
      insert: (row) => ((q.op = 'insert'), (q.row = row), api),
      update: (p) => ((q.op = 'update'), (q.p = p), api),
      delete: () => ((q.op = 'delete'), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = (tables[table] ||= []);
      if (q.op === 'insert') {
        // the key the migration creates: one credit per X post PER SERVER
        if (table === 'x_post_drops' && rows.some((r) => r.guild_id === q.row.guild_id && r.status_id === q.row.status_id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const r = { id: rows.length + 1, ...clone(q.row) };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      const m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'delete') {
        for (const r of m) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      if (q.head) return { count: m.length, data: null, error: null };
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- fake AI
const aiCalls = [];
let aiAnswer = { verdict: 'unsure', confidence: 0.5, category: 'other', reason: 'not clear' };
global.fetch = async (_url, opts) => {
  const body = JSON.parse(opts.body);
  aiCalls.push({ system: body.messages[0].content, user: body.messages[1].content });
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(aiAnswer) } }] }), text: async () => '' };
};

// ---------------------------------------------------------------- fake Discord
const { PermissionFlagsBits: P } = require('discord.js');
const sent = []; // { ch, content, embeds, components }
const deleted = [];
const kicked = [];
const banned = [];
const dms = [];
const channels = {};
const byId = {}; // message id -> message (for fetchReference)
function chan(id, guildId) {
  return (channels[id] ||= {
    id, guildId, type: 0, isTextBased: () => true,
    send: async (m) => {
      const rec = { ch: id, content: m.content || '', embeds: (m.embeds || []).map((e) => e.toJSON?.() || e), components: (m.components || []).map((c) => c.toJSON?.() || c) };
      sent.push(rec);
      return { id: `s${sent.length}`, delete: async () => {} };
    },
    messages: { fetch: async () => new Map(), delete: async (mid) => deleted.push(mid) },
  });
}
const client = { user: { id: BOT, username: 'Vexo' }, channels: { fetch: async (id) => channels[id] || null }, users: { fetch: async (id) => ({ id, tag: 'x#0', send: async (m) => dms.push({ to: id, text: m.content }) }) } };
const botPerms = new Set([P.KickMembers, P.BanMembers, P.ManageMessages]);
function guildOf(id) {
  const g = {
    id, name: id === OTHER ? 'Moon Cats' : 'G', ownerId: id === OTHER ? OWNER_B : REMO, client,
    members: {
      me: { displayName: 'Vexo', permissions: { has: (p) => botPerms.has(p) }, roles: { highest: { position: 10 } } },
      fetch: async () => null,
      ban: async (userId, o) => banned.push({ guildId: id, userId, ...o }),
    },
  };
  return g;
}
const guildsFake = { [HOME]: guildOf(HOME), [OTHER]: guildOf(OTHER), [FREE]: guildOf(FREE) };
let seq = 0;
function msg(guildId, channelId, authorId, content, { perms = [], roles = [], rolePos = 1, name = 'member', replyTo = null, mentions = [] } = {}) {
  const guild = guildsFake[guildId];
  const m = {
    id: `m${++seq}`, guildId, guild, channelId, channel: chan(channelId, guildId), client, content, createdTimestamp: Date.now(),
    author: { id: authorId, bot: false, username: name, tag: `${name}#0`, createdTimestamp: 0, send: async (d) => dms.push({ to: authorId, text: d.content }) },
    mentions: { users: new Map(mentions.map((id) => [id, {}])), roles: new Map(), members: new Map(), repliedUser: null, everyone: false },
    reference: replyTo ? { messageId: replyTo.id } : null,
    fetchReference: async () => replyTo,
    replies: [],
    reply: async (r) => (m.replies.push(typeof r === 'string' ? r : r.content), { id: 'r', delete: async () => {} }),
    delete: async () => deleted.push(m.id),
  };
  m.member = {
    id: authorId, displayName: name, user: m.author,
    roles: { cache: { has: (id) => roles.includes(id), some: () => false }, highest: { position: rolePos } },
    permissions: { has: (p) => perms.includes(p) },
    kick: async (why) => kicked.push({ guildId, userId: authorId, why }),
    timeout: async () => {},
  };
  byId[m.id] = m;
  return m;
}
function button(guildId, userId, customId, perms = []) {
  const it = {
    guildId, guild: guildsFake[guildId], client, customId, user: { id: userId }, memberPermissions: { has: (p) => perms.includes(p) },
    replies: [], edits: [],
    reply: async (m) => it.replies.push(m), followUp: async (m) => it.replies.push(m), deferUpdate: async () => {}, editReply: async (m) => it.edits.push(m),
  };
  return it;
}
const reset = () => [sent, deleted, kicked, banned, dms, aiCalls].forEach((a) => (a.length = 0));

// ---------------------------------------------------------------- load the bot
const guilds = require(src('guilds.js'));
const scam = require(src('scam.js'));
const automod = require(src('automod.js'));
const xDrop = require(src('xDrop.js'));
const setup = require(src('setup.js'));

const quiet = { log: console.log };
Object.assign(console, { log: () => {}, debug: () => {}, warn: () => {}, error: () => {} });
const say = (...a) => quiet.log(...a);
let passed = 0;
let failed = 0;
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
const level = (text, o) => scam.classify(text, o).level;

(async () => {
  tables.guilds.push(
    { guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: {}, ai_calls_today: 0 },
    { guild_id: OTHER, name: 'Moon Cats', status: 'active', boss_user_id: OWNER_B, trial_ends_at: iso(14), ai_calls_today: 0, settings: { channels: { control: 'b-ctl', logs: 'b-logs', xDrop: 'b-x' }, automod: { allowedDomains: ['mooncats.xyz'] } } },
    { guild_id: FREE, name: 'Free Frogs', status: 'active', boss_user_id: MEMBER, trial_ends_at: iso(-5), ai_calls_today: 0, settings: { channels: { control: 'f-ctl', logs: 'f-logs', xDrop: 'f-x' } } }
  );
  for (const [id, g] of [['home-logs', HOME], ['home-x', HOME], ['home-general', HOME], ['b-logs', OTHER], ['b-ctl', OTHER], ['b-chat', OTHER], ['b-x', OTHER], ['f-logs', FREE], ['f-x', FREE], ['f-chat', FREE]]) chan(id, g);
  await guilds.load();

  say('== 1. Rules: what is never a scam ==');
  await test('GIF and media links are ignored', async () => {
    for (const t of ['https://tenor.com/view/cat-dance-gif-12345', 'https://media.giphy.com/media/abc/giphy.gif', 'https://cdn.discordapp.com/attachments/1/2/funny.png', 'https://media.discordapp.net/attachments/1/2/clip.mp4', 'lol https://i.somehost.net/pic.gif', '😂😂😂 <:pepe:123456789012345678>']) {
      assert.equal(level(t), 'clean', t);
    }
    const m = msg(OTHER, 'b-chat', MEMBER, 'free nitro lol https://tenor.com/view/nitro-gif-999');
    assert.equal(await automod.handle(m), false);
    assert.deepEqual([deleted.length, kicked.length, banned.length, sent.length, aiCalls.length], [0, 0, 0, 0, 0]);
  });
  await test('normal X, Twitter and YouTube links are ignored, also with words like "airdrop" or "claim"', async () => {
    for (const t of ['https://x.com/someone/status/1234567890', 'check this airdrop news https://twitter.com/a/status/99', 'claim guide https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'wallet tips https://phantom.app/learn']) {
      assert.equal(level(t), 'clean', t);
    }
    const m = msg(OTHER, 'b-chat', MEMBER, 'free mint thread, claim info here https://x.com/moon/status/123456');
    assert.equal(await automod.handle(m), false);
    assert.deepEqual([deleted.length, kicked.length, sent.length, aiCalls.length], [0, 0, 0, 0]);
  });
  await test('a plain link, normal chat, jokes and wallet questions are never punished', () => {
    for (const t of ['look at this https://some-blog.net/article/42', 'how do I connect my wallet?', 'when can we claim the airdrop?', 'anyone want free nitro lol', 'that mint was a scam imo', 'gm gm', 'dm me if you want to play later', 'our site https://mooncats.xyz/claim connect wallet to mint']) {
      assert.equal(level(t, { allowedDomains: ['mooncats.xyz'] }), 'clean', t);
    }
  });

  say('== 2. Rules: what is caught ==');
  await test('"I buy old phantom wallet" is caught: message deleted, member kicked, DM sent, logged', async () => {
    for (const t of ['I buy old phantom wallet', 'Buying old wallets, good price', 'WTB aged discord accounts', 'i will pay for your used metamask wallet', 'looking to buy verified binance account']) assert.equal(level(t), 'scam', t);
    assert.equal(level('I want to buy a ledger for my wallet'), 'clean');
    const m = msg(OTHER, 'b-chat', SCAMMER, 'I buy old phantom wallet, dm me');
    assert.equal(await automod.handle(m), true);
    assert.deepEqual(deleted, [m.id]);
    assert.equal(kicked.length, 1);
    assert.equal(banned.length, 0);
    assert.equal(dms.length, 1);
    assert.equal(aiCalls.length, 0); // rules only, no AI cost
    const log = sent.find((s) => s.ch === 'b-logs');
    assert.ok(log, 'logged in vexo-logs');
    const e = log.embeds[0];
    assert.ok(e.description.includes('I buy old phantom wallet'), 'full message text kept in the log');
    assert.ok(JSON.stringify(e.fields).includes(SCAMMER));
    assert.equal(tables.scam_actions.at(-1).action, 'kick');
  });
  await test('a phishing link is caught: message deleted, member banned', async () => {
    for (const t of ['Free nitro for everyone https://dlscord-gift.com/claim', 'claim your airdrop now https://phantom-wallet.app/connect', 'verify your wallet: https://metamask.io.secure-login.xyz', 'steam gift 50$ https://steamcommunlty.com/gift/123', '[discord.com/nitro](https://evil-site.ru/x)', '@everyone connect wallet to claim airdrop, hurry https://sol-drop.xyz']) {
      assert.equal(level(t), 'serious', t);
    }
    const m = msg(OTHER, 'b-chat', SCAMMER, 'Free nitro for everyone https://dlscord-gift.com/claim');
    assert.equal(await automod.handle(m), true);
    assert.deepEqual(deleted, [m.id]);
    assert.equal(banned.length, 1);
    assert.equal(banned[0].userId, SCAMMER);
    assert.equal(kicked.length, 0);
    const e = sent.find((s) => s.ch === 'b-logs').embeds[0];
    assert.ok(JSON.stringify(e).includes('dlscord-gift.com'), 'the link is in the log');
  });
  await test('fake support, fake giveaway and tricks (hxxp, [.] , look-alike letters, user@host) are caught', () => {
    assert.equal(level('you won! claim your prize here https://prize-hub.top/win'), 'scam');
    assert.equal(level('need help? open a ticket here https://help-desk-center.top/t'), 'scam');
    assert.equal(level('free nitro hxxps://dіscord-nitro[.]gift/abc'), 'serious');
    assert.equal(scam.extractLinks('https://discord.com@evil.ru/login')[0].host, 'evil.ru'); // the real target, not discord.com
    assert.equal(level('claim reward https://discord.com@evil.ru/login'), 'serious');
    assert.equal(level('DM me for support'), 'suspicious');
    assert.equal(level('DM me for support', { impersonating: true }), 'serious');
    assert.equal(level('check https://bit.ly/3abcd'), 'suspicious');
  });
  await test('extra blocked phrases from /automod scamphrase are caught', () => {
    assert.equal(level('join my alpha signals group today', { blockedPhrases: ['alpha signals group'] }), 'scam');
    assert.equal(level('join my alpha signals group today'), 'clean');
  });

  say('== 3. Who is never touched ==');
  await test('an admin is never punished (nor a moderator, the owner, the boss or a trusted role)', async () => {
    const text = 'Free nitro for everyone https://dlscord-gift.com/claim';
    for (const m of [
      msg(OTHER, 'b-chat', MEMBER, text, { perms: [P.Administrator] }),
      msg(OTHER, 'b-chat', MEMBER, text, { perms: [P.ManageGuild] }),
      msg(OTHER, 'b-chat', MEMBER, text, { perms: [P.ManageMessages] }),
      msg(OTHER, 'b-chat', OWNER_B, text),
    ]) {
      assert.equal(await automod.handle(m), false);
    }
    await guilds.patchSettings(OTHER, { scam: { trustedRoleIds: ['role-trusted'] } });
    assert.equal(await automod.handle(msg(OTHER, 'b-chat', MEMBER, text, { roles: ['role-trusted'] })), false);
    await guilds.patchSettings(OTHER, { scam: { trustedRoleIds: [] } });
    assert.deepEqual([deleted.length, kicked.length, banned.length, sent.length], [0, 0, 0, 0]);
  });
  await test('a member with a role above Vexo is not banned: message removed and the log says what to fix', async () => {
    const m = msg(OTHER, 'b-chat', SCAMMER, 'Free nitro for everyone https://dlscord-gift.com/claim', { rolePos: 50 });
    assert.equal(await automod.handle(m), true);
    assert.deepEqual([deleted.length, kicked.length, banned.length, dms.length], [1, 0, 0, 0]);
    const log = sent.find((s) => s.ch === 'b-logs');
    assert.ok(/What to fix/.test(JSON.stringify(log.embeds[0])) && /above/.test(JSON.stringify(log.embeds[0])));
  });
  await test('missing Ban Members permission: nobody is banned, the log tells the admin what to turn on', async () => {
    botPerms.delete(P.BanMembers);
    const m = msg(OTHER, 'b-chat', SCAMMER, 'Free nitro for everyone https://dlscord-gift.com/claim');
    await automod.handle(m);
    botPerms.add(P.BanMembers);
    assert.equal(banned.length, 0);
    assert.ok(/Ban Members/.test(JSON.stringify(sent.find((s) => s.ch === 'b-logs').embeds[0])));
    assert.ok(/Ban Members/.test(scam.permissionWarning({ members: { me: { permissions: { has: () => false } } } })));
  });
  await test('HΛVØCZ: off by default (nothing happens), free servers: locked', async () => {
    assert.equal(scam.settings(HOME).enabled, false);
    assert.equal(scam.settings(OTHER).enabled, true);
    assert.equal(scam.settings(OTHER).mode, 'auto');
    assert.equal(await automod.handle(msg(HOME, 'home-general', SCAMMER, 'I buy old phantom wallet')), false);
    assert.equal(await automod.handle(msg(FREE, 'f-chat', SCAMMER, 'I buy old phantom wallet')), false);
    assert.deepEqual([deleted.length, kicked.length, banned.length, sent.length], [0, 0, 0, 0]);
  });

  say('== 4. Unsure -> AI -> alert with buttons ==');
  await test('suspicious + AI unsure: nothing deleted, nobody touched, alert with Kick / Ban / Ignore in the logs', async () => {
    aiAnswer = { verdict: 'unsure', confidence: 0.5, category: 'other', reason: 'could be a normal offer' };
    const m = msg(OTHER, 'b-chat', MEMBER, 'DM me for support with your account issue', { name: 'bob' });
    assert.equal(await automod.handle(m), false);
    assert.equal(aiCalls.length, 1);
    assert.deepEqual([deleted.length, kicked.length, banned.length], [0, 0, 0]);
    const alert = sent.find((s) => s.ch === 'b-logs');
    const ids = alert.components[0].components.map((c) => c.custom_id);
    assert.deepEqual(ids.map((i) => i.split(':')[1]), ['kick', 'ban', 'ignore']);
    assert.ok(ids[0].includes(MEMBER) && ids[0].includes(m.id));
    assert.equal(tables.guilds.find((g) => g.guild_id === OTHER).ai_calls_today, 1); // counted toward the daily AI limit
  });
  await test('suspicious + AI says scam with high confidence: deleted and kicked; AI says not a scam: nothing', async () => {
    aiAnswer = { verdict: 'scam', confidence: 0.95, category: 'money_offer', reason: 'advance-fee money offer' };
    const m = msg(OTHER, 'b-chat', 'money-1', 'I will teach 10 people how to earn $5000 in 3 days, message me on telegram', { name: 'carl' });
    assert.equal(await automod.handle(m), true);
    assert.deepEqual([deleted.length, kicked.length], [1, 1]);
    reset();
    aiAnswer = { verdict: 'not_scam', confidence: 0.9, category: 'none', reason: 'normal link share' };
    const ok = msg(OTHER, 'b-chat', MEMBER, 'new mint is live on https://launchpad-site.io/moon go take a look', { name: 'dana' });
    assert.equal(await automod.handle(ok), false);
    assert.equal(aiCalls.length, 1);
    assert.deepEqual([deleted.length, kicked.length, banned.length, sent.length], [0, 0, 0, 0]);
  });
  await test('AI limit reached: never treated as a scam (weak signal ignored, strong signal only alerts)', async () => {
    const g = tables.guilds.find((r) => r.guild_id === OTHER);
    const before = g.ai_calls_today;
    g.ai_calls_today = 50;
    const weak = msg(OTHER, 'b-chat', MEMBER, 'free stuff over at https://random-shop.net/deals', { name: 'eve' });
    assert.equal(await automod.handle(weak), false);
    const strong = msg(OTHER, 'b-chat', MEMBER, 'please DM me for support and refund', { name: 'finn' });
    assert.equal(await automod.handle(strong), false);
    g.ai_calls_today = before;
    assert.equal(aiCalls.length, 0);
    assert.deepEqual([deleted.length, kicked.length, banned.length], [0, 0, 0]);
    assert.equal(sent.filter((s) => s.ch === 'b-logs').length, 1); // only the strong one alerts
  });
  await test('alert buttons: members cannot press them, an admin can; Ignore does nothing', async () => {
    const no = button(OTHER, MEMBER, `scam:kick:${SCAMMER}:b-chat:m1`);
    await scam.handleButton(no);
    assert.ok(/Only admins/.test(no.replies[0].content));
    assert.equal(kicked.length + banned.length, 0);
    const ban = button(OTHER, OWNER_B, `scam:ban:${SCAMMER}:b-chat:m1`, [P.BanMembers]);
    await scam.handleButton(ban);
    assert.equal(banned.length, 1);
    assert.deepEqual(deleted, ['m1']);
    assert.ok(/Banned by/.test(ban.edits[0].content));
    const ig = button(OTHER, OWNER_B, 'scam:ignore', [P.ManageGuild]);
    await scam.handleButton(ig);
    assert.ok(/Ignored by/.test(ig.edits[0].content));
    assert.equal(banned.length, 1);
    // the owner can never be the target
    const own = button(OTHER, OWNER_B, `scam:ban:${OWNER_B}:0:0`, [P.ManageGuild]);
    await scam.handleButton(own);
    assert.equal(banned.length, 1);
  });

  say('== 5. Serious cases and modes ==');
  await test('kicked before, comes back and repeats: banned instead of kicked', async () => {
    tables.scam_actions.push({ guild_id: OTHER, user_id: 'repeat-1', action: 'kick' });
    const m = msg(OTHER, 'b-chat', 'repeat-1', 'buying old phantom wallets, dm');
    await automod.handle(m);
    assert.deepEqual([kicked.length, banned.length], [0, 1]);
  });
  await test('the same suspicious message in 3 channels: banned without any AI call on the third', async () => {
    aiAnswer = { verdict: 'unsure', confidence: 0.4, category: 'other', reason: 'unclear' };
    const text = 'passive income, ask me how, dm me now friends';
    for (const c of ['b-c1', 'b-c2', 'b-c3']) chan(c, OTHER);
    await automod.handle(msg(OTHER, 'b-c1', 'spam-1', text, { name: 'gus' }));
    await automod.handle(msg(OTHER, 'b-c2', 'spam-1', text, { name: 'gus' }));
    const third = msg(OTHER, 'b-c3', 'spam-1', text, { name: 'gus' });
    assert.equal(await automod.handle(third), true);
    assert.equal(kicked.length + banned.length, 1);
    assert.ok(deleted.includes(third.id) && deleted.length >= 3, 'the copies in the other channels are removed too');
  });
  await test('alert-only mode: the scam message is deleted, nobody is kicked or banned, admins get buttons', async () => {
    await guilds.patchSettings(OTHER, { scam: { mode: 'alert' } });
    const m = msg(OTHER, 'b-chat', SCAMMER, 'I buy old phantom wallet');
    assert.equal(await automod.handle(m), true);
    await guilds.patchSettings(OTHER, { scam: { mode: 'auto' } });
    assert.deepEqual([deleted.length, kicked.length, banned.length], [1, 0, 0]);
    assert.equal(sent.find((s) => s.ch === 'b-logs').components.length, 1);
  });
  await test('scam protection off: nothing happens', async () => {
    await guilds.patchSettings(OTHER, { scam: { enabled: false } });
    assert.equal(await automod.handle(msg(OTHER, 'b-chat', SCAMMER, 'I buy old phantom wallet')), false);
    await guilds.patchSettings(OTHER, { scam: { enabled: true } });
    assert.equal(deleted.length + kicked.length, 0);
  });

  say('== 6. Member reports ==');
  await test('a false report does nothing (normal chat, a GIF, an X link, or a report against an admin)', async () => {
    const targets = [
      msg(OTHER, 'b-chat', MEMBER, 'gm everyone, how is your day going', { name: 'hana' }),
      msg(OTHER, 'b-chat', MEMBER, 'https://tenor.com/view/dance-gif-1', { name: 'hana' }),
      msg(OTHER, 'b-chat', MEMBER, 'https://x.com/moon/status/555', { name: 'hana' }),
      msg(OTHER, 'b-chat', MEMBER, 'Free nitro https://dlscord-gift.com/claim', { perms: [P.Administrator], name: 'hana' }),
    ];
    for (const t of targets) {
      const report = msg(OTHER, 'b-chat', 'reporter-1', 'this is a scam!! ban him', { replyTo: t, name: 'ivan' });
      assert.equal(await automod.handle(report), false);
      assert.equal(report.replies.length, 0);
    }
    assert.deepEqual([deleted.length, kicked.length, banned.length, sent.length, aiCalls.length], [0, 0, 0, 0, 0]);
  });
  await test('a report with a link: the AI decides, not the reporter (AI says fine = nothing happens)', async () => {
    aiAnswer = { verdict: 'not_scam', confidence: 0.92, category: 'none', reason: 'a normal blog link' };
    const t = msg(OTHER, 'b-chat', 'blogger-1', 'my blog post https://some-blog.net/post/1', { name: 'jill' });
    const report = msg(OTHER, 'b-chat', 'reporter-2', 'scam link', { replyTo: t, name: 'ken' });
    assert.equal(await automod.handle(report), false);
    assert.equal(aiCalls.length, 1);
    assert.deepEqual([deleted.length, kicked.length, banned.length, sent.length], [0, 0, 0, 0]);
  });
  await test('a true report: Vexo checks it itself, acts, logs who reported, and thanks the reporter', async () => {
    scam._test.posts.clear();
    const t = msg(OTHER, 'b-chat', 'fresh-scammer', 'I buy old phantom wallet');
    const report = msg(OTHER, 'b-chat', 'reporter-3', 'scam', { replyTo: t, name: 'lea' });
    assert.equal(await automod.handle(report), true);
    assert.deepEqual(deleted, [t.id]);
    assert.equal(kicked.length, 1);
    assert.equal(kicked[0].userId, 'fresh-scammer');
    assert.ok(/Thanks for the report/.test(report.replies[0]));
    assert.ok(JSON.stringify(sent.find((s) => s.ch === 'b-logs').embeds[0]).includes('reporter-3'));
  });
  await test('reports are rate-limited per member', async () => {
    scam._test.reports.clear();
    let answered = 0;
    for (let i = 0; i < 5; i++) {
      const t = msg(OTHER, 'b-chat', `sc-${i}`, 'I buy old phantom wallet');
      const report = msg(OTHER, 'b-chat', 'reporter-4', 'scammer here', { replyTo: t, name: 'max' });
      if (await automod.handle(report)) answered++;
    }
    assert.equal(answered, 3);
  });

  say('== 7. Dry run ==');
  await test('/automod test shows what would happen without doing anything', async () => {
    const a = await scam.dryRun('I buy old phantom wallet', OTHER);
    assert.equal(a.res.level, 'scam');
    assert.ok(/kicked/.test(a.would));
    const b = await scam.dryRun('https://tenor.com/view/cat-gif-1', OTHER);
    assert.ok(/Nothing/.test(b.would));
    const c = await scam.dryRun('Free nitro https://dlscord-gift.com/claim', OTHER);
    assert.ok(/banned/.test(c.would));
    assert.deepEqual([deleted.length, kicked.length, banned.length, sent.length], [0, 0, 0, 0]);
  });

  await test('/automod scam, scamphrase, trustrole, test and /status, /help work', async () => {
    const M = [P.ManageGuild];
    const slash = (guildId, name, sub, opts = {}) => {
      const it = {
        guildId, guild: guildsFake[guildId], commandName: name, client, user: { id: OWNER_B }, memberPermissions: { has: (p) => M.includes(p) }, replies: [],
        options: { getSubcommand: () => sub, getString: (n) => opts[n] ?? null, getBoolean: (n) => opts[n] ?? null, getInteger: (n) => opts[n] ?? null, getRole: (n) => opts[n] ?? null },
        reply: async (m) => it.replies.push(m), deferReply: async () => {}, editReply: async (m) => it.replies.push(m),
      };
      return it;
    };
    const out = (it) => {
      const m = it.replies.at(-1);
      return typeof m === 'string' ? m : m.content || JSON.stringify((m.embeds || []).map((e) => e.toJSON?.() || e));
    };
    const am = require(src('commands/automod.js'));
    let it = slash(OTHER, 'automod', 'scam', { on: true, mode: 'alert' });
    await am.execute(it);
    assert.equal(scam.settings(OTHER).mode, 'alert');
    assert.ok(/alert only/.test(out(it)));
    await am.execute(slash(OTHER, 'automod', 'scam', { mode: 'auto' }));
    assert.deepEqual([scam.settings(OTHER).enabled, scam.settings(OTHER).mode], [true, 'auto']);
    await am.execute(slash(OTHER, 'automod', 'scamphrase', { phrase: 'Alpha Signals Group' }));
    assert.deepEqual(scam.settings(OTHER).blockedPhrases, ['alpha signals group']);
    await am.execute(slash(OTHER, 'automod', 'scamphrase', { phrase: 'alpha signals group', remove: true }));
    assert.deepEqual(scam.settings(OTHER).blockedPhrases, []);
    await am.execute(slash(OTHER, 'automod', 'trustrole', { role: { id: 'role-og' } }));
    assert.deepEqual(scam.settings(OTHER).trustedRoleIds, ['role-og']);
    await am.execute(slash(OTHER, 'automod', 'trustrole', { role: { id: 'role-og' }, remove: true }));
    assert.deepEqual(scam.settings(OTHER).trustedRoleIds, []);
    assert.deepEqual(scam.settings(OTHER).allowedDomains, ['mooncats.xyz']); // the /automod allowlink list is kept
    it = slash(OTHER, 'automod', 'test', { text: 'I buy old phantom wallet' });
    await am.execute(it);
    assert.ok(/Dry run/.test(out(it)) && /kicked/.test(out(it)));
    // HΛVØCZ: the switch exists and is off until turned on
    it = slash(HOME, 'automod', 'status');
    await am.execute(it);
    assert.ok(/Scam protection/.test(out(it)) && /⬜ off {2}mode/.test(out(it)));
    it = slash(OTHER, 'status');
    await require(src('commands/status.js')).execute(it);
    assert.ok(/Scam protection/.test(out(it)) && /X posts: <#b-x>/.test(out(it)));
    it = slash(OTHER, 'help');
    await require(src('commands/help.js')).execute(it);
    assert.ok(/X posts channel <#b-x>/.test(out(it)) && /automod test/.test(out(it)));
    assert.deepEqual([deleted.length, kicked.length, banned.length], [0, 0, 0]);
  });

  say('== 8. Permissions ==');
  await test('the invite link and the permission check include Kick Members and Ban Members (no Administrator)', () => {
    const names = setup.NEEDED.map(([, n]) => n);
    assert.ok(names.includes('Kick Members') && names.includes('Ban Members'));
    assert.equal(setup.INVITE_PERMISSIONS, 1099780320342n);
    assert.equal(setup.INVITE_PERMISSIONS & P.Administrator, 0n);
  });

  say('== 9. X posts channel per server ==');
  await test('each server has its own X channel: HΛVØCZ from .env, others from their settings', () => {
    assert.equal(guilds.settings(HOME).channels.xDrop, 'home-x');
    assert.equal(guilds.settings(OTHER).channels.xDrop, 'b-x');
    assert.equal(setup.KEYS.xDrop.name, 'x-posts');
    assert.equal(xDrop.isXChannel('home-x'), true); // no server given = HΛVØCZ, as before
    assert.equal(xDrop.isXChannel('b-x', OTHER), true);
    assert.equal(xDrop.isXChannel('b-x', HOME), false);
  });
  await test('customer server: an X link in its X channel gives the same points, saved under that server', async () => {
    const m = msg(OTHER, 'b-x', MEMBER, 'my post https://x.com/moon/status/1001');
    assert.equal(await xDrop.handle(m), true);
    assert.equal(m.replies.length, 1);
    assert.ok(m.replies[0].includes('10'));
    assert.equal(tables.users.find((u) => u.guild_id === OTHER && u.user_id === MEMBER).points, 10);
    assert.equal(tables.users.some((u) => u.guild_id === HOME), false);
    assert.equal(tables.x_post_drops[0].guild_id, OTHER);
    // not in another channel, and not without a valid link
    assert.equal(await xDrop.handle(msg(OTHER, 'b-chat', MEMBER, 'https://x.com/moon/status/1002')), false);
    assert.equal(await xDrop.handle(msg(OTHER, 'b-x', MEMBER, 'no link here')), false);
  });
  await test('duplicate link: silent, no points. Daily cap: same as HΛVØCZ', async () => {
    const dup = msg(OTHER, 'b-x', 'other-member', 'https://twitter.com/moon/status/1001');
    assert.equal(await xDrop.handle(dup), true);
    assert.equal(dup.replies.length, 0);
    await xDrop.handle(msg(OTHER, 'b-x', MEMBER, 'https://x.com/moon/status/1003')); // 2nd credited drop today
    const third = msg(OTHER, 'b-x', MEMBER, 'https://x.com/moon/status/1004'); // over X_DROP_MAX_PER_DAY=2
    assert.equal(await xDrop.handle(third), true);
    assert.equal(third.replies.length, 0);
    assert.equal(tables.users.find((u) => u.guild_id === OTHER && u.user_id === MEMBER).points, 20);
  });
  await test('the same X post can be credited once in HΛVØCZ too (separate per server); HΛVØCZ works as before', async () => {
    const m = msg(HOME, 'home-x', MEMBER, 'https://x.com/moon/status/1001');
    assert.equal(await xDrop.handle(m), true);
    assert.equal(m.replies.length, 1);
    assert.equal(tables.users.find((u) => u.guild_id === HOME && u.user_id === MEMBER).points, 10);
    assert.equal(tables.users.find((u) => u.guild_id === OTHER && u.user_id === MEMBER).points, 20);
  });
  await test('free server: the X channel gives nothing (points are premium)', async () => {
    const m = msg(FREE, 'f-x', MEMBER, 'https://x.com/frog/status/2001');
    assert.equal(await xDrop.handle(m), false);
    assert.equal(m.replies.length, 0);
    assert.equal(tables.users.some((u) => u.guild_id === FREE), false);
  });

  say(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
