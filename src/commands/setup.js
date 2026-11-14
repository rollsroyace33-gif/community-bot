// /setup: (re)creates anything missing, then lets the admin change settings with Discord menus
// (no copying of IDs): swap a channel for an existing one, the game ping role, knowledge source
// channels, the boss, and the ticket instructions. Manage Server only. Not used in HΛVØCZ (it keeps .env).
const {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType,
} = require('discord.js');
const guilds = require('../guilds');
const plans = require('../plans');
const setup = require('../setup');
const learn = require('../learn');

const EPH = { flags: MessageFlags.Ephemeral };
const CHANNEL_KEYS = {
  control: 'Control channel (private, talk to Vexo)',
  marketplace: 'Marketplace channel (points shop)',
  rumble: 'Rumble channel',
  games: 'Number guess channel',
  xDrop: 'X posts channel (members earn points for X links)',
  giveaway: 'Giveaway channel',
  nftRadar: 'NFT Radar channel',
  solRadar: 'SOL Radar channel',
  assistant: 'Get Vexo Assistant channel (members request Personal Vexo)', // only offered where Personal Vexo is on
  logs: 'Logs channel (private)',
};
// the channel choices this server gets (keys tied to a switched-off flag are hidden)
const channelKeys = (guildId) => Object.entries(CHANNEL_KEYS).filter(([k]) => !setup.KEYS[k]?.flag || guilds.settings(guildId)[setup.KEYS[k].flag] === true);
const isManager = (interaction) => !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

function summary(guildId) {
  const s = guilds.settings(guildId);
  const c = s.channels;
  const ch = (id) => (id ? `<#${id}>` : '*not set*');
  return [
    `Control: ${ch(c.control)} · Marketplace: ${ch(c.marketplace)} · Rumble: ${ch(c.rumble)}`,
    `Number guess: ${ch(c.general)} · X posts: ${ch(c.xDrop)} · Giveaways: ${ch(c.giveaway)} · Logs: ${ch(c.logs)}`,
    `NFT Radar: ${ch(c.nftRadar)} · SOL Radar: ${ch(c.solRadar)}${s.personalVexo ? ` · Get Vexo Assistant: ${ch(c.assistant)}` : ''}`,
    `Game ping role: ${s.pingRoleId ? `<@&${s.pingRoleId}>` : '*none*'} · Boss: ${s.bossUserId ? `<@${s.bossUserId}>` : '*not set*'}`,
    `Knowledge sources: ${s.knowledgeSources.length ? s.knowledgeSources.map(ch).join(', ') : '*none chosen*'}`,
    `Ticket instructions: "${s.ticketInstructions}"`,
  ].join('\n');
}

function menuRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup:menu')
      .setPlaceholder('What do you want to change?')
      .addOptions(
        ...channelKeys(guildId).map(([value, label]) => ({ label, value: `ch:${value}` })),
        { label: 'Role to ping for games', value: 'role' },
        { label: 'Knowledge source channels (announcements, roadmap, rules, FAQ...)', value: 'sources' },
        { label: 'Boss (the admin Vexo obeys in the control channel)', value: 'boss' },
        { label: 'Ticket instructions (how winners and buyers claim prizes)', value: 'ticket' }
      )
  );
}
const panel = (guildId, note = '') => ({ content: `${note ? `${note}\n\n` : ''}**Vexo setup**\n${summary(guildId)}\n\nPick something to change, or dismiss this message when you are done.`.slice(0, 1950), components: [menuRow(guildId)], allowedMentions: { parse: [] } });

async function execute(interaction) {
  if (!isManager(interaction)) return interaction.reply({ content: 'Only members with Manage Server can use /setup.', ...EPH });
  if (guilds.isHome(interaction)) return interaction.reply({ content: 'This is the home server: its channels and roles come from the bot\'s own configuration, so there is nothing to set up here.', ...EPH });
  await interaction.deferReply(EPH);
  if (!guilds.get(interaction)) await guilds.join(interaction.guild); // joined while the bot was offline
  const res = await setup.ensureChannels(interaction.guild);
  let note = '';
  if (res.error === 'missing_permissions') note = setup.permissionHelp(res.missing);
  else if (res.error) note = `⚠️ Setup hit a problem: ${res.error}. Try /setup again.`;
  else {
    note = res.created.length ? `✅ Created: ${res.created.map((k) => `**${setup.KEYS[k].name}**`).join(', ')}.` : '✅ Everything is in place, nothing new was created.';
    if (res.missing.length) note += `\n⚠️ Still missing permissions: **${res.missing.join(', ')}** (some features will not work until my role has them).`;
    if (res.created.includes('marketplace') && plans.hasFeature(interaction, 'marketplace')) {
      await require('../marketplace').ensureHeader(interaction.client, interaction.guildId).catch(() => {});
    }
  }
  return interaction.editReply(panel(interaction.guildId, note));
}

