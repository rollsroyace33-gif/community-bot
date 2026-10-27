const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const supabase = require('./db');
const config = require('./config');
const points = require('./points');
const { isAdmin, getTextChannel } = require('./utils');

const EPHEMERAL = MessageFlags.Ephemeral;

// ---------------------------------------------------------------- cards
function itemMessage(item) {
  const soldOut = item.stock <= 0;
  const embed = new EmbedBuilder()
    .setTitle(item.name)
    .setDescription(item.description || '\u200b')
    .addFields(
      { name: 'Price', value: `${item.price} points`, inline: true },
      { name: 'Stock', value: soldOut ? 'Sold out' : String(item.stock), inline: true },
      { name: 'Type', value: item.type, inline: true }
    )
    .setColor(soldOut ? 0x95a5a6 : 0x2ecc71)
    .setFooter({ text: `Item #${item.id}` });
  if (item.image_url) embed.setImage(item.image_url);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`redeem:${item.id}`)
      .setLabel(soldOut ? 'Sold out' : 'Redeem')
      .setStyle(ButtonStyle.Success)
      .setDisabled(soldOut)
  );
  return { embeds: [embed], components: [row] };
}

// The shop channel no longer has one card per item: members browse everything through the header's
// "Purchase" button, which reads the items table. The card functions below keep their names (the
// admin commands call them and stay unchanged) but no longer post public item cards.

// /additem: nothing to post anymore (the new prize appears in Purchase); just make sure the header is there
async function postItemCard(client) {
  await ensureHeader(client);
}

// /edititem, refunds: no card to refresh (Purchase always reads fresh data)
async function refreshItemCard() {}

// /removeitem, sold out: delete the item's OLD card if one is still around (bot-posted, known message id)
async function deleteItemCard(client, item) {
  const ch = await getTextChannel(client, item.channel_id);
  const msg = ch && item.message_id ? await ch.messages.fetch(item.message_id).catch(() => null) : null;
  if (msg && msg.author?.id === client.user.id) await msg.delete().catch(() => {});
}

// /repostitem: remove the old card if any; the item is shown through the shop header instead
async function repostItemCard(client, item) {
  await deleteItemCard(client, item);
  await ensureHeader(client);
}

// /listitems "card ok": an active item is visible in the shop whenever the shop header exists
async function cardExists(client, item) {
  if (!item.active) return false;
  return !!(await findHeader(client));
}

// After a redeem: update the card, or remove it when sold out and AUTO_REMOVE_SOLD_OUT=true
async function updateCardAfterRedeem(client, itemId, stockLeft) {
  if (config.marketplace.autoRemoveSoldOut && stockLeft <= 0) {
    const { data } = await supabase.from('items').update({ active: false }).eq('id', itemId).lte('stock', 0).select();
    if (data && data[0]) return deleteItemCard(client, data[0]);
  }
  return refreshItemCard(client, itemId);
}

// Autocomplete for item options: "#ID Name (price pts, stock N)", max 25
async function autocompleteItems(interaction) {
  const typed = String(interaction.options.getFocused()).trim().toLowerCase().replace(/^#/, '');
  const { data } = await supabase.from('items').select('id,name,price,stock').eq('active', true).order('id').limit(500);
  const choices = (data || [])
    .filter((i) => !typed || String(i.id).startsWith(typed) || i.name.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((i) => ({ name: `#${i.id} ${i.name} (${i.price} pts, stock ${i.stock})`.slice(0, 100), value: i.id }));
  await interaction.respond(choices);
}

// ---------------------------------------------------------------- header
const HEADER_KEY = 'marketplace_header_message_id';

// ONE compact message in the shop channel: two buttons, no item list
function headerMessage() {
  const embed = new EmbedBuilder()
    .setTitle('🛒 Marketplace')
    .setDescription('Spend your points on prizes. Tap Purchase to browse.')
    .setColor(0x5865f2);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mypoints').setLabel('My Points').setEmoji('🪙').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shop:open').setLabel('Purchase').setEmoji('🛍️').setStyle(ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row] };
}

// the saved header message, if it still exists and the bot posted it
async function findHeader(client) {
  const ch = await getTextChannel(client, config.channels.marketplace);
  if (!ch) return null;
  const { data: saved } = await supabase.from('bot_settings').select('value').eq('key', HEADER_KEY).maybeSingle();
  if (!saved?.value) return null;
  const msg = await ch.messages.fetch(saved.value).catch(() => null);
  return msg && msg.author?.id === client.user.id ? msg : null;
}

