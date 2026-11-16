// /giveaway start | end | reroll | cancel | list: host giveaways by hand, with NO AI (free feature).
// All the logic is in src/giveaway.js (shared with the control channel orders). Admin only:
// Manage Server, or the boss of this server.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const giveaway = require('../giveaway');
const guilds = require('../guilds');
const identity = require('../identity');

const t = (d, f) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${f}>`;
const idOption = (o, text) => o.setName('id').setDescription(text).setMinValue(1);

// Which giveaway does the admin mean? The id they typed (it must belong to THIS server), or, with no id,
// the only one in that status. -> { row } | { error }
async function choose(interaction, status, word) {
  const guildId = guilds.gid(interaction);
  const id = interaction.options.getInteger('id');
  if (id !== null) {
    const row = await giveaway.getRow(id);
    if (!row || row.guild_id !== guildId) return { error: `I cannot find giveaway #${id} in this server. See the numbers with \`/giveaway list\`.` };
    return { row };
  }
  const rows = await giveaway.listByStatus(guildId, status);
  if (!rows.length) return { error: `There is no ${word} giveaway in this server right now.` };
  if (status === 'ended' || rows.length === 1) return { row: rows[0] }; // ended: the most recent one
  return { error: `There are ${rows.length} ${word} giveaways. Tell me which one with the \`id\` option:\n${rows.slice(0, 10).map((g) => `**#${g.id}** · ${giveaway.prizeText(g)}`).join('\n')}` };
}

async function start(interaction) {
  const o = interaction.options;
  const duration = o.getString('duration');
  const end = o.getString('end');
  if (!duration && !end) return interaction.editReply('How long should it run? Fill in `duration` (for example `30m`, `2h`, `1d`) or `end` (for example `9 pm`, `tomorrow 8 pm`).');
  const when = giveaway.resolveEnd({ duration, end });
  if (when.error) return interaction.editReply(when.error);

  // the picture is downloaded now and uploaded again on the giveaway message (Discord links expire)
  let image = null;
  const att = o.getAttachment('image');
  if (att) {
    const got = await giveaway.downloadImage({ url: att.url, name: att.name, contentType: att.contentType, size: att.size });
    if (got.error) return interaction.editReply(`⚠️ ${got.error} Nothing was posted.`);
    image = got;
  }
  const required = o.getRole('required_role');
  const ping = o.getRole('ping_role');
  const res = await giveaway.start({
    guild: interaction.guild,
    client: interaction.client,
    channelId: o.getChannel('channel')?.id || null,
    prize: o.getString('prize'),
    endsAt: when.endsAt,
    winners: o.getInteger('winners') ?? 1,
    pointsPrize: o.getInteger('points_prize'),
    requiredRoleId: required && required.id !== interaction.guildId ? required.id : null, // @everyone = no requirement
    pingRoleId: ping ? ping.id : null,
    hostId: interaction.user.id,
    image,
  });
  if (res.error) return interaction.editReply({ content: res.error, allowedMentions: { parse: [] } });
  const g = res.row;
  return interaction.editReply({
    content:
      `🎉 The giveaway is live: ${giveaway.linkOf(g)}\n` +
      `Prize: ${giveaway.prizeText(g)} · Winners: ${g.winners_count} · Ends ${t(g.ends_at, 'f')} (${t(g.ends_at, 'R')})` +
      `${g.required_role_id ? ` · Only for <@&${g.required_role_id}>` : ''}${image ? ' · with your picture' : ''}\n` +
      `This is giveaway **#${g.id}**. End it early with \`/giveaway end\`, or stop it with \`/giveaway cancel\`.`,
    allowedMentions: { parse: [] },
  });
}

