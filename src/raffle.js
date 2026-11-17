// Points raffles. A host posts a raffle in the server's raffle channel (embed + Join / Buy more tickets
// buttons). Members buy tickets with THIS server's Vexo points; the deduction and the ticket are ONE database
// transaction (raffle_join in supabase/migration_raffle.sql), so there is no double spend, no negative
// balance and no ticket past the limits. At the end time the winners are drawn with a cryptographically
// secure random choice, weighted by tickets, never the same member twice. Prizes are sent by the host by hand.
// Everything is stored with guild_id and nothing lives only in memory, so buttons and end times survive restarts.
//
//   create()           post a raffle (/raffle create)
//   handleComponent()  Join / Buy more / quantity menu ("rf:join:<id>", "rf:more:<id>", "rf:qty:<id>")
//   finish()           close, draw, edit the box, announce, DM winners, log (only once, also after a restart)
//   cancel()           close + refund every member (raffle_cancel, one transaction)
//   startTimer()       every few seconds + at startup: draw every raffle whose time has come
//
// Plan: "raffle" (premium, like points). HΛVØCZ always has it. Logs go ONLY to the server's logs channel.
const crypto = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder, MessageFlags, PermissionFlagsBits, escapeMarkdown } = require('discord.js');
const supabase = require('./db');
const guilds = require('./guilds');
const plans = require('./plans');
const { getTextChannel } = require('./utils');

const P = PermissionFlagsBits;
const MIN = 60 * 1000;
const MIN_DURATION_MS = 1 * MIN;
const MAX_DURATION_MS = 30 * 24 * 60 * MIN;
const MAX_COST = 1000000; // points per ticket
const MAX_WINNERS = 20;
const MAX_PER_USER = 100; // tickets per member
const MAX_TOTAL = 100000; // total ticket cap
const MAX_ACTIVE_PER_GUILD = 10;
const COUNT_EDIT_MS = 5000; // the box is refreshed at most this often
const TICK_MS = 10 * 1000;
const COOLDOWN_MS = 2000; // per member, between two button presses
const QTY_CHOICES = [1, 2, 3, 5, 10, 25, 50, 100];

const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
const ts = (d, f) => `<t:${unix(d)}:${f}>`;
const safe = (t, max = 250) => escapeMarkdown(String(t || '').replace(/\s+/g, ' ').trim()).replace(/@/g, '@​').slice(0, max);
const clean = (t, max) => String(t || '').replace(/@(everyone|here)/gi, '').replace(/\s+/g, ' ').trim().slice(0, max);
const linkOf = (r) => `https://discord.com/channels/${r.guild_id}/${r.channel_id}/${r.message_id}`;
const eph = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra });
const plural = (n, w) => `${n} ${w}${Number(n) === 1 ? '' : 's'}`;
const costText = (c) => (Number(c) > 0 ? `${Number(c).toLocaleString('en-US')} points per ticket` : 'Free');

function check(error, what) {
  if (error) throw new Error(`raffle ${what}: ${error.message}`);
}
const tableHint = (err) => (/raffle/.test(err.message) && /(does not exist|schema cache|relation|function)/i.test(err.message) ? ' (run supabase/migration_raffle.sql in Supabase first)' : '');

// ---------------------------------------------------------------- time
// duration ("30m", "24h", "3d") or an end time ("9 pm", "tomorrow 8 pm") -> { endsAt } | { error }
function parseClock(text) {
  try {
    const orderTime = require('./tasks/orderTime');
    const host = orderTime.readOrder(String(text || ''), { kind: 'simple' }).host;
    if (host?.type !== 'clock') return null;
    const r = orderTime.resolveClockFromNow(host.clock, Date.now());
    return r?.at || r?.tomorrow || null;
  } catch {
    return null;
  }
}
function resolveEnd({ duration, end } = {}, now = Date.now()) {
  const { parseDuration } = require('./giveaway'); // the same duration reader as giveaways
  let endsAt = null;
  const ms = parseDuration(duration);
  if (ms) endsAt = new Date(now + ms);
  else if (end) endsAt = parseClock(end) || (parseDuration(end) ? new Date(now + parseDuration(end)) : null);
  if (!endsAt) return { error: 'I could not read the duration. Use for example `30m`, `1h`, `24h`, `3d`, or an end time like `9 pm` / `tomorrow 8 pm`.' };
  const left = endsAt.getTime() - now;
  if (left < MIN_DURATION_MS - 5000) return { error: 'A raffle must run for at least 1 minute.' };
  if (left > MAX_DURATION_MS) return { error: 'A raffle can run for 30 days at most.' };
  return { endsAt };
}

