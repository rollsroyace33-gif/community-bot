const config = require('./config');
const guilds = require('./guilds');

const hits = new Map(); // `${guildId}:${userId}` -> timestamps

// Max N AI questions per user per hour, counted per server (keeps API cost under control)
function allowQa(userId, guildId) {
  const key = `${guilds.gid(guildId)}:${userId}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 3600000);
  if (recent.length >= config.qa.perHour) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

module.exports = { allowQa };