async function list(interaction) {
  const guildId = guilds.gid(interaction);
  const active = await giveaway.listByStatus(guildId, 'active');
  const ended = (await giveaway.listByStatus(guildId, 'ended')).slice(0, 5);
  const lines = [];
  lines.push(`**Running (${active.length})**`);
  if (!active.length) lines.push('None right now. Start one with `/giveaway start`.');
  for (const g of active.slice(0, 15)) {
    lines.push(`**#${g.id}** · ${giveaway.prizeText(g)} · ${g.winners_count} winner${g.winners_count === 1 ? '' : 's'} · ${await giveaway.entryCount(g.id)} entries · ends ${t(g.ends_at, 'R')} · [open](${giveaway.linkOf(g)})`);
  }
  if (ended.length) {
    lines.push('', '**Last ended**');
    for (const g of ended) {
      const w = (g.winner_ids || []).map((id) => `<@${id}>`).join(', ') || 'no winner';
      lines.push(`**#${g.id}** · ${giveaway.prizeText(g)} · ${w} · [open](${giveaway.linkOf(g)})`);
    }
  }
  return interaction.editReply({ content: lines.join('\n').slice(0, 1950), allowedMentions: { parse: [] } });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('[Admin] Host a giveaway with a Join button')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Post a giveaway in the giveaway channel')
        .addStringOption((o) => o.setName('prize').setDescription('What is given away, e.g. "1 NFT", "50 USDT", "WL spot"').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('duration').setDescription('How long it runs: 30m, 2h, 1d, "1 day 12 hours" (or use "end")').setMaxLength(50))
        .addStringOption((o) => o.setName('end').setDescription('End time instead of a duration: "9 pm", "tomorrow 8 pm"').setMaxLength(50))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(giveaway.MAX_WINNERS))
        .addAttachmentOption((o) => o.setName('image').setDescription('A picture shown large on the giveaway (PNG, JPG, GIF, WEBP)'))
        .addRoleOption((o) => o.setName('required_role').setDescription('Only members with this role can join'))
        .addRoleOption((o) => o.setName('ping_role').setDescription('Role to ping when it starts (default: the game ping role)'))
        .addIntegerOption((o) => o.setName('points_prize').setDescription('Points added to every winner automatically').setMinValue(1).setMaxValue(1000000))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: the giveaway channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    )
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now and pick the winners').addIntegerOption((o) => idOption(o, 'Giveaway number (not needed when only one is running)')))
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('Pick new winner(s) for an ended giveaway (never a previous winner)')
        .addIntegerOption((o) => idOption(o, 'Giveaway number (default: the last ended one)'))
        .addUserOption((o) => o.setName('winner').setDescription('Replace only this winner (default: replace all winners)'))
    )
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a running giveaway (no winner, nobody is pinged)').addIntegerOption((o) => idOption(o, 'Giveaway number (not needed when only one is running)')))
    .addSubcommand((s) => s.setName('list').setDescription('Show the running giveaways and the last ended ones')),
  async execute(interaction) {
    const eph = { flags: MessageFlags.Ephemeral };
    const allowed = !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || identity.isBoss(interaction.user, interaction);
    if (!allowed) return interaction.reply({ content: 'Only admins (Manage Server) can run giveaways.', ...eph });
    await interaction.deferReply(eph);
    const sub = interaction.options.getSubcommand();
    const by = interaction.user.id;
    const say = (content) => interaction.editReply({ content: String(content).slice(0, 1950), allowedMentions: { parse: [] } });
    try {
      if (sub === 'start') return await start(interaction);
      if (sub === 'list') return await list(interaction);

      if (sub === 'end') {
        const pick = await choose(interaction, 'active', 'running');
        if (pick.error) return say(pick.error);
        const res = await giveaway.finish(interaction.client, Number(pick.row.id), { by });
        if (res.error) return say(res.error);
        return say(`🏁 Giveaway #${res.row.id} is over. ${res.winners.length ? `Winner${res.winners.length === 1 ? '' : 's'}: ${res.winners.map((w) => `<@${w}>`).join(', ')}. I announced it in <#${res.row.channel_id}>.` : 'Nobody could win it (no valid entries).'}`);
      }
      if (sub === 'reroll') {
        const pick = await choose(interaction, 'ended', 'ended');
        if (pick.error) return say(pick.error);
        const res = await giveaway.reroll(interaction.client, Number(pick.row.id), { by, replace: interaction.options.getUser('winner')?.id || null });
        if (res.error) return say(res.error);
        return say(`🔁 Giveaway #${res.row.id} rerolled. New winner${res.winners.length === 1 ? '' : 's'}: ${res.winners.map((w) => `<@${w}>`).join(', ')}. I announced it in <#${res.row.channel_id}>.`);
      }
      if (sub === 'cancel') {
        const pick = await choose(interaction, 'active', 'running');
        if (pick.error) return say(pick.error);
        const res = await giveaway.cancel(interaction.client, Number(pick.row.id), { by });
        if (res.error) return say(res.error);
        return say(`🚫 Giveaway #${res.row.id} is cancelled. No winner was picked and nobody was pinged.`);
      }
      return say('Unknown giveaway command.');
    } catch (err) {
      console.error('giveaway command:', err.message);
      const hint = /giveaway/.test(err.message) && /(does not exist|schema cache|relation)/i.test(err.message) ? ' The giveaway tables are missing: run `supabase/migration_giveaway.sql` in Supabase first.' : '';
      return say(`Something went wrong, nothing was changed.${hint}`);
    }
  },
};
