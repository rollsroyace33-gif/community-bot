const { SlashCommandBuilder } = require('discord.js');
const marketplace = require('../marketplace');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Open a ticket for your purchase')
    .addIntegerOption((o) => o.setName('purchase_id').setDescription('Purchase ID (e.g. 42)').setRequired(true)),
  async execute(interaction) {
    await marketplace.handleOpenTicket(interaction, interaction.options.getInteger('purchase_id'));
  },
};
