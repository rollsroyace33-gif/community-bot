// Every message goes through here, in this order:
//   1. ignore bots / DMs
//   2. boss presence    -> if the boss wrote: remember WHEN (before anything is sent). No reply here.
//   3. game channels    -> a running game owns its channel (guesses, game chat); nothing else talks there
//   4. control channel  -> boss/staff orders only, nothing else runs there
//   5. replies.respond  -> boss cover (section 5) -> members: greeting, HΛVØCZ questions / addressed chat
//                          (section 4) -> the boss: welcome back + replies only when he talks to Vexo
//                          (sections 1, 2) -> offline chat with a lone member (section 3)
//   6. channel activity -> offline chat steps back when another human writes (memory only)
//   7. chat context     -> remember the message for later replies (memory only)
//   8. points           -> as before (also in game channels)
const config = require('../config');
const points = require('../points');
const tasks = require('../tasks');
const replies = require('../replies');
const chatContext = require('../chatContext');
const identity = require('../identity');
const bossPresence = require('../bossPresence');
const offlineChat = require('../offlineChat');
const supabase = require('../db');

const lastMsgTime = new Map(); // userId -> timestamp
const recentMsgs = new Map(); // userId -> last few normalized messages
const loggedCount = new Map(); // `${day}:${userId}` -> count

function clean(text) {
  return text
    .replace(/<a?:\w+:\d+>/g, '') // custom emoji
    .replace(/<@!?&?\d+>/g, '') // mentions
    .replace(/<#\d+>/g, '')
    .replace(/https?:\/\/\S+/g, '') // links
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------- Points ----------------
async function handlePoints(message) {
  const { author, member } = message;
  if (!member) return;
  if (config.filters.excludedChannels.includes(message.channelId)) return;
  if (!points.isEligible(member, author)) return;

  const text = clean(message.content);
  if (text.length < config.filters.minLength) return;

  const now = Date.now();
  if (now - (lastMsgTime.get(author.id) || 0) < config.filters.minGapSeconds * 1000) return;

  const norm = text.toLowerCase();
  const recent = recentMsgs.get(author.id) || [];
  if (recent.includes(norm)) return; // repeated message
  recent.push(norm);
  if (recent.length > 5) recent.shift();
  recentMsgs.set(author.id, recent);
  lastMsgTime.set(author.id, now);

  await points.recordMessage(author.id);

  // keep a few messages for the nightly AI quality check
  const day = points.today();
  const key = `${day}:${author.id}`;
  const n = loggedCount.get(key) || 0;
  if (n < config.filters.maxLoggedPerUser) {
    loggedCount.set(key, n + 1);
    const { error } = await supabase
      .from('messages_log')
      .insert({ user_id: author.id, day, content: text.slice(0, 300) });
    if (error) console.error('messages_log insert:', error.message);
  }
}

module.exports = async function onMessageCreate(message) {
  try {
    if (message.author.bot || !message.guild) return;

    // 2. the boss's last message time, updated BEFORE any reply (never welcomed twice for one return)
    let awayMs = null;
    if (identity.isBoss(message.author)) {
      awayMs = bossPresence.note({ isControl: !!config.channels.control && message.channelId === config.channels.control });
    }

    // 3. a running game owns its channel: no welcome, cover, Q&A or chat there (points still count)
    let gameOwned = false;
    try {
      gameOwned = await tasks.handleMessage(message);
    } catch (err) {
      console.error('game chat:', err.message);
    }

    // 4. private control channel: boss/staff orders only, nothing else runs there
    if (!gameOwned && (await tasks.handleControlMessage(message))) return;

    // 5. everything else that can make Vexo talk; never throws, so points below always run
    let isAsk = !!config.channels.ask && message.channelId === config.channels.ask;
    if (!gameOwned) ({ isAsk } = await replies.respond(message, { awayMs }));

    // 6. offline chat: a second human in the channel ends Vexo's chat with the first
    offlineChat.noteHuman(message);
    // 7. short-term context for later replies (memory only; added after the reply so it isn't duplicated in the prompt)
    chatContext.record(message);
    // a dedicated Q&A channel does not earn points (but it does when it is also the general channel)
    if (isAsk && message.channelId !== config.channels.general) return;
    await handlePoints(message);
  } catch (err) {
    console.error('messageCreate error:', err);
  }
};

module.exports.resetCounters = () => loggedCount.clear();
