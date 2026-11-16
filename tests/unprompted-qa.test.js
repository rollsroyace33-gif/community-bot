// Unprompted Q&A test: a real question about the project (or about Vexo) in a normal chat channel gets an
// answer WITHOUT mentioning Vexo, in HΛVØCZ and in customer servers, each from its OWN knowledge.
// Run: node tests/unprompted-qa.test.js
// Fully offline: Discord, Supabase and the AI are faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
const BEEE = '200000000000000002'; // customer server in trial (premium)
const OTHER = '400000000000000004'; // another premium customer server (its knowledge must never leak)
const FREE = '300000000000000003'; // customer server on the free plan
const REMO = '111111111111111110'; // boss of HOME
const ADMIN_B = '222222222222222220';
const MEMBER = '333333333333333330';
const MEMBER2 = '333333333333333331';
const BOT = '999999999999999999';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, OWNER_ID: REMO, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: REMO, STAFF_ROLE_IDS: '', TRIAL_DAYS: '15', DEFAULT_DAILY_AI_LIMIT: '300',
  SUPPORT_CONTACT: '', CONTROL_CHANNEL_ID: 'home-ctl', GENERAL_CHANNEL_ID: 'home-general', ASK_CHANNEL_ID: 'home-ask', LOGS_CHANNEL_ID: 'home-logs',
  MARKETPLACE_CHANNEL_ID: 'home-shop', RUMBLE_CHANNEL_ID: '444444444444444444', VERIFIED_ROLE_ID: 'home-verified', TICKET_CHANNEL_ID: 'home-tickets',
  X_DROP_CHANNEL_ID: '', QA_PER_HOUR: '1000', MIN_ACCOUNT_AGE_DAYS: '0', MIN_MESSAGE_LENGTH: '8', MIN_SECONDS_BETWEEN_MESSAGES: '0',
  EXCLUDED_CHANNEL_IDS: 'home-excluded', MESSAGES_PER_POINT: '2', TIMEZONE: 'Asia/Dhaka', ADMIN_ROLE_ID: '', CHAT_CHANNEL_IDS: '', REDEEM_LOGS_CHANNEL_ID: '', RECEIPT_CHANNEL_ID: '',
  BOSS_OFFLINE_START: '00:00', BOSS_OFFLINE_END: '00:00',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { guilds: [], users: [], point_log: [], vexo_knowledge: [], vexo_unanswered: [], messages_log: [], scheduled_tasks: [], bot_settings: [] };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const fakeDb = {
  async rpc() {
    return { data: 1, error: null };
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
        const r = { id: rows.length + 1, ...clone(q.row) };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      if (q.op === 'upsert' || q.op === 'noop') return { data: null, error: null };
      const m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// ---------------------------------------------------------------- fake AI (records prompts)
const aiCalls = [];
let aiText = '[SPECIFIC] The mint is on March 3, right after the reveal.';
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  aiCalls.push({ system: body.messages[0].content, user: body.messages[1].content });
  const content = body.response_format ? '{"intent":"small_talk","reply":"ok"}' : aiText;
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }), text: async () => '' };
};

// ---------------------------------------------------------------- fake Discord
function channel(id, guildId, name = id) {
  return { id, guildId, name, type: 0, isTextBased: () => true, sendTyping: async () => {}, send: async () => ({ id: 's' }), messages: { fetch: async () => new Map() } };
}
const channels = {};
const chan = (id, g, name) => (channels[id] ||= channel(id, g, name));
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };
let seq = 0;
function msg(guildId, channelId, authorId, content, { mentions = [], bot = false, repliedUser = null } = {}) {
  const replies = [];
  return {
    id: `m${++seq}`, guildId, guild: { id: guildId }, channelId, channel: chan(channelId, guildId), client, content,
    author: { id: authorId, bot, username: `u${authorId.slice(0, 3)}`, tag: `u#0`, createdTimestamp: 0 },
    member: { displayName: 'member', roles: { cache: { has: () => false, some: () => false } }, permissions: { has: () => false } },
    mentions: { users: new Map(mentions.map((id) => [id, {}])), roles: new Map(), repliedUser, everyone: false, channels: { first: () => undefined } },
    embeds: [], replies, reference: null,
    reply: async (r) => (replies.push(typeof r === 'string' ? r : r.content), { id: 'r' }),
    react: async () => {},
    delete: async () => {},
  };
}