// Edit the header in place if the bot already posted one, otherwise post it once (and remember its id)
async function ensureHeader(client) {
  const ch = await getTextChannel(client, config.channels.marketplace);
  if (!ch) throw new Error('MARKETPLACE_CHANNEL_ID is wrong or the bot cannot see that channel.');
  const { data: saved, error } = await supabase.from('bot_settings').select('value').eq('key', HEADER_KEY).maybeSingle();
  if (error) throw new Error(`Could not read bot_settings (did you run the new SQL in Supabase?): ${error.message}`);
  const old = saved?.value ? await ch.messages.fetch(saved.value).catch(() => null) : null;
  if (old && old.author?.id === client.user.id) {
    await old.edit(headerMessage());
    return { message: old, posted: false };
  }
  const msg = await ch.send(headerMessage());
  const { error: saveErr } = await supabase.from('bot_settings').upsert({ key: HEADER_KEY, value: msg.id });
  if (saveErr) throw saveErr;
  return { message: msg, posted: true };
}

// an OLD per-item card: posted by this bot, "Item #N" footer and a Redeem button (nothing else matches)
function isOldItemCard(msg, botId) {
  if (msg.author?.id !== botId) return false;
  const footer = msg.embeds?.[0]?.footer?.text || '';
  const buttons = (msg.components || []).flatMap((r) => r.components || []);
  return /^Item #\d+$/.test(footer) && buttons.some((b) => /^redeem:\d+$/.test(b.customId || b.custom_id || ''));
}

// Delete old item cards in the shop channel (bot-posted only). Returns how many were removed.
async function removeOldItemCards(client) {
  const ch = await getTextChannel(client, config.channels.marketplace);
  if (!ch) return 0;
  let removed = 0;
  let before;
  for (let page = 0; page < 10; page++) {
    const batch = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch || !batch.size) break;
    for (const msg of batch.values()) {
      if (isOldItemCard(msg, client.user.id)) {
        await msg.delete().then(() => removed++).catch((e) => console.error('old card delete:', e.message));
      }
    }
    before = [...batch.keys()].pop();
    if (batch.size < 100) break;
  }
  return removed;
}

// Startup + /setupmarketplace: header in place, old item cards gone. Never posts item cards.
async function syncShop(client) {
  const { posted } = await ensureHeader(client);
  const removed = await removeOldItemCards(client);
  console.log(`Marketplace: header ${posted ? 'posted' : 'updated in place'}, removed ${removed} old item card(s).`);
  return { posted, removed };
}

// /setupmarketplace keeps its reply text; no item cards are reposted anymore, so the count is 0
async function setupHeader(client) {
  await syncShop(client);
  return 0;
}

const balanceOf = async (userId) => {
  const { data: u, error } = await supabase.from('users').select('points').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return u?.points ?? 0;
};

