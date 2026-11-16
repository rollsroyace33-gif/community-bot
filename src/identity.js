// Who is talking? The ONE place that decides whether a message comes from the boss.
// Identity is the Discord user ID only. Names, roles or "I'm the boss" in a message never count,
// so nobody gets special treatment by claiming to be the boss.
//   HΛVØCZ:        the boss is BOSS_USER_ID (.env)
//   other servers: the boss is that server's boss_user_id (the admin who set Vexo up; /setup can change it)
// The boss of one server is a regular member in every other server.
const config = require('./config');
const guilds = require('./guilds');

const norm = (id) => String(id ?? '').trim();

// user:  a Discord User / GuildMember / Interaction user, or a plain ID string
// guild: a guild id, or anything from that server (Message, Interaction, Guild). Left out = HΛVØCZ.
function isBoss(user, guild) {
  const id = norm(typeof user === 'object' && user !== null ? user.id : user);
  const bossId = norm(guilds.settings(guild).bossUserId);
  return !!bossId && id === bossId;
}

// Startup check, no secrets: says whether BOSS_USER_ID is set and how long it is.
function checkBossConfig() {
  const raw = process.env.BOSS_USER_ID;
  const id = config.bossUserId;
  if (!id) {
    console.warn('⚠️  BOSS_USER_ID is empty: Vexo will not recognize the boss anywhere (chat, control channel, games).');
    console.warn('   Fix: Discord > Settings > Advanced > Developer Mode ON, right-click your name > Copy User ID,');
    console.warn('   then put it in .env as BOSS_USER_ID=1234567890 (no quotes, no spaces) and restart.');
    return false;
  }
  const ok = /^\d{17,20}$/.test(id);
  console.log(`BOSS_USER_ID: set, ${id.length} characters, ${ok ? 'looks valid' : 'DOES NOT look like a Discord user ID'}`);
  if (raw !== raw.trim()) console.warn('⚠️  BOSS_USER_ID has spaces around it in .env. They are ignored, but please remove them.');
  if (!ok) {
    console.warn('⚠️  BOSS_USER_ID should be 17-20 digits only. Check .env for quotes, spaces, a "<@...>" mention or a username');
    console.warn('   instead of the numeric ID (Developer Mode ON, right-click your name > Copy User ID).');
  }
  return ok;
}

// Debug log when the boss is detected (channel only, never message content). Once a minute per
// channel, so a chatty boss doesn't flood the console.
const lastNote = new Map();
function noteBoss(message, where) {
  const now = Date.now();
  if (now - (lastNote.get(message.channelId) || 0) < 60 * 1000) return;
  lastNote.set(message.channelId, now);
  console.debug(`[debug] boss message detected in channel ${message.channelId} (${where})`);
}

module.exports = { isBoss, checkBossConfig, noteBoss };
