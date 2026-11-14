// "Vexo never asks the boss a question" test. Run: node tests/bossnoquestion.test.js
// Fully offline: Discord, Supabase and the AI are faked; real .env values are never printed.
const assert = require('assert');

const BOSS = '123456789012345678';
const MEMBER = '987654321098765432';
const BOT = '111111111111111111';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: 'g', HOME_GUILD_ID: 'g', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', BOSS_USER_ID: BOSS, STAFF_ROLE_IDS: '',
  BOSS_OFFLINE_START: '00:00', BOSS_OFFLINE_END: '00:00', // offline window off here (tested in boss-offline.test.js)
  CONTROL_CHANNEL_ID: 'ctl', GENERAL_CHANNEL_ID: 'floor', ASK_CHANNEL_ID: 'ask', QA_PER_HOUR: '1000', MIN_ACCOUNT_AGE_DAYS: '0',
});
const src = (p) => require.resolve(`../src/${p}`);

// fake Supabase: empty tables, nothing stored anywhere
const api = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res({ data: [], error: null }) : () => api) });
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: { from: () => api, rpc: async () => ({ data: 0, error: null }) } };

// fake AI: answers come from a queue (last one repeats), every prompt is recorded
const prompts = [];
let queue = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  prompts.push(body.messages[0].content);
  const next = queue.length > 1 ? queue.shift() : queue[0];
  if (next instanceof Error) throw next;
  return { ok: true, json: async () => ({ choices: [{ message: { content: next } }] }) };
};
const aiSays = (...answers) => (queue = answers);

// fake Discord
const sent = [];
const channel = (id) => ({ id, isTextBased: () => true, sendTyping: async () => {}, send: async (m) => sent.push(m.content || m) });
const channels = { ctl: channel('ctl'), floor: channel('floor'), game: channel('game') };
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };
function msg(ch, authorId, content, { mention = false, replyTo = null } = {}) {
  const users = new Map(mention ? [[BOT, { id: BOT }]] : []);
  return {
    content: mention ? `<@${BOT}> ${content}` : content, channelId: ch, client, channel: channels[ch], guild: { id: 'g' },
    author: { id: authorId, username: 'u', tag: 'u#0', bot: false, createdTimestamp: 0 },
    member: { displayName: 'u', roles: { cache: { has: () => false, some: () => false } } },
    mentions: { users, repliedUser: replyTo ? { id: replyTo } : null },
    reply: async (m) => sent.push(typeof m === 'string' ? m : m.content),
    react: async () => {},
  };
}

const personality = require(src('personality.js'));
const ai = require(src('ai.js'));
const onMessageRaw = require(src('events/messageCreate.js'));
const replies = require(src('replies.js'));
// the boss's 60 s cooldown / 2-in-a-row limits are tested in boss-offline.test.js; reset them per message here
const onMessage = async (m) => (replies._test.reset(), onMessageRaw(m));
const control = require(src('tasks/control.js'));
const numberGuess = require(src('tasks/numberGuess.js'));

const SCREENSHOT = "Hey boss! Just keeping the vibes alive here. 🫀 What's next on your agenda?";
const QUESTIONY = /\?|what'?s next|on your (mind|agenda)|what'?s the plan|anything else|have in mind|how can i help|next (wild )?(move|adventure)|all ears|vibes alive|spice to the mix/i;
const last = () => sent.at(-1) || '';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
const show = (label, text) => console.log(`      ${label}: ${JSON.stringify(text)}`);

