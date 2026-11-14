// Control channel orders for Rumble Royale + number guess: flexible local times, nothing dropped,
// conflicts, past times, Discord timestamps only, and the new P1-P4 ping schedule with precise timers.
// Run: node tests/rumble-order.test.js
// Fake clock: 2026-10-28 16:34 on the boss's clock (BOSS_TIMEZONE Asia/Dhaka = UTC+6). The AI is
// mocked (it only extracts fields); Discord and Supabase are faked. Real .env values are never used.
const assert = require('assert');

const BOSS = '123456789012345678';
const BOT = '111111111111111111';
const RUMBLE_CH = '444444444444444444';
const GENERAL_CH = '555555555555555555';
const VERIFIED = '666666666666666666';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: 'g', HOME_GUILD_ID: 'g', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: BOSS, STAFF_ROLE_IDS: 'staffrole',
  CONTROL_CHANNEL_ID: 'ctl', GENERAL_CHANNEL_ID: GENERAL_CH, VERIFIED_ROLE_ID: VERIFIED, BOSS_TIMEZONE: 'Asia/Dhaka',
  RUMBLE_CHANNEL_ID: RUMBLE_CH, RUMBLE_MIN_PLAYERS: '3', RUMBLE_DEFAULT_JOIN_MINUTES: '5', RUMBLE_PRE_ANNOUNCE_MINUTES: '5',
  RUMBLE_ROUND_SECONDS: '3', RUMBLE_REQUIRE_VERIFIED: 'true',
});
// the three new keys are deliberately NOT set: the code must default to 1440 / 120 / 10
for (const k of ['RUMBLE_MAX_JOIN_MINUTES', 'RUMBLE_REMIND_BEFORE_SECONDS', 'RUMBLE_FINAL_PING_SECONDS']) delete process.env[k];
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake clock (Date.now only)
const START = Date.parse('2026-10-28T10:34:00Z'); // = 16:34 on the boss's clock
let NOW = START;
Date.now = () => NOW;
const MIN = 60 * 1000;
const local = (hhmm, plusDays = 0) => Date.parse(`2026-10-${28 + plusDays}T${hhmm}:00+06:00`); // boss clock -> ms
const U = (ms) => Math.floor(ms / 1000);

// ---------------------------------------------------------------- fake Supabase
const tables = { scheduled_tasks: [], point_log: [] };
const clone = (o) => JSON.parse(JSON.stringify(o));
const fakeDb = {
  rpc: async () => ({ data: 0, error: null }),
  from(table) {
    const q = { op: 'select', filters: [], single: false };
    const api = {
      select: () => api, order: () => api, gt: () => api, gte: () => api, lt: () => api, is: () => api, not: () => api, limit: () => api,
      insert: (row) => ((q.op = 'insert'), (q.row = row), api),
      update: (patch) => ((q.op = 'update'), (q.patch = patch), api),
      upsert: () => ((q.op = 'noop'), api), delete: () => ((q.op = 'noop'), api),
      eq: (k, v) => (q.filters.push((r) => r[k] === v || (k === 'guild_id' && r[k] === undefined)), api),
      in: (k, vs) => (q.filters.push((r) => vs.includes(r[k])), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = (tables[table] ||= []);
      if (q.op === 'insert') {
        const r = { id: rows.length + 1, ...clone(q.row) };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      const match = rows.filter((r) => q.filters.every((f) => f(r)));
      if (q.op === 'update') match.forEach((r) => Object.assign(r, clone(q.patch)));
      const out = match.map(clone);
      return { data: q.single ? out[0] || null : out, error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };
const fakePoints = {
  adjustPoints: async () => 0, today: () => '2026-10-28', daysAgo: () => '2026-10-27', isEligible: () => true,
  recordMessage: async () => 0, recordReaction: async () => 0, awardQuality: async () => 0,
};
require.cache[src('points.js')] = { id: src('points.js'), filename: src('points.js'), loaded: true, exports: fakePoints };

// ---------------------------------------------------------------- mocked AI: field extraction only
let aiCalls = 0;
let aiAnswer = {};
global.fetch = async () => {
  aiCalls++;
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(aiAnswer) } }] }) };
};
const order = (fields) => ({ intent: 'schedule_game', task_type: 'rumble_royale', reply: 'Got it, boss!', ...fields });

