// /rumble start | cancel | status: host a Rumble Royale by hand (no AI). The engine and all checks
// live in tasks/rumbleRoyale.js, shared with control channel orders.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const rumble = require('../tasks/rumbleRoyale');
const config = require('../config');

// join window limit = RUMBLE_MAX_JOIN_MINUTES (default 1440 = 24 h), the same limit as control channel orders.
// Discord stores it when the command is registered: run `npm run deploy` after changing it.
const MAX_JOIN = Math.max(1, Math.floor(Number(config.rumble.maxJoinMinutes) || 1440));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rumble')
    .setDescription('Host a Rumble Royale (boss and staff only)')
    // hidden from regular members; the boss/staff check in code runs on every use anyway
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Preview a Rumble Royale, then press Confirm to schedule it')
        .addIntegerOption((o) => o.setName('minutes').setDescription(`Join window length in minutes (1-${MAX_JOIN})`).setMinValue(1).setMaxValue(MAX_JOIN))
        .addStringOption((o) => o.setName('prize').setDescription('e.g. "100 points" (auto-paid), "1 SOL", "NFT" (ticket)').setMaxLength(100))
        .addIntegerOption((o) => o.setName('min_players').setDescription('Minimum players, else it is cancelled').setMinValue(1).setMaxValue(1000))
        .addIntegerOption((o) => o.setName('start_in').setDescription('Open the join window in N minutes (0 = now)').setMinValue(0).setMaxValue(43200))
    )
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel the scheduled Rumble, or the one in its join window'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the current or scheduled Rumble')),
  execute: (interaction) => rumble.handleSlash(interaction),
};
