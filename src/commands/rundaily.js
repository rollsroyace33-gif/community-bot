const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { runDailyJob } = require('../jobs/daily');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rundaily')
    .setDescription('[Admin] Run the daily job (quality check + top 1) now')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('force').setDescription('Run again even if it already ran today')),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await runDailyJob(interaction.client, { force: interaction.options.getBoolean('force') || false });
    if (r.skipped) return interaction.editReply('Today\'s daily job has already run. You can run it again with `force: true`.');
    await interaction.editReply(
      `✅ Done (${r.day}). AI check: ${r.aiOk ? 'ok' : 'failed (top 1 was picked by message count)'}. Top: ${r.top ? `<@${r.top}>` : 'nobody'}${r.top && !r.announced ? ' (bonus was already given)' : ''}`
    );
  },
};
