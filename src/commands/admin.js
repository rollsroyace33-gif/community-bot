// /admin: the bot owner's commands for manual payments. Registered ONLY in the home server (HΛVØCZ) and
// usable ONLY by OWNER_ID (checked in code on every use).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const guilds = require('../guilds');
const plans = require('../plans');

const DAY = 86400000;
const guildOption = (o) => o.setName('guild_id').setDescription('Server ID (see /admin list)').setRequired(true).setMinLength(17).setMaxLength(20);
const daysOption = (o) => o.setName('days').setDescription('Number of days').setRequired(true).setMinValue(1).setMaxValue(3650);
const when = (iso) => (iso ? `<t:${Math.floor(Date.parse(iso) / 1000)}:f>` : 'not set');

module.exports = {
  homeOnly: true, // deploy-commands.js registers this in the home server only
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('[Owner] Manage server plans')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('activate').setDescription('Give a server premium for N days (adds to remaining paid time)').addStringOption(guildOption).addIntegerOption(daysOption))
    .addSubcommand((s) => s.setName('deactivate').setDescription('End premium (and the trial) of a server now').addStringOption(guildOption))
    .addSubcommand((s) => s.setName('extendtrial').setDescription('Add N days to a server\'s trial').addStringOption(guildOption).addIntegerOption(daysOption))
    .addSubcommand((s) => s.setName('personalvexo').setDescription('Switch Personal Vexo on or off for a server (off by default)').addStringOption(guildOption).addBooleanOption((o) => o.setName('on').setDescription('true = on, false = off').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('All servers with plan and days left')),
  async execute(interaction) {
    const eph = { flags: MessageFlags.Ephemeral };
    if (!config.ownerId || interaction.user.id !== config.ownerId || !guilds.isHome(interaction.guildId)) {
      return interaction.reply({ content: 'Only the bot owner can use this.', ...eph });
    }
    await interaction.deferReply(eph);
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const lines = guilds
        .all()
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((r) => {
          const p = plans.plan(r.guild_id);
          const left = r.status === 'left' ? 'bot removed' : p.kind === 'home' ? 'home server, everything on' : p.premium ? `${p.kind}, ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left` : 'free';
          return `**${String(r.name || 'unknown').slice(0, 40)}** \`${r.guild_id}\` · ${left} · AI calls today: ${r.ai_calls_today ?? 0}`;
        });
      const text = lines.join('\n') || 'No servers yet.';
      return interaction.editReply(text.length > 1900 ? `${text.slice(0, 1900)}\n…` : text);
    }

    const id = interaction.options.getString('guild_id').trim();
    const row = guilds.get(id);
    if (!row || guilds.isHome(id)) return interaction.editReply(guilds.isHome(id) ? 'That is the home server: it always has everything.' : `I have no server with ID \`${id}\`. Check /admin list.`);
    const now = Date.now();
    const name = `**${row.name || id}**`;

    if (sub === 'activate') {
      const days = interaction.options.getInteger('days');
      const from = Math.max(now, row.paid_until ? Date.parse(row.paid_until) : 0);
      const updated = await guilds.update(id, { paid_until: new Date(from + days * DAY).toISOString() });
      return interaction.editReply(`✅ ${name} has premium until ${when(updated.paid_until)} (+${days} days).`);
    }
    if (sub === 'deactivate') {
      const patch = { paid_until: null };
      if (row.trial_ends_at && Date.parse(row.trial_ends_at) > now) patch.trial_ends_at = new Date(now).toISOString();
      await guilds.update(id, patch);
      return interaction.editReply(`🔒 ${name} is now on the free plan. Premium features are locked, free games keep working. No data was deleted.`);
    }
    if (sub === 'extendtrial') {
      const days = interaction.options.getInteger('days');
      const from = Math.max(now, row.trial_ends_at ? Date.parse(row.trial_ends_at) : 0);
      const patch = { trial_ends_at: new Date(from + days * DAY).toISOString() };
      if (!row.trial_started_at) patch.trial_started_at = new Date(now).toISOString();
      const updated = await guilds.update(id, patch);
      return interaction.editReply(`✅ ${name}: trial now ends ${when(updated.trial_ends_at)} (+${days} days).`);
    }
    if (sub === 'personalvexo') {
      const on = interaction.options.getBoolean('on');
      await guilds.patchSettings(id, { personalVexo: on });
      return interaction.editReply(
        on
          ? `✅ Personal Vexo is switched ON for ${name}. Its admin now runs **/setup** there and I create the **🤖・get-vexo-assistant** channel (nothing is created until then).`
          : `🔒 Personal Vexo is switched OFF for ${name}. The get-vexo-assistant channel is not deleted, I just stop using it.`
      );
    }
    return interaction.editReply('Unknown subcommand.');
  },
};