// ---------------------------------------------------------------- database
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  check(error, name);
  return data;
}
async function getRow(id) {
  const { data, error } = await supabase.from('raffles').select('*').eq('id', Number(id)).maybeSingle();
  check(error, 'read');
  return data || null;
}
async function listByStatus(guildId, status) {
  const { data, error } = await supabase.from('raffles').select('*').eq('guild_id', guilds.gid(guildId)).eq('status', status).order('id', { ascending: false }).limit(50);
  check(error, 'list');
  return data || [];
}
async function updateRow(id, patch) {
  const { data, error } = await supabase.from('raffles').update(patch).eq('id', Number(id)).select();
  check(error, 'update');
  return data && data[0] ? data[0] : null;
}
async function entriesOf(id) {
  const { data, error } = await supabase.from('raffle_entries').select('user_id, tickets').eq('raffle_id', Number(id)).limit(100000);
  check(error, 'entries');
  return (data || []).filter((e) => Number(e.tickets) > 0);
}
async function ticketsOf(id, userId) {
  const { data, error } = await supabase.from('raffle_entries').select('tickets').eq('raffle_id', Number(id)).eq('user_id', String(userId)).maybeSingle();
  check(error, 'my tickets');
  return data ? Number(data.tickets) || 0 : 0;
}

// ---------------------------------------------------------------- the draw
// Weighted by tickets, cryptographically secure, never the same member twice.
// entries: [{ user_id, tickets }] -> [user ids], at most min(count, number of members)
function weightedDraw(entries, count, randomInt = crypto.randomInt) {
  const byUser = new Map();
  for (const e of entries || []) {
    const t = Math.floor(Number(e.tickets) || 0);
    if (t > 0 && e.user_id) byUser.set(String(e.user_id), (byUser.get(String(e.user_id)) || 0) + t);
  }
  const pool = [...byUser.entries()].map(([id, t]) => ({ id, t }));
  const want = Math.min(Math.max(0, Math.floor(Number(count) || 0)), pool.length);
  const winners = [];
  while (winners.length < want) {
    const total = pool.reduce((s, e) => s + e.t, 0);
    let r = randomInt(total);
    let i = 0;
    while (r >= pool[i].t) {
      r -= pool[i].t;
      i++;
    }
    winners.push(pool[i].id);
    pool.splice(i, 1); // a winner never wins twice
  }
  return winners;
}

// ---------------------------------------------------------------- the box
function boxPayload(r, mode = r.status) {
  const sold = Number(r.tickets_sold) || 0;
  const embed = new EmbedBuilder().setFooter({ text: `Raffle #${r.id}` });
  const ticketsValue = r.max_total_tickets ? `${sold} / ${r.max_total_tickets}` : String(sold);
  const base = [
    { name: '🎁 Prize', value: `**${safe(r.prize, 200)}**`, inline: false },
    { name: '💰 Entry', value: costText(r.entry_cost), inline: true },
    { name: '🏆 Winners', value: String(r.winners_count), inline: true },
  ];
  if (mode === 'open') {
    embed
      .setTitle(`🎟️ RAFFLE · ${safe(r.title, 200)}`)
      .setColor(0x9b59b6)
      .setDescription(`Press **Join** to buy a ticket${Number(r.entry_cost) > 0 ? ' with your points' : ' (free)'}. More tickets = better odds. Winners are drawn at random when the timer ends.`)
      .addFields(
        ...base,
        { name: '⏰ Ends', value: `${ts(r.ends_at, 'R')}\n${ts(r.ends_at, 'f')}`, inline: true },
        { name: '🎟️ Tickets sold', value: ticketsValue, inline: true },
        { name: '👥 Entrants', value: String(Number(r.entrants) || 0), inline: true },
        { name: '🔢 Max per member', value: plural(r.max_tickets_per_user, 'ticket'), inline: true },
        { name: '🎤 Hosted by', value: `<@${r.created_by}>`, inline: true }
      );
  } else if (mode === 'ended') {
    const winners = (r.winner_ids || []).map((id) => `<@${id}>`);
    embed
      .setTitle(`🎟️ RAFFLE · ${safe(r.title, 200)} · Ended`)
      .setColor(0x95a5a6)
      .setDescription(winners.length ? 'This raffle is over. Congratulations to the winners!' : 'This raffle is over. Nobody entered, so there is no winner.')
      .addFields(
        ...base,
        { name: winners.length === 1 ? '🏆 Winner' : '🏆 Winners', value: winners.length ? winners.join(', ').slice(0, 1000) : 'No winner', inline: false },
        { name: '⏰ Ended', value: ts(r.ended_at || r.ends_at, 'f'), inline: true },
        { name: '🎟️ Tickets sold', value: ticketsValue, inline: true },
        { name: '👥 Entrants', value: String(Number(r.entrants) || 0), inline: true },
        { name: '🎤 Hosted by', value: `<@${r.created_by}>`, inline: true }
      );
  } else {
    embed
      .setTitle(`🎟️ RAFFLE · ${safe(r.title, 200)} · Cancelled`)
      .setColor(0x7f8c8d)
      .setDescription('This raffle was cancelled by the team. No winner was drawn and every member got their points back.')
      .addFields(...base, { name: '🎤 Hosted by', value: `<@${r.created_by}>`, inline: true });
  }
  if (r.image_name) embed.setImage(`attachment://${r.image_name}`); // the picture re-uploaded on this same message
  const open = mode === 'open';
  const buttons = [new ButtonBuilder().setCustomId(`rf:join:${r.id}`).setLabel(open ? '🎟️ Join' : mode === 'ended' ? 'Ended' : 'Cancelled').setStyle(open ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!open)];
  if (open && Number(r.max_tickets_per_user) > 1) buttons.push(new ButtonBuilder().setCustomId(`rf:more:${r.id}`).setLabel('Buy more tickets').setStyle(ButtonStyle.Primary));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };
}