(async () => {
  console.log('== Boss: statements only ==');

  await test('screenshot reply to the BOSS -> question and stock filler removed, never a "?"', async () => {
    aiSays(SCREENSHOT); // the AI keeps asking, even on the retry
    const before = prompts.length;
    await onMessage(msg('floor', BOSS, 'you there', { replyTo: BOT }));
    show('AI wrote', SCREENSHOT);
    show('boss got', last());
    assert.doesNotMatch(last(), QUESTIONY);
    assert.match(last(), /boss/i);
    assert.strictEqual(prompts.length - before, 2, 'expected the answer + exactly one retry');
    assert.match(prompts.at(-1), /Reply with a statement only, no question\./);
    assert.ok(personality.BOSS_LINES.map((l) => personality.asBoss(l)).includes(last()), 'fixed fallback line expected');
  });

  await test('emoji-only reply to Vexo ("🫀🫀"): a reaction at most, never a text reply', async () => {
    const before = sent.length;
    const ai0 = prompts.length;
    await onMessage(msg('floor', BOSS, '🫀🫀', { replyTo: BOT }));
    assert.strictEqual(sent.length, before);
    assert.strictEqual(prompts.length, ai0);
  });

  await test('retry works: first answer is a question, the regenerated statement is used', async () => {
    aiSays("Hey boss! What's on your mind?", 'Boss, you just made my circuits blush 😄');
    await onMessage(msg('floor', BOSS, 'vexo, talk to me', {}));
    show('boss got', last());
    assert.strictEqual(last(), 'Boss, you just made my circuits blush 😄');
  });

  await test('"vexo, you\'re the best": statement part kept, follow-up question cut', async () => {
    aiSays("Takes one to know one, boss 😎 What's the next wild adventure?");
    await onMessage(msg('floor', BOSS, "vexo, you're the best"));
    show('boss got', last());
    assert.strictEqual(last(), 'Takes one to know one, boss 😎');
  });

  await test('boss prompt contains the no-question rule and the emoji / tiny-ack rule', () => {
    const p = prompts.at(-1);
    assert.match(p, /Never ask the boss a question\. Always reply with a statement\./);
    assert.match(p, /only emojis or a tiny acknowledgement/);
  });

  await test('HΛVØCZ answer to the boss: rhetorical / follow-up questions removed too', async () => {
    aiSays('[SPECIFIC] The mint date is not out yet, boss. Want me to ping the team?');
    await onMessage(msg('floor', BOSS, 'vexo when is the mint'));
    show('boss got', last());
    assert.strictEqual(last(), 'The mint date is not out yet, boss.');
  });

  await test('AI down: the boss gets a statement, not "Hit me again?"', async () => {
    aiSays(new Error('AI down'));
    const logError = console.error;
    console.error = () => {};
    try {
      for (let i = 0; i < 10; i++) await onMessage(msg('floor', BOSS, 'vexo, you there?'));
    } finally {
      console.error = logError;
    }
    assert.doesNotMatch(last(), /\?/);
  });

  await test('every fixed line that can reach the boss is question-free (>= 10 fallback lines)', async () => {
    assert.ok(personality.BOSS_LINES.length >= 10);
    const lines = [...personality.BOSS_LINES, ...ai.lines.BOSS_FALLBACK, ...ai.lines.BOSS_UNKNOWN_REPLIES, ...numberGuess._test.REPEAT_BOSS];
    aiSays(new Error('AI down'));
    const logError = console.error;
    console.error = () => {};
    try {
      for (let i = 0; i < 20; i++) {
        lines.push(await personality.gameBanter('hint pls', { min: 1, max: 100, guesses: 0, players: 0, isBoss: true }));
        lines.push(await personality.gameBanter('lol', { min: 1, max: 100, guesses: 0, players: 0, isBoss: true }));
      }
    } finally {
      console.error = logError;
    }
    const bad = lines.filter((l) => QUESTIONY.test(l));
    assert.deepStrictEqual(bad, []);
  });

  await test('game channel: AI banter question to the boss is cut; boss repeat guess gets no "?" line', async () => {
    aiSays("Boss in the arena! What's your lucky number?");
    const line = await personality.gameBanter('vexo im playing', { min: 1, max: 100, guesses: 3, players: 2, isBoss: true });
    show('boss got', line);
    assert.doesNotMatch(line, /\?/);
    const game = { lastReactedTo: null, decks: new Map(), lastLine: new Map() };
    for (let i = 0; i < 30; i++) {
      game.lastReactedTo = null;
      assert.doesNotMatch(numberGuess._test.guessReaction(game, BOSS, { repeated: true }), /\?/);
    }
  });

  console.log('\n== Members: unchanged ==');

  await test('the SAME screenshot text to a regular member is left exactly as it was', async () => {
    aiSays(SCREENSHOT);
    const before = prompts.length;
    await onMessage(msg('floor', MEMBER, 'yo vexo'));
    show('member got', last());
    assert.strictEqual(last(), SCREENSHOT);
    assert.strictEqual(prompts.length - before, 1, 'no retry for members');
    assert.doesNotMatch(prompts.at(-1), /Never ask the boss a question/);
  });

  await test('member repeat-guess lines unchanged (still the full pool)', () => {
    assert.ok(numberGuess._test.REPEAT.includes('Same number again? Bold strategy.'));
  });

  console.log('\n== Control channel: order clarifications stay ==');

  await test('"Morning or night, boss?" clarifying question is kept', async () => {
    aiSays(JSON.stringify({ intent: 'clarify', reply: 'Morning or night, boss?' }));
    await control.handleMessage(msg('ctl', BOSS, 'game at 11'));
    show('control', last());
    assert.strictEqual(last(), 'Morning or night, boss?');
  });

  await test('schedule order still ends with "Confirm? (yes/no)"', async () => {
    aiSays(JSON.stringify({ intent: 'schedule_game', task_type: 'number_guess', time: { in_minutes: 30 }, reply: 'Game night!' }));
    await control.handleMessage(msg('ctl', BOSS, 'game in 30 min'));
    show('control', last());
    assert.match(last(), /Confirm\? \(yes\/no\)/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