async function handleMyPoints(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const balance = await balanceOf(interaction.user.id);
  const embed = new EmbedBuilder().setTitle('🪙 Your Points').setDescription(`You have **${balance}** points.`).setColor(0xf1c40f);
  return interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------- logs
async function sendLog(client, { purchaseId, userId, itemName, price, status, note }) {
  const ch = await getTextChannel(client, config.channels.redeemLogs);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setTitle(`Purchase #${purchaseId}`)
    .addFields(
      { name: 'Member', value: `<@${userId}> (${userId})`, inline: true },
      { name: 'Item', value: itemName, inline: true },
      { name: 'Price', value: `${price} points`, inline: true },
      { name: 'Status', value: status, inline: true }
    )
    .setTimestamp()
    .setColor(status === 'Delivered' ? 0x2ecc71 : status === 'Refunded' ? 0xe74c3c : 0xf1c40f);
  if (note) embed.setDescription(note);
  await ch.send({ embeds: [embed] }).catch((e) => console.error('log send:', e.message));
}

async function sendTranscript(client, channel, purchaseId) {
  try {
    const msgs = await channel.messages.fetch({ limit: 100 });
    const lines = [...msgs.values()].reverse().map((m) => {
      const files = m.attachments.size ? ` [files: ${m.attachments.map((a) => a.url).join(', ')}]` : '';
      return `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}${files}`;
    });
    const file = new AttachmentBuilder(Buffer.from(lines.join('\n') || '(empty)', 'utf8'), {
      name: `ticket-${purchaseId}.txt`,
    });
    const logCh = await getTextChannel(client, config.channels.redeemLogs);
    if (logCh) await logCh.send({ content: `Transcript: purchase #${purchaseId}`, files: [file] });
  } catch (e) {
    console.error('transcript:', e.message);
  }
}

// ---------------------------------------------------------------- redeem
// Build the "not enough points" text here so it doesn't depend on the SQL function's wording
async function redeemFailMessage(userId, itemId, dbMessage) {
  const [{ data: item }, { data: user }] = await Promise.all([
    supabase.from('items').select('price,stock,active').eq('id', itemId).maybeSingle(),
    supabase.from('users').select('points').eq('user_id', userId).maybeSingle(),
  ]);
  if (!item || !item.active) return 'Item not found.';
  if (item.stock <= 0) return '❌ This item is out of stock.';
  const have = user?.points ?? 0;
  if (have < item.price) return `❌ Not enough points. You need ${item.price} points, but you have ${have}.`;
  return dbMessage;
}

// The existing purchase: the atomic redeem_item SQL function (checks points + stock, deducts, creates the
// purchase), then the same follow-up steps as always (card update, role auto-delivery, redeem log).
// Returns { ok: false, message } or { ok: true, data, delivered } where delivered = role given automatically.
async function redeem(interaction, itemId) {
  const { data, error } = await supabase.rpc('redeem_item', {
    p_user: interaction.user.id,
    p_item: itemId,
  });
  if (error) throw error;
  if (!data.ok) return { ok: false, message: await redeemFailMessage(interaction.user.id, itemId, data.message) };

  await updateCardAfterRedeem(interaction.client, itemId, data.stock);

  // Role items are delivered automatically
  if (data.item_type === 'role' && data.role_id) {
    try {
      await interaction.member.roles.add(data.role_id);
      await supabase
        .from('purchases')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .eq('id', data.purchase_id);
      await sendLog(interaction.client, {
        purchaseId: data.purchase_id,
        userId: interaction.user.id,
        itemName: data.item_name,
        price: data.price,
        status: 'Delivered',
        note: 'Role auto delivered.',
      });
      return { ok: true, data, delivered: true };
    } catch (e) {
      console.error('role add failed:', e.message);
      // falls through: handled manually via ticket
    }
  }

  await sendLog(interaction.client, {
    purchaseId: data.purchase_id,
    userId: interaction.user.id,
    itemName: data.item_name,
    price: data.price,
    status: 'Pending',
  });
  return { ok: true, data, delivered: false };
}

const ticketButton = (purchaseId) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:${purchaseId}`).setLabel('Open Ticket').setStyle(ButtonStyle.Primary)
  );

// old "Redeem" buttons (from cards posted before the new shop): same flow and replies as before
async function handleRedeem(interaction, itemId) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const res = await redeem(interaction, itemId);
  if (!res.ok) return interaction.editReply(res.message);
  const { data } = res;
  if (res.delivered) return interaction.editReply(`✅ You redeemed ${data.item_name} successfully! ${data.price} points were deducted.`);
  return interaction.editReply({
    content: `✅ You redeemed ${data.item_name} successfully! ${data.price} points were deducted.\nOpen a ticket to claim your prize 👇`,
    components: [ticketButton(data.purchase_id)],
  });
}

// ---------------------------------------------------------------- shop (Purchase button, all ephemeral)
// customIds carry everything they need, so the buttons keep working after a restart:
//   shop:open · shop:page:<page> · shop:pick:<page> (select, value = item id) · shop:buy:<itemId>:<page>
//   shop:back:<page>
const PAGE_SIZE = 25; // Discord limit for embed fields and select options
const buying = new Set(); // userId -> a purchase is in progress (a double click buys once)
const boughtOn = new Set(); // shop message ids that already completed a purchase (late second click)
const receipts = new Map(); // purchaseId -> receipt data (memory, so the ticket can show the receipt too)

const stockText = (i) => (i.stock > 0 ? `${i.stock} left` : 'Sold out');
const receiptNo = (id) => `#${String(id).padStart(6, '0')}`;
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

async function activeItems() {
  const { data, error } = await supabase.from('items').select('*').eq('active', true).order('id');
  if (error) throw error;
  return data || [];
}

// a) the prize list: balance on top, every active item as a field, a select menu for items in stock
function shopPage(items, balance, page) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = items.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setTitle('🛍️ Prize Shop')
    .setDescription(`Your points: **${balance}**${items.length ? '' : '\n\nNo prizes available right now.'}`)
    .setColor(0x2ecc71);
  for (const i of slice) {
    embed.addFields({ name: `#${i.id} ${i.name}`.slice(0, 256), value: `${i.price} points · ${stockText(i)} · ${i.type}`, inline: false });
  }
  if (pages > 1) embed.setFooter({ text: `Page ${p + 1} of ${pages}` });

  // sold-out items stay visible in the list above but are not selectable
  const inStock = slice.filter((i) => i.stock > 0);
  const menu = new StringSelectMenuBuilder().setCustomId(`shop:pick:${p}`).setPlaceholder(inStock.length ? 'Choose a prize' : 'Nothing in stock on this page');
  if (inStock.length) {
    menu.addOptions(
      inStock.map((i) => ({ label: i.name.slice(0, 100), value: String(i.id), description: `${i.price} points · ${i.stock} left`.slice(0, 100) }))
    );
  } else {
    menu.addOptions([{ label: 'Nothing in stock', value: 'none' }]).setDisabled(true);
  }
  const rows = [new ActionRowBuilder().addComponents(menu)];
  if (pages > 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`shop:page:${p - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
        new ButtonBuilder().setCustomId(`shop:page:${p + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages - 1)
      )
    );
  }
  return { content: '', embeds: [embed], components: rows };
}

