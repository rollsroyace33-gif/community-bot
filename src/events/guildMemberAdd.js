const config = require('../config');
const personality = require('../personality');
const { getTextChannel } = require('../utils');

// Needs the GuildMembers intent (index.js) AND "Server Members Intent" ON in the Developer Portal.

const REWELCOME_MS = 24 * 60 * 60 * 1000; // leave + rejoin within 24h = no second welcome
const BULK_WINDOW_MS = 60 * 1000;
const BULK_THRESHOLD = 3; // more than 3 joins within 60s = bulk join / raid

const welcomed = new Map(); // userId -> timestamp of their welcome (in memory, resets on restart)
let recentJoins = []; // join timestamps inside the current window
let bulkQueue = []; // userIds waiting for the combined welcome
let bulkTimer = null;

// Post in the welcome channel, pinging only the given users. Never DMs anyone.
async function post(client, content, userIds) {
  const channel = await getTextChannel(client, config.channels.welcome);
  if (!channel) return console.error('welcome: cannot find WELCOME_CHANNEL_ID or it is not a text channel');
  await channel.send({ content, allowedMentions: { users: userIds } });
}

// One combined welcome for everyone collected during a bulk join
async function flushBulk(client) {
  bulkTimer = null;
  const ids = bulkQueue;
  bulkQueue = [];
  if (!ids.length) return;
  try {
    await post(client, await personality.groupWelcomeLine(ids), ids.slice(0, 5));
  } catch (err) {
    console.error('bulk welcome error:', err.message);
  }
}

module.exports = async function onGuildMemberAdd(member) {
  try {
    if (member.user.bot || !config.channels.welcome) return;
    if (config.guildId && member.guild.id !== config.guildId) return;

    const now = Date.now();
    for (const [id, t] of welcomed) if (now - t > REWELCOME_MS) welcomed.delete(id); // keep the map small
    if (welcomed.has(member.id)) return;
    welcomed.set(member.id, now);

    recentJoins = recentJoins.filter((t) => now - t < BULK_WINDOW_MS);
    recentJoins.push(now);

    // bulk join: queue them and send ONE message when the window closes
    if (recentJoins.length > BULK_THRESHOLD) {
      bulkQueue.push(member.id);
      if (!bulkTimer) bulkTimer = setTimeout(() => flushBulk(member.client), BULK_WINDOW_MS);
      return;
    }

    await post(member.client, await personality.welcomeLine(member.id), [member.id]);
  } catch (err) {
    console.error('guildMemberAdd error:', err.message);
  }
};
