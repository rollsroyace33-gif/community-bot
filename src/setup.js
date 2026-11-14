// Automatic setup in a NEW server (never in HΛVØCZ): a "Vexo" category with
//   vexo-control (private), marketplace (members read-only), rumble, vexo-logs (private), x-posts,
//   giveaways (members read-only), 📡・nft-radar and 📈・sol-radar (members read-only),
//   and 🤖・get-vexo-assistant only where Personal Vexo is switched on for that server
// The channel IDs are saved in that server's guilds row. Idempotent: it only creates what is missing
// (also when the bot is added again or /setup runs again), and it never throws.
const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('./config');
const guilds = require('./guilds');
const plans = require('./plans');

const P = PermissionFlagsBits;
// every permission the invite link asks for, with the name Discord shows in Server Settings > Roles
const NEEDED = [
  [P.ViewChannel, 'View Channels'],
  [P.ManageChannels, 'Manage Channels'],
  [P.ManageRoles, 'Manage Roles'],
  [P.SendMessages, 'Send Messages'],
  [P.EmbedLinks, 'Embed Links'],
  [P.AttachFiles, 'Attach Files'], // giveaway pictures
  [P.ReadMessageHistory, 'Read Message History'],
  [P.AddReactions, 'Add Reactions'],
  [P.MentionEveryone, 'Mention @everyone, @here and All Roles'],
  [P.ManageMessages, 'Manage Messages'],
  [P.ModerateMembers, 'Timeout Members'],
  [P.KickMembers, 'Kick Members'], // scam protection
  [P.BanMembers, 'Ban Members'], // scam protection
];
const INVITE_PERMISSIONS = NEEDED.reduce((sum, [bit]) => sum | bit, 0n);

const KEYS = {
  control: { name: 'vexo-control', private: true, topic: 'Private: talk to Vexo here (orders, teaching). Admins and the bot only.' },
  marketplace: { name: 'marketplace', readOnly: true, topic: 'Spend your points on prizes.' },
  rumble: { name: 'rumble', topic: 'Rumble Royale and games hosted by Vexo.' },
  logs: { name: 'vexo-logs', private: true, topic: 'Private: Vexo logs (purchases, auto mod).' },
  xDrop: { name: 'x-posts', topic: 'Drop your X (Twitter) post links here to earn points.' },
  giveaway: { name: 'giveaways', readOnly: true, topic: 'Giveaways hosted by Vexo. Press Join to enter.' },
  // anywhere: a channel with this name (or one of the plain names) ANYWHERE in the server is reused, never duplicated
  nftRadar: { name: '📡・nft-radar', aliases: ['nft-radar'], anywhere: true, readOnly: true, topic: 'NFT Radar: upcoming Solana NFT mints researched by Vexo and approved by the team. Not financial advice.' },
  solRadar: { name: '📈・sol-radar', aliases: ['sol-radar'], anywhere: true, readOnly: true, topic: 'SOL Radar: daily SOL market updates in simple words. Not financial advice.' },
  // only in servers where Personal Vexo is switched on (guilds.settings().personalVexo)
  assistant: { name: '🤖・get-vexo-assistant', aliases: ['get-vexo-assistant'], anywhere: true, readOnly: true, flag: 'personalVexo', topic: 'Request your own Personal Vexo assistant here.' },
};
// Raise this number whenever a channel is added to KEYS. A server whose saved number is lower gets the new
// channels ONCE at the next bot start (upgradeExisting below), without its admin having to run /setup.
const SETUP_VERSION = 2; // 2 = nft-radar + sol-radar
// the channels this server should have (a key with a flag only where that flag is on)
const wantedKeys = (guildId) => Object.entries(KEYS).filter(([, spec]) => !spec.flag || guilds.settings(guildId)[spec.flag] === true);

async function me(guild) {
  return guild.members.me || (await guild.members.fetchMe());
}

// names of the server-wide permissions the bot does NOT have
async function missingPermissions(guild) {
  const perms = (await me(guild)).permissions;
  return NEEDED.filter(([bit]) => !perms.has(bit)).map(([, name]) => name);
}

