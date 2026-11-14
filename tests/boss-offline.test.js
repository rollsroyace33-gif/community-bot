// Boss presence / offline window / cover test: fake clock, fake Discord, fake Supabase, scripted AI.
// Run: node tests/boss-offline.test.js   (real .env values are never used for anything that matters, nor printed)
const assert = require('assert');
const { ChannelType } = require('discord.js');

const BOSS = '123456789012345678';
const BOT = '111111111111111111';
const M1 = '200000000000000001';
const M2 = '200000000000000002';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: 'g', HOME_GUILD_ID: 'g', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: BOSS, STAFF_ROLE_IDS: '',
  CONTROL_CHANNEL_ID: 'ctl', GENERAL_CHANNEL_ID: 'floor', ASK_CHANNEL_ID: 'ask', MARKETPLACE_CHANNEL_ID: 'market',
  QA_PER_HOUR: '1000', MIN_ACCOUNT_AGE_DAYS: '0', BOSS_TIMEZONE: 'Asia/Dhaka',
  BOSS_AWAY_HOURS: '4', BOSS_OFFLINE_START: '06:00', BOSS_OFFLINE_END: '18:00', OFFLINE_QUIET_MINUTES: '10',
  OFFLINE_CHAT_MAX_LINES: '2', OFFLINE_CHAT_SOFT_REPLIES: '2', BOSS_ACTIVE_RECENT_MINUTES: '15',
  BOSS_NOTE_COOLDOWN_MINUTES: '30', BOSS_NOTE_CHANNEL_MAX: '3', CHAT_CHANNEL_IDS: '', RUMBLE_CHANNEL_ID: '',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase (bot_settings for the boss timestamp)
