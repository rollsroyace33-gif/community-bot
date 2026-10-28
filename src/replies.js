// The ONE place that decides whether and how Vexo answers a chat message. messageCreate.js runs the
// game and control channel steps first, then calls respond() once per message.
//
// Order inside respond() (see messageCreate.js for the full flow):
//   a. boss cover      -> a member mentions the boss while he may be resting (bossCover.js)
//   b. members         -> "gm"/"gn" greeting, then HΛVØCZ questions + chat when Vexo is addressed
//                         (mention, reply to Vexo, "vexo" by name) or in #ask
//   c. the boss        -> welcome back after a long break; otherwise a reply ONLY when he talks to Vexo
//                         (messageCreate.js only calls respond() for him when bossGate.js allows it)
//   d. offline chat    -> a lone member in a quiet channel during the boss's offline window (offlineChat.js)
// (b and c never overlap: they are split by author.)
// Everything catches its own errors: a failed reply never stops points or other handlers.
const config = require('./config');
const ai = require('./ai');
const personality = require('./personality');
const identity = require('./identity');
const clock = require('./clock');
const chatContext = require('./chatContext');
const bossCover = require('./bossCover');
const offlineChat = require('./offlineChat');
const bossGate = require('./bossGate');
const T = require('./bossTemplates');
const { createBag } = require('./bag');
const { allowQa } = require('./ratelimit');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const draw = createBag();
const quiet = { repliedUser: false, parse: [] }; // never ping anyone by accident

// AI down: playful lines, no pitch
const GLITCH = ['My brain lagged for a sec 😵 Try me again in a moment?', 'Signal got fuzzy on my end. One more time in a bit?'];
// never a question for the boss
const BOSS_GLITCH = ['My brain lagged for a sec, boss 😵 Back in a moment.', 'Signal got fuzzy, boss. Give me a moment and try again.'];

// ---------------- Is Vexo being talked to? ----------------
// mentioned: @Vexo · repliedToVexo: a Discord reply to one of Vexo's messages · byName: "vexo" in the text
function addressed(message) {
  const botId = message.client.user.id;
  const mentioned = !!message.mentions?.users?.has(botId);
  const repliedToVexo = message.mentions?.repliedUser?.id === botId;
  const byName = /\bvexo\b/i.test(message.content || '');
  return { mentioned, repliedToVexo, byName, any: mentioned || repliedToVexo || byName };
}

