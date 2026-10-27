const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const supabase = require('../db');
const marketplace = require('../marketplace');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('repostitem')
    .setDescription('[Admin] Post a fresh card for a prize (removes the old card)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) => o.setName('id').setDescription('Item ID').setRequired(true).setAutocomplete(true)),
  autocomplete: (interaction) => marketplace.autocompleteItems(interaction),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getInteger('id');
    const { data: item, error } = await supabase.from('items').select('*').eq('id', id).eq('active', true).maybeSingle();
    if (error) throw error;
    if (!item) return interaction.editReply('Item not found.');

    try {
      await marketplace.repostItemCard(interaction.client, item);
      await interaction.editReply(`✅ A fresh card for **#${item.id} ${item.name}** has been posted.`);
    } catch (e) {
      await interaction.editReply(`The card could not be posted: ${e.message}`);
    }
  },
};
