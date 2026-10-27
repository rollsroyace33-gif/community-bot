const config = require('../config');
const points = require('../points');

module.exports = async function onReactionAdd(reaction, user) {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    if (!message.guild) return;
    if (message.author.bot || message.author.id === user.id) return; // no self / bot reactions
    if (config.filters.excludedChannels.includes(message.channelId)) return;
    if (config.channels.ask && message.channelId === config.channels.ask) return;

    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member || !points.isEligible(member, member.user)) return;

    await points.recordReaction(message.id, user.id);
  } catch (err) {
    console.error('reactionAdd error:', err.message);
  }
};