const tables = { bot_settings: [], scheduled_tasks: [] };
const fakeDb = {
  rpc: async () => ({ data: 0, error: null }),
  from(table) {
    const q = { op: 'select', f: [] };
    const api = {
      select: () => api, order: () => api, limit: () => api, in: () => api,
      eq: (k, v) => (q.f.push((r) => r[k] === v || (k === 'guild_id' && r[k] === undefined)), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      insert: (row) => ((q.op = 'insert'), (q.row = row), api),
      upsert: (row) => ((q.op = 'upsert'), (q.row = row), api),
      update: () => ((q.op = 'noop'), api),
      then: (res) => {
        const rows = (tables[table] ||= []);
        if (q.op === 'upsert') {
          const i = rows.findIndex((r) => r.key === q.row.key);
          if (i >= 0) rows[i] = { ...q.row };
          else rows.push({ ...q.row });
          return res({ data: null, error: null });
        }
        if (q.op === 'insert') return res({ data: null, error: null });
        const m = rows.filter((r) => q.f.every((f) => f(r)));
        return res({ data: q.single ? m[0] || null : m, error: null });
      },
    };
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- fake clock + scripted AI
const clock = require(src('clock.js'));
let NOW = Date.parse('2026-10-28T06:00:00Z'); // 12:00 on the boss's clock (inside 06:00-18:00)
clock.now = () => NOW;
const at = (iso) => (NOW = Date.parse(iso));
const advance = (ms) => (NOW += ms);
const MIN = 60 * 1000;

let aiCalls = 0;
let queue = [];
const prompts = [];
global.fetch = async (url, opts) => {
  aiCalls++;
  const body = JSON.parse(opts.body);
  prompts.push(body.messages[0].content);
  const next = queue.length > 1 ? queue.shift() : queue[0];
  if (next instanceof Error) throw next;
  return { ok: true, json: async () => ({ choices: [{ message: { content: next } }] }) };
};
const aiSays = (...a) => (queue = a);

// ---------------------------------------------------------------- fake Discord
const out = []; // everything Vexo does: { kind: 'reply'|'send'|'react', ch, content, allowedMentions }
let msgSeq = 0;
function channel(id, { type = ChannelType.GuildText, name = id, parentId = null } = {}) {
  return {
    id, type, name, parentId, isTextBased: () => true, sendTyping: async () => {},
    send: async (m) => out.push({ kind: 'send', ch: id, content: m.content || m, allowedMentions: m.allowedMentions }),
  };
}
const channels = {
  floor: channel('floor'), lounge: channel('lounge'), market: channel('market'), ctl: channel('ctl'), ask: channel('ask'),
  news: channel('news', { type: ChannelType.GuildAnnouncement }), tickets: channel('ticket-42', { name: 'ticket-42' }),
};
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };

// opts: vexo (@Vexo), boss (@boss), replyTo (author id of the replied message), others (extra user mentions)
function msg(ch, author, content, { vexo = false, boss = false, replyTo = null, others = [], name } = {}) {
  const users = new Map();
  let text = content;
  if (vexo) { users.set(BOT, { id: BOT }); text = `<@${BOT}> ${text}`; }
  if (boss) { users.set(BOSS, { id: BOSS }); text = `<@${BOSS}> ${text}`; }
  for (const o of others) users.set(o, { id: o });
  const id = String(++msgSeq);
  return {
    id, content: text.trim(), channelId: channels[ch].id, channel: channels[ch], client, guild: { id: 'g' },
    url: `https://discord.com/channels/g/${channels[ch].id}/${id}`,
    author: { id: author, username: name || `user${author.slice(-2)}`, bot: false, createdTimestamp: 0 },
    member: { displayName: name || `Member ${author.slice(-2)}`, roles: { cache: { has: () => false, some: () => false } } },
    mentions: { users, roles: new Map(), everyone: false, repliedUser: replyTo ? { id: replyTo } : null, channels: { first: () => undefined } },
    reply: async (m) => out.push({ kind: 'reply', ch, content: typeof m === 'string' ? m : m.content, allowedMentions: m.allowedMentions }),
    react: async (e) => out.push({ kind: 'react', ch, content: e }),
  };
}

// ---------------------------------------------------------------- modules
const config = require(src('config.js'));
const T = require(src('bossTemplates.js'));
const { isBossOffline } = require(src('tasks/time.js'));
const presence = require(src('bossPresence.js'));
const replies = require(src('replies.js'));
const offlineChat = require(src('offlineChat.js'));
const bossCover = require(src('bossCover.js'));
const onMessage = require(src('events/messageCreate.js'));

function reset() {
  replies._test.reset();
  offlineChat._test.reset();
  bossCover._test.reset();
  presence._test.reset();
  out.length = 0;
  queue = ['ok'];
}
// one message through the real pipeline; returns what Vexo did and how many AI calls it took
async function send(m) {
  const from = out.length;
  const ai0 = aiCalls;
  await onMessage(m);
  await new Promise((r) => setImmediate(r));
  return { acts: out.slice(from), ai: aiCalls - ai0 };
}
const texts = (acts) => acts.filter((a) => a.kind !== 'react').map((a) => a.content);

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').filter(Boolean).slice(0, 6).join('\n      ')}`);
  }
}
const show = (label, v) => console.log(`      ${label}: ${typeof v === 'string' ? JSON.stringify(v) : v}`);
const NO_SCHEDULE = /\b([01]?\d|2[0-3]):[0-5]\d\b|\b\d{1,2}\s?(am|pm)\b|dhaka|asia\/|utc|gmt|time ?zone|06:00|18:00/i;

