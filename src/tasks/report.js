const guilds = require('../guilds');
const { getTextChannel } = require('../utils');

// Send a message to the private control channel of ONE server (boss/staff only). Never pings anyone.
// guildId left out = HΛVØCZ.
async function report(client, content, guildId) {
  try {
    const s = guilds.settings(guildId);
    const channel = await getTextChannel(client, s.channels.control);
    if (!channel) return console.warn(s.isHome ? 'control report skipped: CONTROL_CHANNEL_ID is not set or not reachable' : `control report skipped: guild ${s.guildId} has no reachable control channel`);
    await channel.send({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('control report:', err.message);
  }
}

// same, with the server first (used by the games, which always know their server)
const reportTo = (guildId, client, content) => report(client, content, guildId);

module.exports = { report, reportTo };
