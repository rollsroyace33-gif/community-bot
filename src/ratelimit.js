const config = require('./config');
const guilds = require('./guilds');

const hits = new Map(); // `${guildId}:${userId}` -> timestamps

// Max QA_PER_HOUR casual AI chat replies per member per hour, counted per server (keeps API cost under control).
// The home server (HΛVØCZ) has no limit. Real questions Vexo routes (floor, price, mint, project...) do not use
// this bucket (they have their own, see unprompted.js).
function recentOf(userId, guildId) {
  const key = `${guilds.gid(guildId)}:${userId}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 3600000);
  hits.set(key, recent);
  return recent;
}
function allowQa(userId, guildId) {
  if (guilds.settings(guildId).isHome) return true;
  const recent = recentOf(userId, guildId);
  if (recent.length >= config.qa.perHour) return false;
  recent.push(Date.now());
  return true;
}
// how many of this member's casual AI replies are counted this hour (for log lines)
const qaUsed = (userId, guildId) => recentOf(userId, guildId).length;

module.exports = { allowQa, qaUsed, _test: { reset: () => hits.clear() } };