// ---------------------------------------------------------------- load the bot
const config = require(src('config.js'));
const guilds = require(src('guilds.js'));
const unprompted = require(src('unprompted.js'));
const aboutVexo = require(src('aboutVexo.js'));
const onMessage = require(src('events/messageCreate.js'));

const DAY = 86400000;
const iso = (days) => new Date(Date.now() + days * DAY).toISOString();
const quiet = { log: console.log };
Object.assign(console, { log: () => {}, debug: () => {}, warn: () => {}, error: () => {} });
const say = (...a) => quiet.log(...a);

let passed = 0;
let failed = 0;
async function test(name, fn) {
  aiCalls.length = 0;
  aiText = '[SPECIFIC] The mint is on March 3, right after the reveal.';
  unprompted._test.reset();
  try {
    await fn();
    passed++;
    say(`PASS  ${name}`);
  } catch (err) {
    failed++;
    say(`FAIL  ${name}\n      ${err.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}
// send one message through the real handler, return it (replies in .replies)
async function send(...args) {
  const m = msg(...args);
  await onMessage(m);
  return m;
}

(async () => {
  tables.guilds.push(
    { guild_id: HOME, name: 'HΛVØCZ', status: 'active', settings: {}, knowledge: 'HOME_SECRET_FACT: HΛVØCZ mint is in phase two.' },
    { guild_id: BEEE, name: 'Beee', status: 'active', boss_user_id: ADMIN_B, trial_started_at: iso(-1), trial_ends_at: iso(14), knowledge: 'BEEE_SECRET_FACT: Beee mint is March 3.', settings: { channels: { control: 'b-ctl', marketplace: 'b-shop', rumble: 'b-rumble', logs: 'b-logs', giveaway: 'b-giveaways', solRadar: 'b-sol', nftRadar: 'b-nft' } } },
    { guild_id: OTHER, name: 'Moon Cats', status: 'active', boss_user_id: MEMBER2, trial_started_at: iso(-1), trial_ends_at: iso(14), knowledge: 'MOON_SECRET_FACT: Moon Cats mint is in May.', settings: { channels: { control: 'o-ctl', logs: 'o-logs' } } },
    { guild_id: FREE, name: 'Free Frogs', status: 'active', boss_user_id: MEMBER2, trial_started_at: iso(-20), trial_ends_at: iso(-5), knowledge: 'FROG_SECRET_FACT', settings: { channels: { control: 'f-ctl', logs: 'f-logs' } } }
  );
  chan('b-vexo-logs', BEEE, 'vexo-logs'); // a log channel Vexo does not know as "logs"
  await guilds.load();

  say('== 1. Questions without a mention get answered ==');
  await test('HΛVØCZ: "when is the mint?" in a normal chat channel is answered from HΛVØCZ knowledge', async () => {
    const m = await send(HOME, 'home-chat', MEMBER, 'when is the mint?');
    assert.equal(m.replies.length, 1, 'one reply');
    assert.match(m.replies[0], /March 3/);
    assert.equal(aiCalls.length, 1, 'one AI call');
    assert.ok(aiCalls[0].system.includes('HOME_SECRET_FACT'), 'HΛVØCZ knowledge used');
    assert.ok(aiCalls[0].system.includes('Reply with exactly: NO_REPLY'), 'casual chat would stay silent');
  });
  await test('HΛVØCZ: the general channel (open floor) works too, and a question without "?" ("how do i earn points")', async () => {
    const m = await send(HOME, 'home-general', MEMBER, 'how do i earn points');
    assert.equal(m.replies.length, 1);
  });
  await test('customer server (Beee, trial): question without mention answered from BEEE knowledge only', async () => {
    const m = await send(BEEE, 'b-chat', MEMBER, "what's the roadmap?");
    assert.equal(m.replies.length, 1);
    assert.equal(aiCalls.length, 1);
    const sys = aiCalls[0].system;
    assert.ok(sys.includes('BEEE_SECRET_FACT'), 'own knowledge used');
    for (const other of ['HOME_SECRET_FACT', 'MOON_SECRET_FACT', 'FROG_SECRET_FACT']) assert.ok(!sys.includes(other), `never ${other}`);
  });
  await test('another customer server uses ITS knowledge, never Beee\'s or HΛVØCZ\'s', async () => {
    const m = await send(OTHER, 'o-chat', MEMBER, 'is there a whitelist for the mint?');
    assert.equal(m.replies.length, 1);
    const sys = aiCalls[0].system;
    assert.ok(sys.includes('MOON_SECRET_FACT'));
    for (const other of ['HOME_SECRET_FACT', 'BEEE_SECRET_FACT', 'FROG_SECRET_FACT']) assert.ok(!sys.includes(other), `never ${other}`);
  });
  await test('the #ask channel still works exactly as before', async () => {
    const m = await send(HOME, 'home-ask', MEMBER, 'when is the mint happening');
    assert.equal(m.replies.length, 1);
  });

  say('== 2. Non-questions and casual chat are ignored ==');
  await test('statements, casual chat and off-topic questions: no reply and NO AI call', async () => {
    for (const text of ['the mint art looks sick', 'lol nice', 'gm everyone', 'how are you all doing?', 'anyone watching the game tonight?', 'ok']) {
      const m = await send(BEEE, 'b-chat', MEMBER, text);
      assert.equal(m.replies.filter((r) => !/morning/i.test(r)).length, 0, text);
    }
    assert.equal(aiCalls.length, 0, 'not one AI call');
  });
  await test('the AI decides it is casual (NO_REPLY): silence', async () => {
    aiText = 'NO_REPLY';
    const m = await send(HOME, 'home-chat', MEMBER, 'is the rumble fun or what?');
    assert.equal(aiCalls.length, 1);
    assert.equal(m.replies.length, 0);
  });
  await test('not in the knowledge (UNKNOWN): silence in normal chat (no "don\'t know" line)', async () => {
    aiText = 'UNKNOWN: what is the price of the mint?';
    const m = await send(HOME, 'home-chat', MEMBER, 'what is the mint price?');
    assert.equal(m.replies.length, 0);
  });
  await test('talking to another member (mention or reply to them): no answer', async () => {
    const a = await send(BEEE, 'b-chat', MEMBER, `<@${MEMBER2}> when is the mint?`, { mentions: [MEMBER2] });
    const b = await send(BEEE, 'b-chat', MEMBER, 'when is the mint?', { repliedUser: { id: MEMBER2 } });
    assert.equal(a.replies.length + b.replies.length, 0);
    assert.equal(aiCalls.length, 0);
  });

  say('== 3. Where Vexo never answers unprompted ==');
  await test('control, logs, vexo-logs, shop, rumble, giveaways, radar, excluded channels: nothing', async () => {
    const places = [[BEEE, 'b-ctl'], [HOME, 'home-ctl'], [BEEE, 'b-logs'],[BEEE, 'b-vexo-logs'], [BEEE, 'b-shop'], [BEEE, 'b-rumble'], [BEEE, 'b-giveaways'], [BEEE, 'b-sol'], [BEEE, 'b-nft'], [HOME, 'home-logs'], [HOME, 'home-shop'], [HOME, '444444444444444444'], [HOME, 'home-excluded'], [HOME, 'home-tickets']];
    for (const [g, ch] of places) {
      const m = await send(g, ch, MEMBER, 'when is the mint?');
      assert.equal(m.replies.length, 0, ch);
    }
    assert.equal(aiCalls.length, 0, 'no AI call in any of them');
  });
  await test('bots (and Vexo itself) never get an answer', async () => {
    const a = await send(BEEE, 'b-chat', '888888888888888888', 'when is the mint?', { bot: true });
    const b = await send(BEEE, 'b-chat', BOT, 'when is the mint?', { bot: true });
    assert.equal(a.replies.length + b.replies.length, 0);
    assert.equal(aiCalls.length, 0);
  });
  await test('free-plan customer server: silent, zero AI calls (premium / trial gating)', async () => {
    const m = await send(FREE, 'f-chat', MEMBER, 'when is the mint?');
    assert.equal(m.replies.length, 0);
    assert.equal(aiCalls.length, 0);
  });
  await test('the boss is not answered unless he talks to Vexo (boss gate unchanged)', async () => {
    const m = await send(HOME, 'home-chat', REMO, 'when is the mint?');
    assert.equal(m.replies.length, 0);
    assert.equal(aiCalls.length, 0);
  });
  await test('anti-spam: one unprompted answer attempt per channel every 15 seconds', async () => {
    const a = await send(BEEE, 'b-chat2', MEMBER, 'when is the mint?');
    const b = await send(BEEE, 'b-chat2', MEMBER2, 'what is the supply?');
    const c = await send(BEEE, 'b-chat3', MEMBER2, 'what is the supply?'); // another channel: its own cooldown
    assert.deepEqual([a.replies.length, b.replies.length, c.replies.length], [1, 0, 1]);
  });

  say('== 4. Questions about Vexo itself ==');
  await test('"what can this bot do?" without a mention: answered with the ABOUT VEXO block', async () => {
    aiText = '[BROAD] I host Rumble and guess games, run giveaways, points and a shop, and post SOL and NFT Radar updates.';
    const m = await send(BEEE, 'b-chat', MEMBER, 'what can this bot do?');
    assert.equal(m.replies.length, 1);
    const sys = aiCalls[0].system;
    assert.ok(sys.includes('=== ABOUT VEXO'), 'block added');
    assert.ok(sys.includes('BEEE_SECRET_FACT') && !sys.includes('HOME_SECRET_FACT'), 'still this server only');
  });
  await test('"/setup" or "free trial" questions count as Vexo questions too', async () => {
    const m = await send(OTHER, 'o-chat', MEMBER, 'how long is the free trial?');
    assert.equal(m.replies.length, 1);
    assert.ok(aiCalls[0].system.includes('=== ABOUT VEXO'));
  });
  await test('with a mention / by name: "@Vexo what can you do?", "vexo any updates?", "what is vexo?" get the block', async () => {
    await send(HOME, 'home-chat', MEMBER, `<@${BOT}> what can you do?`, { mentions: [BOT] });
    await send(HOME, 'home-chat2', MEMBER, 'vexo any updates?');
    await send(BEEE, 'b-chat4', MEMBER, 'what is vexo?');
    assert.equal(aiCalls.length, 3);
    for (const c of aiCalls) assert.ok(c.system.includes('=== ABOUT VEXO'), c.user);
  });
  await test('naming Vexo only to talk to it ("vexo when mint?", "hello vexo"): prompt exactly as before (no block)', async () => {
    await send(HOME, 'home-chat', MEMBER, 'vexo when mint?');
    await send(HOME, 'home-chat3', MEMBER, 'hello vexo');
    assert.equal(aiCalls.length, 2);
    for (const c of aiCalls) assert.ok(!c.system.includes('ABOUT VEXO'), c.user);
  });
  await test('the ABOUT VEXO block: every feature from the live feature map, free vs premium, trial days, commands, planned only', () => {
    const b = aboutVexo.block();
    const free = b.split('Premium features')[0];
    const premium = b.split('Premium features')[1].split('Plans:')[0];
    for (const [k, level] of Object.entries(config.features)) {
      const name = { rumble: 'Rumble Royale', numberGuess: 'Number Guess', aiChat: 'AI chat', knowledgeQa: 'Knowledge Q&A', automod: 'Auto mod', points: 'Points:', marketplace: 'Marketplace', giveaway: 'Giveaways:', giveaway_orders: 'Giveaway orders', solRadar: 'SOL Radar', nftRadar: 'NFT Radar' }[k];
      assert.ok(name, `a line for ${k}`);
      assert.ok((level === 'free' ? free : premium).includes(name), `${k} listed as ${level}`);
    }
    assert.match(b, /15-day free trial/);
    for (const cmd of ['/setup', '/status', '/help']) assert.ok(b.includes(cmd), cmd);
    assert.match(b, /Planned next \(in development, no dates announced/);
    assert.ok(!/\b20\d\d\b/.test(b), 'no dates in the block');
    assert.equal(aboutVexo.PLANNED.length, 8);
  });
  await test('isAboutVexo: Vexo as the subject only', () => {
    const yes = ['what is vexo', 'what can vexo do?', 'vexo any update', "what's coming next for vexo?", 'how do I set up the bot?', 'is sol radar premium?', 'what does /status show?'];
    const no = ['hello vexo', 'vexo when mint?', 'when is the mint?', 'any update on the collection?', 'thanks vexo'];
    for (const t of yes) assert.equal(aboutVexo.isAboutVexo(t), true, t);
    for (const t of no) assert.equal(aboutVexo.isAboutVexo(t), false, t);
    assert.equal(aboutVexo.isAboutVexo('what can you do?', { talkingToVexo: true }), true);
    assert.equal(aboutVexo.isAboutVexo('what can you do?'), false, '"you" means Vexo only when talking to Vexo');
  });

  say(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
