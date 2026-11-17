const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const marketplace = require('../marketplace');
const rumble = require('../tasks/rumbleRoyale');
const plans = require('../plans');

const EPHEMERAL = MessageFlags.Ephemeral;

// THE feature lock for slash commands, buttons and menus: one place, checked before anything runs.
// true = the interaction was answered here (the feature is locked in this server) and must not run.
// HΛVØCZ always has every feature, so this never triggers there.
async function locked(interaction, feature) {
  if (!feature || plans.hasFeature(interaction, feature)) return false;
  const isAdmin = !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  await interaction.reply({ content: plans.lockedText(isAdmin), flags: EPHEMERAL }).catch(() => {});
  return true;
}

module.exports = async function onInteractionCreate(interaction) {
  // Vexo only works inside servers (every command is registered as server-only; this is the safety net)
  if (typeof interaction.inGuild === 'function' && !interaction.inGuild()) {
    if (interaction.isRepliable?.()) await interaction.reply({ content: 'Please use me inside a server.', flags: EPHEMERAL }).catch(() => {});
    return;
  }

  if (interaction.isAutocomplete()) {
    const cmd = interaction.client.commands.get(interaction.commandName);
    try {
      if (!plans.hasFeature(interaction, plans.COMMAND_FEATURES[interaction.commandName]) && plans.COMMAND_FEATURES[interaction.commandName]) return await interaction.respond([]);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction);
    } catch (err) {
      console.error('autocomplete error:', err);
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.client.commands.get(interaction.commandName);
      if (!cmd) return;
      if (await locked(interaction, plans.COMMAND_FEATURES[interaction.commandName])) return;
      await cmd.execute(interaction);
      return;
    }
    const customId = interaction.customId || '';
    // /setup menus, pickers and its modal
    if (customId.startsWith('setup:')) return await require('../commands/setup').handleComponent(interaction);
    // scam alert buttons in the logs channel: Kick / Ban / Ignore (admins only, checked inside)
    if (customId.startsWith('scam:')) return await require('../scam').handleButton(interaction);
    if (await locked(interaction, plans.componentFeature(customId))) return;
    // points raffles: Join / Buy more buttons and the ticket amount menu ("rf:..."; state is in the database)
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && customId.startsWith('rf:')) return await require('../raffle').handleComponent(interaction);

    // shop: Purchase button, page buttons, item select menu, Confirm / Back (handles its own errors)
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && customId.startsWith('shop:')) {
      return await marketplace.handleShop(interaction);
    }
    if (interaction.isButton()) {
      // Rumble Royale: Join button + /rumble preview Confirm / Cancel (handles its own errors)
      if (customId.startsWith('rumble_')) return await rumble.handleButton(interaction);
      // giveaways: Join / Leave ("gw:join:<id>", "gw:leave:<id>"; state is in the database, so they survive restarts)
      if (customId.startsWith('gw:')) return await require('../giveaway').handleButton(interaction);
      // NFT Radar: Approve / Reject under an approval request in the logs channel (admins only, checked inside)
      if (customId.startsWith('nftr:')) return await require('../nftRadar').handleButton(interaction);
      if (customId === 'mypoints') return await marketplace.handleMyPoints(interaction);
      const [action, rawId] = customId.split(':');
      const id = Number(rawId);
      if (action === 'redeem') return await marketplace.handleRedeem(interaction, id);
      if (action === 'ticket') return await marketplace.handleOpenTicket(interaction, id);
      if (action === 'deliver') return await marketplace.handleDeliver(interaction, id);
    }
  } catch (err) {
    console.error('interaction error:', err);
    const msg = { content: 'Something went wrong, please try again.', flags: EPHEMERAL };
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
};