function overwritesFor(guild, botId, spec, bossId) {
  const botAllow = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.AddReactions, P.ManageMessages];
  if (spec.private) {
    const list = [
      { id: guild.id, deny: [P.ViewChannel] }, // @everyone cannot see it (server admins always can)
      { id: botId, allow: botAllow },
    ];
    if (bossId) list.push({ id: bossId, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] });
    return list;
  }
  if (spec.readOnly) {
    return [
      { id: guild.id, deny: [P.SendMessages] },
      { id: botId, allow: botAllow },
    ];
  }
  return [{ id: botId, allow: botAllow }];
}

// Create whatever is missing. Returns { created: [keys], kept: [keys], missing: [permission names], error }
async function ensureChannels(guild) {
  const out = { created: [], kept: [], missing: [], error: null };
  if (guilds.isHome(guild.id)) return out; // nothing is ever created or changed in the home server
  try {
    const bot = await me(guild);
    out.missing = await missingPermissions(guild);
    if (!bot.permissions.has(P.ManageChannels) || !bot.permissions.has(P.ViewChannel)) {
      out.error = 'missing_permissions';
      return out;
    }
    await guild.channels.fetch(); // fill the cache so "does it still exist" is reliable
    const row = guilds.get(guild.id);
    const saved = row?.settings?.channels || {};
    const bossId = row?.boss_user_id || null;
    const has = (id) => !!id && guild.channels.cache.has(String(id));

    // the category: the saved one, else an existing "Vexo" category, else a new one
    let categoryId = has(row?.settings?.categoryId) ? String(row.settings.categoryId) : null;
    if (!categoryId) {
      const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'vexo');
      categoryId = found ? found.id : (await guild.channels.create({ name: 'Vexo', type: ChannelType.GuildCategory })).id;
    }

    const ids = {};
    for (const [key, spec] of wantedKeys(guild.id)) {
      if (has(saved[key])) {
        ids[key] = String(saved[key]);
        out.kept.push(key);
        continue;
      }
      // a channel with our name already in the Vexo category (settings were lost): reuse it, never a duplicate
      const names = [spec.name, ...(spec.aliases || [])];
      const same =
        guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.parentId === categoryId && c.name === spec.name) ||
        (spec.anywhere ? guild.channels.cache.find((c) => c.type === ChannelType.GuildText && names.includes(c.name)) : null);
      if (same) {
        ids[key] = same.id;
        out.kept.push(key);
        continue;
      }
      const ch = await guild.channels.create({
        name: spec.name,
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: spec.topic,
        permissionOverwrites: overwritesFor(guild, bot.id, spec, bossId),
      });
      ids[key] = ch.id;
      out.created.push(key);
      // saved right away: if a later channel fails, this one is already remembered and is never made twice
      if (spec.anywhere) await guilds.patchSettings(guild.id, { categoryId, channels: { [key]: ch.id } });
    }
    await guilds.patchSettings(guild.id, { categoryId, channels: ids, setupVersion: SETUP_VERSION });
  } catch (err) {
    console.error(`setup in guild ${guild.id}:`, err.message);
    out.error = err.code === 50013 ? 'missing_permissions' : err.message;
    try {
      out.missing = await missingPermissions(guild);
    } catch {}
  }
  return out;
}

const permissionHelp = (missing) =>
  `⚠️ I could not finish my setup because I am missing ${missing.length === 1 ? 'this permission' : 'these permissions'}: ` +
  `**${missing.join(', ') || 'Manage Channels'}**.\n` +
  'Fix: Server Settings > Roles > Vexo > turn it on (or remove me and add me again with the invite link), then run **/setup**.';

