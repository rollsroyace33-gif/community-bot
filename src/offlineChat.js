// Offline chat (section 3): during the boss's usual offline window, Vexo chats with a member who shows
// up in a QUIET chat channel, like a friendly server member. Rules:
//   - only while isBossOffline(), only in chat channels, only when nobody else wrote there for
//     OFFLINE_QUIET_MINUTES (a "session" with that one member starts)
//   - at most OFFLINE_CHAT_MAX_LINES short lines, never a question, never a proactive message
//   - after OFFLINE_CHAT_SOFT_REPLIES replies Vexo only answers when the member keeps addressing it
//     (those messages go through the normal conversation path)
//   - another human writes in the channel -> the session ends, Vexo steps back
//   - no replies to walls of text (> 500 chars), link-only, repeated or mention-heavy messages
// Everything here is memory only (nothing about members is stored).
const { ChannelType } = require('discord.js');
const config = require('./config');
const clock = require('./clock');
const ai = require('./ai');
const chatContext = require('./chatContext');
const { isBossOffline } = require('./tasks/time');
const { allowQa } = require('./ratelimit');
const T = require('./bossTemplates');
const guilds = require('./guilds');

const MIN_REPLY_GAP_MS = 4000; // tiny per-session cooldown
const recent = new Map(); // channelId -> [{ authorId, at }] recent human messages (last few)
const sessions = new Map(); // channelId -> { userId, replies, lastActivityAt, lastReplyAt, lastText }

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const quietMs = () => config.offline.quietMinutes * 60 * 1000;

// a channel where casual chat with a lone member is OK
function isChatChannel(message) {
  if (config.xDrop.channelId && message.channelId === config.xDrop.channelId) return false; // never chat in the X drop channel
  if (config.chatChannelIds.length) return config.chatChannelIds.includes(message.channelId);
  const ch = message.channel;
  if (!ch || ch.type !== ChannelType.GuildText) return false; // announcement channels, threads, voice: no
  const c = config.channels;
  const excluded = [c.marketplace, c.redeemLogs, c.control, c.ask, c.welcome, c.rules, c.ticket].filter(Boolean);
  if (excluded.includes(message.channelId)) return false;
  if (c.ticketCategory && ch.parentId === c.ticketCategory) return false; // private ticket channels
  if (/^ticket-/i.test(ch.name || '')) return false;
  return true; // (a running game's channel never gets here: the game owns its messages)
}

// Every human message in the guild (call AFTER the reply step): remembers channel activity and ends
// a session when somebody else joins the conversation.
function noteHuman(message) {
  const list = recent.get(message.channelId) || [];
  list.push({ authorId: message.author.id, at: clock.now() });
  if (list.length > 10) list.shift();
  recent.set(message.channelId, list);
  const s = sessions.get(message.channelId);
  if (s && s.userId !== message.author.id) sessions.delete(message.channelId); // step back
}

// nobody but this member wrote in the channel during the last OFFLINE_QUIET_MINUTES
function isQuiet(channelId, userId) {
  const since = clock.now() - quietMs();
  return !(recent.get(channelId) || []).some((m) => m.authorId !== userId && m.at > since);
}

function looksSkippable(message) {
  const text = message.content || '';
  if (text.length > 500) return true; // walls of text
  if (/^\s*(https?:\/\/\S+\s*)+$/i.test(text)) return true; // link-only
  if (message.mentions?.everyone || /@(everyone|here)/i.test(text)) return true;
  if ((message.mentions?.users?.size || 0) > 0 || (message.mentions?.roles?.size || 0) > 0) return true; // talking to someone else
  if (!/\p{L}/u.test(text)) return true; // emoji / symbols only
  return false;
}

// true = Vexo replied. Called only for members' messages that do NOT address Vexo.
// one log line per early return (never logs message content)
const why = (message, reason) => (console.log(`[offline-chat] ${message.id} in #${message.channelId}: ${reason}`), false);

async function handle(message) {
  try {
    // lone-member chat belongs to the boss's offline hours, which only HΛVØCZ has configured
    if (!guilds.settings(message).bossHours) return false;
    const guildId = guilds.gid(message);
    if (!isBossOffline(clock.now())) return why(message, 'skip: outside the boss offline hours window'); // outside the window: behavior unchanged (silence)
    if (!isChatChannel(message)) return why(message, 'skip: not a chat channel (excluded / ticket / X drop / not text)');
    if (looksSkippable(message)) return why(message, 'skip: message looks skippable (link-only, mentions others, emoji, too long)');
    const uid = message.author.id;
    const now = clock.now();

    let s = sessions.get(message.channelId);
    if (s && (s.userId !== uid || now - s.lastActivityAt > quietMs())) {
      sessions.delete(message.channelId);
      s = null;
    }
    if (!s) {
      if (!isQuiet(message.channelId, uid)) return why(message, 'skip: channel not quiet (others are around)'); // others are around: not Vexo's turn
      s = { userId: uid, replies: 0, lastActivityAt: now, lastReplyAt: 0, lastText: '' };
      sessions.set(message.channelId, s);
    }
    s.lastActivityAt = now;
    const norm = message.content.trim().toLowerCase();
    if (norm === s.lastText) return why(message, 'skip: duplicate of the last message'); // spam: the same thing again
    s.lastText = norm;
    // soft limit reached: chat is over unless they address Vexo (normal path). A real HΛVØCZ question
    // is still answered (section 4 is not limited): only question-like messages get that one AI check.
    const pastSoftLimit = s.replies >= config.offline.softReplies;
    if (pastSoftLimit && !norm.includes('?')) return why(message, 'skip: soft reply limit reached, not a question');
    if (now - s.lastReplyAt < MIN_REPLY_GAP_MS) return why(message, 'skip: reply gap cooldown');
    if (!allowQa(uid, guildId)) return why(message, 'skip: QA_PER_HOUR rate limit'); // the existing hourly per-member limit

    let reply;
    const info = {};
    try {
      reply = await ai.converse(message.content.trim(), {
        context: chatContext.get(message.channelId),
        silentIfCasual: pastSoftLimit, // past the limit: casual chat -> no reply
        chatStyle: { maxLines: config.offline.maxLines, noQuestions: true },
        info,
        guildId,
      });
    } catch (err) {
      console.error('offline chat AI:', err.stack);
      reply = pastSoftLimit ? null : pick(T.offlineFallback); // template fallback
    }
    if (!reply || reply === ai.CREATOR_QUESTION) return why(message, 'skip: AI gave no chat reply');
    if (pastSoftLimit && info.kind !== 'answer' && info.kind !== 'unknown') return why(message, 'skip: past soft limit and not a real answer');
    if (!pastSoftLimit) s.replies += 1;
    s.lastReplyAt = now;
    try {
      await message.reply({ content: reply.slice(0, 1900), allowedMentions: { repliedUser: false, parse: [] } });
    } catch (err) {
      console.error('offline chat reply send failed (missing permission?):', err.stack);
      return false;
    }
    chatContext.recordBot(message.channelId, reply);
    return true;
  } catch (err) {
    console.error('offline chat:', err.stack);
    return false;
  }
}

module.exports = {
  handle,
  noteHuman,
  isChatChannel,
  _test: { reset: () => (recent.clear(), sessions.clear()), sessions },
};
