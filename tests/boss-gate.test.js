// Boss gate tests: Vexo stays silent on the boss's messages unless he talks to Vexo.
// Run: node tests/boss-gate.test.js
// Fully offline: Discord, Supabase and the AI are faked. Like the real .env, #ask and #open-floor are
// the SAME channel here (that is what made Vexo answer every boss message before the fix).
const assert = require('assert');

const BOSS = '123456789012345678';
const MEMBER = '987654321098765432';
const MEMBER2 = '555555555555555555';
const BOT = '111111111111111111';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: 'g', HOME_GUILD_ID: 'g', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: ` ${BOSS} `, // stray spaces: still recognized
  BOSS_OFFLINE_START: '00:00', BOSS_OFFLINE_END: '00:00', // offline window off (tested in boss-offline.test.js)
  CONTROL_CHANNEL_ID: 'ctl', GENERAL_CHANNEL_ID: 'floor', ASK_CHANNEL_ID: 'floor', BOSS_AWAY_HOURS: '4',
  MIN_ACCOUNT_AGE_DAYS: '0', QA_PER_HOUR: '1000',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase (only the game's task row is kept)
const tables = { scheduled_tasks: [] };
const clone = (o) => JSON.parse(JSON.stringify(o));
const fakeDb = {
  rpc: async () => ({ data: 0, error: null }),
  from(table) {
    const q = { op: 'select', filters: [], single: false };
    const api = {
      select: () => api, order: () => api, limit: () => api, gt: () => api, gte: () => api, lt: () => api, is: () => api, not: () => api,
      insert: (row) => ((q.op = 'insert'), (q.row = row), api),
      update: (patch) => ((q.op = 'update'), (q.patch = patch), api),
      upsert: () => ((q.op = 'noop'), api), delete: () => ((q.op = 'noop'), api),
      eq: (k, v) => (q.filters.push((r) => r[k] === v || (k === 'guild_id' && r[k] === undefined)), api),
      in: (k, vs) => (q.filters.push((r) => vs.includes(r[k])), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = tables[table];
      if (!rows) return { data: q.single ? null : [], error: null };
      if (q.op === 'insert') {
        const r = { id: rows.length + 1, state: {}, ...clone(q.row) };
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

// ---------------------------------------------------------------- fake clock + AI
const clock = require(src('clock.js'));
let NOW = Date.parse('2026-10-28T20:00:00Z');
clock.now = () => NOW;
const advance = (ms) => (NOW += ms);
const MIN = 60 * 1000;
let aiCalls = 0;
global.fetch = async () => {
  aiCalls++;
  return { ok: true, json: async () => ({ choices: [{ message: { content: 'Always here for you, boss.' } }] }) };
};

// ---------------------------------------------------------------- fake Discord
const out = []; // everything Vexo does: { kind: 'reply'|'react', content }
const logs = []; // debug lines
const realDebug = console.debug;
console.debug = (line) => logs.push(String(line));

const history = new Map(); // message id -> { author: { id } } for fetchReference()
const mkChannel = (id, name) => ({
  id, type: 0, name, isTextBased: () => true, sendTyping: async () => {}, messages: { cache: new Map() },
  send: async (m) => out.push({ kind: 'send', ch: id, content: typeof m === 'string' ? m : m.content }),
});
const channels = { floor: mkChannel('floor', 'open-floor'), game: mkChannel('game', 'game'), rumble: mkChannel('rumble', 'rumble'), ctl: mkChannel('ctl', 'ctl') };
const channel = channels.floor;
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };
let seq = 0;

// opts: vexo (@Vexo), users (other user mentions), roles (role mentions),
//       replyTo (author id of the replied message, via message.reference + fetch, like real Discord),
//       ch (channel id, default #open-floor)
function msg(author, content, { vexo = false, users = [], roles = [], replyTo = null, ch = 'floor' } = {}) {
  const userMap = new Map();
  let text = content;
  if (vexo) { userMap.set(BOT, { id: BOT }); text = `<@${BOT}> ${text}`; }
  for (const u of users) { userMap.set(u, { id: u }); text = `<@${u}> ${text}`; }
  for (const r of roles) text = `<@&${r}> ${text}`;
  let reference = null;
  if (replyTo) {
    const refId = `ref${++seq}`;
    history.set(refId, { id: refId, author: { id: replyTo } });
    reference = { messageId: refId, channelId: ch, type: 0 };
  }
  return {
    id: String(++seq), content: text, channelId: ch, channel: channels[ch], client, guild: { id: 'g' }, reference,
    fetchReference: async () => history.get(reference.messageId),
    author: { id: author, username: author === BOSS ? 'remo.sol' : 'member', tag: `${author}#0`, bot: false, createdTimestamp: 0 },
    member: { displayName: 'x', roles: { cache: { has: () => false, some: () => false } } },
    // repliedUser stays null: the gate must find the replied author through message.reference itself
    mentions: { users: userMap, roles: new Map(roles.map((r) => [r, { id: r }])), everyone: false, repliedUser: null, channels: { first: () => undefined } },
    reply: async (m) => out.push({ kind: 'reply', content: typeof m === 'string' ? m : m.content }),
    react: async (e) => out.push({ kind: 'react', content: e }),
  };
}

const replies = require(src('replies.js'));
const presence = require(src('bossPresence.js'));
const T = require(src('bossTemplates.js'));
const onMessage = require(src('events/messageCreate.js'));
const numberGuess = require(src('tasks/numberGuess.js'));
const rumble = require(src('tasks/rumbleRoyale.js'));
const RT = require(src('tasks/rumbleTemplates.js'));

async function send(m) {
  out.length = 0;
  logs.length = 0;
  const before = aiCalls;
  await onMessage(m);
  return { acts: [...out], ai: aiCalls - before, log: logs.filter((l) => l.includes('boss message ignored')) };
}
function fresh() {
  replies._test.reset();
  presence._test.reset();
  advance(10 * MIN); // past every cooldown
}

const results = [];
async function test(name, fn) {
  fresh();
  try {
    await fn();
    results.push(true);
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
const silent = (r, why) => {
  assert.strictEqual(r.acts.length, 0, `Vexo acted: ${JSON.stringify(r.acts)}`);
  assert.strictEqual(r.ai, 0, 'AI was called');
  assert.ok(r.log.some((l) => l.includes(why)), `log missing "${why}": ${JSON.stringify(r.log)}`);
  console.log(`      log: ${r.log[0]}`);
};

(async () => {
  console.log('\n== Boss NOT talking to Vexo -> silence (#open-floor, which is also #ask) ==');
  await test('normal message, no mention -> no reply', async () => {
    silent(await send(msg(BOSS, 'alright team, big update coming tonight')), 'not addressed to Vexo');
  });
  await test('reply to another member -> no reply', async () => {
    silent(await send(msg(BOSS, 'yeah I agree with you', { replyTo: MEMBER })), 'reply to another member');
  });
  await test('reply to another member that also says "vexo" mid-sentence -> no reply', async () => {
    silent(await send(msg(BOSS, 'lol vexo is wild', { replyTo: MEMBER })), 'reply to another member');
  });
  await test('mentions another member -> no reply', async () => {
    silent(await send(msg(BOSS, 'check this out', { users: [MEMBER] })), 'mentions another member or a role');
  });
  await test('mentions a role (role mention only) -> no reply', async () => {
    silent(await send(msg(BOSS, '', { roles: ['999'] })), 'mentions another member or a role');
  });
  for (const t of ['gm', 'hi fam', '🔥', 'lol', 'ok']) {
    await test(`"${t}" -> no reply, no reaction`, async () => {
      silent(await send(msg(BOSS, t)), 'not addressed to Vexo');
    });
  }
  await test('a question in #ask/#open-floor not addressed to Vexo -> no reply', async () => {
    silent(await send(msg(BOSS, "what's the roadmap guys?")), 'not addressed to Vexo');
  });
  await test('ending with ", vexo" or mid-sentence "vexo" is not a direct address -> no reply', async () => {
    silent(await send(msg(BOSS, 'thanks everyone, vexo')), 'not addressed to Vexo');
    silent(await send(msg(BOSS, 'that vexo thing was funny')), 'not addressed to Vexo');
  });

  console.log('\n== Boss talking to Vexo -> a reply (boss style) ==');
  await test('"@Vexo what\'s up" -> reply', async () => {
    const r = await send(msg(BOSS, "what's up", { vexo: true }));
    assert.strictEqual(r.acts.length, 1);
    assert.strictEqual(r.acts[0].kind, 'reply');
    assert.match(r.acts[0].content, /\bboss\b/i);
    assert.ok(!r.acts[0].content.includes('?'), 'question to the boss');
    console.log(`      reply: ${r.acts[0].content}`);
  });
  await test('a Discord reply to a Vexo message (found via message.reference) -> reply', async () => {
    const r = await send(msg(BOSS, 'you are right about that', { replyTo: BOT }));
    assert.strictEqual(r.acts.length, 1);
    assert.strictEqual(r.acts[0].kind, 'reply');
  });
  await test('"vexo, tell me a joke" -> reply', async () => {
    const r = await send(msg(BOSS, 'vexo, tell me a joke'));
    assert.strictEqual(r.acts.length, 1);
    assert.strictEqual(r.acts[0].kind, 'reply');
  });
  await test('"hey vexo", "yo vexo", "@vexo" (typed) -> reply', async () => {
    for (const t of ['hey vexo how is the server', 'yo vexo what happened today', '@vexo give me the news']) {
      advance(2 * MIN);
      replies._test.reset();
      const r = await send(msg(BOSS, t));
      assert.strictEqual(r.acts.length, 1, `no reply to "${t}"`);
    }
  });
  await test('"vexo, you\'re the best" -> reply', async () => {
    const r = await send(msg(BOSS, "vexo, you're the best"));
    assert.strictEqual(r.acts.length, 1);
    console.log(`      reply: ${r.acts[0].content}`);
  });
  await test('name-only addresses: at most 2 replies in a row', async () => {
    let replied = 0;
    for (let i = 0; i < 4; i++) {
      advance(2 * MIN);
      replied += (await send(msg(BOSS, `vexo, thought number ${i}`))).acts.length;
    }
    assert.strictEqual(replied, 2);
  });

  console.log('\n== Welcome back (BOSS_AWAY_HOURS = 4) ==');
  await test('5 h away, first message is a reply to another member -> no welcome; next message -> none either', async () => {
    await send(msg(BOSS, 'night all'));
    advance(5 * 60 * MIN);
    let r = await send(msg(BOSS, 'morning man', { replyTo: MEMBER }));
    assert.strictEqual(r.acts.length, 0, 'welcomed inside a conversation with a member');
    r = await send(msg(BOSS, 'anyway'));
    assert.strictEqual(r.acts.length, 0, 'lastBossMessageAt was not updated by the ignored message');
  });
  await test('5 h away, plain message -> exactly one welcome line, then silence again', async () => {
    await send(msg(BOSS, 'night all'));
    advance(5 * 60 * MIN);
    let r = await send(msg(BOSS, 'morning team'));
    assert.strictEqual(r.acts.length, 1);
    assert.ok(T.welcomeHours.map((l) => l.replace('{hours}', '5')).includes(r.acts[0].content), r.acts[0].content);
    console.log(`      welcome: ${r.acts[0].content}`);
    r = await send(msg(BOSS, 'what a day'));
    assert.strictEqual(r.acts.length, 0);
  });

  console.log('\n== Regular members: unchanged ==');
  await test('member "gm" -> greeting with a mention', async () => {
    const r = await send(msg(MEMBER2, 'gm'));
    assert.strictEqual(r.acts.length, 1);
    assert.match(r.acts[0].content, new RegExp(`<@${MEMBER2}>`));
  });
  await test('member "@Vexo what is HΛVØCZ" -> reply (AI called), no boss gate log', async () => {
    const r = await send(msg(MEMBER2, 'what is the project about', { vexo: true }));
    assert.strictEqual(r.acts.length, 1);
    assert.strictEqual(r.ai, 1);
    assert.strictEqual(r.log.length, 0);
  });
  await test('member replying to another member in #ask/#open-floor -> same path as before (AI decides)', async () => {
    const r = await send(msg(MEMBER2, 'how do points work here?', { replyTo: MEMBER }));
    assert.strictEqual(r.ai, 1, 'the #ask Q&A path no longer ran for a member');
    assert.strictEqual(r.log.length, 0);
  });

  console.log('\n== Game banter (a running game owns its channel) ==');
  // the games use Math.random for "1 in 3" banter and Date.now for the 3 s guess gap: both pinned here
  const realRandom = Math.random;
  const realDateNow = Date.now;
  let dateOffset = 0;
  Date.now = () => realDateNow() + dateOffset;

  tables.scheduled_tasks.push({
    id: 1, type: 'number_guess', run_at: new Date(Date.now() - 1000).toISOString(), channel_id: 'game',
    params: { range: [1, 100], prize: '50 points' }, status: 'announced', created_by: BOSS, state: { reminded: true },
  });
  await numberGuess.tick(clone(tables.scheduled_tasks[0]), { client });
  const secret = tables.scheduled_tasks[0].state.secret;
  const wrong = secret === 1 ? 2 : 1;

  await test('number game started (setup)', async () => assert.ok(Number.isInteger(secret)));
  await test('number game: boss chat not addressed to Vexo -> no banter (even when the dice say yes)', async () => {
    Math.random = () => 0; // the 1-in-3 banter would always fire
    silent(await send(msg(BOSS, 'this game is fun', { ch: 'game' })), 'not addressed to Vexo');
    silent(await send(msg(BOSS, 'gg man', { ch: 'game', replyTo: MEMBER })), 'reply to another member');
  });
  await test('number game: boss wrong guess -> counted, but no flavor line', async () => {
    Math.random = () => 0; // the 1-in-3 guess reaction would always fire
    const r = await send(msg(BOSS, String(wrong), { ch: 'game' }));
    assert.strictEqual(r.acts.length, 0, `Vexo reacted: ${JSON.stringify(r.acts)}`);
  });
  await test('number game: member wrong guess -> flavor line as before (unchanged)', async () => {
    Math.random = () => 0;
    const r = await send(msg(MEMBER, String(wrong), { ch: 'game' }));
    assert.strictEqual(r.acts.length, 1);
  });
  await test('number game: boss "vexo how is it going" -> banter reply', async () => {
    Math.random = realRandom;
    const r = await send(msg(BOSS, 'vexo how is it going', { ch: 'game' }));
    assert.strictEqual(r.acts.length, 1);
    console.log(`      banter: ${r.acts[0].content}`);
  });
  await test('number game: boss correct guess (not addressed) still wins the game', async () => {
    dateOffset += 5000; // past the 3 s guess gap
    const r = await send(msg(BOSS, String(secret), { ch: 'game' }));
    assert.strictEqual(tables.scheduled_tasks[0].state.winner?.id, BOSS, 'the boss guess did not count');
    assert.ok(r.acts.some((a) => a.ch === 'game'), 'no winner message');
  });

  const rgame = { channelId: 'rumble', ended: false, lastChatAt: 0, lastChatTo: null, bags: new Map(), lastLine: new Map(), drawn: [] };
  rumble._test.games.set('rumble', rgame);
  const rumbleSay = async (author, content, opts = {}) => {
    rgame.lastChatAt = 0; // skip the channel cooldown
    rgame.lastChatTo = null;
    Math.random = () => 0; // the 1-in-5 one-liner would always fire
    return send(msg(author, content, { ch: 'rumble', ...opts }));
  };
  await test('Rumble: boss chat not addressed to Vexo -> no one-liner', async () => {
    silent(await rumbleSay(BOSS, 'lets go'), 'not addressed to Vexo');
    silent(await rumbleSay(BOSS, 'you got this', { users: [MEMBER] }), 'mentions another member or a role');
  });
  await test('Rumble: member chat -> one-liner as before (unchanged); boss "vexo lets go" -> one-liner', async () => {
    let r = await rumbleSay(MEMBER, 'lets go');
    assert.strictEqual(r.acts.length, 1);
    assert.ok(RT.chatReply.includes(r.acts[0].content));
    r = await rumbleSay(BOSS, 'vexo lets go');
    assert.strictEqual(r.acts.length, 1);
    console.log(`      one-liner: ${r.acts[0].content}`);
  });
  rumble._test.games.delete('rumble');
  Math.random = realRandom;
  Date.now = realDateNow;

  console.debug = realDebug;
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
