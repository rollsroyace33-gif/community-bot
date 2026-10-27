const { MessageFlags } = require('discord.js');
const marketplace = require('../marketplace');
const rumble = require('../tasks/rumbleRoyale');

module.exports = async function onInteractionCreate(interaction) {
  if (interaction.isAutocomplete()) {
    const cmd = interaction.client.commands.get(interaction.commandName);
    try {
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
      if (cmd) await cmd.execute(interaction);
      return;
    }
    // shop: Purchase button, page buttons, item select menu, Confirm / Back (handles its own errors)
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('shop:')) {
      return await marketplace.handleShop(interaction);
    }
    if (interaction.isButton()) {
      // Rumble Royale: Join button + /rumble preview Confirm / Cancel (handles its own errors)
      if (interaction.customId.startsWith('rumble_')) return await rumble.handleButton(interaction);
      if (interaction.customId === 'mypoints') return await marketplace.handleMyPoints(interaction);
      const [action, rawId] = interaction.customId.split(':');
      const id = Number(rawId);
      if (action === 'redeem') return await marketplace.handleRedeem(interaction, id);
      if (action === 'ticket') return await marketplace.handleOpenTicket(interaction, id);
      if (action === 'deliver') return await marketplace.handleDeliver(interaction, id);
    }
  } catch (err) {
    console.error('interaction error:', err);
    const msg = { content: 'Something went wrong, please try again.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
};
