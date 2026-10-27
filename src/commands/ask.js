const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const ai = require('../ai');
const { allowQa } = require('../ratelimit');
const identity = require('../identity');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask a question about the community')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const isBoss = identity.isBoss(interaction.user); // same user-ID check as chat; the boss is never rate limited
    if (!isBoss && !allowQa(interaction.user.id)) {
      return interaction.reply({ content: 'Please ask again a little later (questions are limited per hour).', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();
    try {
      const answer = await ai.answerQuestion(interaction.options.getString('question'), { isBoss });
      await interaction.editReply({ content: answer.slice(0, 1900), allowedMentions: { parse: [] } });
    } catch (e) {
      console.error('ask:', e.message);
      await interaction.editReply('The AI is not working right now, please try again later.');
    }
  },
};
