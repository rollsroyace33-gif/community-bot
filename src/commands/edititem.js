const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const supabase = require('../db');
const marketplace = require('../marketplace');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edititem')
    .setDescription('[Admin] Edit a prize')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) => o.setName('id').setDescription('Item ID').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('name').setDescription('New name').setMaxLength(100))
    .addIntegerOption((o) => o.setName('price').setDescription('New price').setMinValue(1))
    .addIntegerOption((o) => o.setName('stock').setDescription('New stock').setMinValue(0))
    .addStringOption((o) => o.setName('description').setDescription('New description').setMaxLength(500))
    .addStringOption((o) => o.setName('image_url').setDescription('New image link')),
  autocomplete: (interaction) => marketplace.autocompleteItems(interaction),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getInteger('id');
    const patch = {};
    for (const key of ['name', 'description', 'image_url']) {
      const v = interaction.options.getString(key);
      if (v !== null) patch[key] = v;
    }
    const price = interaction.options.getInteger('price');
    const stock = interaction.options.getInteger('stock');
    if (price !== null) patch.price = price;
    if (stock !== null) patch.stock = stock;
    if (Object.keys(patch).length === 0) return interaction.editReply('You did not specify anything to change.');

    const { data, error } = await supabase.from('items').update(patch).eq('id', id).eq('active', true).select();
    if (error) throw error;
    if (!data || data.length === 0) return interaction.editReply('Item not found.');

    await marketplace.refreshItemCard(interaction.client, id);
    await interaction.editReply(`✅ Item #${id} has been updated.`);
  },
};
