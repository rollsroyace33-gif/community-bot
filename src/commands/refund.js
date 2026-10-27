const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const marketplace = require('../marketplace');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refund')
    .setDescription('[Admin] Refund the points for a pending purchase')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) => o.setName('purchase_id').setDescription('Purchase ID').setRequired(true)),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = interaction.options.getInteger('purchase_id');
    const r = await marketplace.refundPurchase(interaction.client, id);
    if (!r.ok) return interaction.editReply(r.message);
    await interaction.editReply(`✅ Purchase #${id} has been refunded: ${r.price} points returned to <@${r.user_id}>.`);
  },
};