// ---------------------------------------------------------------- fake Discord
const sent = []; // { ch, content, allowedMentions, at }
let msgId = 1000;
function channel(id) {
  return {
    id, name: id === RUMBLE_CH ? 'rumble' : id, isTextBased: () => true, sendTyping: async () => {},
    send: async (m) => {
      const rec = { ch: id, content: typeof m === 'string' ? m : m.content || '', allowedMentions: m.allowedMentions, at: Date.now() };
      sent.push(rec);
      return { id: String(++msgId), edit: async () => {} };
    },
    messages: { fetch: async () => ({ id: 'x', edit: async () => {} }) },
  };
}
const channels = { ctl: channel('ctl'), [RUMBLE_CH]: channel(RUMBLE_CH), [GENERAL_CH]: channel(GENERAL_CH) };
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };
const rolesOf = (roles) => ({ cache: { has: (r) => roles.includes(r), some: (fn) => roles.map((id) => ({ id })).some(fn) } });
function controlMsg(content) {
  return {
    content, channelId: 'ctl', client, channel: channels.ctl, guild: { channels: { cache: { find: () => null } } },
    author: { id: BOSS, username: 'boss', tag: 'boss#0', bot: false },
    member: { roles: rolesOf([]) }, mentions: { channels: { first: () => undefined } },
    reply: async (m) => sent.push({ ch: 'ctl', content: typeof m === 'string' ? m : m.content, at: Date.now() }),
  };
}
function button(userId, customId) {
  const it = {
    customId, user: { id: userId, tag: `${userId}#0`, username: 'fighter' }, client,
    member: { roles: rolesOf([VERIFIED]), displayName: 'fighter', displayAvatarURL: () => '' },
    replies: [], reply: async (m) => it.replies.push(m), update: async (m) => it.replies.push(m),
    deferUpdate: async () => {}, editReply: async (m) => it.replies.push(m), followUp: async (m) => it.replies.push(m),
  };
  return it;
}

// ---------------------------------------------------------------- modules
const config = require(src('config.js'));
const T = require(src('tasks/rumbleTemplates.js'));
const rumble = require(src('tasks/rumbleRoyale.js'));
const control = require(src('tasks/control.js'));
const store = require(src('tasks/store.js'));
const { games } = rumble._test;

// fake timers for the join window (P2 / P3 / start) + instant waits during the rounds
let timers = [];
rumble._test.timing.setTimer = (fn, ms) => {
  const t = { fn, due: Date.now() + ms };
  timers.push(t);
  return t;
};
rumble._test.timing.clearTimer = (t) => (timers = timers.filter((x) => x !== t));
rumble._test.timing.sleep = async () => {};
// move the clock to `to`, firing every due timer at its own due time (they re-arm themselves)
async function runUntil(to) {
  for (;;) {
    const next = timers.filter((t) => t.due <= to).sort((a, b) => a.due - b.due)[0];
    if (!next) break;
    timers = timers.filter((t) => t !== next);
    NOW = next.due;
    next.fn();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }
  NOW = to;
}

