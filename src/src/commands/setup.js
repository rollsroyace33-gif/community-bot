// /setup: (re)creates anything missing, then lets the admin change settings with Discord menus
// (no copying of IDs): swap a channel for an existing one, the game ping role, knowledge source
// channels, the boss, and the ticket instructions. Manage Server or the boss of this server.
//
// HΛVØCZ (home server): nothing is created automatically. The menus save choices in its guilds row; a choice
// wins over the .env value, anything not chosen keeps its .env value. A "Create missing channels" button
// creates (or reuses by name) only what is missing, and only when pressed. The boss (BOSS_USER_ID) and the
// ticket text of HΛVØCZ are not changed here.
const {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const guilds = require('../guilds');
const plans = require('../plans');
const setup = require('../setup');
const learn = require('../learn');
const identity = require('../identity');

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
// HΛVØCZ: the channels /setup may change (saved key -> label). Same saved keys as other servers + welcome / ask.
const HOME_CHANNEL_LABELS = {
  control: 'Control channel (private, talk to Vexo)',
  logs: 'Logs channel (private: feature logs, approvals, scam alerts)',
  marketplace: 'Marketplace channel (points shop)',
  rumble: 'Rumble channel',
  games: 'Number guess + daily top chatter channel',
  xDrop: 'X posts channel',
  giveaway: 'Giveaway channel',
  nftRadar: 'NFT Radar channel',
  solRadar: 'SOL Radar channel',
  welcome: 'Welcome channel (new members)',
  ask: 'Ask channel (Q&A)',
};
const SHORT = { control: 'Control', logs: 'Logs', marketplace: 'Marketplace', rumble: 'Rumble', games: 'Number guess', xDrop: 'X posts', giveaway: 'Giveaways', nftRadar: 'NFT Radar', solRadar: 'SOL Radar', welcome: 'Welcome', ask: 'Ask (Q&A)' };

// the channel choices this server gets (keys tied to a switched-off flag are hidden)
const channelKeys = (guildId) =>
  guilds.isHome(guildId) ? Object.entries(HOME_CHANNEL_LABELS) : Object.entries(CHANNEL_KEYS).filter(([k]) => !setup.KEYS[k]?.flag || guilds.settings(guildId)[setup.KEYS[k].flag] === true);
const labelOf = (guildId, key) => (guilds.isHome(guildId) ? HOME_CHANNEL_LABELS : CHANNEL_KEYS)[key] || key;
// Manage Server, or the boss of THIS server
const isManager = (interaction) => !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || identity.isBoss(interaction.user, interaction);

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

// HΛVØCZ: every channel with where it comes from
function homeSummary(missing) {
  const s = guilds.settings(guilds.homeId());
  const src = guilds.homeChannelSources();
  const tag = (x) => (x.from === 'setup' ? '(/setup)' : x.from === 'env' ? '(.env)' : '');
  const line = (k) => {
    const x = src[guilds.HOME_CHANNEL_KEYS[k]];
    return `${SHORT[k]}: ${x.id ? `<#${x.id}> ${tag(x)}` : '*not set*'}`;
  };
  const keys = Object.keys(HOME_CHANNEL_LABELS);
  const rows = [];
  for (let i = 0; i < keys.length; i += 3) rows.push(keys.slice(i, i + 3).map(line).join(' · '));
  if (!src.logs.id && s.channels.redeemLogs) rows.push(`(Feature logs use the purchase log channel <#${s.channels.redeemLogs}> (.env) until you choose a logs channel.)`);
  const saved = guilds.get(guilds.homeId())?.settings || {};
  const roleFrom = typeof saved.pingRoleId === 'string' ? '(/setup)' : s.pingRoleId ? '(.env)' : '';
  rows.push(`Game ping role: ${s.pingRoleId ? `<@&${s.pingRoleId}> ${roleFrom}` : '*none*'} · Boss: ${s.bossUserId ? `<@${s.bossUserId}>` : '*not set*'} (BOSS_USER_ID, not changed here)`);
  rows.push(`Knowledge sources: ${s.knowledgeSources.length ? s.knowledgeSources.map((id) => `<#${id}>`).join(', ') : '*none chosen* (Vexo uses knowledge.md + what the boss teaches)'}`);
  rows.push(missing.length ? `Missing channels: ${missing.map((k) => `**${SHORT[k]}**`).join(', ')} (press **Create missing channels** to make them)` : 'No channel is missing.');
  return rows.join('\n');
}

function menuRow(guildId) {
  const home = guilds.isHome(guildId);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup:menu')
      .setPlaceholder('What do you want to change?')
      .addOptions(
        ...channelKeys(guildId).map(([value, label]) => ({ label, value: `ch:${value}` })),
        { label: 'Role to ping for games', value: 'role' },
        { label: 'Knowledge source channels (announcements, roadmap, rules, FAQ...)', value: 'sources' },
        ...(home
          ? []
          : [
              { label: 'Boss (the admin Vexo obeys in the control channel)', value: 'boss' },
              { label: 'Ticket instructions (how winners and buyers claim prizes)', value: 'ticket' },
            ])
      )
  );
}
const createRow = (missing) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:createhome').setLabel(missing.length ? `Create missing channels (${missing.length})` : 'Create missing channels').setStyle(ButtonStyle.Primary).setDisabled(!missing.length)
  );

