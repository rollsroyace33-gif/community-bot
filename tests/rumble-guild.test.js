// Rumble guild test: a Rumble ordered in a CUSTOMER server's control channel is saved with that server's
// guild_id and posts ONLY in that server's own Rumble channel (join button, pings, winner, points prize),
// never in HΛVØCZ's Rumble channel.
// Run: node tests/rumble-guild.test.js
// Fully offline: Discord, Supabase and the AI are faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
const BEEE = '200000000000000002';
const REMO = '111111111111111110'; // boss of HOME
const BOSS_B = '222222222222222220'; // boss of BEEE
const PLAYER = '333333333333333330';
const BOT = '999999999999999999';
const HOME_RUMBLE = '444444444444444444';
const BEEE_RUMBLE = '555555555555555555';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, STAFF_ROLE_IDS: '', TRIAL_DAYS: '15', DEFAULT_DAILY_AI_LIMIT: '100',
  CONTROL_CHANNEL_ID: 'home-ctl', GENERAL_CHANNEL_ID: 'home-general', MARKETPLACE_CHANNEL_ID: 'home-shop', RUMBLE_CHANNEL_ID: HOME_RUMBLE,
  VERIFIED_ROLE_ID: 'home-verified', LOGS_CHANNEL_ID: 'home-logs', TIMEZONE: 'Asia/Dhaka', BOSS_OFFLINE_START: '00:00', BOSS_OFFLINE_END: '00:00',
  RUMBLE_PRE_ANNOUNCE_MINUTES: '0',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { guilds: [], users: [], point_log: [], scheduled_tasks: [], vexo_knowledge: [], vexo_unanswered: [], bot_settings: [] };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const rpcLog = [];
const fakeDb = {
  async rpc(name, a) {
    rpcLog.push({ name, ...a });
    if (name === 'adjust_points') {
      let u = tables.users.find((r) => r.guild_id === a.p_guild && r.user_id === a.p_user);
      if (!u) tables.users.push((u = { guild_id: a.p_guild, user_id: a.p_user, points: 0 }));
      u.points += a.p_amount;
      tables.point_log.push({ id: tables.point_log.length + 1, guild_id: a.p_guild, user_id: a.p_user, amount: a.p_amount, reason: a.p_reason });
      return { data: u.points, error: null };
    }
    if (name === 'count_ai_call') return { data: 1, error: null };
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
      upsert: () => ((q.op = 'noop'), api),
      delete: () => ((q.op = 'noop'), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = (tables[table] ||= []);
      if (q.op === 'insert') {
        const r = { id: rows.length + 1, settings: {}, state: {}, ...clone(q.row) };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      if (q.op === 'noop') return { data: null, error: null };
      const m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- fake AI: answers with the next queued JSON
let aiNext = null;
global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(aiNext) } }] }), text: async () => '' });

// ---------------------------------------------------------------- fake Discord (every channel knows its server)
const sent = []; // { ch, guild, content, embeds, components }
const channels = new Map();
function chan(id, guildId) {
  if (channels.has(id)) return channels.get(id);
  const c = {
    id, guildId, guild: { id: guildId }, name: id, type: 0, isTextBased: () => true, sendTyping: async () => {},
    permissionsFor: () => ({ has: () => true }),
    send: async (m) => {
      const rec = { ch: id, guild: guildId, content: typeof m === 'string' ? m : m.content || '', embeds: (m.embeds || []).map((e) => e.toJSON?.() || e), components: m.components || [] };
      sent.push(rec);
      return { id: `s${sent.length}`, edit: async () => {}, delete: async () => {} };
    },
    messages: { fetch: async () => null },
  };
  channels.set(id, c);
  return c;
}
const client = { user: { id: BOT }, channels: { cache: channels, fetch: async (id) => channels.get(id) || null } };
function msg(guildId, channelId, authorId, content) {
  const replies = [];
  return {
    id: `m${Math.random()}`, guildId, guild: { id: guildId, channels: { cache: { find: () => undefined } } }, channelId, channel: chan(channelId, guildId), client, content,
    author: { id: authorId, username: 'boss', bot: false }, member: { roles: { cache: { some: () => false, has: () => false } } },
    mentions: { channels: { first: () => undefined } }, replies,
    reply: async (r) => (replies.push(typeof r === 'string' ? r : r.content), { id: 'r' }),
  };
}

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