// ---------------------------------------------------------------- runner
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.stack.split('\n').slice(0, 3).join('\n      ')}`);
  }
}
const lastCtl = () => sent.filter((s) => s.ch === 'ctl').at(-1)?.content || '';
const show = (label, text) => console.log(`      ${label}: ${text.replace(/\n/g, '\n        ')}`);
async function say(text, ai) {
  if (ai) aiAnswer = ai;
  await control.handleMessage(controlMsg(text));
  return lastCtl();
}
const yes = () => say('yes', { intent: 'confirm_yes', reply: 'Done!' });
async function cleanup() {
  for (const t of await store.listActive()) await rumble.cancel(clone(t), { client });
  games.clear();
  timers = [];
  NOW = START;
  await say('no', { intent: 'confirm_no', reply: 'Okay.' }); // drop anything still pending
}
const lastRow = () => tables.scheduled_tasks.at(-1);

(async () => {
  console.log('== 1. Reading Rumble orders (local time, Discord timestamps) ==');
  await test('defaults when the new .env keys are missing: 1440 / 120 / 10', () => {
    assert.deepStrictEqual([config.rumble.maxJoinMinutes, config.rumble.remindBeforeSeconds, config.rumble.finalPingSeconds], [1440, 120, 10]);
  });

  await test('"Host a rumble at 8 pm, play after 30 min of hosting, prize 20 points" -> host 20:00, game 20:30, window 30, points', async () => {
    const r = await say('Host a rumble at 8 pm, play after 30 min of hosting, prize 20 points', order({ time: { local: '2026-10-28T20:00' }, play_after: '30 min', prize: '20 points' }));
    show('summary', r);
    assert.ok(r.startsWith('Got it, boss! **Rumble Royale** in <#'), r);
    assert.ok(r.includes(`Hosting (join opens): <t:${U(local('20:00'))}:t> (<t:${U(local('20:00'))}:R>)`));
    assert.ok(r.includes(`Game starts: <t:${U(local('20:30'))}:t> (<t:${U(local('20:30'))}:R>) · join window: 30 min`));
    assert.match(r, /Prize: \*\*20 points\*\*, sent automatically to the winner/);
    assert.match(r, /Min players: 3/);
    assert.match(r, /Pings: 5 min before hosting \(heads-up\), when hosting, 2 min before the start, 10 s before the start, at the start/);
    assert.match(r, /Confirm\? \(yes\/no\)$/);
    await yes();
    assert.strictEqual(Date.parse(lastRow().run_at), local('20:00'));
    assert.strictEqual(lastRow().params.join_minutes, 30);
    assert.strictEqual(lastRow().params.prize_type, 'points');
    await cleanup();
  });

  await test('"rumble at 8pm, play at 8:30 pm, prize NFT" -> window 30, ticket prize', async () => {
    const r = await say('rumble at 8pm, play at 8:30 pm, prize NFT', order({ time: { local: '2026-10-28T20:00' }, play_at: { local: '2026-10-28T20:30' }, prize: 'NFT' }));
    assert.ok(r.includes('join window: 30 min'), r);
    assert.match(r, /Prize: \*\*NFT\*\*, claimed via ticket/);
    await yes();
    assert.strictEqual(lastRow().params.join_minutes, 30);
    assert.strictEqual(lastRow().params.prize_type, 'ticket');
    await cleanup();
  });

  const conflict = 'Host a rumble at 4.35 pm, join window closes 7.35 pm, prize 20 point, play after 4 hours of hosting';
  const conflictAi = order({ time: { local: '2026-10-28T16:35' }, join_closes: { local: '2026-10-28T19:35' }, play_after: '4 hours', prize: '20 point' });
  await test('conflict: "closes 7.35 pm" vs "play after 4 hours" -> ONE question with both start times, nothing dropped', async () => {
    const before = tables.scheduled_tasks.length;
    const r = await say(conflict, conflictAi);
    show('question', r);
    assert.ok(r.includes(`<t:${U(local('19:35'))}:t>`) && r.includes(`<t:${U(local('20:35'))}:t>`), 'both options as Discord timestamps');
    assert.ok(r.includes('"join window closes 7.35 pm"') && r.includes('"play after 4 hours of hosting"'), 'both phrases quoted');
    assert.strictEqual((r.match(/\?/g) || []).length, 1, 'exactly one question');
    assert.strictEqual(tables.scheduled_tasks.length, before, 'scheduled before the boss picked');
  });
  await test('... "first" picks 7:35 PM (window 3 hours), then yes schedules it', async () => {
    const r = await say('first');
    show('summary', r);
    assert.ok(r.includes(`Game starts: <t:${U(local('19:35'))}:t>`) && r.includes('join window: 3 hours'), r);
    await yes();
    assert.strictEqual(lastRow().params.join_minutes, 180);
    await cleanup();
  });
  await test('... natural replies: "8.35" -> second, "yes the first one" -> first, "2" -> second', async () => {
    for (const [reply, start] of [['8.35', '20:35'], ['yes the first one', '19:35'], ['2', '20:35']]) {
      await say(conflict, conflictAi);
      const r = await say(reply);
      assert.ok(r.includes(`Game starts: <t:${U(local(start))}:t>`), `${reply}: ${r}`);
      await cleanup();
    }
  });

  await test('"Host a rumble at 4.30 pm" at 16:34 -> "That was <t:R>. Host it right now instead, boss?", no UTC; yes hosts now', async () => {
    const r = await say('Host a rumble at 4.30 pm', order({ time: { local: '2026-10-28T16:30' } }));
    show('reply', r);
    assert.ok(r.startsWith(`That was <t:${U(local('16:30'))}:R>. Host it right now instead, boss?`), r);
    assert.doesNotMatch(r, /UTC|GMT|Dhaka|already passed/i);
    await yes();
    assert.strictEqual(Date.parse(lastRow().run_at), NOW, 'not hosted right now');
    assert.strictEqual(lastRow().params.join_minutes, 5, 'default join window');
    await cleanup();
  });

  await test('the screenshot order at 16:34 ("at 4.30 pm, closes 7.35 pm, play after 4 hours"): host-now offer, then the start-time question', async () => {
    const r = await say('Host a rumble at 4.30 pm,join window closes 7.35 pm, prize 20 point,play after 4 hours of hosting', order({ time: { local: '2026-10-28T16:30' }, join_closes: { local: '2026-10-28T19:35' }, play_after: '4 hours', prize: '20 point' }));
    assert.match(r, /^That was <t:\d+:R>\. Host it right now instead, boss\? \(yes\/no\)$/);
    const q = await yes();
    show('after yes', q);
    assert.ok(q.includes(`<t:${U(local('19:35'))}:t>`) && q.includes(`<t:${U(START + 240 * MIN)}:t>`), q);
    await cleanup();
  });

  await test('a time passed more than 30 min ago ("at 4 pm" at 16:34) -> "Did you mean tomorrow at ..."', async () => {
    const r = await say('Host a rumble at 4 pm', order({ time: { local: '2026-10-28T16:00' } }));
    assert.ok(r.startsWith(`That was <t:${U(local('16:00'))}:R>. Did you mean tomorrow at <t:${U(local('16:00', 1))}:t>, boss?`), r);
    await yes();
    assert.strictEqual(Date.parse(lastRow().run_at), local('16:00', 1));
    await cleanup();
  });

  await test('"ekhoni rumble start koro 5 min, prize 10 points" -> now, window 5', async () => {
    const r = await say('ekhoni rumble start koro 5 min, prize 10 points', order({ time: { in_minutes: 0 }, join_minutes: 5, prize: '10 points' }));
    assert.ok(r.includes(`Hosting (join opens): <t:${U(NOW)}:t>`) && r.includes('join window: 5 min'), r);
    assert.match(r, /Pings: when hosting, 2 min before the start, 10 s before the start, at the start/);
    await yes();
    assert.strictEqual(lastRow().params.join_minutes, 5);
    await cleanup();
  });

  await test('"play after 4 hours of hosting" is accepted (window 240 = "4 hours")', async () => {
    const r = await say('Host a rumble at 8 pm, play after 4 hours of hosting', order({ time: { local: '2026-10-28T20:00' }, play_after: '4 hours' }));
    assert.ok(r.includes('join window: 4 hours'), r);
    await yes();
    assert.strictEqual(lastRow().params.join_minutes, 240);
    await cleanup();
  });

  await test('more time words: "tonight 9", "9 tay", "tomorrow 9 pm", "20:00", "in 20 minutes", "2 ghonta pore", "1.5 hours"', async () => {
    const cases = [
      ['rumble tonight 9, join window 30 min', local('21:00'), 30],
      ['rumble royale 9 tay chalao', local('21:00'), 5],
      ['host a rumble tomorrow 9 pm', local('21:00', 1), 5],
      ['rumble at 20:00, start after 1.5 hours', local('20:00'), 90],
      ['host a rumble in 20 minutes', START + 20 * MIN, 5],
      ['rumble at 8 pm, 2 ghonta pore khela', local('20:00'), 120],
    ];
    for (const [text, host, jm] of cases) {
      const r = await say(text, order({}));
      assert.ok(r.includes(`Hosting (join opens): <t:${U(host)}:`), `${text}\n${r}`);
      assert.ok(r.includes(`join window: ${jm >= 60 ? (jm % 60 ? `${Math.floor(jm / 60)} hour${jm >= 120 ? 's' : ''} ${jm % 60} min` : `${jm / 60} hour${jm > 60 ? 's' : ''}`) : `${jm} min`}`), `${text}\n${r}`);
      await cleanup();
    }
  });

  await test('a phrase Vexo cannot place is never dropped: it asks ONE short question about it', async () => {
    const r = await say('Host a rumble at 8 pm, play after 30 min of hosting, double points after round 3', order({ time: { local: '2026-10-28T20:00' }, play_after: '30 min' }));
    show('question', r);
    assert.match(r, /I didn't get this part, boss: "double points after round 3"/);
    assert.strictEqual(tables.scheduled_tasks.filter((t) => store.ACTIVE.includes(t.status)).length, 0);
  });

  await test('"yes" after the pending order expired (10 min) -> "That order expired ... send it again"', async () => {
    await say('Host a rumble at 8 pm', order({ time: { local: '2026-10-28T20:00' } }));
    NOW += 11 * MIN;
    const before = tables.scheduled_tasks.length;
    const r = await yes();
    assert.match(r, /That order expired, boss .*Send it again/);
    assert.strictEqual(tables.scheduled_tasks.length, before);
    await cleanup();
  });

  console.log('\n== 2. Ping schedule ==');
  const plan = (min, params = {}) => rumble.pingPlan(min * MIN, params);
  await test('5-min window: host, +3:00 (2 min before), start - 10 s, start', () => {
    const p = plan(5);
    assert.deepStrictEqual([p.reminders, p.final], [[120], 10]);
  });
  await test('30-min window: host, start - 2 min, start - 10 s, start', () => assert.deepStrictEqual([plan(30).reminders, plan(30).final], [[120], 10]));
  await test('3-min window: no reminder (only the 10 s ping)', () => assert.deepStrictEqual([plan(3).reminders, plan(3).final], [[], 10]));
  await test('explicit "remind 10 min before" is honored (and shown in the summary)', async () => {
    const r = await say('Host a rumble at 8 pm, play after 30 min of hosting, remind 10 min before', order({ time: { local: '2026-10-28T20:00' }, play_after: '30 min', remind_before: ['10 min'] }));
    assert.match(r, /Pings: 5 min before hosting \(heads-up\), when hosting, 10 min before the start, 10 s before the start, at the start/);
    await yes();
    assert.deepStrictEqual(lastRow().params.remind_before_seconds, [600]);
    assert.deepStrictEqual(plan(30, lastRow().params).reminders, [600]);
    await cleanup();
  });

  await test('real 5-min join window on precise timers: P1 host, P2 +3:00, P3 -10 s, P4 start, role pings only, 0 AI calls', async () => {
    await say('ekhoni rumble start koro 5 min, min 1 players', order({ time: { in_minutes: 0 }, join_minutes: 5 }));
    await yes();
    const id = lastRow().id;
    const aiBefore = aiCalls;
    const from = sent.length;
    const t0 = NOW;
    await rumble.tick(clone(lastRow()), { client });
    await rumble.handleButton(button('700000000000000001', `rumble_join:${id}`));
    await runUntil(t0 + 5 * MIN + 1000);
    for (let i = 0; i < 200 && store.ACTIVE.includes(tables.scheduled_tasks.find((t) => t.id === id).status); i++) await new Promise((r) => setTimeout(r, 5));
    const msgs = sent.slice(from).filter((s) => s.ch === RUMBLE_CH);
    const pings = msgs.filter((m) => m.content.startsWith(`<@&${VERIFIED}>`));
    const rel = pings.map((m) => Math.round((m.at - t0) / 1000));
    console.log(`      pings at (s after hosting): ${rel.join(', ')}`);
    assert.deepStrictEqual(rel, [0, 180, 290, 300]);
    assert.ok(T.reminderPing.some((l) => pings[1].content.includes(l.split('{')[0].slice(0, 15))), 'P2 is a reminderPing line');
    assert.ok(T.finalPing.some((l) => pings[2].content.endsWith(l)), 'P3 is a finalPing line');
    assert.ok(T.gameStart.some((l) => pings[3].content.includes(l.split('{')[0].slice(0, 12))), 'P4 is the game start');
    for (const m of pings) assert.deepStrictEqual(m.allowedMentions, { parse: [], roles: [VERIFIED] }, 'only the verified role may be pinged');
    assert.ok(!msgs.some((m) => /one minute|60 seconds/i.test(m.content)), 'the old "1 minute left" ping is gone');
    assert.ok(!msgs.some((m) => T.halfwayReminder.some((l) => m.content.startsWith(l))), 'no halfway note for a 5-min window');
    assert.strictEqual(aiCalls - aiBefore, 0, 'the Rumble game path called the AI');
    await cleanup();
  });

  await test('min players not reached: cancelled as before, no further pings', async () => {
    await say('ekhoni rumble start koro 5 min, min 3 players', order({ time: { in_minutes: 0 }, join_minutes: 5 }));
    await yes();
    const t0 = NOW;
    await rumble.tick(clone(lastRow()), { client });
    const from = sent.length;
    await runUntil(t0 + 10 * MIN);
    const msgs = sent.slice(from).filter((s) => s.ch === RUMBLE_CH);
    assert.strictEqual(lastRow().status, 'cancelled');
    assert.ok(msgs.at(-1).content && T.cancelNotEnoughPlayers.some((l) => msgs.at(-1).content === l.replace('{min}', '3')));
    assert.ok(!msgs.slice(msgs.length - 1).some((m) => m.content.startsWith('<@&')), 'a ping after the cancel');
    assert.strictEqual(timers.length, 0, 'timers left after the cancel');
    await cleanup();
  });

  await test('4-hour window survives restarts: players restored, a ping whose time passed is skipped, the rest fire on time', async () => {
    await say('ekhoni rumble start koro, play after 4 hours, min 1 players', order({ time: { in_minutes: 0 }, play_after: '4 hours' }));
    await yes();
    const id = lastRow().id;
    const t0 = NOW;
    await rumble.tick(clone(lastRow()), { client });
    for (let i = 0; i < 3; i++) await rumble.handleButton(button(`70000000000000001${i}`, `rumble_join:${id}`));
    await runUntil(t0 + 2 * 60 * MIN); // 2 h in (halfway note posted by the pulse is not needed here)
    let g = rumble._test.gameByTask(id);
    g.lastSave = 0;
    await rumble._test.pulse(g);
    const crash = () => {
      clearInterval(g.pulse);
      timers = [];
      games.delete(RUMBLE_CH);
    };
    crash();
    await rumble.tick(clone(tables.scheduled_tasks.find((t) => t.id === id)), { client }); // restart #1 at 2 h
    g = rumble._test.gameByTask(id);
    assert.strictEqual(g.players.size, 3, 'players not restored');
    assert.strictEqual(g.state.joinEndsAt, t0 + 240 * MIN);
    assert.strictEqual(timers.length, 3, 'P2, P3 and the start should be armed');
    await rumble.tick(clone(tables.scheduled_tasks.find((t) => t.id === id)), { client }); // a scheduler tick in the window: no safety timeout
    assert.ok(rumble._test.gameByTask(id) && !g.ended);
    // restart #2 after P2's time (238 min) passed while offline
    crash();
    NOW = t0 + 238.5 * MIN;
    const from = sent.length;
    await rumble.tick(clone(tables.scheduled_tasks.find((t) => t.id === id)), { client });
    g = rumble._test.gameByTask(id);
    await runUntil(t0 + 240 * MIN + 1000);
    for (let i = 0; i < 200 && store.ACTIVE.includes(tables.scheduled_tasks.find((t) => t.id === id).status); i++) await new Promise((r) => setTimeout(r, 5));
    const pings = sent.slice(from).filter((s) => s.ch === RUMBLE_CH && s.content.startsWith('<@&'));
    const rel = pings.map((m) => Math.round((m.at - t0) / 1000));
    console.log(`      after restart at 238.5 min, pings at (s): ${rel.join(', ')} (P2 at 14280 s was skipped, never sent late)`);
    assert.deepStrictEqual(rel, [14390, 14400]);
    assert.ok(['done'].includes(tables.scheduled_tasks.find((t) => t.id === id).status));
    await cleanup();
  });

  console.log('\n== 3. Number guess game ==');
  await test('"guess the number at 9 pm" -> number guess in the general channel at 21:00 local, Discord timestamp', async () => {
    const r = await say('guess the number at 9 pm', { intent: 'schedule_game', task_type: 'number_guess', time: { local: '2026-10-28T21:00' }, reply: 'Game night!' });
    show('summary', r);
    assert.ok(r.includes(`Number guess game at **<t:${U(local('21:00'))}:t> (<t:${U(local('21:00'))}:R>)** in <#${GENERAL_CH}>`), r);
    await yes();
    assert.strictEqual(lastRow().type, 'number_guess');
    assert.strictEqual(Date.parse(lastRow().run_at), local('21:00'));
    await cleanup();
  });
  await test('"number guess game 9 tay" and "play number guess in 30 minutes" are read in code', async () => {
    let r = await say('number guess game 9 tay', { intent: 'schedule_game', task_type: 'number_guess', time: null, reply: 'Sure!' });
    assert.ok(r.includes(`<t:${U(local('21:00'))}:t>`), r);
    await cleanup();
    r = await say('play number guess in 30 minutes', { intent: 'schedule_game', task_type: 'number_guess', time: null, reply: 'Sure!' });
    assert.ok(r.includes(`<t:${U(START + 30 * MIN)}:t>`), r);
    await cleanup();
  });

  console.log('\n== 4. Never a zone in any message ==');
  await test('no control reply or channel message contains "UTC", "GMT" or "Dhaka"', () => {
    const bad = sent.filter((s) => /\bUTC\b|\bGMT\b|Dhaka/i.test(s.content));
    assert.deepStrictEqual(bad.map((s) => s.content.slice(0, 80)), []);
    console.log(`      checked ${sent.length} messages`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('test crashed:', err);
  process.exit(1);
});