function welcomeEmbed(guild) {
  const s = guilds.settings(guild.id);
  const p = plans.plan(guild.id);
  const c = s.channels;
  const ch = (id) => (id ? `<#${id}>` : '*(not set, run /setup)*');
  const trial =
    p.kind === 'trial'
      ? `Your **free trial** is active: **${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}** with every feature unlocked. After that, premium features lock and the free games keep working.`
      : p.kind === 'paid'
        ? `Premium is active for **${p.daysLeft}** more day${p.daysLeft === 1 ? '' : 's'}.`
        : 'This server is on the **free plan** (its trial was already used): Rumble Royale and the Number Guess Game work, premium features are locked.';
  return new EmbedBuilder()
    .setTitle('👋 Vexo is ready')
    .setColor(0x5865f2)
    .setDescription(`Thanks for adding me to **${guild.name}**! I was created by ${config.creatorName} and I now work for your team. Here is what I set up:`)
    .addFields(
      { name: 'Channels', value: `${ch(c.control)} private, talk to me here\n${ch(c.marketplace)} points shop\n${ch(c.rumble)} Rumble Royale and games\n${ch(c.xDrop)} members earn points for X post links\n${ch(c.giveaway)} giveaways\n${ch(c.solRadar)} SOL market updates\n${ch(c.nftRadar)} upcoming Solana NFT mints${c.assistant ? `\n${ch(c.assistant)} members request Personal Vexo` : ''}\n${ch(c.logs)} private logs and scam alerts` },
      { name: '🛡️ Scam protection is ON', value: 'I delete scam messages and kick or ban scammers (fake Nitro, wallet drainers, phishing links, fake support). When I am not sure I only alert you in the logs channel with **Kick / Ban / Ignore** buttons. **Important:** drag my **Vexo** role above your member roles (Server Settings > Roles), or I cannot kick or ban. Settings: `/automod scam` · try it safely: `/automod test`.' },
      { name: 'Plan', value: trial },
      { name: 'Teach me about your project', value: `**1.** Write it here in ${ch(c.control)}, for example: \`remember: our mint is on March 3\`.\n**2.** Run **/setup** and choose **Knowledge source channels** (announcements, roadmap, rules, FAQ...). I read their history once and keep learning from new posts there. I never learn from normal member chat.` },
      { name: 'Main commands', value: '`/setup` channels, game ping role, knowledge sources, ticket text\n`/status` plan, days left, features, channels\n`/rumble start` host a Rumble Royale · `/guess start` host a number guess game\n`/giveaway start` host a giveaway\n`/knowledge view` what I know · `/automod` moderation rules\n`/additem` add a prize to the shop · `/help` everything else' }
    )
    .setFooter({ text: 'Only members with Manage Server can use the admin commands.' });
}

// Full setup + the welcome message. Used on guildCreate (and at startup for servers joined while offline).
async function run(guild, { welcome = true } = {}) {
  if (guilds.isHome(guild.id)) return null;
  const res = await ensureChannels(guild);
  try {
    if (res.error) {
      // tell the admin where we can: the system channel, else the first text channel we may write in
      const bot = await me(guild);
      const canSend = (c) => c && c.type === ChannelType.GuildText && c.permissionsFor(bot)?.has([P.ViewChannel, P.SendMessages]);
      const target = canSend(guild.systemChannel) ? guild.systemChannel : guild.channels.cache.find(canSend);
      const text = res.error === 'missing_permissions' ? permissionHelp(res.missing) : `⚠️ My setup hit a problem (${res.error}). Please run **/setup** to try again.`;
      if (target) await target.send({ content: text, allowedMentions: { parse: [] } });
      return res;
    }
    const control = guild.channels.cache.get(guilds.settings(guild.id).channels.control);
    if (welcome && control) await control.send({ embeds: [welcomeEmbed(guild)], allowedMentions: { parse: [] } });
    if (res.missing.length && control) await control.send({ content: `⚠️ Some features need permissions I do not have yet: **${res.missing.join(', ')}**. Turn them on for my role, then run **/setup**.`, allowedMentions: { parse: [] } });
    // the shop header in the new marketplace channel (premium / trial only; never blocks setup)
    if (res.created.includes('marketplace') && plans.hasFeature(guild.id, 'marketplace')) {
      await require('./marketplace').ensureHeader(guild.client, guild.id).catch((err) => console.error('setup shop header:', err.message));
    }
  } catch (err) {
    console.error(`setup message in guild ${guild.id}:`, err.message);
  }
  return res;
}

