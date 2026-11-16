// /setup in the home server (HΛVØCZ): /setup choices first, .env as fallback, a "Create missing channels"
// button (never automatic), /status shows where each channel comes from, feature logs never go to the shop,
// knowledge source channels learned into a SEPARATE sheet (knowledge.md never rewritten).
// Run: node tests/home-setup.test.js
// Fully offline: Discord, Supabase and the AI are faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
const A = '200000000000000002'; // customer server
const REMO = '111111111111111110'; // the boss (BOSS_USER_ID)
const ADMIN = '222222222222222220';
const MEMBER = '333333333333333330';
const BOT = '999999999999999999';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, TRIAL_DAYS: '15', TIMEZONE: 'Asia/Dhaka',
  CONTROL_CHANNEL_ID: 'home-ctl', REDEEM_LOGS_CHANNEL_ID: 'home-purchases', LOGS_CHANNEL_ID: 'home-logs', MARKETPLACE_CHANNEL_ID: 'home-shop', GENERAL_CHANNEL_ID: 'home-gen',
  WELCOME_CHANNEL_ID: 'home-welcome', ASK_CHANNEL_ID: 'home-ask', VERIFIED_ROLE_ID: 'role-verified', RUMBLE_CHANNEL_ID: 'home-rumble',
  X_DROP_CHANNEL_ID: '', GIVEAWAY_CHANNEL_ID: '', NFT_RADAR_CHANNEL_ID: '', SOL_RADAR_CHANNEL_ID: '',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { guilds: [] };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const fakeDb = {
  rpc: async () => ({ data: 1, error: null }),
  from(table) {
    const q = { op: 'select', f: [], single: false };
    const api = {
      select: () => api, order: () => api, limit: () => api, gte: () => api,
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

// fake AI: the knowledge sheet the "AI" writes from the source channel posts
let aiCalls = 0;
global.fetch = async () => {
  aiCalls++;
  return { ok: true, json: async () => ({ choices: [{ message: { content: '## Announcements\n- Staking opens on March 3 (from the announcements channel)' } }] }), text: async () => '' };
};

// ---------------------------------------------------------------- fake Discord server
const { PermissionFlagsBits: P, ChannelType } = require('discord.js');
let seq = 0;
const sent = [];
function fakeGuild(id, { manageChannels = true } = {}) {
  const list = new Map();
  list.find = (fn) => [...list.values()].find(fn);
  const guild = {
    id, name: id === HOME ? 'HΛVØCZ' : 'Customer', ownerId: REMO, created: [], systemChannel: null,
    client: null,
    members: { me: { id: BOT, permissions: { has: (bit) => bit !== P.ManageChannels || manageChannels } }, fetchMe: async () => guild.members.me },
    channels: {
      cache: list,
      fetch: async () => list,
      create: async (o) => {
        guild.created.push(o.name);
        return guild.add({ name: o.name, type: o.type, parentId: o.parent || null, topic: o.topic, overwrites: o.permissionOverwrites });
      },
    },
    add(c) {
      const ch = { id: `c${++seq}`, parentId: null, type: ChannelType.GuildText, isTextBased: () => true, guild, permissionsFor: () => ({ has: () => true }), send: async (m) => (sent.push({ ch: ch.id, ...m }), { id: `m${sent.length}` }), messages: { fetch: async () => ({ size: 0, values: () => [], last: () => null }) }, ...c };
      ch.guildId = id;
      list.set(ch.id, ch);
      return ch;
    },
  };
  return guild;
}
const homeGuild = fakeGuild(HOME);
for (const [cid, name] of [['home-ctl', 'vexo-control'], ['home-logs', 'vexo-logs'], ['home-purchases', 'purchase-logs'], ['home-shop', 'marketplace'], ['home-gen', 'general'], ['home-welcome', 'welcome'], ['home-ask', 'ask'], ['home-rumble', 'rumble'], ['home-announce', 'announcements'], ['home-other', 'other']]) homeGuild.add({ id: cid, name });
const client = { user: { id: BOT }, channels: { fetch: async (cid) => homeGuild.channels.cache.get(cid) || null }, guilds: { cache: new Map([[HOME, homeGuild]]) } };
homeGuild.client = client;

function slash(userId, { manage = true, guild = homeGuild } = {}) {
  const it = {
    guildId: guild.id, guild, client, user: { id: userId }, commandName: 'setup',
    memberPermissions: { has: (p) => manage && p === P.ManageGuild },
    out: [], reply: async (m) => it.out.push(m), deferReply: async () => {}, editReply: async (m) => it.out.push(m),
  };
  return it;
}
function comp(customId, values = [], userId = REMO, { manage = true } = {}) {
  const it = {
    guildId: HOME, guild: homeGuild, client, user: { id: userId }, customId, values,
    memberPermissions: { has: (p) => manage && p === P.ManageGuild },
    out: [], reply: async (m) => it.out.push(m), update: async (m) => it.out.push(m), deferUpdate: async () => {}, editReply: async (m) => it.out.push(m), followUp: async (m) => it.out.push(m),
    showModal: async (m) => it.out.push({ modal: m }),
  };
  return it;
}
const text = (it) => String(it.out.at(-1)?.content || '');
const menuValues = (it) => it.out.at(-1).components[0].toJSON().components[0].options.map((o) => o.value);

// ---------------------------------------------------------------- load the bot
const guilds = require(src('guilds.js'));
const config = require(src('config.js'));
const setup = require(src('setup.js'));
const setupCmd = require(src('commands/setup.js'));
const statusCmd = require(src('commands/status.js'));
const ai = require(src('ai.js'));
const learn = require(src('learn.js'));

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
async function resetHome(settings = {}) {
  tables.guilds = tables.guilds.filter((r) => r.guild_id !== HOME);
  tables.guilds.push({ guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: clone(settings), knowledge: 'MAIN SHEET from knowledge.md', ai_calls_today: 0 });
  await guilds.load();
  for (const k of [...homeGuild.channels.cache.keys()]) if (!String(k).startsWith('home-')) homeGuild.channels.cache.delete(k);
  homeGuild.created.length = 0;
  sent.length = 0;
}

(async () => {
  tables.guilds.push({ guild_id: A, name: 'Customer', status: 'active', boss_user_id: ADMIN, trial_ends_at: new Date(Date.now() + 9e8).toISOString(), ai_calls_today: 0, settings: { channels: { logs: 'a-logs' } } });

  say('== 1. Nothing changes when /setup was never used in HΛVØCZ ==');
  await test('no /setup values: every HΛVØCZ channel, the ping role, boss and knowledge are exactly the .env values', async () => {
    await resetHome();
    const s = guilds.settings(HOME);
    assert.equal(s.channels.control, 'home-ctl');
    assert.equal(s.channels.redeemLogs, 'home-purchases');
    assert.equal(s.channels.marketplace, 'home-shop');
    assert.equal(s.channels.general, 'home-gen');
    assert.equal(s.channels.welcome, 'home-welcome');
    assert.equal(s.channels.rumble, 'home-rumble');
    assert.equal(s.channels.logs, 'home-logs', 'logs: .env fallback is LOGS_CHANNEL_ID');
    assert.equal(s.channels.solRadar, '');
    assert.equal(s.pingRoleId, 'role-verified');
    assert.equal(s.verifiedRoleId, 'role-verified');
    assert.equal(s.bossUserId, REMO);
    assert.deepEqual(s.knowledgeSources, []);
    assert.equal(ai.getKnowledge(HOME), 'MAIN SHEET from knowledge.md');
    assert.equal(guilds.logsChannelId(HOME), 'home-logs', 'feature logs use LOGS_CHANNEL_ID, never REDEEM_LOGS_CHANNEL_ID');
  });

  await test('startup and joins never create anything in HΛVØCZ (only the button does)', async () => {
    await resetHome();
    const res = await setup.ensureChannels(homeGuild);
    assert.deepEqual(res.created, []);
    assert.equal(await setup.run(homeGuild), null);
    const up = await setup.upgradeExisting(client);
    assert.deepEqual(up.upgraded, []);
    assert.equal(homeGuild.created.length, 0);
  });

  say('== 2. /setup in HΛVØCZ ==');
  await test('/setup opens in HΛVØCZ (boss or Manage Server), creates nothing, lists missing channels; members are refused', async () => {
    await resetHome();
    const member = slash(MEMBER, { manage: false });
    await setupCmd.execute(member);
    assert.match(text(member), /Only the boss or members with Manage Server/);
    const boss = slash(REMO, { manage: false }); // the boss without Manage Server
    await setupCmd.execute(boss);
    const t = text(boss);
    assert.ok(t.startsWith('-# build: unprompted-qa-fix-v1\n'), 'the build marker is the first line of /setup');
    assert.match(t, /\*\*Vexo setup\*\*/);
    assert.ok(!/nothing to set\s+up/i.test(t), 'the old home-server refusal is gone');
    assert.match(t, /Control: <#home-ctl> \(\.env\)/);
    assert.match(t, /SOL Radar: \*not set\*/);
    assert.match(t, /Missing: .*(SOL Radar|NFT Radar|Giveaways).*\(press \*\*Create missing channels\*\*\)/);
    assert.ok(!/Missing: .*X posts/.test(t), 'the button only handles SOL Radar, NFT Radar and Giveaways');
    assert.equal(homeGuild.created.length, 0, 'opening /setup creates nothing');
    const values = menuValues(boss);
    for (const k of ['ch:control', 'ch:logs', 'ch:marketplace', 'ch:rumble', 'ch:games', 'ch:xDrop', 'ch:giveaway', 'ch:nftRadar', 'ch:solRadar', 'ch:welcome', 'ch:ask', 'role', 'sources', 'boss', 'ticket']) assert.ok(values.includes(k), `menu has ${k}`);
    const button = boss.out.at(-1).components[1].toJSON().components[0];
    assert.equal(button.custom_id, 'setup:createhome');
    assert.equal(button.label, 'Create missing channels (3)');
  });

  await test('choosing a channel: /setup wins over .env, untouched channels keep .env; "choose none" goes back to .env', async () => {
    await resetHome();
    await setupCmd.handleComponent(comp('setup:ch:solRadar', ['home-other']));
    await setupCmd.handleComponent(comp('setup:ch:control', ['home-announce']));
    let s = guilds.settings(HOME);
    assert.equal(s.channels.solRadar, 'home-other');
    assert.equal(s.channels.control, 'home-announce', '/setup wins over CONTROL_CHANNEL_ID');
    assert.equal(s.channels.marketplace, 'home-shop', 'untouched: still .env');
    assert.equal(tables.guilds.find((r) => r.guild_id === HOME).settings.channels.solRadar, 'home-other', 'saved in the HΛVØCZ guilds row');
    const back = comp('setup:ch:control', []);
    await setupCmd.handleComponent(back);
    assert.match(text(back), /back to the \.env value/);
    s = guilds.settings(HOME);
    assert.equal(s.channels.control, 'home-ctl');
    assert.equal(require(src('solRadar.js')).blocker(HOME), '', 'SOL Radar can post in HΛVØCZ now without SOL_RADAR_CHANNEL_ID');
  });

  await test('game ping role and number guess channel from /setup; points / Rumble role rule stays VERIFIED_ROLE_ID', async () => {
    await resetHome();
    await setupCmd.handleComponent(comp('setup:role', ['role-games']));
    await setupCmd.handleComponent(comp('setup:ch:games', ['home-other']));
    const s = guilds.settings(HOME);
    assert.equal(s.pingRoleId, 'role-games');
    assert.equal(s.verifiedRoleId, 'role-verified');
    assert.equal(s.channels.general, 'home-other');
  });

  await test('"Create missing channels": only sol-radar, nft-radar, giveaways; existing names reused and untouched; never twice; links in the reply', async () => {
    await resetHome();
    const existing = homeGuild.add({ name: 'sol-radar', topic: 'my own topic' }); // an existing plain-named channel: reused, not duplicated
    const it = comp('setup:createhome');
    await setupCmd.handleComponent(it);
    assert.deepEqual(homeGuild.created.sort(), ['Vexo', 'giveaways', '📡・nft-radar'].sort());
    const s = guilds.settings(HOME);
    assert.match(text(it), new RegExp(`Created: .*NFT Radar <#${s.channels.nftRadar}>.*Giveaways <#${s.channels.giveaway}>`));
    assert.match(text(it), new RegExp(`Found and now using: SOL Radar <#${existing.id}>`));
    assert.equal(existing.name, 'sol-radar');
    assert.equal(existing.topic, 'my own topic', 'an existing channel is never changed');
    for (const k of ['giveaway', 'nftRadar', 'solRadar']) assert.ok(homeGuild.channels.cache.has(s.channels[k]), `${k} is set to a real channel`);
    assert.equal(s.channels.control, 'home-ctl', 'existing .env channels are not replaced');
    assert.equal(s.channels.xDrop, '', 'X posts is not something the button creates');
    assert.match(text(it), /all have a channel/);
    const again = comp('setup:createhome');
    await setupCmd.handleComponent(again);
    assert.equal(homeGuild.created.length, 3, 'pressing again creates nothing');
    const nft = [...homeGuild.channels.cache.values()].find((c) => c.name === '📡・nft-radar');
    assert.ok(nft.overwrites.some((o) => o.id === HOME && o.deny?.includes(P.SendMessages)), 'radar channel is read-only for members');
  });

  await test('without Manage Channels the button says which permission is missing and creates nothing', async () => {
    await resetHome();
    const g = fakeGuild(HOME, { manageChannels: false });
    const it = comp('setup:createhome');
    it.guild = g;
    await setupCmd.handleComponent(it);
    assert.match(text(it), /Manage Channels/);
    assert.equal(g.created.length, 0);
  });

  await test('a /setup-chosen channel is deleted: the choice is cleared and HΛVØCZ falls back to .env', async () => {
    await resetHome({ channels: { control: 'home-announce' } });
    assert.equal(guilds.settings(HOME).channels.control, 'home-announce');
    await setup.onChannelDelete({ id: 'home-announce', guildId: HOME, guild: homeGuild });
    assert.equal(guilds.settings(HOME).channels.control, 'home-ctl');
    // deleting a channel that only came from .env changes no setting
    await setup.onChannelDelete({ id: 'home-gen', guildId: HOME, guild: homeGuild });
    assert.equal(guilds.settings(HOME).channels.general, 'home-gen');
  });

  say('== 3. Feature logs never go to the shop ==');
  await test('logs: the /setup logs channel, else LOGS_CHANNEL_ID (HΛVØCZ); never REDEEM_LOGS, control or the shop', async () => {
    await resetHome();
    assert.equal(guilds.logsChannelId(HOME), 'home-logs');
    await resetHome({ channels: { logs: 'home-other' } });
    assert.equal(guilds.logsChannelId(HOME), 'home-other');
    // no LOGS_CHANNEL_ID and nothing chosen: feature logs are NOT sent anywhere (REDEEM_LOGS is purchases only)
    await resetHome();
    const saved = config.channels.logs;
    config.channels.logs = '';
    assert.equal(guilds.logsChannelId(HOME), '', 'not REDEEM_LOGS_CHANNEL_ID, not the control channel');
    // LOGS_CHANNEL_ID pointing at the shop is ignored too
    config.channels.logs = 'home-shop';
    assert.equal(guilds.logsChannelId(HOME), '');
    config.channels.logs = saved;
    // the same rule in customer servers
    assert.equal(guilds.logsChannelId(A), 'a-logs');
    // the shop channel is refused for logs (and every other feature) in /setup
    for (const key of ['logs', 'solRadar', 'nftRadar', 'giveaway']) {
      const it = comp(`setup:ch:${key}`, ['home-shop']);
      await setupCmd.handleComponent(it);
      assert.match(text(it), /Only shop content goes there/);
    }
    assert.equal(guilds.getFeatureChannel(HOME, 'solRadar'), '');
  });

  await test('a feature with no channel posts nowhere (never another channel), also when a setting points at the shop', async () => {
    await resetHome({ channels: { logs: 'home-other' } });
    const solRadar = require(src('solRadar.js'));
    const nftRadar = require(src('nftRadar.js'));
    assert.match((await solRadar.postTo(client, HOME, 'SOL RADAR test')).error, /cannot find the SOL Radar channel/);
    assert.match((await nftRadar.postTo(client, HOME, 'NFT RADAR test')).error, /cannot find the NFT Radar channel/);
    const g = await require(src('giveaway.js')).start({ guild: homeGuild, client, prize: 'NFT', endsAt: Date.now() + 3600000, hostId: REMO });
    assert.match(g.error, /No giveaway channel is set/);
    // an old setting pointing a feature at the shop is ignored: still "not set"
    await resetHome({ channels: { logs: 'home-other', solRadar: 'home-shop', giveaway: 'home-shop' } });
    assert.equal(guilds.getFeatureChannel(HOME, 'solRadar'), '');
    assert.match((await solRadar.postTo(client, HOME, 'SOL RADAR test')).error, /cannot find/);
    const g2 = await require(src('giveaway.js')).start({ guild: homeGuild, client, prize: 'NFT', endsAt: Date.now() + 3600000, hostId: REMO, channelId: 'home-shop' });
    assert.match(g2.error, /only shop content goes there/);
    assert.equal(sent.length, 0, 'nothing was posted anywhere');
    // the admins are told once, in the logs channel
    const notices = require(src('notices.js'));
    assert.equal(await notices.missingChannelOnce(client, HOME, 'solRadar', 'SOL Radar'), true);
    assert.equal(await notices.missingChannelOnce(client, HOME, 'solRadar', 'SOL Radar'), false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].ch, 'home-other');
  });

  await test('nothing except shop content reaches the shop: REDEEM_LOGS = shop and no logs channel -> settings logs and notices go nowhere', async () => {
    await resetHome({ channels: { solRadar: 'home-announce' } });
    const saved = config.channels.redeemLogs;
    const savedLogs = config.channels.logs;
    config.channels.redeemLogs = 'home-shop'; // what the live HΛVØCZ settings look like
    config.channels.logs = ''; // LOGS_CHANNEL_ID not added on Render yet
    try {
      const solCmd = require(src('commands/solradar.js'));
      const nftCmd = require(src('commands/nftradar.js'));
      const run = async (cmd, sub) => {
        const it = { guildId: HOME, guild: homeGuild, client, user: { id: REMO }, memberPermissions: { has: () => true }, options: { getSubcommand: () => sub, getString: () => null }, out: [], reply: async () => {}, deferReply: async () => {}, editReply: async (m) => it.out.push(m) };
        await cmd.execute(it);
      };
      await run(solCmd, 'off');
      await run(solCmd, 'on');
      await run(nftCmd, 'off');
      await require(src('notices.js')).missingChannelOnce(client, HOME, 'nftRadar', 'NFT Radar');
      assert.equal(sent.filter((m) => m.ch === 'home-shop').length, 0, 'nothing in the shop');
      assert.equal(sent.length, 0, 'and no other channel was used instead');
      const st = { guildId: HOME, guild: homeGuild, client, user: { id: REMO }, memberPermissions: { has: () => true }, out: [], reply: async (m) => st.out.push(m) };
      await statusCmd.execute(st);
      assert.match(st.out[0].embeds[0].toJSON().fields.map((f) => f.value).join('\n'), /Logs: not set/);
      // with LOGS_CHANNEL_ID set, the same logs go to that channel, still never to the shop
      config.channels.logs = 'home-logs';
      await run(solCmd, 'off');
      assert.equal(sent.filter((m) => m.ch === 'home-shop').length, 0);
      assert.equal(sent.filter((m) => m.ch === 'home-logs').length, 1);
    } finally {
      config.channels.redeemLogs = saved;
      config.channels.logs = savedLogs;
    }
  });

  await test('purchase records are the only thing that uses REDEEM_LOGS_CHANNEL_ID', async () => {
    await resetHome();
    const saved = config.channels.redeemLogs;
    config.channels.redeemLogs = 'home-shop';
    try {
      await require(src('marketplace.js'))._test.sendLog(client, { purchaseId: 7, userId: MEMBER, itemName: 'WL spot', price: 50, status: 'Pending', guildId: HOME });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].ch, 'home-shop', 'a purchase record (shop content) may go to the shop');
      assert.notEqual(guilds.logsChannelId(HOME), 'home-shop');
    } finally {
      config.channels.redeemLogs = saved;
    }
  });

  await test('SOL Radar settings log in HΛVØCZ goes to the logs channel, not the shop', async () => {
    await resetHome({ channels: { logs: 'home-other', solRadar: 'home-announce' } });
    const cmd = require(src('commands/solradar.js'));
    const it = { guildId: HOME, guild: homeGuild, client, user: { id: REMO }, memberPermissions: { has: () => true }, options: { getSubcommand: () => 'off', getString: () => null }, out: [], reply: async () => {}, deferReply: async () => {}, editReply: async (m) => it.out.push(m) };
    await cmd.execute(it);
    const logs = sent.filter((m) => m.embeds?.[0]?.data?.title === '📈 SOL Radar settings' || m.embeds?.[0]?.title === '📈 SOL Radar settings');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].ch, 'home-other');
    assert.equal(sent.filter((m) => m.ch === 'home-shop').length, 0);
  });

  say('== 4. /status and knowledge ==');
  await test('/status in HΛVØCZ shows each channel with "from /setup" or "from .env"', async () => {
    await resetHome({ channels: { solRadar: 'home-other' } });
    const it = { guildId: HOME, guild: homeGuild, client, user: { id: REMO }, memberPermissions: { has: () => true }, out: [], reply: async (m) => it.out.push(m) };
    await statusCmd.execute(it);
    const fields = it.out[0].embeds[0].toJSON().fields;
    const t = fields.filter((f) => f.name.startsWith('Channels and roles')).map((f) => f.value).join('\n');
    assert.ok(fields.every((f) => f.value.length <= 1024));
    assert.match(t, /SOL Radar: <#home-other>.* · from \/setup/);
    assert.match(t, /Control: <#home-ctl> · from \.env/);
    assert.match(t, /Welcome: <#home-welcome> · from \.env/);
    assert.match(t, /X posts: not set/);
    assert.match(t, /Logs: <#home-logs> · from \.env \(LOGS_CHANNEL_ID\)/);
    assert.equal(it.out[0].embeds[0].toJSON().footer.text, 'build: unprompted-qa-fix-v1', 'the build marker is at the bottom of /status');
    assert.match(t, /NFT Radar: not set/);
  });

  await test('knowledge sources in HΛVØCZ go to a SEPARATE sheet: knowledge.md text and taught facts are never rewritten', async () => {
    await resetHome({ knowledgeSources: ['home-announce'] });
    await learn.absorb(HOME, ['Big news: staking opens on March 3 for all holders.']);
    const row = tables.guilds.find((r) => r.guild_id === HOME);
    assert.equal(row.knowledge, 'MAIN SHEET from knowledge.md', 'the main sheet is untouched');
    assert.match(row.settings.sourceKnowledge, /Staking opens on March 3/);
    const k = ai.getKnowledge(HOME);
    assert.ok(k.startsWith('MAIN SHEET from knowledge.md'));
    assert.match(k, /From the HΛVØCZ announcement \/ source channels[\s\S]*Staking opens/);
    // a message in the source channel is picked up for the separate sheet (it was ignored in HΛVØCZ before)
    learn.onMessage({ guildId: HOME, channelId: 'home-announce', author: { id: 'x' }, client, content: 'Another long official announcement about the roadmap phase two.', embeds: [] });
    assert.ok(learn._test.buffers.has(HOME));
    clearTimeout(learn._test.buffers.get(HOME).timer);
    learn._test.buffers.delete(HOME);
    // and a normal channel never teaches anything
    learn.onMessage({ guildId: HOME, channelId: 'home-gen', author: { id: 'x' }, client, content: 'random chat message that is long enough', embeds: [] });
    assert.ok(!learn._test.buffers.has(HOME));
  });

  say('== 5. The same /setup in every server ==');
  await test('a customer server and HΛVØCZ get the SAME menu; the customer server still runs its automatic setup', async () => {
    await resetHome();
    const home = slash(REMO);
    await setupCmd.execute(home);
    const g = fakeGuild(A);
    g.client = client;
    const it = slash(ADMIN, { guild: g });
    await setupCmd.execute(it);
    assert.ok(text(it).startsWith('-# build: unprompted-qa-fix-v1\n'));
    assert.match(text(it), /\*\*Vexo setup\*\*/);
    assert.ok(g.created.includes('vexo-control') && g.created.includes('📈・sol-radar'));
    // identical options (Get Vexo Assistant only where Personal Vexo is on: on in HΛVØCZ, off in this server)
    const same = (v) => v.filter((x) => x !== 'ch:assistant');
    assert.deepEqual(same(menuValues(it)), same(menuValues(home)));
    for (const k of ['boss', 'ticket', 'ch:welcome', 'ch:ask']) assert.ok(menuValues(it).includes(k));
    assert.equal(it.out.at(-1).components.length, 1, 'no create button outside HΛVØCZ (it gets its channels automatically)');
    assert.equal(home.out.at(-1).components.length, 2, 'HΛVØCZ: the same menu + the Create missing channels button');
  });

  await test('HΛVØCZ boss and ticket text: /setup first, BOSS_USER_ID / the usual ticket button when not chosen', async () => {
    await resetHome();
    const identity = require(src('identity.js'));
    assert.equal(guilds.settings(HOME).bossUserId, REMO, 'not chosen: BOSS_USER_ID');
    assert.equal(guilds.settings(HOME).ticketInstructions, null, 'not chosen: the usual HΛVØCZ ticket button');
    await setupCmd.handleComponent(comp('setup:boss', [ADMIN]));
    assert.equal(guilds.settings(HOME).bossUserId, ADMIN);
    assert.ok(identity.isBoss(ADMIN, HOME) && !identity.isBoss(REMO, HOME));
    const modal = comp('setup:ticketmodal');
    modal.fields = { getTextInputValue: () => 'DM a mod with your prize name.' };
    await setupCmd.handleComponent(modal);
    assert.equal(guilds.settings(HOME).ticketInstructions, 'DM a mod with your prize name.');
    // the customer servers keep their own boss
    assert.equal(guilds.settings(A).bossUserId, ADMIN);
    await resetHome();
    assert.equal(guilds.settings(HOME).bossUserId, REMO);
  });

  await test('welcome and ask channels work in a customer server too (only when chosen; never another channel)', async () => {
    const onJoin = require(src('events/guildMemberAdd.js'));
    homeGuild.add({ id: 'a-welcome', name: 'welcome' }); // reachable through the fake client
    const member = (id) => ({ id, user: { bot: false }, guild: { id: A }, client });
    sent.length = 0;
    await onJoin(member('900000000000000001')); // no welcome channel chosen yet: nothing
    assert.equal(sent.length, 0);
    await guilds.patchSettings(A, { channels: { welcome: 'a-welcome', ask: 'a-ask' } });
    assert.equal(guilds.settings(A).channels.ask, 'a-ask');
    await onJoin(member('900000000000000002'));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].ch, 'a-welcome');
    assert.ok(sent[0].content.includes('<@900000000000000002>'));
    await onJoin(member('900000000000000002')); // the same member again: no second welcome
    assert.equal(sent.length, 1);
    await guilds.patchSettings(A, { channels: { welcome: '', ask: '' } });
  });

  quiet.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
