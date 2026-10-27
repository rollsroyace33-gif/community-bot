const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const marketplace = require('../marketplace');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setupmarketplace')
    .setDescription('[Admin] Post the marketplace header (with My Points button) at the top')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const count = await marketplace.setupHeader(interaction.client);
      await interaction.editReply(`✅ Marketplace header posted. ${count} item card(s) reposted below it.`);
    } catch (e) {
      await interaction.editReply(`Could not set up the marketplace: ${e.message}`);
    }
  },
};
