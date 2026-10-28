// Is the boss talking to Vexo? The ONE gate for every reply to a boss message (all channels, all
// reply handlers). messageCreate.js calls it right after the "ignore bots / DMs" check; the control
// channel order flow and points do not depend on it.
//
// A boss message (author id === BOSS_USER_ID) is for Vexo ONLY when:
//   (a) it mentions the Vexo bot user (<@botId>), or
//   (b) it is a Discord reply to a message written by Vexo, or
//   (c) it starts with "vexo" as a direct address: "vexo, ...", "hey vexo ...", "yo vexo", "@vexo ..."
// Everything else (a reply to another member, mentioning someone else or a role, normal chat, "gm",
// "lol", an emoji, ...) gets NOTHING from Vexo: no text, no reaction.
const identity = require('./identity');

// (c) "vexo" first, optionally after a short greeting word or "@". "vexo is wild" / "vexo's ..."
// talks ABOUT Vexo (to others), not to it.
const DIRECT_ADDRESS =
  /^\s*(?:(?:hey|hi|hello|yo|oi|ok|okay|oye|ey|bro|so|and|sup|gm|gn|good\s+(?:morning|night))[\s,!.]+)?@?vexo\b(?!['’]s\b)(?!\s+(?:is|was|has|had|seems|looks|and|did|does|will|can|could|would|just|really|kinda|tbh)\b)/i;
const callsVexoByName = (text) => DIRECT_ADDRESS.test(String(text || ''));

// Author id of the message this one replies to (null = not a reply / unknown). discord.js fills
// mentions.repliedUser from the referenced message; otherwise use the cache, then fetch it once.
// Memoized per message, so the gate and the reply handlers never fetch twice.
const replyAuthor = new WeakMap();
function repliedAuthorId(message) {
  if (!replyAuthor.has(message)) replyAuthor.set(message, lookupRepliedAuthor(message));
  return replyAuthor.get(message);
}
async function lookupRepliedAuthor(message) {
  const known = message.mentions?.repliedUser?.id;
  if (known) return String(known);
  const ref = message.reference;
  if (!ref?.messageId) return null;
  if (ref.type !== undefined && ref.type !== 0) return null; // 0 = reply; 1 = a forwarded message, not a reply
  try {
    const cached = message.channel?.messages?.cache?.get(ref.messageId);
    const referenced = cached || (await message.fetchReference());
    return referenced?.author?.id ? String(referenced.author.id) : null;
  } catch {
    return null; // deleted / no access: we can't tell it was Vexo, so treat it as not for Vexo
  }
}

// 'mention' | 'reply' | 'name' when the message is addressed to Vexo, otherwise null
async function addressedVia(message, client) {
  const botId = String(client?.user?.id || message.client?.user?.id || '').trim();
  if (!botId) return null;
  const mentionsBot =
    !!message.mentions?.users?.has?.(botId) || new RegExp(`<@!?${botId}>`).test(message.content || '');
  if (mentionsBot) return 'mention';
  if ((await repliedAuthorId(message)) === botId) return 'reply';
  if (callsVexoByName(message.content)) return 'name';
  return null;
}

// The boss is talking to someone else: a reply to another member's message, or a user / role mention
// that is not Vexo. Used to keep even the welcome-back line out of those conversations.
async function bossTalksToOthers(message, client) {
  const botId = String(client?.user?.id || message.client?.user?.id || '').trim();
  const replied = await repliedAuthorId(message);
  if (replied && replied !== botId) return true;
  const users = [...(message.mentions?.users?.keys?.() || [])].some((id) => String(id) !== botId);
  return users || (message.mentions?.roles?.size || 0) > 0 || /<@&\d+>/.test(message.content || '');
}

// THE gate. true = Vexo may reply to this message. Messages from anyone but the boss always pass
// (members keep their normal rules). Logs why a boss message is ignored (no content, no ids but the channel).
async function shouldVexoHandleBossMessage(message, client) {
  if (!identity.isBoss(message.author)) return true; // compares trimmed id strings with BOSS_USER_ID
  if (await addressedVia(message, client)) return true;

  let reason = 'not addressed to Vexo';
  const botId = String(client?.user?.id || message.client?.user?.id || '');
  const replied = await repliedAuthorId(message);
  if (replied && replied !== botId) reason = 'reply to another member';
  else if (await bossTalksToOthers(message, client)) reason = 'mentions another member or a role';
  console.debug(`[debug] boss message ignored: ${reason} (channel ${message.channelId})`);
  return false;
}

module.exports = { shouldVexoHandleBossMessage, addressedVia, bossTalksToOthers, callsVexoByName };
