// /knowledge view | refresh | clear: what Vexo knows about THIS server (admins only, premium).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, AttachmentBuilder } = require('discord.js');
const ai = require('../ai');
const guilds = require('../guilds');
const knowledge = require('../knowledge');
const learn = require('../learn');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('knowledge')
    .setDescription('[Admin] What Vexo knows about this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('view').setDescription('Show the knowledge Vexo answers from'))
    .addSubcommand((s) => s.setName('refresh').setDescription('Read the knowledge source channels again from the start'))
    .addSubcommand((s) => s.setName('clear').setDescription('Forget everything Vexo learned in this server')),
  async execute(interaction) {
    const eph = { flags: MessageFlags.Ephemeral };
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Admins only.', ...eph });
    await interaction.deferReply(eph);
    const guildId = guilds.gid(interaction);
    const s = guilds.settings(interaction);
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const text = ai.getKnowledge(guildId);
      const facts = knowledge.getFacts(guildId);
      const full = `${text}\n\n## Taught in the control channel (${facts.length})\n${facts.map((f) => `- #${f.id} ${f.fact}`).join('\n') || '(nothing yet)'}`;
      const chosen = s.knowledgeSources.map((id) => `<#${id}>`).join(', ');
      const sources = s.isHome ? `knowledge.md + the control channel${chosen ? ` + ${chosen} (separate sheet)` : ''}` : chosen || 'none chosen yet (run /setup)';
      const head = `**Knowledge of ${s.name}** · ${text.length} characters${s.isHome ? '' : ` (limit ${learn.MAX_KNOWLEDGE_CHARS})`} · ${facts.length} taught fact${facts.length === 1 ? '' : 's'}\nSource channels: ${sources}`;
      if (full.length <= 1500) return interaction.editReply({ content: `${head}\n\`\`\`md\n${full.replace(/```/g, "'''")}\n\`\`\``, allowedMentions: { parse: [] } });
      return interaction.editReply({ content: head, files: [new AttachmentBuilder(Buffer.from(full, 'utf8'), { name: 'vexo-knowledge.md' })], allowedMentions: { parse: [] } });
    }

    // HΛVØCZ keeps its rule: it learns only from what the boss teaches in the control channel
    if (s.isHome) return interaction.editReply('In this server my knowledge is managed by the boss in the control channel (teach, edit, forget), so refresh and clear are switched off here.');

    if (sub === 'clear') {
      const n = await learn.clear(guildId);
      return interaction.editReply(`🧹 Cleared. I forgot the summary of your source channels and ${n} taught fact${n === 1 ? '' : 's'}. Use \`/knowledge refresh\` to read the source channels again.`);
    }
    if (sub === 'refresh') {
      if (!s.knowledgeSources.length) return interaction.editReply('No knowledge source channels are chosen yet. Run /setup and pick them first.');
      await interaction.editReply('📚 Reading your source channels again. This can take a minute...');
      const results = await learn.refresh(interaction.client, guildId);
      const lines = results.map((r) => `<#${r.channelId}>: ${r.error ? `⚠️ ${r.error}` : `read ${r.read} messages, learned from ${r.learned} posts`}`);
      return interaction.editReply({ content: `✅ Done.\n${lines.join('\n')}\nSee the result with \`/knowledge view\`.`.slice(0, 1900), allowedMentions: { parse: [] } });
    }
    return interaction.editReply('Unknown subcommand.');
  },
};