(async () => {
  const beeeSettings = { channels: { control: 'b-ctl', rumble: BEEE_RUMBLE, games: 'b-general', logs: 'b-logs' } };
  tables.guilds.push(
    { guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: {} },
    { guild_id: BEEE, name: 'Beee', status: 'active', boss_user_id: BOSS_B, trial_started_at: new Date(Date.now() - 86400000).toISOString(), trial_ends_at: new Date(Date.now() + 9 * 86400000).toISOString(), settings: clone(beeeSettings) }
  );
  for (const [id, g] of [['home-ctl', HOME], ['home-general', HOME], ['home-logs', HOME], [HOME_RUMBLE, HOME], ['b-ctl', BEEE], ['b-general', BEEE], ['b-logs', BEEE], [BEEE_RUMBLE, BEEE]]) chan(id, g);
  const guilds = require(src('guilds.js'));
  await guilds.load();
  const control = require(src('tasks/control.js'));
  const store = require(src('tasks/store.js'));
  const rumble = require(src('tasks/rumbleRoyale.js'));
  rumble._test.timing.sleep = async () => {}; // instant rounds
  rumble._test.timing.setTimer = () => null;
  rumble._test.timing.clearTimer = () => {};
  const order = { intent: 'schedule_game', task_type: 'rumble_royale', reply: 'On it, boss!', time: { in_minutes: 0 }, prize: '50 points', min_players: 1 };

  await test("an order in a customer server's control channel posts ONLY in that server's Rumble channel", async () => {
    aiNext = order;
    const m = msg(BEEE, 'b-ctl', BOSS_B, 'Host a rumble now prize 50 points min 1 players');
    await control.handleMessage(m);
    assert.match(m.replies[0], new RegExp(`Rumble Royale\\*\\* in <#${BEEE_RUMBLE}>`), m.replies[0]);
    assert.ok(!m.replies[0].includes(HOME_RUMBLE), 'never the HΛVØCZ channel in the summary');
    aiNext = { intent: 'confirm_yes', reply: 'Done, boss!' };
    const yes = msg(BEEE, 'b-ctl', BOSS_B, 'yes');
    await control.handleMessage(yes);
    assert.match(yes.replies[0], /Scheduled/, yes.replies[0]);

    const [task] = await store.listActive(BEEE);
    assert.equal(task.guild_id, BEEE, 'saved with the ordering server');
    assert.equal(task.channel_id, BEEE_RUMBLE, "saved with that server's Rumble channel");

    // host it: join message + button, a player joins, the game runs, winner + points prize
    sent.length = 0;
    await rumble.tick({ ...task, run_at: new Date(Date.now() - 1000).toISOString() }, { client });
    const join = sent.find((s) => s.components.length);
    assert.ok(join, 'join message with the Join button was sent');
    assert.equal(join.ch, BEEE_RUMBLE);
    const replies = [];
    await rumble.handleButton({ customId: `rumble_join:${task.id}`, guildId: BEEE, user: { id: PLAYER, username: 'p' }, member: { displayName: 'Player', roles: { cache: new Map() } }, reply: async (r) => replies.push(r) });
    assert.equal(rumble._test.gameByTask(task.id).players.size, 1, 'the Join button worked');
    await rumble._test.closeJoin(rumble._test.gameByTask(task.id));
    for (let i = 0; i < 50 && rumble._test.gameByTask(task.id); i++) await new Promise((r) => setImmediate(r));

    const game = sent.filter((s) => s.ch === BEEE_RUMBLE || s.ch === HOME_RUMBLE);
    assert.ok(game.length >= 3, 'join, start ping and winner were posted');
    assert.ok(game.every((s) => s.ch === BEEE_RUMBLE), 'every Rumble message is in the customer Rumble channel');
    assert.ok(!sent.some((s) => s.guild === HOME), 'nothing at all was sent in HΛVØCZ');
    assert.ok(game.some((s) => s.content.includes(`<@${PLAYER}>`)), 'winner message in the customer channel');
    const pay = rpcLog.filter((r) => r.name === 'adjust_points');
    assert.equal(pay.length, 1);
    assert.equal(pay[0].p_guild, BEEE, "the points prize goes to the customer server's points");
    assert.equal(pay[0].p_amount, 50);
  });

  await test('customer server with no Rumble channel, or one pointing at HΛVØCZ: "Rumble channel not set, run /setup", nothing scheduled', async () => {
    for (const rumbleCh of ['', HOME_RUMBLE]) {
      await guilds.patchSettings(BEEE, { channels: { rumble: rumbleCh } });
      aiNext = order;
      const m = msg(BEEE, 'b-ctl', BOSS_B, 'Host a rumble now prize 50 points');
      await control.handleMessage(m);
      assert.match(m.replies[0], /Rumble channel not set, run \/setup/, m.replies[0]);
      assert.ok(!m.replies[0].includes(HOME_RUMBLE));
      assert.equal((await store.listActive(BEEE)).length, 0);
    }
    await guilds.patchSettings(BEEE, { channels: { rumble: BEEE_RUMBLE } });
  });

  await test("GUARD: a Beee Rumble whose channel is in HΛVØCZ sends nothing there and tells Beee's boss in Beee's logs", async () => {
    const row = await store.create({ guild_id: BEEE, type: 'rumble_royale', run_at: new Date(Date.now() - 1000).toISOString(), channel_id: HOME_RUMBLE, params: { channel_id: HOME_RUMBLE, join_minutes: 5, prize_type: 'points', prize: '50 points', prize_points: 50, min_players: 1 }, status: 'pending', created_by: BOSS_B, state: { skipPre: true } });
    sent.length = 0;
    await rumble.tick(row, { client });
    assert.ok(!sent.some((s) => s.ch === HOME_RUMBLE || s.guild === HOME), 'nothing sent in HΛVØCZ');
    const note = sent.find((s) => s.ch === 'b-logs');
    assert.ok(note && note.content.includes(`<@${BOSS_B}>`) && /blocked/.test(note.content), "Beee's boss was told in Beee's logs");
    assert.equal((await store.get(row.id)).status, 'cancelled');
  });

  await test('HΛVØCZ order still uses RUMBLE_CHANNEL_ID exactly as before', async () => {
    aiNext = order;
    const m = msg(HOME, 'home-ctl', REMO, 'Host a rumble now prize 50 points');
    await control.handleMessage(m);
    assert.match(m.replies[0], new RegExp(`Rumble Royale\\*\\* in <#${HOME_RUMBLE}>`), m.replies[0]);
  });

  say(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
