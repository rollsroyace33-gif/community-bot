const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const supabase = require('../db');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pending')
    .setDescription('[Admin] Purchases that have not been delivered yet')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { data } = await supabase.from('purchases').select('*').eq('status', 'pending').order('id').limit(25);
    if (!data || data.length === 0) return interaction.editReply('No pending purchases 🎉');
    const lines = data.map((p) => {
      const t = p.ticket_channel_id && p.ticket_channel_id !== 'creating' ? `<#${p.ticket_channel_id}>` : 'no ticket opened';
      return `**#${p.id}** <@${p.user_id}> — ${p.item_name} (${p.price}pts) — ${t}`;
    });
    await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
  },
};