// b) one item: details, points before/after, Confirm enabled only with enough points and stock
function itemDetail(item, balance, page) {
  const short = item.price - balance;
  const blocker = item.stock <= 0 ? 'Sold out' : short > 0 ? `You need ${short} more points` : null;
  const embed = new EmbedBuilder()
    .setTitle(item.name)
    .addFields(
      { name: 'Price', value: `${item.price} points`, inline: true },
      { name: 'Stock', value: stockText(item), inline: true },
      { name: 'Type', value: item.type, inline: true },
      { name: 'Your points', value: String(balance), inline: true },
      { name: 'Points after purchase', value: blocker ? '-' : String(balance - item.price), inline: true }
    )
    .setColor(blocker ? 0x95a5a6 : 0x2ecc71);
  if (item.description) embed.setDescription(item.description);
  if (item.image_url) embed.setThumbnail(item.image_url);
  if (blocker) embed.setFooter({ text: blocker });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop:buy:${item.id}:${page}`)
      .setLabel(blocker || 'Confirm purchase')
      .setEmoji(blocker ? '🔒' : '✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!blocker),
    new ButtonBuilder().setCustomId(`shop:back:${page}`).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
  );
  return { content: '', embeds: [embed], components: [row] };
}

// 4) receipt embed (member, staff copy and ticket share the same facts)
function receiptEmbed(r, { title = '🧾 Purchase Receipt', staff = false } = {}) {
  const e = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x5865f2)
    .addFields(
      { name: 'Receipt', value: receiptNo(r.purchaseId), inline: true },
      { name: 'Item', value: r.itemName.slice(0, 1024), inline: true },
      { name: 'Price', value: `${r.price} points`, inline: true },
      { name: 'Points before', value: r.before === null ? '-' : String(r.before), inline: true },
      { name: 'Points after', value: r.after === null ? '-' : String(r.after), inline: true },
      { name: 'Time', value: `<t:${unix(r.at)}:f> (<t:${unix(r.at)}:R>)`, inline: true }
    )
    .setFooter({ text: 'Marketplace · Vexo' });
  if (staff) e.addFields({ name: 'Buyer', value: `${r.buyerName.slice(0, 100)} (ID ${r.userId})`, inline: false });
  if (r.ticketChannelId) e.addFields({ name: 'Ticket', value: `<#${r.ticketChannelId}>`, inline: false });
  else if (r.delivered) e.addFields({ name: 'Delivery', value: 'Role delivered automatically.', inline: false });
  else if (!staff) e.addFields({ name: 'Next step', value: 'Open a ticket to claim your prize 👇', inline: false });
  else e.addFields({ name: 'Delivery', value: 'Pending: the member opens a ticket.', inline: false });
  return e;
}

