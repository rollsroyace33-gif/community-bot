const personality = require('../personality');
const { getTextChannel } = require('../utils');
const guilds = require('../guilds');

// Needs the GuildMembers intent (index.js) AND "Server Members Intent" ON in the Developer Portal.
//
// New-member welcomes in EVERY server that has a welcome channel: chosen in /setup, and in HΛVØCZ the
// WELCOME_CHANNEL_ID as fallback. No welcome channel = no welcome (never another channel). The AI line goes
// through that server's plan and daily AI limit; without AI a pre-written line is used.

const REWELCOME_MS = 24 * 60 * 60 * 1000; // leave + rejoin within 24h = no second welcome
const BULK_WINDOW_MS = 60 * 1000;
const BULK_THRESHOLD = 3; // more than 3 joins within 60s = bulk join / raid

const welcomed = new Map(); // "guildId:userId" -> timestamp of their welcome (in memory, resets on restart)
const perGuild = new Map(); // guildId -> { recentJoins: [], bulkQueue: [], bulkTimer }
const stateOf = (guildId) => {
  if (!perGuild.has(guildId)) perGuild.set(guildId, { recentJoins: [], bulkQueue: [], bulkTimer: null });
  return perGuild.get(guildId);
};

// this server's welcome channel (/setup first; HΛVØCZ: WELCOME_CHANNEL_ID as fallback)
const welcomeChannelId = (guildId) => guilds.getFeatureChannel(guildId, 'welcome');

// Post in the welcome channel, pinging only the given users. Never DMs anyone.
async function post(client, guildId, content, userIds) {
  const channel = await getTextChannel(client, welcomeChannelId(guildId));
  if (!channel) return console.error(`welcome (guild ${guildId}): cannot find the welcome channel (/setup${guilds.isHome(guildId) ? ' or WELCOME_CHANNEL_ID' : ''}) or it is not a text channel`);
  await channel.send({ content, allowedMentions: { users: userIds } });
}

// One combined welcome for everyone collected during a bulk join in one server
async function flushBulk(client, guildId) {
  const st = stateOf(guildId);
  st.bulkTimer = null;
  const ids = st.bulkQueue;
  st.bulkQueue = [];
  if (!ids.length) return;
  try {
    await post(client, guildId, await personality.groupWelcomeLine(ids, guildId), ids.slice(0, 5));
  } catch (err) {
    console.error('bulk welcome error:', err.message);
  }
}

module.exports = async function onGuildMemberAdd(member) {
  try {
    const guildId = String(member.guild.id);
    if (member.user.bot || !welcomeChannelId(guildId)) return;
    if (!guilds.settings(guildId).known) return; // a server the bot has no row for

    const now = Date.now();
    for (const [k, t] of welcomed) if (now - t > REWELCOME_MS) welcomed.delete(k); // keep the map small
    const key = `${guildId}:${member.id}`;
    if (welcomed.has(key)) return;
    welcomed.set(key, now);

    const st = stateOf(guildId);
    st.recentJoins = st.recentJoins.filter((t) => now - t < BULK_WINDOW_MS);
    st.recentJoins.push(now);

    // bulk join: queue them and send ONE message when the window closes
    if (st.recentJoins.length > BULK_THRESHOLD) {
      st.bulkQueue.push(member.id);
      if (!st.bulkTimer) st.bulkTimer = setTimeout(() => flushBulk(member.client, guildId), BULK_WINDOW_MS);
      return;
    }

    await post(member.client, guildId, await personality.welcomeLine(member.id, guildId), [member.id]);
  } catch (err) {
    console.error('guildMemberAdd error:', err.message);
  }
};
