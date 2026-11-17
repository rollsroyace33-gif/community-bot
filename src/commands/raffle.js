// /raffle create | end | cancel | list: points raffles. All the logic is in src/raffle.js.
// Host: Manage Server, the boss of this server, or the bot owner. Members join with the buttons on the raffle.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const raffle = require('../raffle');
const guilds = require('../guilds');
const identity = require('../identity');
const config = require('../config');

const t = (d, f) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${f}>`;
const idOption = (o, text) => o.setName('id').setDescription(text).setMinValue(1);
const isHost = (interaction) =>
  !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || identity.isBoss(interaction.user, interaction) || (!!config.ownerId && String(interaction.user?.id) === config.ownerId);

// Which raffle does the host mean? The id they typed (it must belong to THIS server), or the only open one.
async function choose(interaction) {
  const guildId = guilds.gid(interaction);
  const id = interaction.options.getInteger('id');
  if (id !== null) {
    const row = await raffle.getRow(id);
    if (!row || String(row.guild_id) !== guildId) return { error: `I cannot find raffle #${id} in this server. See the numbers with \`/raffle list\`.` };
    return { row };
  }
  const rows = await raffle.listByStatus(guildId, 'open');
  if (!rows.length) return { error: 'There is no open raffle in this server right now.' };
  if (rows.length === 1) return { row: rows[0] };
  return { error: `There are ${rows.length} open raffles. Tell me which one with the \`id\` option:\n${rows.slice(0, 10).map((r) => `**#${r.id}** · ${r.title}`).join('\n')}` };
}

async function create(interaction) {
  const o = interaction.options;
  const duration = o.getString('duration');
  const end = o.getString('end');
  if (!duration && !end) return interaction.editReply('How long should it run? Fill in `duration` (for example `1h`, `24h`, `3d`) or `end` (for example `9 pm`, `tomorrow 8 pm`).');
  const when = raffle.resolveEnd({ duration, end });
  if (when.error) return interaction.editReply(when.error);

  // the channel is checked BEFORE the picture is downloaded, so "not set" is answered right away
  const ch = await raffle.raffleChannel(interaction.client, interaction.guild);
  if (ch.error) return interaction.editReply({ content: ch.error, allowedMentions: { parse: [] } });

  let image = null;
  const att = o.getAttachment('image');
  if (att) {
    const got = await require('../giveaway').downloadImage({ url: att.url, name: att.name, contentType: att.contentType, size: att.size });
    if (got.error) return interaction.editReply(`⚠️ ${got.error} Nothing was posted.`);
    image = { buffer: got.buffer, name: got.name.replace(/^giveaway/, 'raffle') };
  }
  const res = await raffle.create({
    guild: interaction.guild,
    client: interaction.client,
    hostId: interaction.user.id,
    title: o.getString('title'),
    prize: o.getString('prize'),
    entryCost: o.getInteger('entry_cost'),
    winners: o.getInteger('winners') ?? 1,
    maxPerUser: o.getInteger('max_tickets') ?? 1,
    maxTotal: o.getInteger('total_tickets'),
    endsAt: when.endsAt,
    image,
  });
  if (res.error) return interaction.editReply({ content: res.error, allowedMentions: { parse: [] } });
  const r = res.row;
  return interaction.editReply({
    content:
      `🎟️ The raffle is live: ${raffle.linkOf(r)}\n` +
      `**${r.title}** · Prize: **${r.prize}** · Entry: ${raffle.costText(r.entry_cost)} · Winners: ${r.winners_count} · Max ${r.max_tickets_per_user} per member${r.max_total_tickets ? ` · ${r.max_total_tickets} tickets in total` : ''}\n` +
      `Ends ${t(r.ends_at, 'f')} (${t(r.ends_at, 'R')}). This is raffle **#${r.id}**. Draw it early with \`/raffle end\`, or cancel and refund everyone with \`/raffle cancel\`.`,
    allowedMentions: { parse: [] },
  });
}