(async () => {
  // ================================================================ templates
  console.log('== 0. Template banks ==');
  await test('all boss/cover templates: statements, <= 1 emoji, no promises, no clock time or zone; sizes', () => {
    const lists = ['welcomeHours', 'welcomeDay', 'coverShort', 'coverLead', 'needsBoss', 'noteAlreadyLeft', 'bossNotified', 'keepBrief', 'offlineFallback'];
    const bad = [];
    for (const n of lists) {
      for (const l of T[n]) {
        if (l.includes('?')) bad.push(`${n}: ? in ${l}`);
        if ((l.match(/\p{Extended_Pictographic}/gu) || []).length > 1) bad.push(`${n}: 2 emoji in ${l}`);
        if (bossCover.hasPromise(l)) bad.push(`${n}: promise in ${l}`);
        if (NO_SCHEDULE.test(l.replace('{hours}', '5'))) bad.push(`${n}: time/zone in ${l}`);
        if (new Set(T[n]).size !== T[n].length) bad.push(`${n}: duplicates`);
      }
    }
    assert.ok(T.welcomeHours.every((l) => l.includes('{hours}')));
    assert.ok(T.welcomeHours.length + T.welcomeDay.length >= 30);
    assert.ok(T.coverShort.length >= 25);
    assert.ok([...T.welcomeHours, ...T.welcomeDay].every((l) => /\bboss\b/i.test(l)), 'every welcome line calls him boss');
    show('sizes', lists.map((n) => `${n} ${T[n].length}`).join(', '));
    assert.deepStrictEqual(bad, []);
  });

  // ================================================================ section 1
  console.log('\n== 1. Boss messages: reply only when he talks to Vexo ==');
  await test('boss chatting with others, remarks, emojis, "gm": NO reply, no AI call', async () => {
    reset();
    at('2026-10-28T14:00:00Z'); // outside the window (doesn't matter for the boss)
    for (const t of ['lol that was wild', 'nice game everyone', '🔥🔥', 'gm', 'vexo is a legend tbh lol']) {
      const r = await send(msg('floor', BOSS, t));
      assert.strictEqual(r.acts.length, 0, `replied to "${t}"`);
      assert.strictEqual(r.ai, 0);
    }
  });

  await test('mention, reply-to-Vexo and "vexo, ..." get a statement (no "?"); closing remark gets a reaction only', async () => {
    reset();
    aiSays("All good, boss, the fort is standing. What's next on the agenda?");
    let r = await send(msg('floor', BOSS, "what's good", { vexo: true }));
    show('mention', texts(r.acts)[0]);
    assert.strictEqual(texts(r.acts).length, 1);
    assert.doesNotMatch(texts(r.acts)[0], /\?/);
    advance(61 * 1000);
    aiSays('Always on duty, boss.');
    r = await send(msg('floor', BOSS, 'vexo, how is the server doing'));
    assert.strictEqual(texts(r.acts)[0], 'Always on duty, boss.');
    aiSays('Facts only, boss 😎'); // a reply to Vexo is exempt from the cooldown and the 2-in-a-row rule
    r = await send(msg('floor', BOSS, 'you are right about that', { replyTo: BOT }));
    assert.strictEqual(texts(r.acts)[0], 'Facts only, boss 😎');
    r = await send(msg('floor', BOSS, 'ok', { replyTo: BOT }));
    assert.deepStrictEqual(r.acts.map((a) => a.kind), ['react']);
    assert.strictEqual(r.ai, 0);
  });

  await test('name-only address: 60 s per-channel cooldown and at most 2 in a row; a mention always works', async () => {
    reset();
    aiSays('Sure thing, boss.');
    let r = await send(msg('lounge', BOSS, 'vexo, status report'));
    assert.strictEqual(texts(r.acts).length, 1);
    r = await send(msg('lounge', BOSS, 'vexo, again please'));
    assert.strictEqual(r.acts.length, 0, 'cooldown ignored');
    advance(61 * 1000);
    r = await send(msg('lounge', BOSS, 'vexo, one more'));
    assert.strictEqual(texts(r.acts).length, 1);
    advance(61 * 1000);
    r = await send(msg('lounge', BOSS, 'vexo, and another'));
    assert.strictEqual(r.acts.length, 0, 'third in a row by name');
    r = await send(msg('lounge', BOSS, 'still there', { vexo: true }));
    assert.strictEqual(texts(r.acts).length, 1, 'explicit mention is exempt');
  });

  // ================================================================ section 2
  console.log('\n== 2. Welcome back after a long break ==');
  await test('5-hour gap: exactly one welcome line (zero AI); 1-hour gap: none; right after: none', async () => {
    reset();
    at('2026-10-28T01:00:00Z');
    await send(msg('floor', BOSS, 'night all'));
    advance(5 * 60 * MIN);
    let r = await send(msg('floor', BOSS, 'morning team'));
    assert.strictEqual(r.acts.length, 1);
    assert.strictEqual(r.ai, 0);
    assert.match(r.acts[0].content, /boss/i);
    assert.match(r.acts[0].content, /\b5 hours\b/);
    assert.deepStrictEqual(r.acts[0].allowedMentions, { repliedUser: false, parse: [] });
    assert.ok(T.welcomeHours.map((l) => l.replace('{hours}', '5')).includes(r.acts[0].content));
    show('welcome', r.acts[0].content);
    r = await send(msg('floor', BOSS, 'anyway'));
    assert.strictEqual(r.acts.length, 0, 'welcomed twice');
    advance(60 * MIN);
    r = await send(msg('floor', BOSS, 'back from lunch'));
    assert.strictEqual(r.acts.length, 0, '1-hour gap welcomed');
  });

  await test('a whole day away uses the "day" lines; the control channel never gets a welcome', async () => {
    reset();
    at('2026-10-28T01:00:00Z');
    await send(msg('floor', BOSS, 'see ya'));
    advance(30 * 60 * MIN);
    aiSays(JSON.stringify({ intent: 'small_talk', reply: 'Hey boss.' }));
    let r = await send(msg('ctl', BOSS, 'hey'));
    const isWelcome = (t) => T.welcomeDay.includes(t) || T.welcomeHours.some((w) => new RegExp(`^${w.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('{hours}', '\\d+')}$`).test(t));
    assert.ok(!texts(r.acts).some(isWelcome), 'welcome in control');
    r = await send(msg('floor', BOSS, 'whats up everyone'));
    assert.ok(T.welcomeDay.includes(r.acts[0]?.content), `got ${r.acts[0]?.content}`);
    show('day welcome', r.acts[0].content);
  });

  await test('restart persistence: the saved timestamp prevents a false welcome, and still welcomes a real return', async () => {
    reset();
    at('2026-10-28T08:00:00Z');
    await send(msg('floor', BOSS, 'quick check'));
    const saved = tables.bot_settings.find((r) => r.key === 'boss_last_message_at');
    assert.strictEqual(Number(saved.value), NOW);
    presence._test.reset(); // "restart"
    await presence.load();
    advance(60 * MIN);
    let r = await send(msg('floor', BOSS, 'still here'));
    assert.strictEqual(r.acts.length, 0, 'false welcome after restart');
    presence._test.reset();
    await presence.load();
    advance(6 * 60 * MIN);
    r = await send(msg('floor', BOSS, 'and now I am back'));
    assert.strictEqual(r.acts.length, 1);
    presence._test.reset(); // nothing saved and nothing loaded = unknown = no welcome
    tables.bot_settings.length = 0;
    advance(9 * 60 * MIN);
    r = await send(msg('floor', BOSS, 'hello'));
    assert.strictEqual(r.acts.length, 0);
  });

  // ================================================================ section 3
  console.log('\n== 3. Offline window + offline chat ==');
  await test('isBossOffline: 12:00 yes / 20:00 no (06:00-18:00 on the boss clock), across midnight, start == end = off', () => {
    const local = (h) => Date.parse(`2026-10-28T${String((h - 6 + 24) % 24).padStart(2, '0')}:00:00Z`); // boss clock is UTC+6
    assert.strictEqual(isBossOffline(local(12)), true);
    assert.strictEqual(isBossOffline(local(20)), false);
    assert.strictEqual(isBossOffline(local(6)), true);
    assert.strictEqual(isBossOffline(local(18)), false);
    const night = { start: '22:00', end: '04:00' };
    assert.strictEqual(isBossOffline(local(23), night), true);
    assert.strictEqual(isBossOffline(local(3), night), true);
    assert.strictEqual(isBossOffline(local(12), night), false);
    assert.strictEqual(isBossOffline(local(12), { start: '09:00', end: '09:00' }), false);
    assert.strictEqual(isBossOffline(local(12), { start: 'bad', end: '18:00' }), false);
  });

  await test('lone member in a quiet channel: reply of at most 2 lines and no question; after 2 replies only if addressed', async () => {
    reset();
    at('2026-10-28T06:00:00Z');
    aiSays("Ha, Mondays hit different. Coffee is mandatory. Honestly I'd nap too. What's your plan today?");
    let r = await send(msg('floor', M1, 'ugh what a monday'));
    const first = texts(r.acts)[0];
    show('offline chat', first);
    assert.ok(first && !first.includes('?'));
    assert.ok(first.split(/(?<=[.!?…])\s+/).length <= 2 && first.split('\n').length <= 2);
    advance(10 * 1000);
    aiSays('Respect, the grind never sleeps 😄');
    r = await send(msg('floor', M1, 'at least the weekend is close'));
    assert.strictEqual(texts(r.acts).length, 1);
    advance(10 * 1000);
    r = await send(msg('floor', M1, 'anyway, back to work'));
    assert.strictEqual(r.acts.length, 0, 'third unaddressed reply');
    assert.strictEqual(r.ai, 0);
    advance(10 * 1000);
    aiSays('Go get it 💪');
    r = await send(msg('floor', M1, 'wish me luck', { vexo: true }));
    assert.strictEqual(texts(r.acts).length, 1, 'addressed after the soft limit');
  });

  await test('another human joins: Vexo steps back; busy channel: no session', async () => {
    reset();
    at('2026-10-28T06:30:00Z');
    aiSays('Hey hey, welcome in 👋');
    let r = await send(msg('lounge', M1, 'anyone around'));
    assert.strictEqual(texts(r.acts).length, 1);
    await send(msg('lounge', M2, 'yo I am here'));
    advance(10 * 1000);
    r = await send(msg('lounge', M1, 'oh nice, hi'));
    assert.strictEqual(r.acts.length, 0, 'kept chatting with two humans around');
    assert.strictEqual(r.ai, 0);
  });

  await test('outside the window (and in excluded channels) the old behavior stays: silence, no AI', async () => {
    reset();
    at('2026-10-28T14:00:00Z');
    let r = await send(msg('floor', M1, 'so quiet in here today'));
    assert.strictEqual(r.acts.length, 0);
    assert.strictEqual(r.ai, 0);
    at('2026-10-28T06:00:00Z');
    aiSays('NO_REPLY'); // #ask keeps its own rule: the AI stays silent on casual chat there
    for (const ch of ['market', 'news', 'tickets', 'ask']) {
      r = await send(msg(ch, M2, 'just chilling here'));
      assert.ok(!r.acts.some((a) => a.kind === 'reply'), `chatted in ${ch}`);
    }
  });

  // ================================================================ section 4
  console.log('\n== 4. HΛVØCZ questions any time ==');
  await test('HΛVØCZ question gets an answer inside and outside the window: no lists/headings, no trailing question', async () => {
    for (const when of ['2026-10-28T06:00:00Z', '2026-10-28T14:00:00Z']) {
      reset();
      at(when);
      aiSays('[SPECIFIC] ## Points\n- Points are spent in the marketplace on prizes, so chat away and cash in. Want the full list?');
      const r = await send(msg('floor', M1, 'where do we use the points', { vexo: true }));
      const a = texts(r.acts)[0];
      show(when.slice(11, 16) + ' UTC', a);
      assert.ok(a && !/^\s*(#|-|\d+\.)/m.test(a) && !a.trim().endsWith('?'));
      assert.match(prompts.at(-1), /Use light humor and charm/);
    }
  });

  // ================================================================ section 5
  console.log('\n== 5. Boss cover during the offline window ==');
  await test('"@Remo", "hi @Remo", "gm @Remo": cover templates, zero AI, no clock time / zone text, nobody pinged', async () => {
    reset();
    at('2026-10-28T06:00:00Z');
    for (const [t, who] of [['', M1], ['hi', M2], ['gm', '200000000000000003'], ['👀', '200000000000000004']]) {
      const r = await send(msg('floor', who, t, { boss: true }));
      assert.strictEqual(r.ai, 0);
      assert.strictEqual(r.acts.length, 1);
      assert.ok(T.coverShort.includes(r.acts[0].content));
      assert.doesNotMatch(r.acts[0].content, NO_SCHEDULE);
      assert.deepStrictEqual(r.acts[0].allowedMentions, { repliedUser: false, parse: [] });
    }
    show('cover', T.coverShort[0]);
  });

  await test('outside the window, or when the boss wrote 5 minutes ago: nothing new happens', async () => {
    reset();
    at('2026-10-28T14:00:00Z');
    let r = await send(msg('floor', M1, 'can you check this', { boss: true }));
    assert.strictEqual(r.acts.length, 0);
    reset();
    at('2026-10-28T06:00:00Z');
    await send(msg('lounge', BOSS, 'brb'));
    advance(5 * MIN);
    r = await send(msg('floor', M1, 'can you check this', { boss: true }));
    assert.strictEqual(r.acts.length, 0);
    assert.strictEqual(r.ai, 0);
  });

  await test('HΛVØCZ question: one reply (cover line + answer), ONE AI call, no boss ping', async () => {
    reset();
    at('2026-10-28T06:00:00Z');
    aiSays(JSON.stringify({ addressed_to_boss: true, can_help: true, reply: 'Points are spent in the marketplace on prizes, so keep chatting 😄', boss_note: '' }));
    const r = await send(msg('floor', M1, 'where do we use the points', { boss: true }));
    assert.strictEqual(r.ai, 1);
    assert.strictEqual(r.acts.length, 1);
    assert.strictEqual(r.acts[0].kind, 'reply');
    assert.ok(T.coverLead.some((l) => r.acts[0].content.startsWith(l)));
    assert.match(r.acts[0].content, /marketplace/);
    assert.ok((r.acts[0].content.match(/\p{Extended_Pictographic}/gu) || []).length <= 1, 'more than one emoji');
    assert.doesNotMatch(r.acts[0].content, /\?/);
    assert.ok(!r.acts.some((a) => a.content.includes(`<@${BOSS}>`)));
    show('answer', r.acts[0].content);
  });

  await test('needs the boss (WL spot): member reply + ONE separate note that pings only the boss, with summary + jump link', async () => {
    reset();
    at('2026-10-28T06:00:00Z');
    aiSays(JSON.stringify({ addressed_to_boss: true, can_help: false, reply: 'Sure, the boss will give you one!', boss_note: 'Asks for a WL spot <@999999999999999999> @everyone **now**?' }));
    const m = msg('floor', M1, 'can I get a WL spot? cc', { boss: true, others: ['999999999999999999'], name: 'Luna' });
    const r = await send(m);
    assert.strictEqual(r.ai, 1);
    const [rep, note] = r.acts;
    assert.strictEqual(rep.kind, 'reply');
    assert.ok(T.needsBoss.includes(rep.content));
    assert.ok(!bossCover.hasPromise(rep.content));
    assert.strictEqual(note.kind, 'send');
    assert.ok(note.content.startsWith(`<@${BOSS}> 📌 Note from Vexo: **Luna** needs you about: `));
    assert.ok(note.content.endsWith(m.url));
    assert.deepStrictEqual(note.allowedMentions, { users: [BOSS] });
    assert.doesNotMatch(note.content, /<@9|@everyone|\?|\*\*now/);
    show('member', rep.content);
    show('note', note.content);
  });

  await test('anti-spam: same member within 30 min = no second ping; > BOSS_NOTE_CHANNEL_MAX per hour = no ping', async () => {
    reset();
    at('2026-10-28T06:00:00Z');
    aiSays(JSON.stringify({ addressed_to_boss: true, can_help: false, reply: '', boss_note: 'Partnership request' }));
    let r = await send(msg('floor', M1, 'can we talk partnership', { boss: true }));
    assert.strictEqual(r.acts.filter((a) => a.kind === 'send').length, 1);
    advance(10 * MIN);
    r = await send(msg('floor', M1, 'hello again about the partnership', { boss: true }));
    assert.strictEqual(r.acts.filter((a) => a.kind === 'send').length, 0);
    assert.ok(T.noteAlreadyLeft.includes(texts(r.acts)[0]));
    for (const id of ['300000000000000001', '300000000000000002']) {
      r = await send(msg('floor', id, 'I need the boss for a payment issue', { boss: true }));
      assert.strictEqual(r.acts.filter((a) => a.kind === 'send').length, 1);
    }
    r = await send(msg('floor', '300000000000000003', 'refund question for the boss please', { boss: true }));
    assert.strictEqual(r.acts.filter((a) => a.kind === 'send').length, 0, '4th ping in the channel');
    assert.ok(T.bossNotified.includes(texts(r.acts)[0]));
    advance(61 * MIN);
    r = await send(msg('floor', '300000000000000004', 'one more question for the boss', { boss: true }));
    assert.strictEqual(r.acts.filter((a) => a.kind === 'send').length, 1, 'cap did not reset after an hour');
  });

  await test('a promise in the model reply is never sent (banned-phrases check) -> needs-boss path instead', async () => {
    reset();
    at('2026-10-28T06:00:00Z');
    aiSays(JSON.stringify({ addressed_to_boss: true, can_help: true, reply: "Don't worry, the boss will approve your refund, guaranteed.", boss_note: 'Refund request' }));
    const r = await send(msg('floor', M2, 'will the boss refund me', { boss: true }));
    assert.ok(r.acts.every((a) => !bossCover.hasPromise(a.content) || a.kind === 'send'));
    assert.ok(T.needsBoss.includes(texts(r.acts)[0]));
  });

  await test('AI down: template reply + the note still happen; addressed_to_boss=false stays silent', async () => {
    reset();
    at('2026-10-28T06:00:00Z');
    aiSays(new Error('AI down'));
    const logError = console.error;
    console.error = () => {};
    let r;
    try {
      r = await send(msg('floor', M1, 'need help with my order please', { boss: true }));
    } finally {
      console.error = logError;
    }
    assert.ok(T.needsBoss.includes(texts(r.acts)[0]));
    assert.ok(r.acts.some((a) => a.kind === 'send' && a.content.includes(`<@${BOSS}>`) && /need help with my order please/.test(a.content)));
    aiSays(JSON.stringify({ addressed_to_boss: false, can_help: false, reply: '', boss_note: '' }));
    r = await send(msg('lounge', M2, 'lol remember when he said that', { boss: true }));
    assert.strictEqual(r.acts.length, 0);
  });

  await test('ignored: messages from the boss and from bots; walls of text get a "keep it brief" line; spam ignored', async () => {
    reset();
    at('2026-10-28T06:00:00Z');
    assert.strictEqual(await bossCover.handle(msg('floor', BOSS, 'note to self', { boss: true })), false);
    const bot = msg('floor', '400000000000000001', 'beep', { boss: true });
    bot.author.bot = true;
    let r = await send(bot);
    assert.strictEqual(r.acts.length, 0);
    r = await send(msg('floor', M1, `help ${'x'.repeat(520)}`, { boss: true }));
    assert.ok(T.keepBrief.includes(texts(r.acts)[0]));
    assert.strictEqual(r.ai, 0);
    const spam = msg('floor', M2, 'free stuff @everyone', { boss: true });
    spam.mentions.everyone = true;
    r = await send(spam);
    assert.strictEqual(r.acts.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('test crashed:', err);
  process.exit(1);
});
