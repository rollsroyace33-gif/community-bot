// The bot was removed from a server (or the server was deleted). Its row and all its data are KEPT,
// only marked as "left", so nothing is lost and the trial cannot be taken again by re-adding the bot.
const guilds = require('../guilds');

module.exports = async function onGuildDelete(guild) {
  try {
    if (!guild?.id || guild.available === false) return; // a Discord outage, not a removal
    if (guilds.isHome(guild.id)) return;
    await guilds.leave(guild.id);
    console.log(`[guild] left ${guild.id} (row kept)`);
  } catch (err) {
    console.error(`guildDelete ${guild?.id}:`, err.message);
  }
};