async function panel(guild, note = '') {
  const guildId = guild?.id || guilds.homeId();
  if (guilds.isHome(guildId)) {
    const missing = guild ? await setup.missingHome(guild) : [];
    return {
      content: `${note ? `${note}\n\n` : ''}**Vexo setup · home server**\nA channel chosen here is used instead of the .env value; everything else keeps its .env value. Nothing is created unless you press the button.\n${homeSummary(missing)}`.slice(0, 1950),
      components: [menuRow(guildId), createRow(missing)],
      allowedMentions: { parse: [] },
    };
  }
  return { content: `${note ? `${note}\n\n` : ''}**Vexo setup**\n${summary(guildId)}\n\nPick something to change, or dismiss this message when you are done.`.slice(0, 1950), components: [menuRow(guildId)], allowedMentions: { parse: [] } };
}

async function execute(interaction) {
  if (!isManager(interaction)) return interaction.reply({ content: 'Only the boss or members with Manage Server can use /setup.', ...EPH });
  await interaction.deferReply(EPH);
  if (guilds.isHome(interaction)) return interaction.editReply(await panel(interaction.guild)); // nothing is created automatically here
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
  return interaction.editReply(await panel(interaction.guild, note));
}

// every component / modal whose customId starts with "setup:" (routed from interactionCreate)
async function handleComponent(interaction) {
  if (!isManager(interaction)) return interaction.reply({ content: 'Only the boss or members with Manage Server can do this.', ...EPH });
  const guildId = interaction.guildId;
  const home = guilds.isHome(guildId);
  const [, kind, key] = interaction.customId.split(':');
  const textTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  const withMenu = (content, row) => interaction.update({ content, components: [row, menuRow(guildId)], allowedMentions: { parse: [] } });
  const show = async (note = '') => interaction.update(await panel(interaction.guild, note));

  // ---- HΛVØCZ: the "Create missing channels" button (the only way channels are ever made there)
  if (kind === 'createhome') {
    if (!home) return show();
    await interaction.deferUpdate();
    const res = await setup.createMissingHome(interaction.guild);
    let note;
    if (res.error === 'missing_permissions') note = setup.permissionHelp(res.missing);
    else if (res.error) note = `⚠️ I could not create the channels: ${res.error}.`;
    else if (!res.created.length && !res.reused.length) note = '✅ Nothing was missing.';
    else note = [res.created.length && `✅ Created: ${res.created.map((k) => `**${setup.KEYS[k].name}**`).join(', ')}.`, res.reused.length && `♻️ Found and now using: ${res.reused.map((k) => `**${setup.KEYS[k].name}**`).join(', ')} (already existed, not duplicated).`].filter(Boolean).join('\n');
    return interaction.editReply(await panel(interaction.guild, note));
  }

  // ---- the main menu: show the matching picker
  if (kind === 'menu') {
    const pick = interaction.values[0];
    if (pick.startsWith('ch:')) {
      const k = pick.slice(3);
      const picker = new ChannelSelectMenuBuilder().setCustomId(`setup:ch:${k}`).setChannelTypes(ChannelType.GuildText).setPlaceholder('Choose a channel');
      if (home) picker.setMinValues(0).setMaxValues(1); // choose none = use the .env value again
      return withMenu(`Choose the channel to use as: **${labelOf(guildId, k)}**${home ? '\n(Choose none to go back to the .env value.)' : ''}`, new ActionRowBuilder().addComponents(picker));
    }
    if (pick === 'role') return withMenu('Choose the role I ping when a game opens (choose none to ping nobody).', new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('setup:role').setMinValues(0).setMaxValues(1).setPlaceholder('Choose a role')));
    if (pick === 'sources') return withMenu(`Choose the channels I should learn from (announcements, roadmap, lore, rules, FAQ...). I read their history once and keep learning from new posts. I never learn from normal chat channels unless you pick them here.${home ? ' In this server they are learned into a separate sheet: knowledge.md and the facts the boss taught are never changed.' : ''}`, new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('setup:sources').setChannelTypes(...textTypes).setMinValues(0).setMaxValues(10).setPlaceholder('Choose up to 10 channels')));
    if (pick === 'boss' && !home) return withMenu('Choose the admin I call "boss" and obey in the control channel.', new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('setup:boss').setPlaceholder('Choose a member')));
    if (pick === 'ticket' && !home) {
      const input = new TextInputBuilder().setCustomId('text').setLabel('What should winners and buyers do?').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(true).setValue(guilds.settings(guildId).ticketInstructions.slice(0, 300));
      return interaction.showModal(new ModalBuilder().setCustomId('setup:ticketmodal').setTitle('Ticket instructions').addComponents(new ActionRowBuilder().addComponents(input)));
    }
    return show();
  }

  // ---- a picker was used: save
  if (kind === 'ticketmodal') {
    if (home) return show();
    const text = interaction.fields.getTextInputValue('text').replace(/@(everyone|here)/gi, '').replace(/\s+/g, ' ').trim().slice(0, 300);
    await guilds.update(guildId, { ticket_instructions: text || guilds.DEFAULT_TICKET_TEXT });
    return show('✅ Ticket instructions saved.');
  }
  if (kind === 'ch') {
    if (!channelKeys(guildId).some(([k]) => k === key)) return show(); // not a channel this server can set
    const id = interaction.values[0] || '';
    if (!id) {
      if (!home) return show();
      await guilds.patchSettings(guildId, { channels: { [key]: '' } });
      return show(`✅ ${labelOf(guildId, key)}: back to the .env value.`);
    }
    // feature logs never go to the shop: the logs and marketplace channels must be different
    const c = guilds.settings(guildId).channels;
    if ((key === 'logs' && id === c.marketplace) || (key === 'marketplace' && id === c.logs)) {
      return show('⚠️ The logs channel and the marketplace (shop) channel must be different channels. Logs never go to the shop.');
    }
    const channel = interaction.guild.channels.cache.get(id);
    const me = interaction.guild.members.me;
    const perms = channel && me ? channel.permissionsFor(me) : null;
    if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return show(`⚠️ I cannot see or write in <#${id}>. Give my role **View Channel** and **Send Messages** there, then choose it again.`);
    }
    await guilds.patchSettings(guildId, { channels: { [key]: id } });
    if (key === 'marketplace' && plans.hasFeature(guildId, 'marketplace')) await require('../marketplace').ensureHeader(interaction.client, guildId).catch(() => {});
    return show(`✅ ${labelOf(guildId, key)} is now <#${id}>.`);
  }
  if (kind === 'role') {
    const id = interaction.values[0] || '';
    await guilds.patchSettings(guildId, { pingRoleId: id });
    return show(id ? `✅ I will ping <@&${id}> for games. (The role must be mentionable, or my role needs "Mention @everyone, @here and All Roles".)` : '✅ I will not ping any role for games.');
  }
  if (kind === 'boss') {
    if (home) return show();
    const id = interaction.values[0];
    if (interaction.users?.get(id)?.bot) return show('⚠️ A bot cannot be the boss. Choose a member.');
    await guilds.update(guildId, { boss_user_id: id });
    return show(`✅ <@${id}> is now my boss in this server.`);
  }
  if (kind === 'sources') {
    const ids = [...interaction.values];
    await guilds.patchSettings(guildId, { knowledgeSources: ids });
    if (!ids.length) return show(home ? '✅ No knowledge source channels. I use knowledge.md and what the boss teaches me in the control channel.' : '✅ No knowledge source channels. I only learn what the boss teaches me in the control channel.');
    if (!plans.hasFeature(guildId, 'knowledgeQa')) return show(`✅ Saved. ${plans.lockedText(true)} I will read these channels when premium is active (use \`/knowledge refresh\`).`);
    await show('✅ Saved. 📚 I am reading the history of the new source channels now. This can take a minute; check the result with `/knowledge view`.');
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
  return show();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('[Admin] Set up Vexo: channels, game ping role, knowledge sources, ticket text')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  execute,
  handleComponent,
};