async function fetchBox(client, r) {
  const channel = await getTextChannel(client, r.channel_id);
  if (!channel || !r.message_id) return { channel, message: null };
  const message = await Promise.resolve(channel.messages.fetch(r.message_id)).catch(() => null);
  return { channel, message };
}
async function editBox(client, r, mode) {
  try {
    const { message } = await fetchBox(client, r);
    if (!message) return false;
    await message.edit({ ...boxPayload(r, mode), allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    console.error(`raffle #${r.id} box edit:`, err.message);
    return false;
  }
}

// live counts: at most one edit per raffle every few seconds, however many members press Join
const countTimers = new Map(); // raffle id -> { last, timer }
function touchCount(client, id) {
  const st = countTimers.get(id) || { last: 0, timer: null };
  countTimers.set(id, st);
  if (st.timer) return;
  const wait = Math.max(0, COUNT_EDIT_MS - (Date.now() - st.last));
  st.timer = setTimeout(async () => {
    st.timer = null;
    st.last = Date.now();
    try {
      const r = await getRow(id);
      if (r && r.status === 'open') await editBox(client, r, 'open');
      else countTimers.delete(id);
    } catch (err) {
      console.error(`raffle #${id} count:`, err.message);
    }
  }, wait);
  st.timer.unref?.();
}

// ---------------------------------------------------------------- logs (ONLY the server's logs channel)
async function log(client, guildId, title, lines, color = 0x9b59b6) {
  try {
    const ch = await getTextChannel(client, guilds.logsChannelId(guilds.settings(guildId))); // logs channel, never the shop
    if (!ch) return;
    const embed = new EmbedBuilder().setTitle(title).setColor(color).setDescription(lines.filter(Boolean).join('\n').slice(0, 3900)).setTimestamp();
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('raffle log:', err.message);
  }
}

// ---------------------------------------------------------------- create
// Validates the host's input. -> { value } | { error }
function validate(o) {
  const title = clean(o.title, 100);
  if (!title) return { error: 'The raffle needs a title.' };
  const prize = clean(o.prize, 200);
  if (!prize) return { error: 'What is the prize? For example `1 SOL`, `WL spot` or a role name.' };
  const num = (v, d) => (v === null || v === undefined || v === '' ? d : Number(v));
  const entryCost = num(o.entryCost, 0);
  if (!Number.isInteger(entryCost) || entryCost < 0 || entryCost > MAX_COST) return { error: `The entry cost must be a whole number of points from 0 (free) to ${MAX_COST.toLocaleString('en-US')}.` };
  const winners = num(o.winners, 1);
  if (!Number.isInteger(winners) || winners < 1 || winners > MAX_WINNERS) return { error: `The number of winners must be between 1 and ${MAX_WINNERS}.` };
  const maxPerUser = num(o.maxPerUser, 1);
  if (!Number.isInteger(maxPerUser) || maxPerUser < 1 || maxPerUser > MAX_PER_USER) return { error: `Max tickets per member must be between 1 and ${MAX_PER_USER}.` };
  const maxTotal = num(o.maxTotal, null);
  if (maxTotal !== null && (!Number.isInteger(maxTotal) || maxTotal < 1 || maxTotal > MAX_TOTAL)) return { error: `The total ticket cap must be between 1 and ${MAX_TOTAL.toLocaleString('en-US')} (or empty for no cap).` };
  if (maxTotal !== null && maxTotal < winners) return { error: `The total ticket cap (${maxTotal}) is lower than the number of winners (${winners}).` };
  const endsAt = new Date(o.endsAt);
  const left = endsAt.getTime() - Date.now();
  if (!(left > 0)) return { error: 'The end time must be in the future.' };
  if (left < MIN_DURATION_MS - 5000) return { error: 'A raffle must run for at least 1 minute.' };
  if (left > MAX_DURATION_MS) return { error: 'A raffle can run for 30 days at most.' };
  return { value: { title, prize, entryCost, winners, maxPerUser, maxTotal, endsAt } };
}

// The raffle channel of THIS server, checked: set, not the shop, really in this server, and writable.
// -> { channel } | { error }
async function raffleChannel(client, guild, { needFiles = true } = {}) {
  const guildId = String(guild.id);
  const s = guilds.settings(guildId);
  const channelId = guilds.getFeatureChannel(s, 'raffle'); // /setup first, .env only in HΛVØCZ, never the shop
  if (!channelId) return { error: `Raffle channel not set, run /setup${s.isHome ? ' (or set RAFFLE_CHANNEL_ID)' : ''}.` };
  const channel = await getTextChannel(client, channelId);
  const owner = channel ? String(channel.guildId || channel.guild?.id || '') : '';
  if (!channel || owner !== guildId) return { error: `I cannot find the raffle channel <#${channelId}> in this server. Run /setup and choose the raffle channel again.` };
  const me = guild.members?.me;
  const perms = me && channel.permissionsFor ? channel.permissionsFor(me) : null;
  if (perms) {
    const need = [[P.ViewChannel, 'View Channel'], [P.SendMessages, 'Send Messages'], [P.EmbedLinks, 'Embed Links']];
    if (needFiles) need.push([P.AttachFiles, 'Attach Files']);
    const missing = need.filter(([bit]) => !perms.has(bit)).map(([, n]) => n);
    if (missing.length) return { error: `⚠️ I cannot post in the raffle channel <#${channelId}>: I am missing **${missing.join(', ')}** there. Fix: Server Settings > Roles > Vexo (or that channel's permissions) > turn ${missing.length === 1 ? 'it' : 'them'} on, then try again.` };
  }
  return { channel };
}

// o: { guild, client, hostId, title, prize, image ({buffer,name}) | null, entryCost, winners, maxPerUser, maxTotal, endsAt }
// -> { row } | { error }
async function create(o) {
  const guild = o.guild;
  const guildId = String(guild.id);
  if (!plans.hasFeature(guildId, 'raffle')) return { error: plans.lockedText(true) };
  const v = validate(o);
  if (v.error) return { error: v.error };
  const ch = await raffleChannel(o.client, guild);
  if (ch.error) return { error: ch.error };
  const channel = ch.channel;
  try {
    if ((await listByStatus(guildId, 'open')).length >= MAX_ACTIVE_PER_GUILD) return { error: `This server already has ${MAX_ACTIVE_PER_GUILD} open raffles. End or cancel one first.` };
    const { title, prize, entryCost, winners, maxPerUser, maxTotal, endsAt } = v.value;
    const { data: row, error } = await supabase
      .from('raffles')
      .insert({
        guild_id: guildId, channel_id: String(channel.id), title, prize, image_name: o.image ? o.image.name : null, entry_cost: entryCost,
        winners_count: winners, max_tickets_per_user: maxPerUser, max_total_tickets: maxTotal, ends_at: endsAt.toISOString(), status: 'open', created_by: String(o.hostId),
      })
      .select()
      .single();
    check(error, 'create');
    const payload = { content: '🎟️ **A new raffle is open!**', ...boxPayload(row, 'open'), allowedMentions: { parse: [] } };
    if (o.image) payload.files = [new AttachmentBuilder(o.image.buffer, { name: o.image.name })];
    let message;
    try {
      message = await channel.send(payload);
    } catch (err) {
      await supabase.from('raffles').delete().eq('id', row.id); // never leave a raffle nobody can see (nobody could have joined yet)
      await log(o.client, guildId, '⚠️ Raffle error', [`Could not post raffle "${safe(title, 100)}" in <#${channel.id}>: ${err.message}`, 'Nothing was created. Check Send Messages, Embed Links and Attach Files there.'], 0xe74c3c);
      return { error: `⚠️ I could not post the raffle in <#${channel.id}> (${err.message}). Check that I have **Send Messages**, **Embed Links** and **Attach Files** there.` };
    }
    const saved = (await updateRow(row.id, { message_id: message.id })) || { ...row, message_id: message.id };
    await log(o.client, guildId, '🎟️ Raffle created', [
      `**#${saved.id}** · ${safe(title, 100)} · Prize: **${safe(prize, 150)}**`,
      `Channel: <#${saved.channel_id}> · [open](${linkOf(saved)})`,
      `Entry: ${costText(entryCost)} · Max per member: ${maxPerUser} · Total cap: ${maxTotal ?? 'none'}`,
      `Winners: ${winners} · Ends: ${ts(endsAt, 'f')} (${ts(endsAt, 'R')})`,
      `Image: ${o.image ? 'yes' : 'no'} · Host: <@${saved.created_by}>`,
    ]);
    return { row: saved };
  } catch (err) {
    console.error('raffle create:', err.message);
    await log(o.client, guildId, '⚠️ Raffle error', [`Creating a raffle failed: ${err.message}`], 0xe74c3c);
    return { error: `Something went wrong while creating the raffle${tableHint(err)}. Nothing was posted.` };
  }
}

// ---------------------------------------------------------------- buying tickets
// The ONE way tickets are bought: the database function does every check and the deduction together.
async function buy(guildId, raffleId, userId, tickets) {
  const res = await rpc('raffle_join', { p_guild: guilds.gid(guildId), p_raffle: Number(raffleId), p_user: String(userId), p_tickets: Math.floor(Number(tickets)) });
  return typeof res === 'string' ? JSON.parse(res) : res || {};
}

function buyText(r, res, n) {
  if (res.ok) {
    const paid = Number(res.cost) > 0 ? ` for **${Number(res.cost).toLocaleString('en-US')} points**` : ' (free)';
    return `🎟️ You bought **${plural(n, 'ticket')}**${paid}. You now have **${plural(res.tickets, 'ticket')}** in **${safe(r.title, 100)}**.\nRemaining points: **${Number(res.balance).toLocaleString('en-US')}** · Draw ${ts(r.ends_at, 'R')}. Good luck!`;
  }
  if (res.code === 'no_points') return `❌ Not enough points. ${n === 1 ? 'A ticket' : `${n} tickets`} cost${n === 1 ? 's' : ''} **${Number(res.cost).toLocaleString('en-US')} points**, and you have **${Number(res.balance || 0).toLocaleString('en-US')} points**.`;
  if (res.code === 'max_user') return `You already have **${plural(res.tickets, 'ticket')}**, the most one member can have in this raffle (${res.max}).`;
  if (res.code === 'sold_out') return Number(res.left) > 0 ? `Only **${plural(res.left, 'ticket')}** left in this raffle. Pick a smaller amount.` : 'This raffle is sold out: every ticket is taken.';
  if (res.code === 'closed') return 'This raffle is already closed. Catch the next one!';
  if (res.code === 'not_found') return 'I cannot find this raffle anymore.';
  return 'Something went wrong, please try again.';
}

// per member: one button press at a time, and not faster than COOLDOWN_MS
const lastPress = new Map(); // `${guildId}:${userId}` -> time
const inFlight = new Set();
function allowPress(key, now = Date.now()) {
  if (inFlight.has(key)) return false;
  if (now - (lastPress.get(key) || 0) < COOLDOWN_MS) return false;
  lastPress.set(key, now);
  if (lastPress.size > 5000) for (const [k, t] of lastPress) if (now - t > 60000) lastPress.delete(k);
  return true;
}

function quantityMenu(r, have) {
  const room = Math.max(0, Number(r.max_tickets_per_user) - have);
  const totalLeft = r.max_total_tickets ? Math.max(0, Number(r.max_total_tickets) - Number(r.tickets_sold || 0)) : Infinity;
  const max = Math.min(room, totalLeft);
  const choices = QTY_CHOICES.filter((n) => n <= max);
  if (max > 0 && !choices.includes(max) && max <= MAX_PER_USER) choices.push(max);
  choices.sort((a, b) => a - b);
  if (!choices.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rf:qty:${r.id}`)
    .setPlaceholder('How many tickets?')
    .addOptions(choices.slice(0, 25).map((n) => ({ label: plural(n, 'ticket'), description: Number(r.entry_cost) > 0 ? `${(n * Number(r.entry_cost)).toLocaleString('en-US')} points` : 'Free', value: String(n) })));
  return new ActionRowBuilder().addComponents(menu);
}

// every component whose customId starts with "rf:" (routed from events/interactionCreate.js after the feature lock)
async function handleComponent(interaction) {
  const [, action, rawId] = String(interaction.customId).split(':');
  const id = Number(rawId);
  if (interaction.user?.bot) return null; // bots never buy tickets
  const guildId = String(interaction.guildId);
  const userId = String(interaction.user.id);
  const key = `${guildId}:${userId}`;
  if (!allowPress(key)) return interaction.reply(eph('⏳ Easy, one click at a time. Try again in a second.')).catch(() => {});
  inFlight.add(key);
  const isMenu = action === 'qty';
  try {
    if (isMenu) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const answer = (content, extra = {}) => interaction.editReply({ content, components: [], allowedMentions: { parse: [] }, ...extra });

    const r = await getRow(id);
    if (!r || String(r.guild_id) !== guildId) return await answer('I cannot find this raffle anymore.'); // never another server's raffle
    if (r.status !== 'open' || Date.parse(r.ends_at) <= Date.now()) return await answer('This raffle is already closed. Catch the next one!');

    if (action === 'join') {
      const have = await ticketsOf(id, userId);
      if (have > 0) {
        const more = Number(r.max_tickets_per_user) > have ? ' Want more? Press **Buy more tickets**.' : '';
        return await answer(`You are already in with **${plural(have, 'ticket')}**.${more}`);
      }
      const res = await buy(guildId, id, userId, 1);
      if (res.ok) touchCount(interaction.client, id);
      return await answer(buyText(r, res, 1));
    }
    if (action === 'more') {
      const have = await ticketsOf(id, userId);
      const row = quantityMenu(r, have);
      if (!row) return await answer(have >= Number(r.max_tickets_per_user) ? `You already have **${plural(have, 'ticket')}**, the most one member can have in this raffle.` : 'This raffle is sold out: every ticket is taken.');
      return await answer(`You have **${plural(have, 'ticket')}**. Entry: ${costText(r.entry_cost)}. How many more do you want?`, { components: [row] });
    }
    if (action === 'qty') {
      const n = Math.floor(Number(interaction.values?.[0]));
      if (!(n >= 1 && n <= MAX_PER_USER)) return await answer('That is not a valid amount.');
      const res = await buy(guildId, id, userId, n);
      if (res.ok) touchCount(interaction.client, id);
      return await answer(buyText(r, res, n));
    }
    return await answer('Unknown raffle button.');
  } catch (err) {
    console.error(`raffle button #${id}:`, err.message);
    await log(interaction.client, guildId, '⚠️ Raffle error', [`Button "${action}" on raffle #${id} by <@${userId}> failed: ${err.message}${tableHint(err)}`, 'No points were taken unless the member got a confirmation.'], 0xe74c3c);
    const msg = 'Something went wrong, please try again. No points were taken.';
    if (interaction.deferred || interaction.replied) return interaction.editReply({ content: msg, components: [] }).catch(() => {});
    return interaction.reply(eph(msg)).catch(() => {});
  } finally {
    inFlight.delete(key);
  }
}

// ---------------------------------------------------------------- announce
async function announce(client, guild, r, winners) {
  const channel = await getTextChannel(client, r.channel_id);
  if (!channel) return 'the raffle channel is gone, nothing was announced';
  if (!winners.length) {
    try {
      await channel.send({ content: `🎟️ **Raffle over: ${safe(r.title, 150)}**\nNobody entered, so there is no winner this time.`, allowedMentions: { parse: [] } });
    } catch (err) {
      return `the end message could not be sent (${err.message})`;
    }
    return '';
  }
  const { message } = await fetchBox(client, r);
  const imageUrl = message?.attachments?.first?.()?.url || null; // the box picture (fresh link, the box was just fetched)
  const many = winners.length > 1;
  const mentions = winners.map((w) => `<@${w}>`).join(', ');
  const embed = new EmbedBuilder()
    .setTitle(`🎉 ${safe(r.title, 200)} · Winner${many ? 's' : ''}`)
    .setColor(0x2ecc71)
    .setDescription(`Congratulations ${mentions}! You won **${safe(r.prize, 200)}**.\nThe host <@${r.created_by}> will send the prize.`)
    .addFields(
      { name: '🎁 Prize', value: `**${safe(r.prize, 200)}**`, inline: false },
      { name: '👥 Entrants', value: String(Number(r.entrants) || 0), inline: true },
      { name: '🎟️ Tickets sold', value: String(Number(r.tickets_sold) || 0), inline: true },
      { name: '🏆 Winners', value: `${winners.length}${winners.length < r.winners_count ? ` of ${r.winners_count} (not enough entrants)` : ''}`, inline: true }
    )
    .setFooter({ text: `Raffle #${r.id}` });
  if (imageUrl) embed.setImage(imageUrl);
  try {
    await channel.send({ content: `🎟️ **RAFFLE WINNER${many ? 'S' : ''}** ${mentions}\n[Raffle #${r.id}](${linkOf(r)})`.slice(0, 1990), embeds: [embed], allowedMentions: { parse: [], users: winners.slice(0, 100) } });
  } catch (err) {
    return `the winner announcement could not be sent (${err.message})`;
  }
  return '';
}

// a short DM to every winner; members with closed DMs are listed in the log (they were still pinged)
async function dmWinners(client, guild, r, winners) {
  const failed = [];
  for (const w of winners) {
    try {
      const user = await client.users.fetch(w);
      await user.send({ content: `🎉 You won **${safe(r.prize, 200)}** in the raffle **${safe(r.title, 150)}** in **${safe(guild?.name || 'the server', 100)}**! The host will send your prize. ${linkOf(r)}`, allowedMentions: { parse: [] } });
    } catch {
      failed.push(w);
    }
  }
  return failed;
}

// ---------------------------------------------------------------- end + draw
const busy = new Set(); // raffle ids being finished right now in this process
// Close it in the database (only one caller can), draw ONCE (saved before anything is announced), edit the box,
// announce, DM, log, mark settled. A restart in the middle continues from what is saved, never draws again.
// by: user id for /raffle end, null for the timer. -> { row, winners } | { error }
async function finish(client, id, { by = null, guildId = null } = {}) {
  if (busy.has(id)) return { error: 'This raffle is being drawn right now.' };
  busy.add(id);
  let r = null;
  try {
    r = await getRow(id);
    if (!r || (guildId && String(r.guild_id) !== String(guildId))) return { error: 'I cannot find that raffle in this server.' };
    if (r.status === 'cancelled') return { error: `Raffle #${id} was cancelled.` };
    if (r.status === 'ended' && r.settled) return { error: `Raffle #${id} has already ended.` };
    if (r.status === 'open') {
      if (!by && Date.parse(r.ends_at) > Date.now()) return { error: 'not due yet' };
      const closed = await rpc('raffle_close', { p_guild: r.guild_id, p_raffle: Number(id) });
      if (!closed) {
        r = await getRow(id);
        if (!r || r.status !== 'ended' || r.settled) return { error: 'This raffle was just ended or cancelled by someone else.' };
      } else r = typeof closed === 'string' ? JSON.parse(closed) : closed;
    }
    // (status ended + not settled = a restart hit in the middle: carry on from here)
    const guild = client.guilds?.cache?.get?.(r.guild_id) || (await Promise.resolve(client.guilds?.fetch?.(r.guild_id)).catch(() => null));
    if (!guild) {
      await updateRow(id, { settled: true, winner_ids: r.winner_ids || [] });
      return { error: 'I am not in that server anymore.' };
    }
    let winners;
    if (Array.isArray(r.winner_ids)) winners = r.winner_ids.map(String); // already drawn before a restart: never drawn again
    else {
      winners = weightedDraw(await entriesOf(id), r.winners_count);
      r = (await updateRow(id, { winner_ids: winners })) || { ...r, winner_ids: winners };
    }
    await editBox(client, r, 'ended');
    const note = await announce(client, guild, r, winners);
    const dmFailed = winners.length ? await dmWinners(client, guild, r, winners) : [];
    await updateRow(id, { settled: true });
    countTimers.delete(id);
    await log(client, r.guild_id, '🏁 Raffle ended', [
      `**#${r.id}** · ${safe(r.title, 100)} · Prize: **${safe(r.prize, 150)}** · [open](${linkOf(r)})`,
      `Ended ${by ? `early by <@${by}>` : 'at its end time'} · Entrants: ${Number(r.entrants) || 0} · Tickets sold: ${Number(r.tickets_sold) || 0}`,
      `Winners (${winners.length} of ${r.winners_count}): ${winners.length ? winners.map((w) => `<@${w}> (${w})`).join(', ') : 'nobody (no entrants)'}`,
      winners.length ? `Prize payout is manual: the host <@${r.created_by}> sends it. Ticket points are not refunded after a draw.` : '',
      dmFailed.length ? `Could not DM: ${dmFailed.map((w) => `<@${w}>`).join(', ')} (DMs closed; they were pinged in the channel).` : '',
      note ? `⚠️ ${note}.` : '',
    ], 0x2ecc71);
    return { row: r, winners };
  } catch (err) {
    console.error(`raffle #${id} end:`, err.message);
    if (r?.guild_id) await log(client, r.guild_id, '⚠️ Raffle error', [`Drawing raffle #${id} failed: ${err.message}${tableHint(err)}`, 'I will try again in a moment. Nothing is drawn twice.'], 0xe74c3c);
    return { error: `Something went wrong while ending raffle #${id}${tableHint(err)}. I will try again in a moment.` };
  } finally {
    busy.delete(id);
  }
}

// ---------------------------------------------------------------- cancel + refund
async function cancel(client, id, { by, guildId } = {}) {
  try {
    const before = await getRow(id);
    if (!before || (guildId && String(before.guild_id) !== String(guildId))) return { error: 'I cannot find that raffle in this server.' };
    if (before.status !== 'open') return { error: `Raffle #${id} is not open anymore (it is ${before.status}). Points are only refunded on cancel, never after a draw.` };
    if (busy.has(id)) return { error: 'This raffle is being drawn right now, it is too late to cancel it.' };
    const raw = await rpc('raffle_cancel', { p_guild: before.guild_id, p_raffle: Number(id) });
    const res = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
    if (!res.ok) return { error: res.code === 'not_open' ? 'This raffle just ended, it is too late to cancel it.' : 'I cannot find that raffle.' };
    const r = (await getRow(id)) || { ...before, status: 'cancelled' };
    await editBox(client, r, 'cancelled');
    countTimers.delete(id);
    await log(client, r.guild_id, '🚫 Raffle cancelled', [
      `**#${r.id}** · ${safe(r.title, 100)} · Prize: **${safe(r.prize, 150)}** · [open](${linkOf(r)})`,
      `Cancelled by <@${by}> · Entrants: ${Number(r.entrants) || 0} · Tickets sold: ${Number(r.tickets_sold) || 0}`,
      `Refunded: ${Number(res.refunded_points || 0).toLocaleString('en-US')} points to ${plural(Number(res.refunded_users || 0), 'member')}. No winner was drawn.`,
    ], 0x7f8c8d);
    return { row: r, refundedUsers: Number(res.refunded_users || 0), refundedPoints: Number(res.refunded_points || 0) };
  } catch (err) {
    console.error(`raffle #${id} cancel:`, err.message);
    if (guildId) await log(client, guildId, '⚠️ Raffle error', [`Cancelling raffle #${id} failed: ${err.message}${tableHint(err)}`], 0xe74c3c);
    return { error: `Something went wrong while cancelling raffle #${id}${tableHint(err)}. Nothing was changed.` };
  }
}

// ---------------------------------------------------------------- timer (also the restart recovery)
let timer = null;
let ticking = false;
async function tick(client) {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date().toISOString();
    const due = await supabase.from('raffles').select('id').eq('status', 'open').lte('ends_at', now).limit(50);
    check(due.error, 'due');
    const half = await supabase.from('raffles').select('id').eq('status', 'ended').eq('settled', false).limit(50);
    check(half.error, 'unsettled');
    const ids = [...new Set([...(due.data || []), ...(half.data || [])].map((x) => Number(x.id)))];
    for (const id of ids) await finish(client, id);
  } catch (err) {
    console.error(`raffle timer: ${err.message}${tableHint(err)}`);
  } finally {
    ticking = false;
  }
}
async function startTimer(client) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick(client), TICK_MS);
  timer.unref?.();
  try {
    const { count, error } = await supabase.from('raffles').select('id', { count: 'exact', head: true }).eq('status', 'open');
    check(error, 'startup count');
    console.log(`[raffle] ${count || 0} open raffle(s) reloaded from the database`);
  } catch (err) {
    console.error(`[raffle] could not read raffles: ${err.message}${tableHint(err)}`);
  }
  await tick(client); // anything that ended while the bot was offline is drawn right now
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  create, handleComponent, finish, cancel, tick, startTimer, stopTimer, buy,
  resolveEnd, validate, weightedDraw, listByStatus, getRow, linkOf, costText, boxPayload, raffleChannel,
  MAX_COST, MAX_WINNERS, MAX_PER_USER, MAX_TOTAL,
  _test: { countTimers, busy, lastPress, inFlight },
};
