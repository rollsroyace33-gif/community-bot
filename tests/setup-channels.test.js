// Upgrade phase 2: automatic setup of the NFT Radar, SOL Radar and Get Vexo Assistant channels.
// Run: node tests/setup-channels.test.js
// Fully offline: Discord and Supabase are faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
const A = '200000000000000002'; // customer server
const B = '300000000000000003'; // another customer server
const REMO = '111111111111111110';
const BOT = '999999999999999999';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, TRIAL_DAYS: '15', CONTROL_CHANNEL_ID: 'home-ctl', REDEEM_LOGS_CHANNEL_ID: 'home-logs',
  NFT_RADAR_CHANNEL_ID: 'home-nft', SOL_RADAR_CHANNEL_ID: 'home-sol', VEXO_ASSISTANT_CHANNEL_ID: 'home-assistant', TIMEZONE: 'Asia/Dhaka',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase (only what guilds.js uses)
const tables = { guilds: [] };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const fakeDb = {
  rpc: async () => ({ data: 0, error: null }),
  from(table) {
    const q = { op: 'select', f: [], single: false };
    const api = {
      select: () => api, order: () => api, limit: () => api,
      eq: (k, v) => (q.f.push((r) => r[k] === v), api),
      insert: (row) => ((q.op = 'insert'), (q.row = row), api),
      update: (p) => ((q.op = 'update'), (q.p = p), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = (tables[table] ||= []);
      if (q.op === 'insert') {
        const r = { settings: {}, ...clone(q.row) };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      const m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- fake Discord server
const { PermissionFlagsBits: P, ChannelType } = require('discord.js');
let seq = 0;
function fakeGuild(id, { perms = null, failOn = null } = {}) {
  const list = new Map();
  list.find = (fn) => [...list.values()].find(fn);
  const sent = [];
  const add = (c) => {
    const ch = { id: `c${++seq}`, parentId: null, type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }), send: async (m) => sent.push({ ch: ch.name, ...m }), ...c };
    list.set(ch.id, ch);
    return ch;
  };
  const guild = {
    id, name: `Server ${id.slice(0, 3)}`, ownerId: REMO, sent, add, failOn, created: [], systemChannel: null,
    client: { user: { id: BOT } },
    members: { me: { id: BOT, permissions: { has: (bit) => (perms ? perms.has(bit) : true) } }, fetchMe: async () => guild.members.me },
    channels: {
      cache: list,
      fetch: async () => list,
      create: async (o) => {
        if (guild.failOn && o.name === guild.failOn) {
          const err = new Error('Discord is having a moment');
          throw err;
        }
        guild.created.push(o.name);
        return add({ name: o.name, type: o.type, parentId: o.parent || null, topic: o.topic, overwrites: o.permissionOverwrites });
      },
    },
  };
  return guild;
}
const textNamed = (guild, name) => [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText && c.name === name);

// ---------------------------------------------------------------- load the bot
const guilds = require(src('guilds.js'));
const setup = require(src('setup.js'));
const plans = require(src('plans.js'));

const quiet = { log: console.log };
Object.assign(console, { log: () => {}, debug: () => {}, warn: () => {}, error: () => {} });
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
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString();
const NFT = '📡・nft-radar';
const SOL = '📈・sol-radar';
const ASSIST = '🤖・get-vexo-assistant';
async function freshServer(id, opts) {
  tables.guilds = tables.guilds.filter((r) => r.guild_id !== id);
  tables.guilds.push({ guild_id: id, name: 'Test', status: 'active', boss_user_id: REMO, trial_ends_at: iso(10), ai_calls_today: 0, settings: {} });
  await guilds.load();
  return fakeGuild(id, opts);
}

(async () => {
  tables.guilds.push({ guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: {}, ai_calls_today: 0 });
  await guilds.load();

  say('== 1. A new server ==');
  await test('automatic setup creates 📡・nft-radar and 📈・sol-radar in the Vexo category and saves their IDs for that server', async () => {
    const g = await freshServer(A);
    const res = await setup.ensureChannels(g);
    assert.equal(res.error, null);
    assert.ok(res.created.includes('nftRadar') && res.created.includes('solRadar'));
    const c = guilds.settings(A).channels;
    const nft = g.channels.cache.get(c.nftRadar);
    const sol = g.channels.cache.get(c.solRadar);
    assert.equal(nft.name, NFT);
    assert.equal(sol.name, SOL);
    const category = [...g.channels.cache.values()].find((x) => x.type === ChannelType.GuildCategory && x.name === 'Vexo');
    assert.equal(nft.parentId, category.id);
    assert.equal(sol.parentId, category.id);
    // members can read but not write; the bot can write
    for (const ch of [nft, sol]) {
      assert.ok(ch.overwrites.some((o) => o.id === A && o.deny.includes(P.SendMessages)));
      assert.ok(ch.overwrites.some((o) => o.id === BOT && o.allow.includes(P.SendMessages)));
    }
    // everything that existed before is still created too
    for (const k of ['control', 'marketplace', 'rumble', 'logs', 'xDrop', 'giveaway']) assert.ok(c[k === 'xDrop' ? 'xDrop' : k], k);
  });
  await test('Personal Vexo is off by default: no get-vexo-assistant channel, and the setting stays empty', async () => {
    const g = await freshServer(A);
    const res = await setup.ensureChannels(g);
    assert.ok(!res.created.includes('assistant'));
    assert.equal(textNamed(g, ASSIST).length, 0);
    assert.equal(guilds.settings(A).personalVexo, false);
    assert.equal(guilds.settings(A).channels.assistant, '');
    assert.equal(plans.hasFeature(A, 'personalVexo'), false);
  });

  say('== 2. No duplicates ==');
  await test('running setup again (restart, /setup, added again) creates nothing new', async () => {
    const g = await freshServer(A);
    await setup.ensureChannels(g);
    const count = g.channels.cache.size;
    const before = clone(guilds.settings(A).channels);
    for (let i = 0; i < 3; i++) {
      const res = await setup.ensureChannels(g);
      assert.deepEqual(res.created, []);
    }
    assert.equal(g.channels.cache.size, count);
    assert.deepEqual(guilds.settings(A).channels, before);
    assert.equal(textNamed(g, NFT).length, 1);
    assert.equal(textNamed(g, SOL).length, 1);
  });
  await test('channels that already exist are reused: same name anywhere in the server, or the plain name without the emoji', async () => {
    const g = await freshServer(A);
    const other = g.add({ name: 'Community', type: ChannelType.GuildCategory });
    const nft = g.add({ name: NFT, parentId: other.id }); // made by the admin in another category
    const sol = g.add({ name: 'sol-radar', parentId: other.id }); // plain name
    const res = await setup.ensureChannels(g);
    assert.ok(res.kept.includes('nftRadar') && res.kept.includes('solRadar'));
    assert.ok(!g.created.includes(NFT) && !g.created.includes(SOL));
    assert.equal(guilds.settings(A).channels.nftRadar, nft.id);
    assert.equal(guilds.settings(A).channels.solRadar, sol.id);
  });
  await test('settings were lost: the channels are found again by name and never made twice', async () => {
    const g = await freshServer(A);
    await setup.ensureChannels(g);
    const ids = clone(guilds.settings(A).channels);
    tables.guilds.find((r) => r.guild_id === A).settings = {}; // settings wiped
    await guilds.load();
    const res = await setup.ensureChannels(g);
    assert.deepEqual(res.created, []);
    assert.equal(guilds.settings(A).channels.nftRadar, ids.nftRadar);
    assert.equal(guilds.settings(A).channels.solRadar, ids.solRadar);
  });

  say('== 3. Problems ==');
  await test('setup fails half-way: what was created is remembered, and the retry only makes what is missing', async () => {
    const g = await freshServer(A, { failOn: SOL });
    const first = await setup.ensureChannels(g);
    assert.match(first.error, /having a moment/);
    assert.equal(textNamed(g, NFT).length, 1);
    assert.equal(textNamed(g, SOL).length, 0);
    assert.ok(guilds.settings(A).channels.nftRadar, 'the NFT Radar channel was saved before the failure');
    g.failOn = null;
    const madeBefore = g.created.length;
    const second = await setup.ensureChannels(g);
    assert.equal(second.error, null);
    assert.deepEqual(g.created.slice(madeBefore), [SOL]); // only the missing one
    assert.equal(textNamed(g, NFT).length, 1);
    assert.equal(textNamed(g, SOL).length, 1);
  });
  await test('no Manage Channels permission: nothing is created and the admin is told which permission is missing', async () => {
    const g = await freshServer(A, { perms: new Set([P.ViewChannel, P.SendMessages]) });
    const general = g.add({ name: 'general' });
    const res = await setup.run(g, { welcome: true });
    assert.equal(res.error, 'missing_permissions');
    assert.ok(res.missing.includes('Manage Channels'));
    assert.deepEqual(g.created, []);
    assert.equal(g.sent.length, 1);
    assert.equal(g.sent[0].ch, general.name);
    assert.match(g.sent[0].content, /Manage Channels/);
    assert.match(g.sent[0].content, /\/setup/);
  });

  say('== 4. Separate servers, HΛVØCZ, Personal Vexo ==');
  await test('every server has its own channels and settings', async () => {
    const a = await freshServer(A);
    tables.guilds = tables.guilds.filter((r) => r.guild_id !== B);
    tables.guilds.push({ guild_id: B, name: 'Other', status: 'active', boss_user_id: REMO, trial_ends_at: iso(10), ai_calls_today: 0, settings: {} });
    await guilds.load();
    const b = fakeGuild(B);
    await setup.ensureChannels(a);
    await setup.ensureChannels(b);
    const ca = guilds.settings(A).channels;
    const cb = guilds.settings(B).channels;
    assert.notEqual(ca.nftRadar, cb.nftRadar);
    assert.notEqual(ca.solRadar, cb.solRadar);
    assert.ok(a.channels.cache.has(ca.solRadar) && !a.channels.cache.has(cb.solRadar));
    assert.ok(b.channels.cache.has(cb.solRadar) && !b.channels.cache.has(ca.solRadar));
  });
  await test('HΛVØCZ: nothing is ever created; its three channels come from the .env variables', async () => {
    const g = fakeGuild(HOME);
    const res = await setup.ensureChannels(g);
    assert.deepEqual([res.created, res.kept, res.error], [[], [], null]);
    assert.deepEqual(g.created, []);
    assert.equal(await setup.run(g), null);
    const c = guilds.settings(HOME).channels;
    assert.deepEqual([c.nftRadar, c.solRadar, c.assistant], ['home-nft', 'home-sol', 'home-assistant']);
    assert.equal(guilds.settings(HOME).personalVexo, true);
    assert.equal(tables.guilds.find((r) => r.guild_id === HOME).settings.channels, undefined); // nothing stored for it
  });
  await test('Personal Vexo switched on for one server: /setup creates 🤖・get-vexo-assistant there only; switched off: it is ignored, not deleted', async () => {
    const g = await freshServer(A);
    await setup.ensureChannels(g);
    await guilds.patchSettings(A, { personalVexo: true }); // what /admin personalvexo does
    const res = await setup.ensureChannels(g);
    assert.deepEqual(res.created, ['assistant']);
    const id = guilds.settings(A).channels.assistant;
    assert.equal(g.channels.cache.get(id).name, ASSIST);
    assert.equal(guilds.settings(B).channels.assistant, ''); // the other server is untouched
    assert.deepEqual((await setup.ensureChannels(g)).created, []);
    await guilds.patchSettings(A, { personalVexo: false });
    assert.equal(guilds.settings(A).channels.assistant, '');
    assert.equal(textNamed(g, ASSIST).length, 1);
    assert.ok(!setup.wantedKeys(A).some(([k]) => k === 'assistant'));
  });
  await test('a radar channel is deleted: it is cleared from that server\'s settings and the admin is told to run /setup', async () => {
    const g = await freshServer(A);
    await setup.ensureChannels(g);
    const c = guilds.settings(A).channels;
    const sol = g.channels.cache.get(c.solRadar);
    g.channels.cache.delete(sol.id);
    await setup.onChannelDelete({ id: sol.id, guildId: A, guild: g });
    assert.equal(guilds.settings(A).channels.solRadar, '');
    assert.equal(guilds.settings(A).channels.nftRadar, c.nftRadar);
    assert.ok(g.sent.some((m) => /sol-radar/.test(m.content) && /\/setup/.test(m.content)));
    const res = await setup.ensureChannels(g);
    assert.deepEqual(res.created, ['solRadar']);
  });

  say('== 5. Servers that already had Vexo before the radar channels existed ==');
  // a server set up by the OLD version: its six old channels are saved, no radar channels, no setup version
  async function oldServer(id, opts) {
    const g = await freshServer(id, opts);
    await setup.ensureChannels(g);
    const row = tables.guilds.find((r) => r.guild_id === id);
    for (const k of ['nftRadar', 'solRadar']) {
      g.channels.cache.delete(row.settings.channels[k]);
      delete row.settings.channels[k];
    }
    delete row.settings.setupVersion;
    g.created.length = 0;
    await guilds.load();
    return g;
  }
  const clientOf = (...gs) => ({ guilds: { cache: new Map(gs.map((g) => [g.id, g])) } });
  await test('bot start: an existing server gets the two radar channels by itself, once, and its admin is told in the control channel', async () => {
    const g = await oldServer(A);
    assert.equal(guilds.settings(A).channels.solRadar, '');
    const oldIds = clone(guilds.settings(A).channels);
    const res = await setup.upgradeExisting(clientOf(g));
    assert.deepEqual(res, { upgraded: [A], failed: [] });
    assert.deepEqual([...g.created].sort(), [NFT, SOL].sort());
    const c = guilds.settings(A).channels;
    assert.equal(g.channels.cache.get(c.solRadar).name, SOL);
    assert.equal(g.channels.cache.get(c.nftRadar).name, NFT);
    for (const k of ['control', 'marketplace', 'rumble', 'logs', 'xDrop', 'giveaway']) assert.equal(c[k], oldIds[k], `${k} unchanged`);
    assert.equal(g.sent.length, 1);
    assert.equal(g.sent[0].ch, 'vexo-control');
    assert.ok(g.sent[0].content.includes(`<#${c.solRadar}>`) && g.sent[0].content.includes(`<#${c.nftRadar}>`));
    // the next starts do nothing and say nothing
    for (let i = 0; i < 2; i++) assert.deepEqual(await setup.upgradeExisting(clientOf(g)), { upgraded: [], failed: [] });
    assert.equal(g.created.length, 2);
    assert.equal(g.sent.length, 1);
  });
  await test('after the upgrade, a channel the admin deletes is NOT forced back at the next start (only /setup makes it again)', async () => {
    const g = await oldServer(A);
    await setup.upgradeExisting(clientOf(g));
    const sol = g.channels.cache.get(guilds.settings(A).channels.solRadar);
    g.channels.cache.delete(sol.id);
    await setup.onChannelDelete({ id: sol.id, guildId: A, guild: g });
    const made = g.created.length;
    await setup.upgradeExisting(clientOf(g));
    assert.equal(g.created.length, made);
    assert.equal(guilds.settings(A).channels.solRadar, '');
    assert.deepEqual((await setup.ensureChannels(g)).created, ['solRadar']); // /setup
  });
  await test('upgrade without Manage Channels: nothing is created, the admin is told ONCE, and it works on a later start when the permission is there', async () => {
    const perms = new Set([P.ViewChannel, P.SendMessages]);
    const g = await oldServer(A);
    g.members.me.permissions.has = (bit) => perms.has(bit);
    for (let i = 0; i < 3; i++) assert.deepEqual(await setup.upgradeExisting(clientOf(g)), { upgraded: [], failed: [A] });
    assert.deepEqual(g.created, []);
    assert.equal(g.sent.length, 1);
    assert.match(g.sent[0].content, /Manage Channels/);
    g.members.me.permissions.has = () => true;
    assert.deepEqual(await setup.upgradeExisting(clientOf(g)), { upgraded: [A], failed: [] });
    assert.equal(g.created.length, 2);
  });
  await test('the upgrade never touches HΛVØCZ, a server that was never set up, or a server the bot left', async () => {
    const home = fakeGuild(HOME);
    const never = await freshServer(B); // has a row but no channels yet
    const left = await oldServer(A);
    tables.guilds.find((r) => r.guild_id === A).status = 'left';
    await guilds.load();
    assert.deepEqual(await setup.upgradeExisting(clientOf(home, never, left)), { upgraded: [], failed: [] });
    assert.deepEqual([home.created, never.created, left.created], [[], [], []]);
    assert.deepEqual([home.sent.length, never.sent.length, left.sent.length], [0, 0, 0]);
  });

  say(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
