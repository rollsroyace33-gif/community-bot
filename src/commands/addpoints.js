const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const points = require('../points');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addpoints')
    .setDescription('[Admin] Give points to a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Number of points').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const reason = interaction.options.getString('reason') || 'admin add';
    const bal = await points.adjustPoints(user.id, amount, `admin: ${reason}`);
    await interaction.editReply(`✅ Gave +${amount} points to <@${user.id}>. New balance: **${bal}**`);
  },
};