// staff copy in RECEIPT_CHANNEL_ID. Never throws, never blocks or undoes a purchase, never pings.
async function postStaffReceipt(client, r) {
  try {
    if (!config.channels.receipts) return console.warn('Marketplace: RECEIPT_CHANNEL_ID is empty, staff receipt copy skipped.');
    const ch = await getTextChannel(client, config.channels.receipts);
    if (!ch) return console.warn('Marketplace: RECEIPT_CHANNEL_ID is not reachable (wrong ID or no access), staff receipt copy skipped.');
    await ch.send({ embeds: [receiptEmbed(r, { title: '🧾 New purchase', staff: true })], allowedMentions: { parse: [] } });
  } catch (e) {
    console.warn('Marketplace: staff receipt copy failed:', e.message);
  }
}

// a ticket was opened for a purchase: put its receipt there too (never throws)
async function postReceiptInTicket(channel, purchase) {
  try {
    const r = receipts.get(purchase.id) || {
      purchaseId: purchase.id,
      itemName: purchase.item_name,
      price: purchase.price,
      before: null,
      after: null,
      at: purchase.created_at || new Date(),
    };
    await channel.send({ embeds: [receiptEmbed({ ...r, ticketChannelId: channel.id, delivered: false }, { staff: false })], allowedMentions: { parse: [] } });
  } catch (e) {
    console.warn('Marketplace: ticket receipt failed:', e.message);
  }
}

// c) Confirm: re-checks points + stock through the existing purchase; one purchase per click, ever
async function shopBuy(interaction, itemId, page) {
  const uid = interaction.user.id;
  const msgId = interaction.message?.id;
  if (buying.has(uid)) return; // a second click while the first is running: ignored (already acknowledged)
  if (msgId && boughtOn.has(msgId)) return; // a late click on a shop message that already completed a purchase
  buying.add(uid);
  try {
    const res = await redeem(interaction, itemId);
    if (!res.ok) {
      const back = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`shop:back:${page}`).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
      );
      return interaction.editReply({ content: `${res.message}\nNothing was changed.`, embeds: [], components: [back] });
    }
    const { data } = res;
    const after = await balanceOf(uid).catch(() => null);
    const r = {
      purchaseId: data.purchase_id,
      itemName: data.item_name,
      price: data.price,
      after,
      before: after === null ? null : after + data.price,
      at: new Date(),
      userId: uid,
      buyerName: interaction.member?.displayName || interaction.user.username,
      delivered: res.delivered,
      ticketChannelId: null,
    };
    receipts.set(data.purchase_id, r);
    if (msgId) {
      boughtOn.add(msgId);
      if (boughtOn.size > 2000) boughtOn.delete(boughtOn.values().next().value); // keep it small
    }
    // the receipt replaces the Confirm button, so the same purchase can't be clicked again
    await interaction.editReply({ content: '', embeds: [receiptEmbed(r)], components: res.delivered ? [] : [ticketButton(data.purchase_id)] });
    await postStaffReceipt(interaction.client, r);
  } finally {
    buying.delete(uid);
  }
}

