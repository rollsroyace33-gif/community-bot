const points = require('../points');
const guilds = require('../guilds');
const plans = require('../plans');

module.exports = async function onReactionAdd(reaction, user) {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    if (!message.guild) return;
    if (!plans.hasFeature(message, 'points')) return; // points are a premium feature (HΛVØCZ: always on)
    const s = guilds.settings(message);
    if (message.author.bot || message.author.id === user.id) return; // no self / bot reactions
    if (s.excludedChannels.includes(message.channelId)) return;
    if (s.channels.ask && message.channelId === s.channels.ask) return;

    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member || !points.isEligible(member, member.user, message)) return;

    await points.recordReaction(message.id, user.id, s.guildId);
  } catch (err) {
    console.error('reactionAdd error:', err.message);
  }
};
