// /solradar status | on | off | times | now | preview: this server's SOL Radar (premium feature).
// All the logic is in src/solRadar.js. Admin only: Manage Server, or the boss of this server.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const solRadar = require('../solRadar');
const guilds = require('../guilds');
const identity = require('../identity');
const { getTextChannel } = require('../utils');

async function log(interaction, text) {
  try {
    const s = guilds.settings(interaction);
    const ch = await getTextChannel(interaction.client, guilds.logsChannelId(s)); // logs channel, never the shop
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setTitle('📈 SOL Radar settings').setColor(0x3498db).setDescription(`${text}\nBy <@${interaction.user.id}>`).setTimestamp()], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('solradar log:', err.message);
  }
}

function statusText(guildId) {
  const s = guilds.settings(guildId);
  const st = solRadar.settingsOf(guildId);
  const why = solRadar.blocker(guildId);
  return [
    why ? `📈 **SOL Radar is not posting here:** ${why}.` : '📈 **SOL Radar is ON** in this server.',
    `Channel: ${s.channels.solRadar ? `<#${s.channels.solRadar}>` : 'not set'}`,
    `Updates a day: **${st.times.length}** at ${st.times.map((t) => `\`${t}\``).join(', ')} (${st.timezone} time)`,
    'Change the times with `/solradar times`, switch it with `/solradar on` / `/solradar off`, see an example with `/solradar preview`.',
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('solradar')
    .setDescription('[Admin] SOL Radar: daily SOL market updates')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Is SOL Radar on, where and when does it post'))
    .addSubcommand((s) => s.setName('on').setDescription('Switch SOL Radar on in this server'))
    .addSubcommand((s) => s.setName('off').setDescription('Switch SOL Radar off in this server'))
    .addSubcommand((s) =>
      s
        .setName('times')
        .setDescription('Set the 4 or 5 daily update times')
        .addStringOption((o) => o.setName('times').setDescription('4 or 5 times, 24-hour clock, e.g. 01:00, 06:00, 11:00, 16:00, 21:00').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('timezone').setDescription('The clock for those times, e.g. UTC, Asia/Dhaka, Europe/London (default: keep the current one)').setMaxLength(40))
    )
    .addSubcommand((s) => s.setName('now').setDescription('Post one SOL Radar update in the channel right now'))
    .addSubcommand((s) => s.setName('preview').setDescription('See an update here, only visible to you (nothing is posted)')),
  async execute(interaction) {
    const eph = { flags: MessageFlags.Ephemeral };
    const allowed = !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || identity.isBoss(interaction.user, interaction);
    if (!allowed) return interaction.reply({ content: 'Only admins (Manage Server) can change SOL Radar.', ...eph });
    await interaction.deferReply(eph);
    const guildId = guilds.gid(interaction);
    const sub = interaction.options.getSubcommand();
    const say = (content) => interaction.editReply({ content: String(content).slice(0, 1990), allowedMentions: { parse: [] } });
    try {
      if (sub === 'status') return say(statusText(guildId));
      if (sub === 'on' || sub === 'off') {
        await solRadar.saveSettings(guildId, { enabled: sub === 'on' });
        await log(interaction, `SOL Radar switched **${sub.toUpperCase()}**.`);
        return say(`${sub === 'on' ? '✅ SOL Radar is switched on.' : '🔕 SOL Radar is switched off. No more updates until you switch it on again.'}\n\n${statusText(guildId)}`);
      }
      if (sub === 'times') {
        const times = solRadar.parseTimes(interaction.options.getString('times'));
        if (!times) return say('I could not read those times. Write them like this: `01:00, 06:00, 11:00, 16:00, 21:00` (24-hour clock).');
        if (times.length < solRadar.MIN_SLOTS || times.length > solRadar.MAX_SLOTS) return say(`SOL Radar posts ${solRadar.MIN_SLOTS} or ${solRadar.MAX_SLOTS} updates a day, so give me ${solRadar.MIN_SLOTS} or ${solRadar.MAX_SLOTS} different times (you gave ${times.length}).`);
        const zone = interaction.options.getString('timezone')?.trim();
        if (zone && !solRadar.validZone(zone)) return say(`I do not know the time zone "${zone.slice(0, 40)}". Use a name like \`UTC\`, \`Asia/Dhaka\`, \`Europe/London\`, \`America/New_York\`.`);
        await solRadar.saveSettings(guildId, zone ? { times, timezone: zone } : { times });
        const st = solRadar.settingsOf(guildId);
        await log(interaction, `Update times set to ${st.times.join(', ')} (${st.timezone}).`);
        return say(`✅ Saved.\n\n${statusText(guildId)}`);
      }
      // now / preview need live market data
      const why = solRadar.blocker(guildId);
      if (sub === 'now' && why) return say(`I cannot post: ${why}.`);
      let post;
      try {
        post = await solRadar.compose();
      } catch (err) {
        return say(err.code === 'NO_KEY' ? 'SOL Radar is off: the market data key (COINGECKO_API_KEY) is not set on the bot.' : `⚠️ I could not get live SOL market data right now (${err.message}). Nothing was posted. I never post made-up numbers, so please try again in a few minutes.`);
      }
      if (sub === 'preview') return say(post.text);
      const res = await solRadar.postTo(interaction.client, guildId, post.text);
      if (res.error) return say(`⚠️ ${res.error}`);
      return say(`✅ Posted in <#${res.channelId}>. (This extra update does not change the daily schedule.)`);
    } catch (err) {
      console.error('solradar command:', err.message);
      return say('Something went wrong, nothing was changed.');
    }
  },
};
