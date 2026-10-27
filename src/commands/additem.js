const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const supabase = require('../db');
const marketplace = require('../marketplace');
const { isAdmin } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('additem')
    .setDescription('[Admin] Add a new prize to the marketplace')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('name').setDescription('Prize name').setRequired(true).setMaxLength(100))
    .addIntegerOption((o) => o.setName('price').setDescription('Price in points').setRequired(true).setMinValue(1))
    .addIntegerOption((o) => o.setName('stock').setDescription('How many are available').setRequired(true).setMinValue(1))
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Prize type')
        .setRequired(true)
        .addChoices(
          { name: 'Role (auto deliver)', value: 'role' },
          { name: 'Whitelist', value: 'whitelist' },
          { name: 'Merch', value: 'merch' },
          { name: 'Giveaway entry', value: 'giveaway' },
          { name: 'Other', value: 'other' }
        )
    )
    .addStringOption((o) => o.setName('description').setDescription('Prize description').setMaxLength(500))
    .addRoleOption((o) => o.setName('role').setDescription('Role to give (when type is Role)'))
    .addStringOption((o) => o.setName('image_url').setDescription('Permanent image link (https://...)')),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const type = interaction.options.getString('type');
    const role = interaction.options.getRole('role');
    if (type === 'role' && !role) return interaction.editReply('When the type is **Role**, please set the `role` option.');

    const { data: item, error } = await supabase
      .from('items')
      .insert({
        name: interaction.options.getString('name'),
        price: interaction.options.getInteger('price'),
        stock: interaction.options.getInteger('stock'),
        type,
        role_id: role ? role.id : null,
        description: interaction.options.getString('description') || '',
        image_url: interaction.options.getString('image_url') || null,
      })
      .select()
      .single();
    if (error) throw error;

    try {
      await marketplace.postItemCard(interaction.client, item);
      await interaction.editReply(`✅ Item **#${item.id} ${item.name}** has been added to the marketplace.`);
    } catch (e) {
      await interaction.editReply(`Item saved (#${item.id}), but the card could not be posted: ${e.message}`);
    }
  },
};
