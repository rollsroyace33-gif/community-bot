// /status: this server's plan, days left, enabled features and configured channels.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const guilds = require('../guilds');
const plans = require('../plans');
const automod = require('../automod');
const scam = require('../scam');
const setup = require('../setup');

// Discord allows 1,024 characters per embed field: long text is split by lines into more fields
function fieldsOf(name, text) {
  const out = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    if (cur && cur.length + line.length + 1 > 1024) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line.slice(0, 1024);
  }
  if (cur) out.push(cur);
  return out.map((value, i) => ({ name: i ? `${name} (continued)` : name, value }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('[Admin] Plan, days left, enabled features and channels of this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const eph = { flags: MessageFlags.Ephemeral };
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Admins only.', ...eph });
    const s = guilds.settings(interaction);
    const row = guilds.get(interaction);
    const p = plans.plan(interaction);
    const end = p.endsAt ? ` · ends <t:${Math.floor(p.endsAt.getTime() / 1000)}:D> (**${p.daysLeft}** day${p.daysLeft === 1 ? '' : 's'} left)` : '';
    const planText = { home: 'Home server: every feature, no limits', paid: `**Premium**${end}`, trial: `**Free trial**${end}`, free: '**Free plan** (premium features locked)', unknown: 'Not set up yet: run /setup' }[p.kind];
    const feats = Object.entries(plans.featureList(interaction))
      .map(([f, on]) => `${on ? '✅' : '🔒'} ${plans.FEATURE_NAMES[f] || f}${config.features[f] === 'free' ? ' (free)' : ''}`)
      .join('\n');
    const ch = (id) => (id ? `<#${id}>` : 'not set');
    const c = s.channels;
    // HΛVØCZ: where each channel comes from (/setup wins over .env)
    const src = s.isHome ? guilds.homeChannelSources() : {};
    const from = (key) => (!s.isHome ? '' : src[key]?.from === 'setup' ? ' · from /setup' : src[key]?.from === 'env' ? ' · from .env' : '');
    const solRadar = require('../solRadar');
    const solRadarNote = solRadar.blocker(s.guildId) ? 'not posting, see /solradar status' : `${solRadar.settingsOf(s.guildId).times.length} updates a day`;
    const logsId = guilds.logsChannelId(s);
    const logsFrom = !s.isHome ? '' : src.logs?.from === 'setup' ? ' · from /setup' : logsId && logsId === c.redeemLogs ? ' · purchase log channel, from .env' : logsId ? ' · control channel (no logs channel set)' : '';
    const channels = [
      `Control: ${ch(c.control)}${from('control')}`,
      `Marketplace: ${ch(c.marketplace)}${from('marketplace')}`,
      `Rumble: ${ch(c.rumble)}${from('rumble')}`,
      `Number guess: ${ch(c.general)}${from('general')}`,
      `X posts: ${ch(c.xDrop)}${c.xDrop ? ` (${config.xDrop.points} points per X post link)` : ''}${from('xDrop')}`,
      `Giveaways: ${ch(c.giveaway)}${from('giveaway')}`,
      `NFT Radar: ${ch(c.nftRadar)}${c.nftRadar ? ` (${require('../nftRadar').blocker(s.guildId) ? 'not running, see /nftradar status' : 'on, posts after approval'})` : ''}${from('nftRadar')}`,
      `SOL Radar: ${ch(c.solRadar)}${c.solRadar ? ` (${solRadarNote})` : ''}${from('solRadar')}`,
      ...(s.isHome ? [`Welcome: ${ch(c.welcome)}${from('welcome')}`, `Ask (Q&A): ${ch(c.ask)}${from('ask')}`] : []),
      ...(s.personalVexo && !s.isHome ? [`Get Vexo Assistant: ${ch(c.assistant)}`] : []),
      `Logs: ${ch(logsId)}${logsFrom}`,
      `Game ping role: ${s.pingRoleId ? `<@&${s.pingRoleId}>` : 'none'}`,
      `Boss: ${s.bossUserId ? `<@${s.bossUserId}>` : 'not set'}`,
      `Knowledge sources: ${s.knowledgeSources.length ? `${s.knowledgeSources.map(ch).join(', ')}${s.isHome ? ' (separate sheet, knowledge.md unchanged)' : ''}` : s.isHome ? 'knowledge.md + control channel' : 'none chosen (run /setup)'}`,
    ].join('\n');
    const am = automod.rules(s.guildId);
    const on = Object.keys(automod.RULES).filter((k) => am[k] === true);
    const embed = new EmbedBuilder()
      .setTitle(`Vexo status · ${interaction.guild?.name || s.name}`)
      .setColor(p.premium ? 0x2ecc71 : 0x95a5a6)
      .addFields(
        { name: 'Plan', value: planText },
        { name: 'Features', value: feats },
        ...fieldsOf('Channels and roles', channels),
        { name: 'Auto mod', value: on.length ? `On: ${on.join(', ')} · action: ${am.action}` : 'All rules off' }
      );
    const sc = scam.settings(s.guildId);
    const scamOn = sc.enabled && plans.hasFeature(interaction, 'automod');
    embed.addFields({ name: 'Scam protection', value: !sc.enabled ? 'Off (turn on with `/automod scam on:true`)' : !scamOn ? 'On, but locked (premium feature)' : `On · mode: ${sc.mode === 'alert' ? 'alert only (never kicks or bans)' : 'auto (deletes, kicks or bans scammers)'}` });
    // permission check: everything the invite link asks for (other servers), or what scam protection needs (HΛVØCZ, only when on)
    try {
      if (!s.isHome) {
        const missing = await setup.missingPermissions(interaction.guild);
        embed.addFields({ name: 'Permissions', value: missing.length ? `⚠️ Missing: **${missing.join(', ')}**. Fix: Server Settings > Roles > Vexo > turn them on.${missing.some((m) => /Kick|Ban/.test(m)) ? ' Without Kick Members and Ban Members I can only delete scam messages.' : ''}` : '✅ I have every permission I need. For kicks and bans my **Vexo** role must also be above the member roles.' });
      } else if (sc.enabled && scam.permissionWarning(interaction.guild)) {
        embed.addFields({ name: 'Permissions', value: scam.permissionWarning(interaction.guild) });
      }
    } catch {}
    if (!s.isHome) embed.addFields({ name: 'AI calls today', value: `${row?.ai_calls_today ?? 0} of ${config.defaultDailyAiLimit}`, inline: true });
    if (!s.isHome && !p.premium && config.supportContact) embed.addFields({ name: 'Unlock premium', value: config.supportContact.slice(0, 1000) });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, ...eph });
  },
};
