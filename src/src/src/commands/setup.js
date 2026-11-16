// /setup: the SAME setup for every server, HΛVØCZ included: the same menu, the same channel pickers, the same
// checks, and the choices saved per server in the guilds table. Manage Server or the boss of this server.
//
// The only differences in HΛVØCZ (the home server):
//   - anything NOT chosen in /setup falls back to its .env value (choose "none" in a picker = back to .env);
//   - nothing is created automatically: a "Create missing channels" button creates sol-radar, nft-radar and
//     giveaways only when pressed. Customer servers get their channels from the automatic setup instead.
const {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const guilds = require('../guilds');
const plans = require('../plans');
const setup = require('../setup');
const learn = require('../learn');
const identity = require('../identity');
const { BUILD } = require('../build');

const EPH = { flags: MessageFlags.Ephemeral };
const BUILD_LINE = `-# build: ${BUILD}`;
// ONE list of channels for every server (saved key -> label). "assistant" only where Personal Vexo is on.
const CHANNEL_KEYS = {
  control: 'Control channel (private, talk to Vexo)',
  logs: 'Logs channel (private: feature logs, approvals, scam alerts)',
  marketplace: 'Marketplace channel (points shop)',
  rumble: 'Rumble channel',
  games: 'Number guess + daily top chatter channel',
  xDrop: 'X posts channel (members earn points for X links)',
  giveaway: 'Giveaway channel',
  nftRadar: 'NFT Radar channel',
  solRadar: 'SOL Radar channel',
  welcome: 'Welcome channel (new members)',
  ask: 'Ask channel (Q&A)',
  assistant: 'Get Vexo Assistant channel (members request Personal Vexo)',
};
const SHORT = { control: 'Control', logs: 'Logs', marketplace: 'Marketplace', rumble: 'Rumble', games: 'Number guess', xDrop: 'X posts', giveaway: 'Giveaways', nftRadar: 'NFT Radar', solRadar: 'SOL Radar', welcome: 'Welcome', ask: 'Ask (Q&A)', assistant: 'Get Vexo Assistant' };
// saved key -> the settings.channels key the features read
const FEATURE_OF = { games: 'general' };

// the channel choices (identical everywhere; a key tied to a switched-off flag is hidden)
const channelKeys = (guildId) => Object.entries(CHANNEL_KEYS).filter(([k]) => !setup.KEYS[k]?.flag || guilds.settings(guildId)[setup.KEYS[k].flag] === true);
const labelOf = (key) => CHANNEL_KEYS[key] || key;
// Manage Server, or the boss of THIS server
const isManager = (interaction) => !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || identity.isBoss(interaction.user, interaction);

// the same summary in every server; HΛVØCZ also shows where each value comes from
function summary(guildId) {
  const s = guilds.settings(guildId);
  const home = s.isHome;
  const src = home ? guilds.homeChannelSources() : {};
  const tag = (key) => (!home ? '' : src[key]?.from === 'setup' ? ' (/setup)' : src[key]?.from === 'env' ? ' (.env)' : '');
  const line = (k) => {
    const key = FEATURE_OF[k] || k;
    const id = guilds.getFeatureChannel(s, key); // exactly the channel the feature uses
    return `${SHORT[k]}: ${id ? `<#${id}>${tag(key)}` : '*not set*'}`;
  };
  const keys = channelKeys(guildId).map(([k]) => k);
  const rows = [];
  for (let i = 0; i < keys.length; i += 3) rows.push(keys.slice(i, i + 3).map(line).join(' · '));
  const row = guilds.get(guildId);
  const saved = row?.settings || {};
  const roleFrom = home ? (typeof saved.pingRoleId === 'string' ? ' (/setup)' : s.pingRoleId ? ' (.env)' : '') : '';
  const bossFrom = home ? (String(row?.boss_user_id || '').trim() ? ' (/setup)' : s.bossUserId ? ' (.env)' : '') : '';
  rows.push(`Game ping role: ${s.pingRoleId ? `<@&${s.pingRoleId}>${roleFrom}` : '*none*'} · Boss: ${s.bossUserId ? `<@${s.bossUserId}>${bossFrom}` : '*not set*'}`);
  rows.push(`Knowledge sources: ${s.knowledgeSources.length ? s.knowledgeSources.map((id) => `<#${id}>`).join(', ') : '*none chosen*'}`);
  rows.push(`Ticket instructions: ${s.ticketInstructions ? `"${s.ticketInstructions}"` : home ? '*the usual HΛVØCZ ticket button (not changed)*' : '*not set*'}`);
  if (!guilds.getFeatureChannel(s, 'logs')) rows.push(`(No logs channel: feature logs and notices are not sent anywhere${home ? '. Choose one here or set LOGS_CHANNEL_ID. Purchase records keep going to REDEEM_LOGS_CHANNEL_ID' : ''}.)`);
  return rows.join('\n');
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
const createRow = (missing) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:createhome').setLabel(missing.length ? `Create missing channels (${missing.length})` : 'Create missing channels').setStyle(ButtonStyle.Primary).setDisabled(!missing.length)
  );

async function panel(guild, note = '') {
  const guildId = guild?.id || guilds.homeId();
  const home = guilds.isHome(guildId);
  const missing = home && guild ? await setup.missingHome(guild) : [];
  const homeNote = home
    ? `\nHome server: a value chosen here is used instead of the .env value; anything not chosen keeps its .env value. ${missing.length ? `Missing: ${missing.map((k) => `**${SHORT[k]}**`).join(', ')} (press **Create missing channels**).` : 'SOL Radar, NFT Radar and Giveaways all have a channel.'}`
    : '';
  return {
    content: `${BUILD_LINE}\n${note ? `${note}\n\n` : ''}**Vexo setup**\n${summary(guildId)}${homeNote}\n\nPick something to change, or dismiss this message when you are done.`.slice(0, 1990),
    components: home ? [menuRow(guildId), createRow(missing)] : [menuRow(guildId)],
    allowedMentions: { parse: [] },
  };
}

async function execute(interaction) {
  if (!isManager(interaction)) return interaction.reply({ content: `${BUILD_LINE}\nOnly the boss or members with Manage Server can use /setup.`, ...EPH });
  await interaction.deferReply(EPH);
  if (!guilds.get(interaction)) await guilds.join(interaction.guild); // joined while the bot was offline (HΛVØCZ: its row only)
  let note = '';
  // customer servers: the automatic setup makes what is missing. HΛVØCZ: nothing automatic (the button does it).
  if (!guilds.isHome(interaction)) {
    const res = await setup.ensureChannels(interaction.guild);
    if (res.error === 'missing_permissions') note = setup.permissionHelp(res.missing);
    else if (res.error) note = `⚠️ Setup hit a problem: ${res.error}. Try /setup again.`;
    else {
      note = res.created.length ? `✅ Created: ${res.created.map((k) => `**${setup.KEYS[k].name}**`).join(', ')}.` : '✅ Everything is in place, nothing new was created.';
      if (res.missing.length) note += `\n⚠️ Still missing permissions: **${res.missing.join(', ')}** (some features will not work until my role has them).`;
      if (res.created.includes('marketplace') && plans.hasFeature(interaction, 'marketplace')) {
        await require('../marketplace').ensureHeader(interaction.client, interaction.guildId).catch(() => {});
      }
    }
  }
  return interaction.editReply(await panel(interaction.guild, note));
}

// every component / modal whose customId starts with "setup:" (routed from interactionCreate)
async function handleComponent(interaction) {
  if (!isManager(interaction)) return interaction.reply({ content: `${BUILD_LINE}\nOnly the boss or members with Manage Server can do this.`, ...EPH });
  const guildId = interaction.guildId;
  const home = guilds.isHome(guildId);
  const [, kind, key] = interaction.customId.split(':');
  const textTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  const withMenu = (content, row) => interaction.update({ content: `${BUILD_LINE}\n${content}`, components: [row, menuRow(guildId)], allowedMentions: { parse: [] } });
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
    else note = [res.created.length && `✅ Created: ${res.created.map((k) => `${SHORT[k]} <#${res.ids[k]}>`).join(', ')}.`, res.reused.length && `♻️ Found and now using: ${res.reused.map((k) => `${SHORT[k]} <#${res.ids[k]}>`).join(', ')} (already existed, not duplicated or changed).`].filter(Boolean).join('\n');
    return interaction.editReply(await panel(interaction.guild, note));
  }

  // ---- the main menu: show the matching picker (the same in every server)
  if (kind === 'menu') {
    const pick = interaction.values[0];
    if (pick.startsWith('ch:')) {
      const k = pick.slice(3);
      const picker = new ChannelSelectMenuBuilder().setCustomId(`setup:ch:${k}`).setChannelTypes(ChannelType.GuildText).setPlaceholder('Choose a channel');
      if (home) picker.setMinValues(0).setMaxValues(1); // HΛVØCZ: choose none = use the .env value again
      return withMenu(`Choose the channel to use as: **${labelOf(k)}**${home ? '\n(Choose none to go back to the .env value.)' : ''}`, new ActionRowBuilder().addComponents(picker));
    }
    if (pick === 'role') return withMenu('Choose the role I ping when a game opens (choose none to ping nobody).', new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('setup:role').setMinValues(0).setMaxValues(1).setPlaceholder('Choose a role')));
    if (pick === 'sources') return withMenu(`Choose the channels I should learn from (announcements, roadmap, lore, rules, FAQ...). I read their history once and keep learning from new posts. I never learn from normal chat channels unless you pick them here.${home ? ' In this server they are learned into a separate sheet: knowledge.md and the facts the boss taught are never changed.' : ''}`, new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('setup:sources').setChannelTypes(...textTypes).setMinValues(0).setMaxValues(10).setPlaceholder('Choose up to 10 channels')));
    if (pick === 'boss') return withMenu('Choose the admin I call "boss" and obey in the control channel.', new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('setup:boss').setPlaceholder('Choose a member')));
    if (pick === 'ticket') {
      const current = guilds.settings(guildId).ticketInstructions || guilds.DEFAULT_TICKET_TEXT;
      const input = new TextInputBuilder().setCustomId('text').setLabel('What should winners and buyers do?').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(true).setValue(current.slice(0, 300));
      return interaction.showModal(new ModalBuilder().setCustomId('setup:ticketmodal').setTitle('Ticket instructions').addComponents(new ActionRowBuilder().addComponents(input)));
    }
    return show();
  }

  // ---- a picker was used: save (the same saving in every server: this server's guilds row)
  if (kind === 'ticketmodal') {
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
      return show(`✅ ${labelOf(key)}: back to the .env value.`);
    }
    // only shop content goes to the shop: no other feature may use the marketplace channel
    const c = guilds.settings(guildId).channels;
    if (key !== 'marketplace' && id === c.marketplace) {
      return show(`⚠️ <#${id}> is the marketplace (shop) channel. Only shop content goes there, so it cannot also be the ${labelOf(key)}. Choose a different channel.`);
    }
    if (key === 'marketplace' && id === c.logs) {
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
    return show(`✅ ${labelOf(key)} is now <#${id}>.`);
  }
  if (kind === 'role') {
    const id = interaction.values[0] || '';
    await guilds.patchSettings(guildId, { pingRoleId: id });
    return show(id ? `✅ I will ping <@&${id}> for games. (The role must be mentionable, or my role needs "Mention @everyone, @here and All Roles".)` : '✅ I will not ping any role for games.');
  }
  if (kind === 'boss') {
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
  CHANNEL_KEYS,
};
