// Unprompted Q&A: a member asks a real question about the project (or about Vexo) in a normal chat channel
// WITHOUT mentioning Vexo. replies.js asks check() first; only when it says yes does one AI call run, and the
// AI still decides from the meaning (casual chat -> NO_REPLY -> silence).
//
// Cheap code checks first, so ordinary chat never costs an AI call:
//   1. the server has Knowledge Q&A (HΛVØCZ: always; customer servers: premium / trial)
//   2. an allowed chat channel (never logs, control, shop, rumble, giveaways, radar, X posts, welcome, rules,
//      tickets, receipts, excluded channels; only CHAT_CHANNEL_IDS when that list is set)
//   3. not talking to another person (no mention of / reply to another member)
//   4. looks like a question (a "?" or a question word first) AND is about the project / Vexo
//   5. one unprompted answer attempt per channel every CHANNEL_COOLDOWN_MS (anti-spam, cost)
// The per-member hourly limit (QA_PER_HOUR, ratelimit.js) still applies afterwards in replies.js.
const { ChannelType } = require('discord.js');
const guilds = require('./guilds');
const plans = require('./plans');
const clock = require('./clock');
const { isAboutVexo } = require('./aboutVexo');

const CHANNEL_COOLDOWN_MS = 15 * 1000;
const lastTry = new Map(); // `${guildId}:${channelId}` -> timestamp

const strip = (text) =>
  String(text || '')
    .replace(/<a?:\w+:\d+>/g, ' ') // custom emoji
    .replace(/<@[!&]?\d+>|<#\d+>/g, ' ') // mentions
    .replace(/https?:\/\/\S+/g, ' ') // links
    .replace(/\s+/g, ' ')
    .trim();

const QUESTION_START =
  /^(what|whats|what's|wat|when|wen|where|who|whom|whose|why|how|which|is|are|was|were|will|would|can|could|do|does|did|should|shall|has|have|any|anyone|anybody|tell me|explain|pls|please)\b/i;
function looksLikeQuestion(text) {
  const t = strip(text);
  if (t.length < 6 || t.length > 400) return false;
  return t.includes('?') || QUESTION_START.test(t);
}

// project words (any server). The server's own name counts too.
const PROJECT_TOPIC =
  /\b(mint(s|ing|ed)?|wl|whitelist|allow ?list|og|presale|pre-sale|supply|price|floor|collection|nfts?|roadmap|phases?|rules?|points?|marketplace|shop|redeem|stak(e|ing)|tokens?|airdrop|launch(es|ing)?|reveal|team|founders?|lore|story|giveaways?|rumble|guess game|holders?|utility|utilities|website|site|socials|twitter|x post|roles?|verif(y|ied|ication)|tickets?|raffle|rewards?|earn(ing)?|partners?(hip)?|collab|announcements?|project|community|ecosystem|chain|solana|sol|event|events|benefits?)\b/i;
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').replace(/λ/g, 'a').replace(/ø/g, 'o');
function aboutProject(text, serverName) {
  const t = strip(text);
  if (PROJECT_TOPIC.test(t)) return true;
  const name = fold(serverName);
  return name.length >= 3 && fold(t).includes(name);
}

// a normal chat channel of this server where unprompted answers are allowed
function isQaChannel(message, s = guilds.settings(message)) {
  const ch = message.channel;
  if (!ch || (ch.type !== ChannelType.GuildText && ch.type !== undefined)) return false; // text channels only (no threads, voice, announcements)
  const c = s.channels || {};
  const blocked = [c.marketplace, c.redeemLogs, c.logs, c.control, c.welcome, c.rules, c.ticket, c.receipts, c.xDrop, c.rumble, c.giveaway, c.nftRadar, c.solRadar, c.assistant].filter(Boolean);
  if (blocked.includes(message.channelId)) return false;
  if ((s.excludedChannels || []).includes(message.channelId)) return false;
  if (c.ticketCategory && ch.parentId === c.ticketCategory) return false;
  if (/^ticket-|log/i.test(ch.name || '')) return false; // ticket channels, vexo-logs and other log channels
  if (s.chatChannelIds && s.chatChannelIds.length) return s.chatChannelIds.includes(message.channelId);
  return true;
}

// talking to another person: mentions a member, or replies to someone who is not Vexo
function talksToSomeoneElse(message) {
  const botId = message.client?.user?.id;
  const others = [...(message.mentions?.users?.keys?.() || [])].filter((id) => id !== botId);
  if (others.length) return true;
  const replied = message.mentions?.repliedUser;
  return !!replied && replied.id !== botId;
}

// -> { ok: true, aboutVexo } or { ok: false, reason }. Nothing is remembered unless ok (then the channel cooldown starts).
function check(message) {
  if (message.author?.bot) return { ok: false, reason: 'author is a bot' };
  const s = guilds.settings(message);
  if (!plans.hasFeature(message, 'knowledgeQa')) return { ok: false, reason: 'Knowledge Q&A not available in this server (plan)' };
  if (!isQaChannel(message, s)) return { ok: false, reason: 'not an allowed chat channel' };
  if (talksToSomeoneElse(message)) return { ok: false, reason: 'talking to someone else' };
  const text = message.content || '';
  if (!looksLikeQuestion(text)) return { ok: false, reason: 'not a question' };
  const vexo = isAboutVexo(text);
  if (!vexo && !aboutProject(text, s.name)) return { ok: false, reason: 'question not about the project or Vexo' };
  const key = `${s.guildId}:${message.channelId}`;
  const now = clock.now();
  if (now - (lastTry.get(key) || 0) < CHANNEL_COOLDOWN_MS) return { ok: false, reason: 'channel cooldown for unprompted answers' };
  lastTry.set(key, now);
  return { ok: true, aboutVexo: vexo };
}

module.exports = { check, looksLikeQuestion, aboutProject, isQaChannel, talksToSomeoneElse, CHANNEL_COOLDOWN_MS, _test: { reset: () => lastTry.clear() } };
