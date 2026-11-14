const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const ai = require('../ai');
const { allowQa } = require('../ratelimit');
const identity = require('../identity');
const guilds = require('../guilds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask a question about the community')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const guildId = guilds.gid(interaction);
    const isBoss = identity.isBoss(interaction.user, interaction); // same user-ID check as chat; the boss is never rate limited
    if (!isBoss && !allowQa(interaction.user.id, guildId)) {
      return interaction.reply({ content: 'Please ask again a little later (questions are limited per hour).', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();
    try {
      const answer = await ai.answerQuestion(interaction.options.getString('question'), { isBoss, guildId });
      await interaction.editReply({ content: answer.slice(0, 1900), allowedMentions: { parse: [] } });
    } catch (e) {
      if (e.code === 'AI_LIMIT') return interaction.editReply('Vexo has answered a lot today and needs a rest. Please try again tomorrow ⏳');
      console.error('ask:', e.message);
      await interaction.editReply('The AI is not working right now, please try again later.');
    }
  },
};