// every shop:* button and the shop select menu (routed from interactionCreate). Never throws.
async function handleShop(interaction) {
  const [, action, a, b] = interaction.customId.split(':');
  try {
    if (action === 'open') {
      await interaction.deferReply({ flags: EPHEMERAL }); // acknowledged right away
      const [items, balance] = await Promise.all([activeItems(), balanceOf(interaction.user.id)]);
      return await interaction.editReply(shopPage(items, balance, 0));
    }
    await interaction.deferUpdate(); // the ephemeral shop message is updated in place
    if (action === 'page' || action === 'back') {
      const [items, balance] = await Promise.all([activeItems(), balanceOf(interaction.user.id)]);
      return await interaction.editReply(shopPage(items, balance, Number(a) || 0));
    }
    if (action === 'pick') {
      const id = Number(interaction.values?.[0]);
      const [items, balance] = await Promise.all([activeItems(), balanceOf(interaction.user.id)]);
      const item = items.find((i) => i.id === id);
      if (!item) return await interaction.editReply(shopPage(items, balance, Number(a) || 0));
      return await interaction.editReply(itemDetail(item, balance, Number(a) || 0));
    }
    if (action === 'buy') return await shopBuy(interaction, Number(a), Number(b) || 0);
  } catch (err) {
    console.error('shop:', err.message);
    const msg = { content: 'Something went wrong, nothing was changed. Please try again.', flags: EPHEMERAL };
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
}

// ---------------------------------------------------------------- tickets
async function handleOpenTicket(interaction, purchaseId) {
  await interaction.deferReply({ flags: EPHEMERAL });
  if (!Number.isInteger(purchaseId)) return interaction.editReply('Invalid purchase ID.');

  const { data: p } = await supabase.from('purchases').select('*').eq('id', purchaseId).maybeSingle();
  if (!p || p.user_id !== interaction.user.id) return interaction.editReply('This is not your purchase.');
  if (p.status !== 'pending') return interaction.editReply(`This purchase's status is: **${p.status}**.`);

  if (p.ticket_channel_id && p.ticket_channel_id !== 'creating') {
    return interaction.editReply(`A ticket is already open: <#${p.ticket_channel_id}>`);
  }

  // lock so double-click cannot create two tickets
  const { data: lock } = await supabase
    .from('purchases')
    .update({ ticket_channel_id: 'creating' })
    .eq('id', purchaseId)
    .is('ticket_channel_id', null)
    .select();
  if (!lock || lock.length === 0) return interaction.editReply('Your ticket is being created, please wait a moment.');

  try {
    const guild = interaction.guild;
    const overwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ];
    if (config.adminRoleId) {
      overwrites.push({
        id: config.adminRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    const channel = await guild.channels.create({
      name: `ticket-${purchaseId}`,
      type: ChannelType.GuildText,
      parent: config.channels.ticketCategory || null,
      permissionOverwrites: overwrites,
    });
    await supabase.from('purchases').update({ ticket_channel_id: channel.id }).eq('id', purchaseId);

    const embed = new EmbedBuilder()
      .setTitle(`Ticket: Purchase #${purchaseId}`)
      .setDescription(`**Item:** ${p.item_name}\n**Price:** ${p.price} points\n\nAn admin will talk with you here and deliver your prize.`)
      .setColor(0xf1c40f);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`deliver:${purchaseId}`)
        .setLabel('Mark Delivered (admin)')
        .setStyle(ButtonStyle.Success)
    );
    await channel.send({
      content: `<@${interaction.user.id}>${config.adminRoleId ? ` <@&${config.adminRoleId}>` : ''}`,
      embeds: [embed],
      components: [row],
    });
    await postReceiptInTicket(channel, p); // the purchase receipt in the ticket too (never throws)

    return interaction.editReply(`🎫 Ticket opened: <#${channel.id}>`);
  } catch (err) {
    await supabase.from('purchases').update({ ticket_channel_id: null }).eq('id', purchaseId);
    throw err;
  }
}

async function handleDeliver(interaction, purchaseId) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: 'Only admins can do this.', flags: EPHEMERAL });
  }
  await interaction.deferReply();

  const { data } = await supabase
    .from('purchases')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .eq('id', purchaseId)
    .eq('status', 'pending')
    .select();
  if (!data || data.length === 0) {
    return interaction.editReply('This purchase has already been delivered or refunded.');
  }
  const p = data[0];

  await sendLog(interaction.client, {
    purchaseId: p.id,
    userId: p.user_id,
    itemName: p.item_name,
    price: p.price,
    status: 'Delivered',
    note: `Delivered by <@${interaction.user.id}>`,
  });
  await interaction.editReply('✅ Delivered! This ticket will close in 15 seconds.');

  const channel = interaction.channel;
  await sendTranscript(interaction.client, channel, p.id);
  setTimeout(() => channel.delete().catch(() => {}), 15000);
}

// ---------------------------------------------------------------- refund
async function refundPurchase(client, purchaseId) {
  const { data, error } = await supabase.rpc('refund_purchase', { p_purchase: purchaseId });
  if (error) throw error;
  if (!data.ok) return data;

  await refreshItemCard(client, data.item_id);
  await sendLog(client, {
    purchaseId,
    userId: data.user_id,
    itemName: data.item_name,
    price: data.price,
    status: 'Refunded',
  });

  if (data.ticket_channel_id && data.ticket_channel_id !== 'creating') {
    const ch = await getTextChannel(client, data.ticket_channel_id);
    if (ch) {
      await sendTranscript(client, ch, purchaseId);
      await ch.delete().catch(() => {});
    }
  }
  return data;
}

module.exports = {
  itemMessage,
  postItemCard,
  refreshItemCard,
  deleteItemCard,
  repostItemCard,
  cardExists,
  autocompleteItems,
  setupHeader,
  syncShop,
  ensureHeader,
  removeOldItemCards,
  isOldItemCard,
  handleShop,
  handleMyPoints,
  handleRedeem,
  handleOpenTicket,
  handleDeliver,
  refundPurchase,
  points,
  _test: { buying, boughtOn, receipts, shopPage, itemDetail, PAGE_SIZE },
};
