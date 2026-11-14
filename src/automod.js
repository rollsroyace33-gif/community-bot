// Auto mod (premium, rule-based, ZERO AI calls). Every rule is OFF until an admin switches it on with
// /automod, in every server including HΛVØCZ.
// Scam protection is a separate part with its own switch (src/scam.js); it runs first, from handle() below.
//   spam     too many messages in a few seconds, or the same message repeated
//   mentions mass mentions in one message
//   invites  Discord invite links
//   words    the server's blocked words list
//   links    any link whose site is not on the server's allowed list
// Action (one per server): delete | warn (delete + a short notice) | timeout (delete + notice + timeout).
// Everything is logged to the server's logs channel. Admins, moderators and the boss are never moderated.
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const guilds = require('./guilds');
const plans = require('./plans');
const identity = require('./identity');
const { getTextChannel } = require('./utils');

const RULES = {
  spam: 'Spam and repeated messages',
  mentions: 'Mass mentions',
  invites: 'Discord invite links',
  words: 'Blocked words',
  links: 'Links not on the allowed list',
};
const ACTIONS = ['delete', 'warn', 'timeout'];
const DEFAULTS = { action: 'delete', timeoutMinutes: 10, blockedWords: [], allowedDomains: [] };

const SPAM_WINDOW_MS = 8000;
const SPAM_MAX = 5; // messages in the window
const REPEAT_WINDOW_MS = 30000;
const REPEAT_MAX = 3; // same text
const MENTION_MAX = 6;
const ALWAYS_ALLOWED = ['discord.com', 'discordapp.com', 'discordapp.net', 'tenor.com', 'giphy.com'];
const INVITE_RE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const LINK_RE = /https?:\/\/([^\s/<>()]+)/gi;

// settings with defaults filled in
function rules(guildId) {
  const a = guilds.settings(guildId).automod || {};
  return {
    ...DEFAULTS,
    ...a,
    action: ACTIONS.includes(a.action) ? a.action : DEFAULTS.action,
    blockedWords: Array.isArray(a.blockedWords) ? a.blockedWords : [],
    allowedDomains: Array.isArray(a.allowedDomains) ? a.allowedDomains : [],
  };
}
const anyRuleOn = (r) => Object.keys(RULES).some((k) => r[k] === true);

function isExempt(message) {
  if (identity.isBoss(message.author, message)) return true;
  const perms = message.member?.permissions;
  return !!perms?.has?.(PermissionFlagsBits.ManageGuild) || !!perms?.has?.(PermissionFlagsBits.ManageMessages) || !!perms?.has?.(PermissionFlagsBits.Administrator);
}

const recent = new Map(); // `${guildId}:${userId}` -> [{ at, text }]

// which rule a message breaks: { rule, detail } or null. Pure (no Discord calls), so it is easy to test.
function verdict(message, r, now = Date.now()) {
  const text = String(message.content || '');
  const lower = text.toLowerCase();
  if (r.invites && INVITE_RE.test(text)) return { rule: 'invites', detail: 'Discord invite link' };
  if (r.mentions) {
    const count = (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0);
    if (count >= MENTION_MAX || (message.mentions?.everyone && count >= 1)) return { rule: 'mentions', detail: `${count} mentions` };
  }
  if (r.words) {
    const hit = r.blockedWords.find((w) => w && new RegExp(`(^|[^\\p{L}\\p{N}])${String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(lower));
    if (hit) return { rule: 'words', detail: 'blocked word' };
  }
  if (r.links) {
    const allowed = [...ALWAYS_ALLOWED, ...r.allowedDomains.map((d) => String(d).toLowerCase())];
    for (const m of text.matchAll(LINK_RE)) {
      const host = m[1].toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
      if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) return { rule: 'links', detail: `link to ${host}` };
    }
  }
  if (r.spam) {
    const key = `${guilds.gid(message)}:${message.author.id}`;
    const list = (recent.get(key) || []).filter((m) => now - m.at < REPEAT_WINDOW_MS);
    list.push({ at: now, text: lower.trim() });
    recent.set(key, list.slice(-12));
    if (list.filter((m) => now - m.at < SPAM_WINDOW_MS).length >= SPAM_MAX) return { rule: 'spam', detail: `${SPAM_MAX}+ messages in ${SPAM_WINDOW_MS / 1000}s` };
    const t = lower.trim();
    if (t.length >= 3 && list.filter((m) => m.text === t).length >= REPEAT_MAX) return { rule: 'spam', detail: 'same message repeated' };
  }
  return null;
}

async function log(message, s, found, done) {
  const ch = await getTextChannel(message.client, s.channels.logs || s.channels.redeemLogs);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setTitle('🛡️ Auto mod')
    .setColor(0xe67e22)
    .addFields(
      { name: 'Member', value: `<@${message.author.id}> (${message.author.id})`, inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Rule', value: `${RULES[found.rule]} (${found.detail})`, inline: false },
      { name: 'Action', value: done.join(', ') || 'none (missing permission)', inline: false },
      { name: 'Message', value: (message.content || '(no text)').slice(0, 900) }
    )
    .setTimestamp();
  await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((e) => console.error('automod log:', e.message));
}

// true = the message broke a rule and was handled (nothing else should answer it or give points for it).
// Never throws.
async function handle(message) {
  try {
    if (!message.guild || message.author.bot) return false;
    if (!plans.hasFeature(message, 'automod')) return false;
    const s = guilds.settings(message);
    const r = rules(s.guildId);
    if (s.channels.control && message.channelId === s.channels.control) return false;
    // scam protection first (scam.js: its own on/off switch and its own "never touched" list)
    if (await require('./scam').handle(message)) return true;
    if (!anyRuleOn(r)) return false; // nothing switched on (the default everywhere)
    if (isExempt(message)) return false;
    const found = verdict(message, r);
    if (!found) return false;

    const done = [];
    await message.delete().then(() => done.push('message deleted')).catch((e) => console.error('automod delete:', e.message));
    if (r.action === 'warn' || r.action === 'timeout') {
      const note = await message.channel
        .send({ content: `⚠️ <@${message.author.id}>, that is not allowed here (${RULES[found.rule].toLowerCase()}).`, allowedMentions: { users: [message.author.id] } })
        .catch(() => null);
      if (note) {
        done.push('warned');
        setTimeout(() => note.delete().catch(() => {}), 10000).unref?.();
      }
    }
    if (r.action === 'timeout') {
      const minutes = Math.min(Math.max(1, Number(r.timeoutMinutes) || DEFAULTS.timeoutMinutes), 40320);
      await message.member
        ?.timeout(minutes * 60 * 1000, `Vexo auto mod: ${RULES[found.rule]}`)
        .then(() => done.push(`timeout ${minutes} min`))
        .catch((e) => console.error('automod timeout:', e.message));
    }
    await log(message, s, found, done);
    return true;
  } catch (err) {
    console.error('automod:', err.message);
    return false;
  }
}

module.exports = { handle, rules, verdict, RULES, ACTIONS, DEFAULTS, _test: { recent } };
