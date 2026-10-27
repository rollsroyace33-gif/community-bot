const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const supabase = require('../db');
const marketplace = require('../marketplace');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeitem')
    .setDescription('[Admin] Remove a prize')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) => o.setName('id').setDescription('Item ID').setRequired(true).setAutocomplete(true)),
  autocomplete: (interaction) => marketplace.autocompleteItems(interaction),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getInteger('id');
    const { data, error } = await supabase.from('items').update({ active: false }).eq('id', id).eq('active', true).select();
    if (error) throw error;
    if (!data || data.length === 0) return interaction.editReply('Item not found.');

    await marketplace.deleteItemCard(interaction.client, data[0]);
    await interaction.editReply(`🗑️ Item #${id} (${data[0].name}) has been removed.`);
  },
};
