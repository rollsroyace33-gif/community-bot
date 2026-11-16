// "This feature has no channel" notes for the admins / boss, sent ONCE per server and feature.
//
// A feature without a channel never falls back to another channel: it skips posting (see guilds.getFeatureChannel).
// So the admins are told once, in the logs channel only (never control, general or the shop). It is remembered in
// the server's guilds row (settings.channelNotices), so a restart or redeploy does not repeat it. When the channel
// is set again the note is forgotten, so a channel that goes missing later is reported again (once).
// No logs channel either = the note goes to the bot log (console) only.
const guilds = require('./guilds');
const { getTextChannel } = require('./utils');

const notesOf = (guildId) => guilds.get(guildId)?.settings?.channelNotices || {};

// -> true when the note was recorded now (first time), false when it was already told
async function missingChannelOnce(client, guildId, feature, label) {
  try {
    const row = guilds.get(guildId);
    if (!row) return false;
    const notes = notesOf(guildId);
    if (notes[feature]) return false;
    await guilds.patchSettings(guildId, { channelNotices: { ...notes, [feature]: new Date().toISOString() } });
    const s = guilds.settings(guildId);
    const how = s.isHome ? 'Choose one with **/setup** (or press **Create missing channels** there).' : 'Choose one with **/setup**.';
    console.warn(`[notices] guild ${guildId}: ${label} has no channel, nothing is posted`);
    const ch = await getTextChannel(client, guilds.logsChannelId(s));
    if (ch) {
      const boss = s.bossUserId ? `<@${s.bossUserId}> ` : '';
      await ch.send({ content: `${boss}⚠️ **${label}** has no channel in this server, so nothing is posted for it. ${how} (I say this once.)`, allowedMentions: { users: s.bossUserId ? [s.bossUserId] : [] } }).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error('[notices]', err.message);
    return false;
  }
}

// the channel is set again: forget the note (no database write when there is nothing to forget)
async function channelBack(guildId, feature) {
  try {
    const notes = notesOf(guildId);
    if (!notes[feature]) return;
    const next = { ...notes };
    delete next[feature];
    await guilds.patchSettings(guildId, { channelNotices: next });
  } catch (err) {
    console.error('[notices]', err.message);
  }
}

module.exports = { missingChannelOnce, channelBack };
