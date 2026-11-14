// HΛVØCZ safety net: the exact instructions (prompts) Vexo sends to the AI for HΛVØCZ must stay
// identical, letter for letter, while the bot becomes multi-server.
//   node tests/prompt-snapshot.test.js            compare with the saved snapshot
//   node tests/prompt-snapshot.test.js --update   save a new snapshot (only when a change is intended)
// Fully offline: Discord, Supabase and the AI are faked. No real .env value is printed or saved
// (every value the prompts use is set below).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BOSS = '123456789012345678';
const MEMBER = '987654321098765432';
const BOT = '111111111111111111';
const HOME = '222222222222222222';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: HOME, HOME_GUILD_ID: HOME, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x', OPENAI_MODEL: 'gpt-4o-mini', BOSS_USER_ID: BOSS, STAFF_ROLE_IDS: 'staffrole',
  BOSS_OFFLINE_START: '00:00', BOSS_OFFLINE_END: '23:59', BOSS_TIMEZONE: 'Asia/Dhaka', TIMEZONE: 'Asia/Dhaka',
  CONTROL_CHANNEL_ID: 'ctl', GENERAL_CHANNEL_ID: 'floor', ASK_CHANNEL_ID: 'ask', TICKET_CHANNEL_ID: 'tickets', TICKET_CATEGORY_ID: '',
  VERIFIED_ROLE_ID: 'verified', QA_PER_HOUR: '1000', X_DROP_POINTS: '10', X_DROP_CHANNEL_ID: '',
  GAME_ANNOUNCE_MINUTES: '10', GAME_DURATION_MINUTES: '15', GAME_MAX_GUESSES_PER_USER: '30',
  RUMBLE_CHANNEL_ID: '333333333333333333', RUMBLE_MIN_PLAYERS: '3', RUMBLE_DEFAULT_JOIN_MINUTES: '5', RUMBLE_MAX_JOIN_MINUTES: '1440',
  BOSS_ACTIVE_RECENT_MINUTES: '15', BOSS_NOTE_COOLDOWN_MINUTES: '30', BOSS_NOTE_CHANNEL_MAX: '3',
});
const src = (p) => require.resolve(`../src/${p}`);

// fake Supabase: every table is empty, every write succeeds
const fakeDb = {
  rpc: async () => ({ data: 0, error: null }),
  from() {
    let single = false;
    const api = new Proxy(
      {},
      {
        get(_, key) {
          if (key === 'then') return (res, rej) => Promise.resolve({ data: single ? null : [], error: null }).then(res, rej);
          if (key === 'single' || key === 'maybeSingle') return () => ((single = true), api);
          return () => api;
        },
      }
    );
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

// fake AI: records every prompt; JSON calls get JSON back, text calls get a short sentence
const prompts = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  prompts.push({ system: body.messages[0].content, user: body.messages[1].content });
  const content = body.response_format
    ? '{"intent":"small_talk","reply":"Hi boss.","scores":[],"addressed_to_boss":true,"can_help":false,"boss_note":"needs help"}'
    : 'Sure thing.';
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }), text: async () => '' };
};

const realRandom = Math.random;
const silence = () => {};
const realLog = { log: console.log, error: console.error, warn: console.warn, debug: console.debug };

async function collect() {
  Object.assign(console, { log: silence, error: silence, warn: silence, debug: silence });
  Math.random = () => 0.5;
  try {
    const ai = require('../src/ai');
    const personality = require('../src/personality');
    const parser = require('../src/tasks/parser');
    const bossCover = require('../src/bossCover');
    const G = { guildId: HOME }; // ignored by the single-server code, used by the multi-server code

    await ai.converse('what is the roadmap?', { ...G });
    await ai.converse('hello vexo', { ...G, isBoss: true });
    await ai.converse('anyone here', { ...G, silentIfCasual: true, detectCreator: true, context: ['mira: gm all'] });
    Math.random = () => 0.1; // the "playful extra sentence" variant
    await ai.converse('how do I earn points?', { ...G });
    Math.random = () => 0.5;
    await personality.creatorReply({ ...G, useAi: true });
    await personality.welcomeLine('1', G);
    await personality.groupWelcomeLine(['1', '2'], G);
    await personality.gameBanter('nice game', { ...G, min: 1, max: 100, guesses: 3, players: 2, isBoss: false });
    await personality.gameBanter('nice game', { ...G, min: 1, max: 100, guesses: 3, players: 2, isBoss: true });
    await ai.judgeMessages([{ id: 1, text: 'hello there friends' }], G).catch(silence);
    await parser.understand('hello', 'Boss (remo)', { ...G }).catch(silence);
    await bossCover.handle({
      id: 'm1', url: 'https://discord.test/m1', channelId: 'chat', guild: { id: HOME }, guildId: HOME,
      author: { id: MEMBER, bot: false, username: 'mira' }, member: { displayName: 'mira' },
      content: `<@${BOSS}> can you tell me when the mint is happening please, I need to plan`,
      mentions: { users: new Map([[BOSS, {}]]), roles: new Map(), repliedUser: null, everyone: false },
      channel: { name: 'chat', send: async () => {} }, client: { user: { id: BOT } }, reply: async () => {},
    });
  } finally {
    Math.random = realRandom;
    Object.assign(console, realLog);
  }
  // the only part that changes by itself: the boss's clock line in the control channel prompt
  return prompts.map((p) => ({
    system: p.system.replace(/Boss's clock right now: .*/g, "Boss's clock right now: <clock>"),
    user: p.user,
  }));
}

(async () => {
  const file = path.join(__dirname, 'fixtures', 'prompts.havocz.json');
  const now = await collect();
  if (process.argv.includes('--update')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(now, null, 2));
    console.log(`Saved ${now.length} prompts to ${path.relative(process.cwd(), file)}`);
    return;
  }
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  let failed = 0;
  if (saved.length !== now.length) {
    failed += 1;
    console.log(`FAIL  number of AI calls: was ${saved.length}, now ${now.length}`);
  }
  for (let i = 0; i < Math.min(saved.length, now.length); i++) {
    for (const part of ['system', 'user']) {
      try {
        assert.strictEqual(now[i][part], saved[i][part]);
      } catch {
        failed += 1;
        const a = saved[i][part];
        const b = now[i][part];
        let at = 0;
        while (at < a.length && a[at] === b[at]) at += 1;
        console.log(`FAIL  prompt ${i + 1} (${part}) differs at character ${at}:`);
        console.log(`      was: ${JSON.stringify(a.slice(Math.max(0, at - 40), at + 80))}`);
        console.log(`      now: ${JSON.stringify(b.slice(Math.max(0, at - 40), at + 80))}`);
      }
    }
  }
  console.log(failed ? `${failed} difference(s): the HΛVØCZ prompts CHANGED` : `${now.length}/${now.length} HΛVØCZ prompts identical to the snapshot`);
  process.exit(failed ? 1 : 0);
})();