// Bot start: servers that ALREADY had Vexo before new channels were added to the automatic setup get them
// now. Once per SETUP_VERSION per server (a channel an admin deletes later is not forced back on every
// restart), never in HΛVØCZ, never a duplicate (ensureChannels reuses what exists). The admin is told in the
// control channel what was added, or once which permission is missing. Never throws.
async function upgradeExisting(client) {
  const out = { upgraded: [], failed: [] };
  for (const guild of client.guilds.cache.values()) {
    try {
      if (guilds.isHome(guild.id)) continue;
      const row = guilds.get(guild.id);
      if (!row || row.status === 'left') continue;
      const st = row.settings || {};
      if (!st.channels || !Object.keys(st.channels).length) continue; // never set up at all: /setup or the join flow handles it
      if ((Number(st.setupVersion) || 0) >= SETUP_VERSION) continue;
      const res = await ensureChannels(guild); // on success it saves setupVersion
      const s = guilds.settings(guild.id);
      const control = guild.channels.cache.get(s.channels.control) || guild.channels.cache.get(s.channels.logs);
      if (res.error) {
        out.failed.push(guild.id);
        console.error(`[setup] upgrade in guild ${guild.id} failed: ${res.error}`);
        if (Number(st.setupWarned) !== SETUP_VERSION) {
          await guilds.patchSettings(guild.id, { setupWarned: SETUP_VERSION }); // told once, tried again quietly on later starts
          const text = res.error === 'missing_permissions' ? permissionHelp(res.missing) : `⚠️ I tried to add my new channels but hit a problem (${res.error}). Please run **/setup** to try again.`;
          if (control) await control.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
        }
        continue;
      }
      out.upgraded.push(guild.id);
      console.log(`[setup] guild ${guild.id} upgraded to setup version ${SETUP_VERSION} (created: ${res.created.join(', ') || 'nothing'})`);
      if (res.created.length && control) {
        const list = res.created.map((k) => `<#${s.channels[k] || guilds.get(guild.id)?.settings?.channels?.[k]}>`).join(', ');
        await control.send({ content: `🆕 I was updated and added ${res.created.length === 1 ? 'a new channel' : 'new channels'}: ${list}. You can move or rename them, or pick other channels with **/setup**. See what is on with **/status**.`, allowedMentions: { parse: [] } }).catch(() => {});
      }
    } catch (err) {
      out.failed.push(guild.id);
      console.error(`[setup] upgrade in guild ${guild?.id}:`, err.message);
    }
  }
  return out;
}

// A channel was deleted: if it was one of ours, forget its ID and tell the admin to run /setup
async function onChannelDelete(channel) {
  try {
    const guildId = channel.guildId || channel.guild?.id;
    if (!guildId || guilds.isHome(guildId)) return;
    const row = guilds.get(guildId);
    const st = row?.settings || {};
    const saved = st.channels || {};
    const lost = Object.keys(saved).filter((k) => saved[k] === channel.id);
    const sources = (st.knowledgeSources || []).filter((id) => id !== channel.id);
    const lostSource = sources.length !== (st.knowledgeSources || []).length;
    const lostCategory = st.categoryId === channel.id;
    if (!lost.length && !lostSource && !lostCategory) return;
    const patch = {};
    if (lost.length) patch.channels = Object.fromEntries(lost.map((k) => [k, '']));
    if (lostSource) patch.knowledgeSources = sources;
    if (lostCategory) patch.categoryId = '';
    await guilds.patchSettings(guildId, patch);
    if (!lost.length) return;
    const s = guilds.settings(guildId);
    const target = channel.guild?.channels.cache.get(s.channels.control) || channel.guild?.channels.cache.get(s.channels.logs) || channel.guild?.systemChannel;
    const names = lost.map((k) => (k === 'games' ? 'games' : KEYS[k]?.name || k)).join(', ');
    if (target) await target.send({ content: `⚠️ The **${names}** channel I was using was deleted, so I cleared it from my settings. Run **/setup** to create it again or pick another channel.`, allowedMentions: { parse: [] } }).catch(() => {});
  } catch (err) {
    console.error('channel delete:', err.message);
  }
}

module.exports = { run, ensureChannels, missingPermissions, permissionHelp, welcomeEmbed, onChannelDelete, INVITE_PERMISSIONS, NEEDED, KEYS, wantedKeys, upgradeExisting, SETUP_VERSION };
