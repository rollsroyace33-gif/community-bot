// /nftradar status | pending | preview | run | add | on | off: this server's NFT Radar (premium feature).
// All the logic is in src/nftRadar.js. Admin only: Manage Server, or the boss of this server.
// Registered GLOBALLY (every server) by src/deploy-commands.js, like every command that is not homeOnly.
// Nothing is ever posted publicly by this command: projects go to the logs channel for Approve / Reject first.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const nftRadar = require('../nftRadar');
const research = require('../web3/research');
const guilds = require('../guilds');
const identity = require('../identity');
const config = require('../config');
const { getTextChannel } = require('../utils');

async function log(interaction, text) {
  try {
    const s = guilds.settings(interaction);
    const ch = await getTextChannel(interaction.client, guilds.logsChannelId(s)); // logs channel, never the shop
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setTitle('📡 NFT Radar settings').setColor(0x3498db).setDescription(`${text}\nBy <@${interaction.user.id}>`).setTimestamp()], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('nftradar log:', err.message);
  }
}

const ts = (iso) => (Date.parse(iso) ? `<t:${Math.floor(Date.parse(iso) / 1000)}:R>` : 'unknown');

async function statusText(guildId) {
  const s = guilds.settings(guildId);
  const why = nftRadar.blocker(guildId);
  const logs = guilds.logsChannelId(s);
  const pending = await nftRadar.pendingCount(guildId).catch(() => 0);
  const st = await nftRadar.stats().catch(() => null);
  const use = await research.usage().catch(() => null);
  const credits = use && use.used !== null
    ? `**${use.used}**${use.limit ? ` of ${use.limit}` : ''} this month${use.plan ? ` (${use.plan} plan)` : ''}`
    : `not available from Tavily right now${research.available() ? ` (searches since the bot started: ${research.used.sinceStart})` : ''}`;
  return [
    why ? `📡 **NFT Radar is not running here:** ${why}.` : '📡 **NFT Radar is ON** in this server.',
    `Public channel: ${s.channels.nftRadar ? `<#${s.channels.nftRadar}>` : 'not set'} · Approval requests go to: ${logs ? `<#${logs}>` : 'no logs channel'}`,
    `Automatic runs: every day at ${nftRadar.runTimes().map((t) => `\`${t}\``).join(', ')} UTC (shared by all servers).`,
    `Last run: ${st?.lastRun ? `${ts(st.lastRun.at)}${st.lastRun.manual ? ' (started by hand)' : ''}, new candidates found: **${st.lastRun.found ?? 0}**` : 'none yet'}`,
    `Projects researched so far: **${st?.projects ?? 0}** (good enough: ${st?.selected ?? 0}, filtered out: ${st?.dropped ?? 0})`,
    `Waiting for approval in this server: **${pending}** (see \`/nftradar pending\`)`,
    `Tavily web searches (credits) used: ${credits}`,
    'Nothing is posted until an admin presses **Approve**.',
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nftradar')
    .setDescription('[Admin] NFT Radar: upcoming Solana NFT mints, posted only after approval')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Last run, projects found, pending approvals, Tavily credits used'))
    .addSubcommand((s) => s.setName('pending').setDescription('List the projects waiting for Approve / Reject in this server'))
    .addSubcommand((s) => s.setName('preview').setDescription('See what a public NFT Radar post looks like (only you see it)'))
    .addSubcommand((s) => s.setName('run').setDescription('Start one research run now (at most once per 6 hours)'))
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Let Vexo research a project; it then appears in the logs channel for approval')
        .addStringOption((o) => o.setName('project').setDescription("The project's website or X link, or its name").setRequired(true).setMaxLength(200))
    )
    .addSubcommand((s) => s.setName('on').setDescription('Switch NFT Radar on in this server'))
    .addSubcommand((s) => s.setName('off').setDescription('Switch NFT Radar off in this server (no new approval requests)')),
  async execute(interaction) {
    const eph = { flags: MessageFlags.Ephemeral };
    const allowed = !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || identity.isBoss(interaction.user, interaction);
    if (!allowed) return interaction.reply({ content: 'Only admins (Manage Server) can use NFT Radar.', ...eph });
    await interaction.deferReply(eph);
    const guildId = guilds.gid(interaction);
    const sub = interaction.options.getSubcommand();
    const say = (content) => interaction.editReply({ content: String(content).slice(0, 1990), allowedMentions: { parse: [] } });
    try {
      if (sub === 'status') return say(await statusText(guildId));
      if (sub === 'on' || sub === 'off') {
        await nftRadar.saveSettings(guildId, { enabled: sub === 'on' });
        await log(interaction, `NFT Radar switched **${sub.toUpperCase()}**.`);
        return say(`${sub === 'on' ? '✅ NFT Radar is switched on.' : '🔕 NFT Radar is switched off. No new approval requests until you switch it on again.'}\n\n${await statusText(guildId)}`);
      }
      if (sub === 'pending') {
        const list = await nftRadar.pendingList(guildId);
        if (!list.length) return say('📡 No projects are waiting for approval in this server right now.');
        const lines = list.map((p, i) => `${i + 1}. **${p.name}** · mint: ${nftRadar.fmtDate(p.data)} · score ${p.data.score ?? '?'}/10 · sent ${ts(p.createdAt)}${p.link ? ` · [open request](${p.link})` : ''}`);
        return say(`📡 **Waiting for Approve / Reject (${list.length}):**\n${lines.join('\n')}\n\nPress Approve or Reject on the request in the logs channel.`);
      }
      if (sub === 'preview') {
        const p = await nftRadar.previewProject(guildId).catch(() => null);
        const head = p
          ? `👀 **Preview** (only you see this, nothing was posted). This is how **${p.data?.name || p.name}** would look after Approve:\n\n`
          : '👀 **Preview** (only you see this, nothing was posted). No real project has been researched yet, so this is a **made-up example** to show the layout:\n\n';
        return say(head + nftRadar.buildPost(p ? p.data || {} : nftRadar.EXAMPLE));
      }
      const why = nftRadar.blocker(guildId);
      if (why) return say(`NFT Radar cannot run here: ${why}.`);
      if (sub === 'add') {
        const res = await nftRadar.addProject(interaction.client, guildId, interaction.user.id, interaction.options.getString('project'));
        if (res.error) return say(`⚠️ ${res.error}`);
        if (res.exists) return say(`This project was already sent to this server (status: **${res.status}**). Look for it in the logs channel.`);
        return say(`✅ Researched **${res.project.name}**. The approval request is in <#${res.channelId}>: press **Approve** there to post it, or **Reject**.`);
      }
      if (sub === 'run') {
        const byOwner = !!config.ownerId && String(interaction.user.id) === config.ownerId;
        const out = await nftRadar.scanNow(interaction.client, { byOwner });
        if (out.cooldown) return say('A run already happened in the last few hours (runs are shared by all servers to save the free web searches). Try again later, or add a project with `/nftradar add`.');
        if (out.busy) return say('A run is going on right now. Look in the logs channel in a few minutes.');
        if (out.error && !out.found) return say(`⚠️ The run did not work: ${out.error}`);
        return say(`🔎 Run finished. New candidates: **${out.found}**, researched: **${out.researched}**, good enough: **${out.selected}**, approval requests sent (all servers): **${out.sent}**.${out.sent ? '\nLook in the logs channel for Approve / Reject.' : '\nUpcoming Solana mints are hard to find on the web, and weak ones are filtered out on purpose. `/nftradar add` works best.'}`);
      }
      return say('Unknown option.');
    } catch (err) {
      console.error('nftradar command:', err.message);
      return say('Something went wrong, nothing was posted.');
    }
  },
};
