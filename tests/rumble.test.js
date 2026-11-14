// Rumble Royale test: complete games with fake players, no Discord, no Supabase, no AI, and a fake
// clock (every wait is recorded, none really happens).
// Run: node tests/rumble.test.js   (real .env values are never used for anything that matters, nor printed)
const assert = require('assert');

const BOSS = '123456789012345678';
const STAFF = '223456789012345678';
const MEMBER = '323456789012345678';
const BOT = '111111111111111111';
const RUMBLE_CH = '444444444444444444';
const GENERAL_CH = '555555555555555555';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: 'g', HOME_GUILD_ID: 'g', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: BOSS, STAFF_ROLE_IDS: 'staffrole',
  CONTROL_CHANNEL_ID: 'ctl', GENERAL_CHANNEL_ID: GENERAL_CH, TICKET_CHANNEL_ID: 'tickets', VERIFIED_ROLE_ID: 'verified',
  BOSS_TIMEZONE: 'Asia/Dhaka', RUMBLE_CHANNEL_ID: RUMBLE_CH, RUMBLE_MIN_PLAYERS: '3', RUMBLE_MAX_PLAYERS: '100',
  RUMBLE_ROUND_SECONDS: '1', RUMBLE_MAX_MINUTES: '20', RUMBLE_REQUIRE_VERIFIED: 'true', RUMBLE_DEFAULT_JOIN_MINUTES: '5',
  RUMBLE_MAX_POINTS_PRIZE: '100000', RUMBLE_PRE_ANNOUNCE_MINUTES: '5',
  RUMBLE_REVIVE_CHANCE: '25', RUMBLE_MAX_REVIVES: '2', RUMBLE_RUNNERS_SHOWN: '5',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { scheduled_tasks: [], point_log: [] };
