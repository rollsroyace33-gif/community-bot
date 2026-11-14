// /guess start | cancel | status: host a Number Guess Game by hand, with NO AI (free feature).
// The game itself is the existing engine in tasks/numberGuess.js, shared with control channel orders.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const guilds = require('../guilds');
const store = require('../tasks/store');
const numberGuess = require('../tasks/numberGuess');
const rumble = require('../tasks/rumbleRoyale');
const { tickSoon } = require('../tasks/scheduler');
const { reportTo } = require('../tasks/report');

const MIN = 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('guess')
    .setDescription('Host a Number Guess Game (admins and staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Schedule a Number Guess Game')
        .addIntegerOption((o) => o.setName('start_in').setDescription('Start in N minutes (default 10, minimum 1)').setMinValue(1).setMaxValue(43200))
        .addIntegerOption((o) => o.setName('min').setDescription('Lowest number (default 1)').setMinValue(-1000000).setMaxValue(1000000))
        .addIntegerOption((o) => o.setName('max').setDescription('Highest number (default 100)').setMinValue(-1000000).setMaxValue(1000000))
        .addStringOption((o) => o.setName('prize').setDescription('e.g. "50 points" (auto-paid) or "1 SOL", "NFT" (claimed by hand)').setMaxLength(100))
    )
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel the scheduled or running Number Guess Game'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the scheduled or running Number Guess Game')),
  async execute(interaction) {
    const eph = { flags: MessageFlags.Ephemeral };
    if (!rumble.isStaff(interaction)) return interaction.reply({ content: 'Only admins and staff can host games.', ...eph });
    await interaction.deferReply(eph);
    const guildId = guilds.gid(interaction);
    const s = guilds.settings(interaction);
    const sub = interaction.options.getSubcommand();
    const mine = async () => (await store.listActive(guildId)).filter((t) => t.type === numberGuess.type);

    if (sub === 'status') {
      const active = await mine();
      return interaction.editReply(active.length ? active.map((t) => numberGuess.describe(t)).join('\n') : 'No Number Guess Game is scheduled or running right now.');
    }
    if (sub === 'cancel') {
      const active = await mine();
      if (!active.length) return interaction.editReply('No Number Guess Game is scheduled or running right now.');
      const task = active[0];
      await numberGuess.cancel(task, { client: interaction.client });
      return interaction.editReply(`Game #${task.id} is cancelled.`);
    }

    // start
    const channelId = s.channels.general;
    if (!channelId) return interaction.editReply(s.isHome ? 'GENERAL_CHANNEL_ID is missing in .env, so I have nowhere to host the game.' : 'No games channel is set for this server. Run /setup first.');
    const lo = interaction.options.getInteger('min');
    const hi = interaction.options.getInteger('max');
    const built = numberGuess.buildParams({
      range: lo !== null || hi !== null ? [lo ?? 1, hi ?? 100] : null,
      prize: interaction.options.getString('prize') || '',
    });
    if (built.error) return interaction.editReply(built.error.replace(', boss', ''));
    // points prizes are paid from this server's points system: only where that feature is on
    if (built.params.prize_type === 'points' && !require('../plans').hasFeature(interaction, 'points')) {
      return interaction.editReply('A points prize needs the Points feature (premium). Use another prize text, or no prize.');
    }
    const busy = (await store.listActive(guildId)).find((t) => t.channel_id === channelId);
    if (busy) return interaction.editReply(`There is already a game in <#${channelId}> (#${busy.id}, ${busy.status}). Only one game runs per channel: cancel it first or wait for it to end.`);

    const startIn = interaction.options.getInteger('start_in') ?? 10;
    const runAt = new Date(Date.now() + startIn * MIN);
    const row = await store.create({
      guild_id: guildId,
      type: numberGuess.type,
      run_at: runAt.toISOString(),
      channel_id: channelId,
      params: built.params,
      status: 'pending',
      created_by: interaction.user.id,
      state: {},
    });
    tickSoon();
    await reportTo(guildId, interaction.client, `🎲 Game #${row.id} scheduled via /guess by ${interaction.user.tag || interaction.user.id}: ${numberGuess.describe(row)}`);
    return interaction.editReply(`Scheduled! ${numberGuess.describe(row)}`);
  },
};
