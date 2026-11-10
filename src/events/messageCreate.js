// Every message goes through here, in this order:
//   1. ignore bots / DMs
//   1b. boss gate       -> a boss message NOT addressed to Vexo gets no reply from any handler below
//                          (bossGate.js: @Vexo, a reply to Vexo, or "vexo, ..." only). Bookkeeping still runs.
//   2. boss presence    -> if the boss wrote: remember WHEN (before anything is sent). No reply here.
//   3. game channels    -> a running game owns its channel (guesses, game chat); nothing else talks there
//                          (gated boss message: his guesses count, but no banter / flavor line)
//   4. control channel  -> boss/staff orders only, nothing else runs there (not affected by the gate)
//   5. replies.respond  -> boss cover (section 5) -> members: greeting, HΛVØCZ questions / addressed chat
//                          (section 4) -> the boss: welcome back + replies only when he talks to Vexo
//                          (sections 1, 2) -> offline chat with a lone member (section 3)
//                          Gated boss message: only the one welcome-back line after a long break,
//                          and never when he is replying to / mentioning someone else.
//   6. channel activity -> offline chat steps back when another human writes (memory only)
//   7. chat context     -> remember the message for later replies (memory only)
//   8. points           -> as before (also in game channels)
//   X drop (first)      -> in X_DROP_CHANNEL_ID, a valid X post link = instant extra points + one reply (xDrop.js),
//                          for every member incl. the boss (not gated). A drop message gets no other reply.
const config = require('../config');
const points = require('../points');
const tasks = require('../tasks');
const replies = require('../replies');
const chatContext = require('../chatContext');
const identity = require('../identity');
const bossPresence = require('../bossPresence');
const offlineChat = require('../offlineChat');
const bossGate = require('../bossGate');
const supabase = require('../db');
const xDrop = require('../xDrop');

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

// one log line per early return: why a message got no (further) handling. Never logs message content.
const skip = (message, reason) => console.log(`[msg] ${message.id} in #${message.channelId} by ${message.author?.id}: ${reason}`);

// ---------------- Points ----------------
async function handlePoints(message) {
  const { author, member } = message;
  if (!member) return skip(message, 'no points: no guild member object');
  if (config.filters.excludedChannels.includes(message.channelId)) return skip(message, 'no points: excluded channel');
  if (!points.isEligible(member, author)) return skip(message, 'no points: member not eligible (account age / role)');

  const text = clean(message.content);
  if (text.length < config.filters.minLength) return skip(message, 'no points: message too short');

  const now = Date.now();
  if (now - (lastMsgTime.get(author.id) || 0) < config.filters.minGapSeconds * 1000) return skip(message, 'no points: cooldown between messages');

  const norm = text.toLowerCase();
  const recent = recentMsgs.get(author.id) || [];
  if (recent.includes(norm)) return skip(message, 'no points: duplicate of a recent message'); // repeated message
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
    if (message.author.bot) return skip(message, 'ignored: author is a bot');
    if (!message.guild) return skip(message, 'ignored: not in a guild (DM)');
    if (!message.content && message.author.id !== message.client.user.id) {
      // empty content for a normal text message usually means the Message Content Intent is missing
      skip(message, 'warning: empty message content (Message Content Intent enabled in the Developer Portal?)');
    }

    // X post drop: before the boss gate, so it works the same for everyone (never throws)
    const isDrop = await xDrop.handle(message);

    // 1b. the boss gate: true for every member; for the boss only when he talks to Vexo
    //     (the control channel has its own order flow below and is not gated)
    const isBoss = identity.isBoss(message.author);
    const isControl = !!config.channels.control && message.channelId === config.channels.control;
    const mayReply = isBoss && !isControl ? await bossGate.shouldVexoHandleBossMessage(message, message.client) : true;

    // 2. the boss's last message time, updated BEFORE any reply, for EVERY boss message (also ignored
    //    ones), so one return is never welcomed twice
    let awayMs = null;
    if (isBoss) {
      awayMs = bossPresence.note({ isControl });
    }

    // 3. a running game owns its channel: no welcome, cover, Q&A or chat there (points still count)
    let gameOwned = false;
    try {
      gameOwned = await tasks.handleMessage(message, { mayReply }); // gated boss: counted, no banter
    } catch (err) {
      console.error('game chat:', err.message);
    }

    // 4. private control channel: boss/staff orders only, nothing else runs there
    if (gameOwned) skip(message, 'a running game owns this channel: no chat replies (points still count)');
    if (!gameOwned && (await tasks.handleControlMessage(message))) return skip(message, 'handled as a control channel order');
    if (isBoss && !mayReply) skip(message, 'boss message not addressed to Vexo (boss gate): only welcome-back may reply');
    if (isDrop) skip(message, 'X drop handled: no other reply');

    // 5. everything else that can make Vexo talk; never throws, so points below always run
    let isAsk = !!config.channels.ask && message.channelId === config.channels.ask;
    if (isDrop) {
      // an X drop: the confirmation line was its only reply (no cover / chat / welcome on it)
    } else if (!gameOwned && mayReply) ({ isAsk } = await replies.respond(message, { awayMs }));
    // the boss is not talking to Vexo: every reply handler is skipped, except the one funny welcome-back
    // after a long break (BOSS_AWAY_HOURS), and even that never on a reply to / mention of someone else
    else if (!gameOwned) await replies.welcomeBack(message, { awayMs, addressed: false });

    // 6. offline chat: a second human in the channel ends Vexo's chat with the first
    offlineChat.noteHuman(message);
    // 7. short-term context for later replies (memory only; added after the reply so it isn't duplicated in the prompt)
    chatContext.record(message);
    // a dedicated Q&A channel does not earn points (but it does when it is also the general channel)
    if (isAsk && message.channelId !== config.channels.general) return skip(message, 'no points: #ask channel');
    await handlePoints(message);
  } catch (err) {
    console.error('messageCreate error:', err && err.stack ? err.stack : err);
  }
};

module.exports.resetCounters = () => loggedCount.clear();
