const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const supabase = require('../db');
const marketplace = require('../marketplace');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listitems')
    .setDescription('[Admin] List all active items (with IDs)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { data } = await supabase.from('items').select('*').eq('active', true).order('id').limit(50);
    if (!data || data.length === 0) return interaction.editReply('There are no active items.');

    const health = await Promise.all(data.map((i) => marketplace.cardExists(interaction.client, i)));
    const lines = data.map(
      (i, n) =>
        `**#${i.id}** ${i.name} — ${i.price}pts — stock ${i.stock} — ${i.type} — ${health[n] ? '✅ card ok' : '⚠️ card missing, use /repostitem'}`
    );

    // Discord messages are limited to 2000 characters
    const chunks = [''];
    for (const line of lines) {
      if (chunks[chunks.length - 1].length + line.length + 1 > 1900) chunks.push('');
      chunks[chunks.length - 1] += (chunks[chunks.length - 1] ? '\n' : '') + line;
    }
    await interaction.editReply(chunks[0]);
    for (const c of chunks.slice(1)) await interaction.followUp({ content: c, flags: MessageFlags.Ephemeral });
  },
};