const clone = (o) => JSON.parse(JSON.stringify(o));
const fakeDb = {
  rpc: async () => ({ data: 0, error: null }),
  from(table) {
    const q = { op: 'select', filters: [], single: false, limit: Infinity };
    const api = {
      select: () => api, order: () => api, gt: () => api, gte: () => api, lt: () => api, is: () => api, not: () => api,
      limit: (n) => ((q.limit = n), api),
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
      const out = match.slice(0, q.limit).map(clone);
      return { data: q.single ? out[0] || null : out, error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- mocked points module
const credits = []; // every adjustPoints call
const balances = {};
let failPayout = false;
const fakePoints = {
  adjustPoints: async (userId, amount, reason) => {
    if (failPayout) throw new Error('simulated database error');
    await new Promise((r) => setTimeout(r, 5)); // like a real round trip, so concurrent calls overlap
    credits.push({ userId, amount, reason });
    balances[userId] = (balances[userId] || 0) + amount;
    tables.point_log.push({ id: tables.point_log.length + 1, user_id: userId, amount, reason });
    return balances[userId];
  },
  today: () => '2026-10-27', daysAgo: () => '2026-10-26', isEligible: () => true,
  recordMessage: async () => 0, recordReaction: async () => 0, awardQuality: async () => 0,
};
require.cache[src('points.js')] = { id: src('points.js'), filename: src('points.js'), loaded: true, exports: fakePoints };

// ---------------------------------------------------------------- AI: counted, scripted only for control orders
let aiCalls = 0;
let aiAnswer = '{}';
global.fetch = async () => {
  aiCalls++;
  return { ok: true, json: async () => ({ choices: [{ message: { content: aiAnswer } }] }) };
};

// ---------------------------------------------------------------- fake Discord + event log
const sent = []; // { ch, content, embeds, components, allowedMentions }
const events = []; // ordered: { type: 'send', rec } | { type: 'sleep', ms } | { type: 'typing' }
let msgId = 1000;
function channel(id) {
  return {
    id, name: id === RUMBLE_CH ? 'rumble' : id, isTextBased: () => true,
    sendTyping: async () => events.push({ type: 'typing', ch: id }),
    send: async (m) => {
      const rec = {
        ch: id, content: typeof m === 'string' ? m : m.content, embeds: (m.embeds || []).map((e) => e.toJSON?.() || e),
        components: m.components, allowedMentions: m.allowedMentions, edits: [],
      };
      sent.push(rec);
      events.push({ type: 'send', rec });
      return { id: String(++msgId), edit: async (e) => rec.edits.push(e) };
    },
    messages: { fetch: async () => ({ id: 'x', edit: async () => {} }) },
  };
}
const channels = { ctl: channel('ctl'), [RUMBLE_CH]: channel(RUMBLE_CH), [GENERAL_CH]: channel(GENERAL_CH) };
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };
const rolesOf = (roles) => ({ cache: { has: (r) => roles.includes(r), some: (fn) => roles.map((id) => ({ id })).some(fn) } });

function slash(userId, sub, opts = {}, roles = []) {
  const it = {
    user: { id: userId, tag: `${userId}#0`, username: 'u' }, member: { roles: rolesOf(roles), displayName: 'u' }, client,
    options: { getSubcommand: () => sub, getInteger: (n) => opts[n] ?? null, getString: (n) => opts[n] ?? null },
    replies: [], deferred: false, replied: false,
    reply: async (m) => ((it.replied = true), it.replies.push(m)),
    deferReply: async () => (it.deferred = true),
    editReply: async (m) => it.replies.push(m),
    followUp: async (m) => it.replies.push(m),
  };
  return it;
}
function button(userId, customId, { roles = ['verified'], name = 'fighter' } = {}) {
  const it = {
    customId, user: { id: userId, tag: `${userId}#0`, username: name },
    member: { roles: rolesOf(roles), displayName: name, displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${userId}/a.png` },
    client, replies: [], deferred: false, replied: false,
    reply: async (m) => ((it.replied = true), it.replies.push(m)),
    update: async (m) => ((it.replied = true), it.replies.push(m)),
    deferUpdate: async () => (it.deferred = true),
    editReply: async (m) => it.replies.push(m),
    followUp: async (m) => it.replies.push(m),
  };
  return it;
}
const text = (m) => (typeof m === 'string' ? m : m?.content || '');
const lastReply = (it) => text(it.replies.at(-1));
function controlMsg(content, author = BOSS) {
  return {
    content, channelId: 'ctl', client, channel: channels.ctl, guild: { channels: { cache: { find: () => null } } },
    author: { id: author, username: 'boss', tag: 'boss#0', bot: false },
    member: { roles: rolesOf([]) }, mentions: { channels: { first: () => undefined } },
    reply: async (m) => sent.push({ ch: 'ctl', content: text(m) }),
  };
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
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 15000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await realSleep(2);
  }
}

const config = require(src('config.js'));
const T = require(src('tasks/rumbleTemplates.js'));
const rumble = require(src('tasks/rumbleRoyale.js'));
const control = require(src('tasks/control.js'));
const store = require(src('tasks/store.js'));
const { games } = rumble._test;
// fake clock: every game wait is recorded and returns at once
rumble._test.timing.sleep = async (ms) => {
  events.push({ type: 'sleep', ms });
  await new Promise((r) => setImmediate(r));
};
const row = (id) => tables.scheduled_tasks.find((t) => t.id === id);
const EMOJI = /\p{Extended_Pictographic}/gu;

// open the join window of a task right away, add n verified players, close the window, wait for the end
async function playGame(params, n, { source = 'manual', names } = {}) {
  const { row: r, error } = await rumble.createRumble({ params, runAt: new Date(), createdBy: BOSS, source });
  if (error) throw new Error(error);
  await rumble.tick(clone(row(r.id)), { client });
  const game = rumble._test.gameByTask(r.id);
  assert.ok(game, 'join window did not open');
  for (let i = 0; i < n; i++) {
    const id = `9${String(r.id).padStart(5, '0')}${String(i).padStart(12, '0')}`; // 18-digit string (too big for a JS number)
    await rumble.handleButton(button(id, `rumble_join:${r.id}`, { name: names ? names[i % names.length] : `Fighter ${i + 1}` }));
  }
  const from = events.length;
  await rumble._test.closeJoin(game);
  await until(() => ['done', 'cancelled'].includes(row(r.id).status));
  const ev = events.slice(from).filter((e) => e.type !== 'send' || e.rec.ch === RUMBLE_CH);
  return { id: r.id, game, ev, msgs: ev.filter((e) => e.type === 'send').map((e) => e.rec) };
}
const isRoundCard = (m) => m.embeds.length === 1 && /^(⚔️ Round \d+|🔥 FINAL DUEL)$/.test(m.embeds[0].title || '');

// a game object driven by playRound() directly (no Discord, no waits): for the many-games checks
function simGame(n) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, kills: 0, rounds: 0, alive: true, eliminatedAt: null, revived: false }));
  return rumble._test.newGame({ id: 1, channel_id: 'sim', params: {} }, client, { players, phase: 'rounds' });
}
function simulate(n) {
  const g = simGame(n);
  let guard = 0;
  while ([...g.players.values()].filter((p) => p.alive).length > 1) {
    rumble._test.playRound(g);
    if (++guard > 500) throw new Error('game did not terminate');
  }
  return g;
}

(async () => {
  console.log('== 1. Template bank ==');
  await test('every list meets its minimum size, placeholders are valid, no "?", emoji counts per list', () => {
    const problems = [];
    for (const [name, rule] of Object.entries(T.RULES)) {
      const list = T[name];
      if (!Array.isArray(list)) { problems.push(`${name}: missing`); continue; }
      if (list.length < rule.min) problems.push(`${name}: ${list.length} < ${rule.min}`);
      const allowed = new Set([...(rule.required || []), ...(rule.optional || [])]);
      const [emin, emax] = rule.emoji || [0, 1];
      if (new Set(list).size !== list.length) problems.push(`${name}: duplicate lines`);
      for (const line of list) {
        const used = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        for (const u of used) if (!allowed.has(u)) problems.push(`${name}: unknown {${u}} in "${line}"`);
        for (const r of rule.required || []) if (!used.includes(r)) problems.push(`${name}: missing {${r}} in "${line}"`);
        if (line.includes('?')) problems.push(`${name}: question mark in "${line}"`);
        const e = (line.match(EMOJI) || []).length;
        if (e < emin || e > emax) problems.push(`${name}: ${e} emoji (want ${emin}-${emax}) in "${line}"`);
      }
      for (const [ph, min] of Object.entries(rule.minWith || {})) {
        const n = list.filter((l) => l.includes(`{${ph}}`)).length;
        if (n < min) problems.push(`${name}: only ${n} lines use {${ph}} (min ${min})`);
      }
    }
    console.log(`      sizes: ${Object.keys(T.RULES).map((k) => `${k} ${T[k].length}`).join(', ')}`);
    assert.deepStrictEqual(problems, []);
  });

  console.log('\n== 2. Parsing (shared, deterministic) ==');
  await test('join window parsing: "10 minute", "5 min", "10 minute dhore", "15 minutes" (and start-time phrases are skipped)', () => {
    const cases = {
      '10 minute': 10, '5 min': 5, '10 minute dhore': 10, '15 minutes': 15,
      'aj 9 tay rumble royale chalao, 10 minute, prize 100 points': 10, 'rumble 5 minute dhore, prize 1 SOL': 5,
      'ekhoni rumble start koro 10 min, NFT prize': 10, 'tonight 10pm rumble royale, 15 minutes, 500 points': 15,
      'rumble in 10 minutes': null, '10 min por rumble': null, 'min 5 players': null,
    };
    for (const [t, want] of Object.entries(cases)) assert.strictEqual(rumble.parseJoinMinutes(t), want, t);
    assert.strictEqual(rumble.parseMinPlayers('min 5 players'), 5);
  });
  await test('prize classification: points / ticket / none (one shared function)', () => {
    const c = (p) => rumble.classifyPrize(p);
    assert.deepStrictEqual(c('100 points'), { prize: '100 points', prize_type: 'points', prize_points: 100 });
    assert.deepStrictEqual(c('1,000 pts'), { prize: '1,000 pts', prize_type: 'points', prize_points: 1000 });
    for (const t of ['1 SOL', 'NFT', 'WL spot', '$50', '20 USDC', 'custom role', '0.5 ETH']) {
      assert.strictEqual(c(t).prize_type, 'ticket', t);
      assert.strictEqual(c(t).prize, t);
    }
    assert.strictEqual(c('').prize_type, 'none');
    assert.strictEqual(c(null).prize_type, 'none');
  });

  console.log('\n== 3. Channel + permissions ==');
  await test('empty RUMBLE_CHANNEL_ID blocks scheduling everywhere with a clear message, no fallback channel', async () => {
    const saved = config.rumble.channelId;
    config.rumble.channelId = '';
    const before = tables.scheduled_tasks.length;
    try {
      assert.match(rumble.buildRumbleParams({}).error, /RUMBLE_CHANNEL_ID is missing/);
      const it = slash(BOSS, 'start', { minutes: 5 });
      await rumble.handleSlash(it);
      assert.match(lastReply(it), /RUMBLE_CHANNEL_ID is missing/);
      aiAnswer = JSON.stringify({ intent: 'schedule_game', task_type: 'rumble_royale', time: { in_minutes: 0 }, prize: '10 points', join_minutes: 5, reply: 'Rumble!' });
      await control.handleMessage(controlMsg('ekhoni rumble start koro 5 min'));
      assert.match(sent.at(-1).content, /RUMBLE_CHANNEL_ID is missing/);
      config.rumble.channelId = 'general'; // invalid value
      assert.match(rumble.buildRumbleParams({}).error, /RUMBLE_CHANNEL_ID/);
      assert.strictEqual(tables.scheduled_tasks.length, before, 'a task was created');
      assert.ok(!sent.some((s) => s.ch === GENERAL_CH), 'something was posted in another channel');
    } finally {
      config.rumble.channelId = saved;
    }
  });

  await test('non-staff user is denied (ephemeral template line), staff and boss are allowed', async () => {
    const it = slash(MEMBER, 'start', { minutes: 5 });
    await rumble.handleSlash(it);
    assert.ok(T.denial.includes(lastReply(it)), lastReply(it));
    assert.ok(it.replies.at(-1).flags, 'not ephemeral');
    const st = slash(STAFF, 'status', {}, ['staffrole']);
    await rumble.handleSlash(st);
    assert.match(lastReply(st), /No Rumble/);
  });

  console.log('\n== 4. /rumble preview, confirm, second game, cancel ==');
  let manualParams = null;
  await test('/rumble start shows a preview and schedules NOTHING until Confirm; Confirm by another user is rejected', async () => {
    const aiBefore = aiCalls;
    const before = tables.scheduled_tasks.length;
    const it = slash(BOSS, 'start', { minutes: 10, prize: '100 points' });
    await rumble.handleSlash(it);
    const preview = it.replies.at(-1);
    assert.match(preview.content, /<t:\d+:t> \(<t:\d+:R>\)/);
    assert.match(preview.content, /Prize: \*\*100 points\*\*, sent automatically to the winner/);
    assert.strictEqual(tables.scheduled_tasks.length, before, 'scheduled before Confirm');
    const token = preview.components[0].components[0].data.custom_id.split(':')[1];
    const other = button(STAFF, `rumble_ok:${token}`);
    await rumble.handleButton(other);
    assert.match(lastReply(other), /Only the person who ran/);
    assert.strictEqual(tables.scheduled_tasks.length, before, 'scheduled by the wrong user');
    await rumble.handleButton(button(BOSS, `rumble_ok:${token}`));
    assert.strictEqual(tables.scheduled_tasks.length, before + 1);
    manualParams = clone(tables.scheduled_tasks.at(-1).params);
    assert.strictEqual(manualParams.source, 'manual');
    assert.strictEqual(aiCalls - aiBefore, 0, 'the /rumble path called the AI');
  });

  await test('a second game in the same channel is rejected (slash and control order)', async () => {
    const it = slash(BOSS, 'start', { minutes: 5 });
    await rumble.handleSlash(it);
    assert.match(lastReply(it), /already a game/);
    aiAnswer = JSON.stringify({ intent: 'schedule_game', task_type: 'rumble_royale', time: { in_minutes: 0 }, prize: null, join_minutes: 5, reply: 'Rumble!' });
    await control.handleMessage(controlMsg('ekhoni rumble start koro 5 min'));
    assert.match(sent.at(-1).content, /already a game/);
  });

  await test('/rumble cancel works during the join window (template line in the game channel + control report)', async () => {
    const task = tables.scheduled_tasks.at(-1);
    await rumble.tick(clone(task), { client });
    assert.strictEqual(row(task.id).status, 'running');
    await rumble.handleButton(button('700000000000000001', `rumble_join:${task.id}`));
    const from = sent.length;
    await rumble.handleSlash(slash(BOSS, 'cancel'));
    assert.strictEqual(row(task.id).status, 'cancelled');
    assert.ok(sent.slice(from).some((s) => s.ch === RUMBLE_CH && T.cancelledByBoss.includes(s.content)), 'no cancelledByBoss line');
    assert.ok(sent.slice(from).some((s) => s.ch === 'ctl' && /cancelled via \/rumble/.test(s.content)), 'no control report');
    assert.ok(!games.has(RUMBLE_CH));
  });

  await test('a huge points prize needs a second Confirm press', async () => {
    const it = slash(BOSS, 'start', { prize: '500000 points' });
    await rumble.handleSlash(it);
    const token = it.replies.at(-1).components[0].components[0].data.custom_id.split(':')[1];
    const before = tables.scheduled_tasks.length;
    const first = button(BOSS, `rumble_ok:${token}`);
    await rumble.handleButton(first);
    assert.strictEqual(tables.scheduled_tasks.length, before, 'scheduled after one press');
    assert.match(lastReply(first), /Press Confirm once more/);
    await rumble.handleButton(button(BOSS, `rumble_ok:${token}`));
    assert.strictEqual(tables.scheduled_tasks.length, before + 1);
    await rumble.cancel(clone(tables.scheduled_tasks.at(-1)), { client });
  });

  console.log('\n== 5. Control channel order = same task ==');
  await test('control order and the equivalent /rumble start produce identical params (except source)', async () => {
    aiAnswer = JSON.stringify({ intent: 'schedule_game', task_type: 'rumble_royale', time: { in_minutes: 0 }, prize: '100 points', join_minutes: 10, reply: 'Rumble time!' });
    await control.handleMessage(controlMsg('ekhoni rumble royale start koro, 10 minute, prize 100 points'));
    assert.match(sent.at(-1).content, /Prize: \*\*100 points\*\*, sent automatically to the winner/);
    const before = tables.scheduled_tasks.length;
    aiAnswer = JSON.stringify({ intent: 'confirm_yes', reply: 'Done!' });
    await control.handleMessage(controlMsg('yes'));
    assert.strictEqual(tables.scheduled_tasks.length, before + 1, sent.at(-1).content);
    const vexoParams = clone(tables.scheduled_tasks.at(-1).params);
    const strip = ({ source, ...rest }) => rest;
    assert.strictEqual(vexoParams.source, 'vexo');
    assert.deepStrictEqual(strip(vexoParams), strip(manualParams));
    await rumble.cancel(clone(tables.scheduled_tasks.at(-1)), { client });
  });

  console.log('\n== 6. Pacing: one card per round, one at a time ==');
  await test('RUMBLE_ROUND_SECONDS=1 is clamped to 3 (with one startup warning line)', () => {
    assert.strictEqual(config.rumble.roundSeconds, 1);
    assert.strictEqual(rumble._test.roundSeconds(), 3);
    console.log(`      startup: ${rumble._test.roundSecondsNote()}`);
    assert.match(rumble._test.roundSecondsNote(), /below the minimum, using 3 seconds/);
  });

  const aiBeforeGames = aiCalls;
  const creditsBefore = credits.length;
  const NAMES = ['*Star*', 'Mega_Max', '@everyone', 'Luna', 'Zed', '`code`', 'Ana', 'Bo'];
  const results = [];
  for (const prize of ['100 points', '1 SOL', '', '250 points', 'NFT']) {
    const built = rumble.buildRumbleParams({ join_minutes: 1, prize, min_players: 3 });
    results.push({ prize, ...(await playGame(built.params, 40, { names: NAMES })) });
  }

  await test('each round is exactly ONE embed message (no text), in round order, final duel last', () => {
    for (const r of results) {
      const cards = r.msgs.filter(isRoundCard);
      assert.strictEqual(cards.length, r.game.round, 'one card per round');
      cards.forEach((c, i) => {
        assert.strictEqual(c.embeds.length, 1);
        assert.ok(!c.content, 'round card has text content');
        if (i < cards.length - 1) assert.strictEqual(c.embeds[0].title, `⚔️ Round ${i + 1}`);
      });
      assert.strictEqual(cards.at(-1).embeds[0].title, '🔥 FINAL DUEL');
      assert.match(cards[0].embeds[0].footer.text, /^👥 \d+ players left$/);
    }
    const c = results[0].msgs.filter(isRoundCard)[1].embeds[0];
    console.log(`      sample card: [${c.title}] ${c.description.split('\n').slice(0, 3).join(' / ')} [${c.footer.text}] color #${c.color.toString(16)}`);
  });

  await test('rounds are sent one at a time with a >= 3 s wait between cards (typing at most once per wait), suspense before the final duel', () => {
    for (const r of results) {
      const ev = r.ev;
      const cardIdx = ev.map((e, i) => (e.type === 'send' && isRoundCard(e.rec) ? i : -1)).filter((i) => i >= 0);
      for (let k = 1; k < cardIdx.length; k++) {
        const between = ev.slice(cardIdx[k - 1] + 1, cardIdx[k]);
        const waits = between.filter((e) => e.type === 'sleep').map((e) => e.ms);
        assert.ok(waits.some((ms) => ms >= 3000), `no >= 3 s wait between card ${k} and ${k + 1}`);
        assert.ok(between.filter((e) => e.type === 'typing').length <= 1, 'typing more than once in a wait');
        assert.ok(waits.every((ms) => ms >= 3000), `a wait shorter than 3 s between round cards: ${waits}`);
      }
      // the final duel: suspense message, ~4 s, then the card
      const lastCard = cardIdx.at(-1);
      const before = ev.slice(cardIdx.at(-2) + 1, lastCard);
      const suspense = before.find((e) => e.type === 'send' && T.finalCountdown.includes(e.rec.content));
      assert.ok(suspense, 'no suspense message before the final duel');
      assert.ok(before.some((e) => e.type === 'sleep' && e.ms === rumble._test.FINAL_SUSPENSE_MS));
    }
    const waits = results[0].ev.filter((e) => e.type === 'sleep').map((e) => e.ms);
    console.log(`      waits in game 1 (ms): ${waits.join(', ')}`);
  });

  await test('winner path in order: winner embed, ~2 s, runners-up embed, ~2 s, congratulation message (only ping)', () => {
    for (const r of results) {
      const ev = r.ev;
      const finalIdx = ev.findIndex((e) => e.type === 'send' && e.rec.embeds[0]?.title === '🔥 FINAL DUEL');
      const after = ev.slice(finalIdx + 1);
      const sends = after.filter((e) => e.type === 'send').map((e) => e.rec);
      assert.strictEqual(sends.length, 3, `expected 3 messages after the final duel, got ${sends.length}`);
      const [win, runners, congrats] = sends;
      assert.strictEqual(win.embeds[0].title, '👑 RUMBLE CHAMPION');
      assert.strictEqual(runners.embeds[0].title, '🏅 Runners-up');
      assert.ok(!congrats.embeds.length && congrats.content);
      const w = row(r.id).state.winner;
      assert.match(congrats.content, new RegExp(`<@${w.id}>`));
      assert.deepStrictEqual(congrats.allowedMentions.users, [w.id]);
      assert.deepStrictEqual(win.allowedMentions.parse, []);
      const gaps = (a, b) => after.slice(after.findIndex((e) => e.rec === a) + 1, after.findIndex((e) => e.rec === b)).filter((e) => e.type === 'sleep').map((e) => e.ms);
      assert.deepStrictEqual(gaps(win, runners), [2000]);
      assert.deepStrictEqual(gaps(runners, congrats), [2000]);
      // winner card fields
      const f = Object.fromEntries(win.embeds[0].fields.map((x) => [x.name, x.value]));
      assert.strictEqual(f.Eliminations, String(w.kills));
      assert.strictEqual(f['Rounds survived'], String(w.rounds));
      assert.strictEqual(f['Players in the game'], '40');
      assert.strictEqual(f.Prize, r.prize === '' ? 'Glory' : r.prize);
      assert.match(win.embeds[0].thumbnail.url, /^https:\/\//);
      assert.strictEqual(win.embeds[0].footer.text, 'Rumble Royale · hosted by Vexo');
    }
    const r = results[0];
    const [win, runners, congrats] = r.msgs.slice(-3);
    console.log(`      winner card: ${win.embeds[0].description.replace(/\n/g, ' / ')} | ${win.embeds[0].fields.map((x) => `${x.name}: ${x.value}`).join(', ')}`);
    console.log(`      runners-up: ${runners.embeds[0].description.replace(/\n/g, ' / ')}`);
    console.log(`      congrats: ${congrats.content.replace(/\n/g, ' / ')}`);
  });

  await test('runners-up: right order (last eliminated = 2nd, same round -> more kills), up to 5 shown', () => {
    for (const r of results) {
      const players = row(r.id).state.players.filter((p) => !p.alive);
      const expected = players
        .sort((a, b) => b.eliminatedAt - a.eliminatedAt || b.kills - a.kills || a.tie - b.tie)
        .slice(0, 5)
        .map((p) => p.id);
      const got = row(r.id).state.runnersUp.map((x) => x.id);
      assert.deepStrictEqual(got, expected);
      assert.strictEqual(row(r.id).state.runnersUp[0].id, players.find((p) => p.eliminatedAt === r.game.round).id, 'final duel loser is not 2nd');
      const lines = r.msgs.at(-2).embeds[0].description.split('\n').filter((l) => /^(🥈|🥉|4️⃣|5️⃣|6️⃣)/.test(l));
      assert.deepStrictEqual(lines.map((l) => l.slice(0, 2)), ['🥈', '🥉', '4️', '5️', '6️'].map((x) => x.slice(0, 2)));
    }
  });

  await test('players only decrease, except a revive round, which adds exactly one back', () => {
    for (const r of results) {
      for (const e of r.game.roundLog) {
        assert.ok(e.afterElims < e.start, `round ${e.round}: nobody eliminated`);
        assert.strictEqual(e.end - e.afterElims, e.revived ? 1 : 0, `round ${e.round}`);
        assert.ok(e.end <= e.start, `round ${e.round}: more players than at the start`);
      }
      const ends = r.game.roundLog.map((e) => e.end);
      assert.strictEqual(ends.at(-1), 1);
    }
    console.log(`      players after each round (game 1): 40 -> ${results[0].game.roundLog.map((e) => (e.revived ? `${e.end}(+1 revive)` : e.end)).join(' -> ')}`);
  });

  await test('no template line repeats within a game while unused ones remain', () => {
    for (const r of results) {
      const seen = new Map();
      for (const [name, i] of r.game.drawn) {
        const s = seen.get(name) || new Set();
        if (s.has(i)) {
          assert.strictEqual(s.size, T[name].length, `${name} repeated a line with ${T[name].length - s.size} unused`);
          s.clear();
        }
        s.add(i);
        seen.set(name, s);
      }
    }
  });

  await test('points prize credited exactly once; ticket / no-prize never credit; congrats says "sent" only after the credit', () => {
    const mine = credits.slice(creditsBefore);
    assert.deepStrictEqual(mine.map((c) => c.amount), [100, 250]);
    assert.strictEqual(mine[0].userId, row(results[0].id).state.winner.id);
    assert.ok(row(results[0].id).state.paid);
    assert.match(results[0].msgs.at(-1).content, /100 points/);
    assert.match(results[1].msgs.at(-1).content, /1 SOL/);
    assert.match(results[1].msgs.at(-1).content, /ticket/i);
    const rep = sent.filter((s) => s.ch === 'ctl' && s.content.includes(`Rumble #${results[0].id} is done`)).at(-1).content;
    assert.match(rep, /Points credited: \*\*yes\*\*/);
    assert.match(rep, /Runners-up: 2\. /);
    assert.match(rep, /Revives: \d/);
    assert.match(rep, /AI calls during game: 0/);
    console.log(`      report: ${rep.replace(/\n/g, ' / ')}`);
  });

  await test('AI call counter is 0 for all games', () => {
    assert.strictEqual(aiCalls - aiBeforeGames, 0);
  });

  await test('100 players (and a 300-player stress game): every embed description stays under 4000 chars', async () => {
    let built = rumble.buildRumbleParams({ join_minutes: 1, prize: '', min_players: 3 });
    const r = await playGame(built.params, 100);
    assert.strictEqual(r.game.players.size, 100);
    const savedMax = config.rumble.maxPlayers;
    config.rumble.maxPlayers = 300;
    built = rumble.buildRumbleParams({ join_minutes: 1, prize: '', min_players: 3 });
    const big = await playGame(built.params, 300);
    config.rumble.maxPlayers = savedMax;
    const all = [...r.msgs, ...big.msgs].filter((m) => m.embeds.length);
    for (const m of all) assert.ok((m.embeds[0].description || '').length < 4000, `${m.embeds[0].description.length} chars`);
    const round1 = big.msgs.find(isRoundCard).embeds[0].description;
    assert.match(round1, /\.\.\.and \*\*\d+\*\* more fell\./);
    console.log(`      100 players, round 1: ${r.msgs.find(isRoundCard).embeds[0].description.length} chars · 300 players, round 1: ${round1.length} chars (truncated with "...and N more fell")`);
  });

  console.log('\n== 7. Revives (code-decided, simulated games) ==');
  await test('revive rules hold over 2000 games: never round 1, never final duel, never with <= 3 left, max 2, never the same player twice', () => {
    config.rumble.reviveChance = 100;
    let total = 0;
    for (let i = 0; i < 2000; i++) {
      const g = simulate(3 + (i % 60));
      const revs = g.roundLog.filter((e) => e.revived);
      total += revs.length;
      for (const e of revs) {
        assert.ok(e.round > 1, 'revive in round 1');
        assert.notStrictEqual(e.kind, 'final');
        assert.ok(e.afterElims > 3, `revive with ${e.afterElims} left`);
      }
      assert.ok(revs.length <= 2);
      assert.strictEqual(new Set(revs.map((e) => e.revived)).size, revs.length, 'same player revived twice');
      assert.strictEqual([...g.players.values()].filter((p) => p.alive).length, 1, 'not exactly one winner');
      const final = g.roundLog.at(-1);
      assert.strictEqual(final.kind, 'final');
    }
    console.log(`      chance 100: ${total} revives in 2000 games of 3-62 players`);
    config.rumble.reviveChance = 25;
  });

  await test('RUMBLE_REVIVE_CHANCE=100 revives in allowed rounds; 0 never revives', () => {
    config.rumble.reviveChance = 100;
    const g = simulate(40);
    assert.strictEqual(g.revives, 2, 'with 40 players and chance 100, both revives should happen');
    // round 2 is the first allowed round, and it had a pool (round 1 victims)
    assert.strictEqual(g.roundLog[1].kind, 'revive');
    config.rumble.reviveChance = 0;
    for (let i = 0; i < 300; i++) assert.strictEqual(simulate(40).revives, 0);
    config.rumble.reviveChance = 25;
  });

  await test('revived players can be eliminated again; runners-up use their LAST elimination', () => {
    config.rumble.reviveChance = 100;
    let checked = 0;
    for (let i = 0; i < 300 && checked < 50; i++) {
      const g = simulate(30);
      const rank = rumble._test.rankRunnersUp(g);
      for (const p of g.players.values()) {
        if (!p.revived || p.alive) continue;
        assert.ok(p.eliminatedAt > p.revivedAt, 'revived player keeps an old elimination round');
        const idx = rank.findIndex((x) => x.id === p.id);
        if (idx >= 0) {
          // everyone ranked above them was eliminated in the same or a LATER round than their last elimination
          rank.slice(0, idx).forEach((q) => assert.ok(q.eliminatedAt >= p.eliminatedAt, 'ranked by an old elimination'));
          checked++;
        }
      }
    }
    config.rumble.reviveChance = 25;
    assert.ok(checked > 0, 'no revived runner-up seen');
  });

  await test('fairness: over 6000 games every player has about the same chance to be revived (and to win)', () => {
    config.rumble.reviveChance = 100;
    const N = 12;
    const revived = new Array(N).fill(0);
    const won = new Array(N).fill(0);
    const GAMES = 6000;
    for (let i = 0; i < GAMES; i++) {
      const g = simulate(N);
      for (const p of g.players.values()) {
        const idx = Number(p.id.slice(1));
        if (p.revived) revived[idx]++;
        if (p.alive) won[idx]++;
      }
    }
    const spread = (a) => (Math.max(...a) - Math.min(...a)) / (a.reduce((x, y) => x + y, 0) / a.length);
    console.log(`      revives per player: ${revived.join(' ')} (spread ${(spread(revived) * 100).toFixed(1)}%)`);
    console.log(`      wins per player:    ${won.join(' ')} (spread ${(spread(won) * 100).toFixed(1)}%)`);
    assert.ok(spread(revived) < 0.25, 'revive chance is not even across players');
    assert.ok(spread(won) < 0.35, 'win chance is not even across players');
    config.rumble.reviveChance = 25;
  });

  await test('real game flow with RUMBLE_REVIVE_CHANCE=100: orange revive card with a "🧟 REVIVE" section, count +1 in its footer', async () => {
    config.rumble.reviveChance = 100;
    const built = rumble.buildRumbleParams({ join_minutes: 1, prize: '', min_players: 3 });
    const r = await playGame(built.params, 30);
    config.rumble.reviveChance = 25;
    const cards = r.msgs.filter(isRoundCard).map((m) => m.embeds[0]);
    const reviveCards = cards.filter((c) => /\*\*🧟 REVIVE\*\*/.test(c.description));
    assert.strictEqual(reviveCards.length, 2, 'expected 2 revive cards');
    for (const c of reviveCards) assert.strictEqual(c.color, 0xe67e22);
    for (const e of r.game.roundLog) {
      const card = cards.find((c) => c.title === (e.kind === 'final' ? '🔥 FINAL DUEL' : `⚔️ Round ${e.round}`));
      assert.strictEqual(card.footer.text, `👥 ${e.end} player${e.end === 1 ? '' : 's'} left`);
    }
    assert.strictEqual(row(r.id).state.revives, 2);
    assert.strictEqual(r.msgs.filter((m) => m.embeds[0]?.title === '👑 RUMBLE CHAMPION').length, 1);
    const rc = reviveCards[0];
    console.log(`      revive card: [${rc.title}] …${rc.description.slice(rc.description.indexOf('**🧟')).replace(/\n/g, ' / ')} [${rc.footer.text}]`);
    console.log(`      players after each round: 30 -> ${r.game.roundLog.map((e) => (e.revived ? `${e.end}(+1 revive)` : e.end)).join(' -> ')}`);
  });

  await test('small games: 2 players -> 1 runner-up; 1 player -> no runners-up card', async () => {
    let built = rumble.buildRumbleParams({ join_minutes: 1, min_players: 1 });
    const two = await playGame(built.params, 2);
    assert.strictEqual(row(two.id).state.runnersUp.length, 1);
    assert.ok(two.msgs.some((m) => m.embeds[0]?.title === '🏅 Runners-up'));
    built = rumble.buildRumbleParams({ join_minutes: 1, min_players: 1 });
    const one = await playGame(built.params, 1);
    assert.strictEqual(row(one.id).state.runnersUp.length, 0);
    assert.ok(!one.msgs.some((m) => m.embeds[0]?.title === '🏅 Runners-up'));
    assert.ok(one.msgs.some((m) => m.embeds[0]?.title === '👑 RUMBLE CHAMPION'));
    const titles = one.msgs.map((m) => m.embeds[0]?.title || 'text');
    console.log(`      1-player game messages: ${titles.join(' -> ')}`);
  });

  console.log('\n== 8. Payout safety ==');
  await test('payout called twice (one after another AND at the same moment) credits exactly once', async () => {
    const n = credits.length;
    const state = {};
    const ctx = { taskId: 9001, state, winnerId: MEMBER, amount: 77 };
    const [a, b] = await Promise.all([rumble.payout(ctx), rumble.payout(ctx)]);
    const c = await rumble.payout(ctx);
    const fresh = await rumble.payout({ taskId: 9001, state: {}, winnerId: MEMBER, amount: 77 }); // flag lost: point_log still blocks it
    assert.strictEqual(credits.length - n, 1);
    assert.ok(a.ok && !b.ok && c.ok && c.already && fresh.ok && fresh.already);
  });

  await test('payout failure: never claims it was paid, tells the winner to open a ticket, reports to the boss', async () => {
    failPayout = true;
    try {
      const built = rumble.buildRumbleParams({ join_minutes: 1, prize: '30 points', min_players: 3 });
      const r = await playGame(built.params, 5);
      const congrats = r.msgs.at(-1).content;
      assert.doesNotMatch(congrats, /sent to|credited|have been added|balance just|pockets/i);
      assert.match(congrats, /ticket/i);
      const rep = sent.filter((s) => s.ch === 'ctl').at(-1).content;
      assert.match(rep, /Points credited: \*\*NO\*\*/);
      assert.match(rep, /30 points/);
      assert.ok(!row(r.id).state.paid);
    } finally {
      failPayout = false;
    }
  });

  console.log('\n== 9. Edge cases ==');
  await test('fewer than min players cancels with a template line and a control report', async () => {
    const built = rumble.buildRumbleParams({ join_minutes: 1, prize: '10 points', min_players: 3 });
    const n = credits.length;
    const r = await playGame(built.params, 2);
    assert.strictEqual(row(r.id).status, 'cancelled');
    assert.ok(r.msgs.some((m) => T.cancelNotEnoughPlayers.some((l) => m.content === l.replace('{min}', '3'))));
    assert.match(sent.filter((s) => s.ch === 'ctl').at(-1).content, /only 2 player\(s\) joined/);
    assert.strictEqual(credits.length, n);
  });

  await test('join button: second click "already in", unverified member refused, window closed afterwards', async () => {
    const built = rumble.buildRumbleParams({ join_minutes: 1, min_players: 1 });
    const { row: r } = await rumble.createRumble({ params: built.params, runAt: new Date(), createdBy: BOSS, source: 'manual' });
    await rumble.tick(clone(row(r.id)), { client });
    const a = button(MEMBER, `rumble_join:${r.id}`);
    await rumble.handleButton(a);
    assert.ok(T.joinAck.includes(lastReply(a)));
    const b = button(MEMBER, `rumble_join:${r.id}`);
    await rumble.handleButton(b);
    assert.ok(T.joinAlready.includes(lastReply(b)));
    const c = button('623456789012345678', `rumble_join:${r.id}`, { roles: [] });
    await rumble.handleButton(c);
    assert.ok(T.joinNotAllowed.includes(lastReply(c)));
    assert.ok(a.replies[0].flags && b.replies[0].flags && c.replies[0].flags, 'join replies must be ephemeral');
    await rumble._test.closeJoin(rumble._test.gameByTask(r.id));
    await until(() => row(r.id).status === 'done');
    const d = button(STAFF, `rumble_join:${r.id}`);
    await rumble.handleButton(d);
    assert.ok(T.joinClosed.includes(lastReply(d)));
    assert.strictEqual(row(r.id).state.winner.id, MEMBER);
  });

  await test('restart in the join window restores players; restart mid-rounds ends safely with no winner and no payout', async () => {
    const built = rumble.buildRumbleParams({ join_minutes: 5, prize: '40 points', min_players: 2 });
    const { row: r } = await rumble.createRumble({ params: built.params, runAt: new Date(), createdBy: BOSS, source: 'vexo' });
    await rumble.tick(clone(row(r.id)), { client });
    let g = rumble._test.gameByTask(r.id);
    for (let i = 0; i < 4; i++) await rumble.handleButton(button(`81000000000000000${i}`, `rumble_join:${r.id}`));
    g.lastSave = 0;
    await rumble._test.pulse(g);
    clearInterval(g.pulse);
    games.delete(RUMBLE_CH); // "crash"
    await rumble.tick(clone(row(r.id)), { client });
    g = rumble._test.gameByTask(r.id);
    assert.strictEqual(g.players.size, 4, 'players not restored');
    clearInterval(g.pulse);
    g.phase = 'rounds';
    g.state.phase = 'rounds';
    await store.update(r.id, { state: g.state });
    games.delete(RUMBLE_CH);
    const n = credits.length;
    const from = sent.length;
    await rumble.tick(clone(row(r.id)), { client });
    assert.strictEqual(row(r.id).status, 'done');
    assert.strictEqual(row(r.id).state.endReason, 'restart');
    assert.ok(!row(r.id).state.winner);
    assert.strictEqual(credits.length, n);
    assert.ok(sent.slice(from).some((s) => s.ch === RUMBLE_CH && T.crashEnded.includes(s.content)));
  });

  await test('chat during a game: template one-liners only, ~1 in 5, never the same person twice in a row, no "?"', async () => {
    const built = rumble.buildRumbleParams({ join_minutes: 5, min_players: 1 });
    const { row: r } = await rumble.createRumble({ params: built.params, runAt: new Date(), createdBy: BOSS, source: 'manual' });
    await rumble.tick(clone(row(r.id)), { client });
    const g = rumble._test.gameByTask(r.id);
    const replies = [];
    const aiBefore = aiCalls;
    for (let i = 0; i < 400; i++) {
      g.lastChatAt = 0; // skip the 20 s cooldown to sample the 1-in-5 rate
      const author = i % 3 === 0 ? BOSS : `83000000000000000${i % 7}`;
      await rumble.handleMessage({ channelId: RUMBLE_CH, author: { id: author }, content: 'lets go', reply: async (m) => replies.push({ to: author, c: m.content }) });
    }
    const rate = replies.length / 400;
    for (let i = 1; i < replies.length; i++) assert.notStrictEqual(replies[i].to, replies[i - 1].to);
    assert.ok(replies.every((x) => T.chatReply.includes(x.c) && !x.c.includes('?')));
    assert.ok(rate > 0.1 && rate < 0.3, `rate ${rate}`);
    assert.strictEqual(aiCalls - aiBefore, 0);
    await rumble.cancel(clone(row(r.id)), { client });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('test crashed:', err);
  process.exit(1);
});