async function list(interaction) {
  const guildId = guilds.gid(interaction);
  const open = await raffle.listByStatus(guildId, 'open');
  const ended = (await raffle.listByStatus(guildId, 'ended')).slice(0, 5);
  const lines = [`**Open (${open.length})**`];
  if (!open.length) lines.push('None right now. Start one with `/raffle create`.');
  for (const r of open.slice(0, 10)) {
    lines.push(`**#${r.id}** · ${r.title} · ${raffle.costText(r.entry_cost)} · ${r.tickets_sold} tickets · ${r.entrants} entrants · ends ${t(r.ends_at, 'R')} · [open](${raffle.linkOf(r)})`);
  }
  if (ended.length) {
    lines.push('', '**Last ended**');
    for (const r of ended) lines.push(`**#${r.id}** · ${r.title} · ${(r.winner_ids || []).map((id) => `<@${id}>`).join(', ') || 'no winner'} · [open](${raffle.linkOf(r)})`);
  }
  return interaction.editReply({ content: lines.join('\n').slice(0, 1950), allowedMentions: { parse: [] } });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raffle')
    .setDescription('[Admin] Points raffles: members buy tickets with their points')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Post a raffle in the raffle channel')
        .addStringOption((o) => o.setName('title').setDescription('Raffle title').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('prize').setDescription('The prize, e.g. "1 SOL", "WL spot", "OG role" (you send it by hand)').setRequired(true).setMaxLength(200))
        .addIntegerOption((o) => o.setName('entry_cost').setDescription('Points per ticket (0 = free)').setRequired(true).setMinValue(0).setMaxValue(raffle.MAX_COST))
        .addStringOption((o) => o.setName('duration').setDescription('How long it runs: 1h, 24h, 3d (or use "end")').setMaxLength(50))
        .addStringOption((o) => o.setName('end').setDescription('End time instead of a duration: "9 pm", "tomorrow 8 pm"').setMaxLength(50))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(raffle.MAX_WINNERS))
        .addIntegerOption((o) => o.setName('max_tickets').setDescription('Max tickets per member (default 1)').setMinValue(1).setMaxValue(raffle.MAX_PER_USER))
        .addIntegerOption((o) => o.setName('total_tickets').setDescription('Total ticket cap (default: no cap)').setMinValue(1).setMaxValue(raffle.MAX_TOTAL))
        .addAttachmentOption((o) => o.setName('image').setDescription('Prize picture (PNG, JPG, GIF, WEBP, 8 MB max)'))
    )
    .addSubcommand((s) => s.setName('end').setDescription('Draw the winners now').addIntegerOption((o) => idOption(o, 'Raffle number (not needed when only one is open)')))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a raffle and refund every member').addIntegerOption((o) => idOption(o, 'Raffle number (not needed when only one is open)')))
    .addSubcommand((s) => s.setName('list').setDescription('Show the open raffles and the last ended ones')),
  async execute(interaction) {
    const eph = { flags: MessageFlags.Ephemeral };
    if (!isHost(interaction)) return interaction.reply({ content: 'Only admins (Manage Server) can run raffles.', ...eph });
    await interaction.deferReply(eph);
    const sub = interaction.options.getSubcommand();
    const by = interaction.user.id;
    const guildId = guilds.gid(interaction);
    const say = (content) => interaction.editReply({ content: String(content).slice(0, 1950), allowedMentions: { parse: [] } });
    try {
      if (sub === 'create') return await create(interaction);
      if (sub === 'list') return await list(interaction);
      if (sub === 'end') {
        const pick = await choose(interaction);
        if (pick.error) return say(pick.error);
        const res = await raffle.finish(interaction.client, Number(pick.row.id), { by, guildId });
        if (res.error) return say(res.error);
        return say(`🏁 Raffle #${res.row.id} is drawn. ${res.winners.length ? `Winner${res.winners.length === 1 ? '' : 's'}: ${res.winners.map((w) => `<@${w}>`).join(', ')}. I announced it in <#${res.row.channel_id}>. Please send the prize to the winner${res.winners.length === 1 ? '' : 's'}.` : 'Nobody entered, so there is no winner.'}`);
      }
      if (sub === 'cancel') {
        const pick = await choose(interaction);
        if (pick.error) return say(pick.error);
        const res = await raffle.cancel(interaction.client, Number(pick.row.id), { by, guildId });
        if (res.error) return say(res.error);
        return say(`🚫 Raffle #${res.row.id} is cancelled. ${res.refundedPoints.toLocaleString('en-US')} points were refunded to ${res.refundedUsers} member${res.refundedUsers === 1 ? '' : 's'}.`);
      }
      return say('Unknown raffle command.');
    } catch (err) {
      console.error('raffle command:', err.message);
      const hint = /raffle/.test(err.message) && /(does not exist|schema cache|relation|function)/i.test(err.message) ? ' The raffle tables are missing: run `supabase/migration_raffle.sql` in Supabase first.' : '';
      return say(`Something went wrong, nothing was changed.${hint}`);
    }
  },
};