// "ok", "lol", "let's see", pure emoji: a closing remark gets silence or at most a reaction
function isClosingRemark(text) {
  const t = String(text || '').replace(/<a?:\w+:\d+>/g, ' ').replace(/\bvexo\b[,!.]*/gi, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return true; // emoji / symbols only (or nothing)
  return /^(ok(ay)?|k+|kk|lol+|lmao|haha+|hehe+|nice|cool|thanks?|thx|ty|let'?s see|sure|alright|yup|yep|gg|true|same|noted|bet|fair)[\s.!]*$/i.test(t);
}

// ---------------- Greetings (members) ----------------
const GREET_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per user
const lastGreet = new Map(); // userId -> timestamp

const MORNING_REPLIES = [
  (u) => `☀️ Good morning, ${u}! Hope you have an amazing day!`,
  (u) => `🌅 Morning, ${u}! Grab a coffee and let's make today great.`,
  (u) => `🌞 Good morning ${u}! Wishing you a productive and happy day.`,
  (u) => `☕ Rise and shine, ${u}! Great to see you here this morning.`,
];
const NIGHT_REPLIES = [
  (u) => `🌙 Good night, ${u}! Sleep well and sweet dreams.`,
  (u) => `😴 Night night, ${u}! Get some good rest, see you tomorrow.`,
  (u) => `✨ Good night ${u}! Thanks for hanging out today.`,
  (u) => `🌌 Rest well, ${u}! Catch you tomorrow.`,
];

// true = a greeting was sent (the conversation step then stays quiet, no double reply)
async function handleGreeting(message) {
  const text = message.content.trim().toLowerCase();
  let pool = null;
  if (/^(gm|good morning)\b/.test(text)) pool = MORNING_REPLIES;
  else if (/^(gn|good night)\b/.test(text)) pool = NIGHT_REPLIES;
  if (!pool) return false;

  const now = Date.now();
  if (now - (lastGreet.get(message.author.id) || 0) < GREET_COOLDOWN_MS) return false;
  lastGreet.set(message.author.id, now);

  await message
    .reply({ content: pick(pool)(`<@${message.author.id}>`), allowedMentions: { users: [message.author.id], repliedUser: false } })
    .catch((err) => console.error('greeting reply:', err.message));
  return true;
}

// ---------------- Creator identity ("who made you", members only) ----------------
// Only answers the question. It never gives anyone extra powers.
async function sendCreatorReply(message, { useAi }) {
  const content = await personality.creatorReply({ useAi }); // never throws, falls back to fixed lines
  await message
    .reply({ content, allowedMentions: personality.creatorMentions() }) // pings the boss only
    .catch((err) => console.error('creator reply:', err.message));
}

// ---------------- Conversation ----------------
// true = Vexo replied
async function converse(message, { isBoss, isAsk, addr }) {
  const botId = message.client.user.id;
  const text = message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
  // un-addressed #ask messages need some substance; a bare "@Vexo" still gets a reply
  if (!addr.any && text.length < 5) return false;
  const said = text || '(pinged you without saying anything)';

  // cheap regex first (members only: the boss knows who made Vexo, the AI answers him in character)
  if (!isBoss && personality.isCreatorQuestion(said)) {
    const withinLimit = allowQa(message.author.id);
    // over the hourly limit: direct mentions still get a fixed (no-AI) answer, #ask gets ⏳
    if (!withinLimit && !addr.any) {
      await message.react('⏳').catch(() => {});
      return false;
    }
    await sendCreatorReply(message, { useAi: withinLimit });
    return true;
  }

  // members: max QA_PER_HOUR AI replies per hour. The boss is never rate limited.
  if (!isBoss && !allowQa(message.author.id)) {
    if (addr.mentioned) await message.reply('Easy there, my brain needs a breather. Try me again a bit later ⏳').catch(() => {});
    else if (isAsk && !addr.any) await message.react('⏳').catch(() => {});
    return false; // called by name / replied to: just stay quiet
  }

  await message.channel.sendTyping().catch(() => {});
  try {
    const reply = await ai.converse(said, {
      isBoss,
      silentIfCasual: isAsk && !addr.any, // #ask without being addressed: only real questions get an answer
      detectCreator: !isBoss,
      context: chatContext.get(message.channelId), // recent chat, recorded before this message
    });
    if (!reply) return false;
    // the AI recognized a "who made you" question the regex missed
    if (reply === ai.CREATOR_QUESTION) {
      await sendCreatorReply(message, { useAi: true });
      return true;
    }
    await message.reply({ content: reply.slice(0, 1900), allowedMentions: quiet });
    chatContext.recordBot(message.channelId, reply);
    return true;
  } catch (err) {
    console.error('reply error:', err.message);
    if (addr.any || isBoss) {
      await message.reply({ content: pick(isBoss ? BOSS_GLITCH : GLITCH), allowedMentions: quiet }).catch(() => {});
      return true;
    }
    return false;
  }
}

// ---------------- The boss (sections 1 + 2) ----------------
const BOSS_COOLDOWN_MS = 60 * 1000; // per channel, for replies he did not ask for with a mention / reply
const MAX_IN_A_ROW = 2; // name-only addresses: at most 2 replies in a row to him per channel
const bossState = new Map(); // channelId -> { lastReplyAt, inARow }

function welcomeLine(awayMs) {
  const hours = Math.floor(awayMs / 3600000);
  if (hours >= 24) return draw('welcomeDay', T.welcomeDay);
  return draw('welcomeHours', T.welcomeHours).replace('{hours}', String(Math.max(1, hours)));
}

// 2. welcome back: ONE line for the first message after a long break (BOSS_AWAY_HOURS). addressed =
// he talks to Vexo (bossGate.js); otherwise the line is still allowed, but never while he is replying
// to / mentioning another member. true = the line was sent.
async function welcomeBack(message, { awayMs, addressed }) {
  if (awayMs === null || awayMs === undefined || awayMs < config.bossAwayHours * 3600000) return false;
  if (!addressed && (await bossGate.bossTalksToOthers(message, message.client))) return false;
  await message.reply({ content: welcomeLine(awayMs), allowedMentions: { repliedUser: false, parse: [] } }).catch((err) => console.error('welcome back:', err.message));
  return true;
}

async function bossMessage(message, { isAsk, addr, awayMs }) {
  if (await welcomeBack(message, { awayMs, addressed: true })) return; // then the normal rules

  // 1. only when he is actually talking to Vexo. messageCreate.js already checked this (bossGate.js);
  // checked again so no path can answer him otherwise. (The old "#ask channel = always answer the
  // boss" rule is gone: #ask is the same channel as #open-floor, so he got a reply to everything.)
  const via = await bossGate.addressedVia(message, message.client); // 'mention' | 'reply' | 'name' | null
  if (!via) return;

  const text = message.content.replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '').trim();
  if (isClosingRemark(text)) {
    await message.react(draw('reaction', T.bossReactions)).catch(() => {});
    return; // "ok", "lol", pure emoji: a reaction at most, never a text reply
  }

  const now = clock.now();
  const st = bossState.get(message.channelId) || { lastReplyAt: 0, inARow: 0 };
  const explicit = via === 'mention' || via === 'reply';
  if (!explicit && now - st.lastReplyAt < BOSS_COOLDOWN_MS) return; // per-channel cooldown
  if (!explicit && st.inARow >= MAX_IN_A_ROW) return; // at most 2 in a row unless he mentions / replies

  // he is talking to Vexo (checked above), so converse() treats it as addressed in every channel
  const replied = await converse(message, { isBoss: true, isAsk, addr: { ...addr, any: true } });
  if (replied) bossState.set(message.channelId, { lastReplyAt: now, inARow: st.inARow + 1 });
}

// ---------------- Entry point ----------------
// awayMs: gap since the boss's previous message (from bossPresence, already updated by the caller)
// Returns { isAsk } so the caller can keep the points rules ("#ask earns no points").
async function respond(message, { awayMs = null } = {}) {
  const isBoss = identity.isBoss(message.author); // who is talking: Discord user ID only
  if (isBoss) identity.noteBoss(message, 'chat');
  const isAsk = !!config.channels.ask && message.channelId === config.channels.ask;

  try {
    const addr = addressed(message);

    if (isBoss) {
      await bossMessage(message, { isAsk, addr, awayMs }); // c.
      return { isAsk, isBoss };
    }
    bossState.delete(message.channelId); // another human spoke: the boss's "in a row" count starts over

    if (await bossCover.handle(message)) return { isAsk, isBoss }; // a.

    const greeted = await handleGreeting(message).catch((err) => (console.error('greeting:', err.message), false)); // b.
    // a plain "gm vexo" was already answered by the greeting; "gm vexo, when mint?" still gets an answer
    const greetingOnly = greeted && !message.content.includes('?');
    if (greetingOnly) return { isAsk, isBoss };
    if (isAsk || addr.any) {
      await converse(message, { isBoss: false, isAsk, addr });
      return { isAsk, isBoss };
    }
    await offlineChat.handle(message); // d.
  } catch (err) {
    console.error('conversation:', err.message);
  }
  return { isAsk, isBoss };
}

module.exports = {
  respond,
  welcomeBack,
  addressed,
  isClosingRemark,
  _test: { reset: () => bossState.clear() },
};