// every component / modal whose customId starts with "setup:" (routed from interactionCreate)
async function handleComponent(interaction) {
  if (!isManager(interaction)) return interaction.reply({ content: 'Only members with Manage Server can do this.', ...EPH });
  if (guilds.isHome(interaction)) return interaction.reply({ content: 'Nothing to set up in the home server.', ...EPH });
  const guildId = interaction.guildId;
  const [, kind, key] = interaction.customId.split(':');
  const textTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  const withMenu = (content, row) => interaction.update({ content, components: [row, menuRow(guildId)], allowedMentions: { parse: [] } });

  // ---- the main menu: show the matching picker
  if (kind === 'menu') {
    const pick = interaction.values[0];
    if (pick.startsWith('ch:')) {
      const k = pick.slice(3);
      return withMenu(`Choose the channel to use as: **${CHANNEL_KEYS[k]}**`, new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`setup:ch:${k}`).setChannelTypes(ChannelType.GuildText).setPlaceholder('Choose a channel')));
    }
    if (pick === 'role') return withMenu('Choose the role I ping when a game opens (choose none to ping nobody).', new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('setup:role').setMinValues(0).setMaxValues(1).setPlaceholder('Choose a role')));
    if (pick === 'sources') return withMenu('Choose the channels I should learn from (announcements, roadmap, lore, rules, FAQ...). I read their history once and keep learning from new posts. I never learn from normal chat channels unless you pick them here.', new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('setup:sources').setChannelTypes(...textTypes).setMinValues(0).setMaxValues(10).setPlaceholder('Choose up to 10 channels')));
    if (pick === 'boss') return withMenu('Choose the admin I call "boss" and obey in the control channel.', new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('setup:boss').setPlaceholder('Choose a member')));
    if (pick === 'ticket') {
      const input = new TextInputBuilder().setCustomId('text').setLabel('What should winners and buyers do?').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(true).setValue(guilds.settings(guildId).ticketInstructions.slice(0, 300));
      return interaction.showModal(new ModalBuilder().setCustomId('setup:ticketmodal').setTitle('Ticket instructions').addComponents(new ActionRowBuilder().addComponents(input)));
    }
    return interaction.update(panel(guildId));
  }

  // ---- a picker was used: save
  if (kind === 'ticketmodal') {
    const text = interaction.fields.getTextInputValue('text').replace(/@(everyone|here)/gi, '').replace(/\s+/g, ' ').trim().slice(0, 300);
    await guilds.update(guildId, { ticket_instructions: text || guilds.DEFAULT_TICKET_TEXT });
    return interaction.update(panel(guildId, '✅ Ticket instructions saved.'));
  }
  if (kind === 'ch') {
    if (!channelKeys(guildId).some(([k]) => k === key)) return interaction.update(panel(guildId)); // not a channel this server can set
    const id = interaction.values[0];
    const channel = interaction.guild.channels.cache.get(id);
    const me = interaction.guild.members.me;
    const perms = channel && me ? channel.permissionsFor(me) : null;
    if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return interaction.update(panel(guildId, `⚠️ I cannot see or write in <#${id}>. Give my role **View Channel** and **Send Messages** there, then choose it again.`));
    }
    await guilds.patchSettings(guildId, { channels: { [key]: id } });
    if (key === 'marketplace' && plans.hasFeature(guildId, 'marketplace')) await require('../marketplace').ensureHeader(interaction.client, guildId).catch(() => {});
    return interaction.update(panel(guildId, `✅ ${CHANNEL_KEYS[key]} is now <#${id}>.`));
  }
  if (kind === 'role') {
    const id = interaction.values[0] || '';
    await guilds.patchSettings(guildId, { pingRoleId: id });
    return interaction.update(panel(guildId, id ? `✅ I will ping <@&${id}> for games. (The role must be mentionable, or my role needs "Mention @everyone, @here and All Roles".)` : '✅ I will not ping any role for games.'));
  }
  if (kind === 'boss') {
    const id = interaction.values[0];
    if (interaction.users?.get(id)?.bot) return interaction.update(panel(guildId, '⚠️ A bot cannot be the boss. Choose a member.'));
    await guilds.update(guildId, { boss_user_id: id });
    return interaction.update(panel(guildId, `✅ <@${id}> is now my boss in this server.`));
  }
  if (kind === 'sources') {
    const ids = [...interaction.values];
    await guilds.patchSettings(guildId, { knowledgeSources: ids });
    if (!ids.length) return interaction.update(panel(guildId, '✅ No knowledge source channels. I only learn what the boss teaches me in the control channel.'));
    if (!plans.hasFeature(guildId, 'knowledgeQa')) return interaction.update(panel(guildId, `✅ Saved. ${plans.lockedText(true)} I will read these channels when premium is active (use \`/knowledge refresh\`).`));
    await interaction.update(panel(guildId, '✅ Saved. 📚 I am reading the history of the new source channels now. This can take a minute; check the result with `/knowledge view`.'));
    // in the background: never blocks the menu
    learn
      .readNewSources(interaction.client, guildId)
      .then((results) => {
        const lines = results.map((r) => `<#${r.channelId}>: ${r.error ? `⚠️ ${r.error}` : `read ${r.read} messages, learned from ${r.learned} posts`}`);
        if (lines.length) return interaction.followUp({ content: `📚 Finished reading:\n${lines.join('\n')}`.slice(0, 1900), allowedMentions: { parse: [] }, ...EPH });
        return null;
      })
      .catch((err) => console.error('setup sources:', err.message));
    return null;
  }
  return interaction.update(panel(guildId));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('[Admin] Set up Vexo: channels, game ping role, knowledge sources, ticket text')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  execute,
  handleComponent,
};
