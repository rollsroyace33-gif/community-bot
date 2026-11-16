// The bot was added to a server: create (or re-activate) its row, start its one-time trial, and run the
// automatic setup. Nothing happens for HΛVØCZ. Never throws.
const guilds = require('../guilds');
const setup = require('../setup');

module.exports = async function onGuildCreate(guild) {
  try {
    if (guilds.isHome(guild.id)) return;
    const before = guilds.get(guild.id);
    const { created } = await guilds.join(guild); // an old row is kept: a server only ever gets one trial
    // Discord also sends this event when a server comes back after an outage: then the bot was never
    // removed, so nothing is announced again (missing channels are still re-created, quietly).
    const reAdded = !created && before?.status === 'left';
    console.log(`[guild] joined ${guild.id} (${created ? 'new server, trial started' : reAdded ? 'added again, no new trial' : 'already known'})`);
    await setup.run(guild, { welcome: created || reAdded });
  } catch (err) {
    console.error(`guildCreate ${guild?.id}:`, err.message);
  }
};
