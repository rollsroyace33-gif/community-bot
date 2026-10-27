const config = require('../config');
const { getTextChannel } = require('../utils');

// Send a message to the private control channel (boss/staff only). Never pings anyone.
async function report(client, content) {
  try {
    const channel = await getTextChannel(client, config.channels.control);
    if (!channel) return console.warn('control report skipped: CONTROL_CHANNEL_ID is not set or not reachable');
    await channel.send({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('control report:', err.message);
  }
}

module.exports = { report };
