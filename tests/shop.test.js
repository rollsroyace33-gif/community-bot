// Marketplace shop test: mocked Discord + Supabase + the redeem_item purchase function. No AI, nothing sent anywhere.
// Run: node tests/shop.test.js
const assert = require('assert');
const { PermissionFlagsBits } = require('discord.js');

const BOT = '111111111111111111';
const BUYER = '200000000000000001';
const POOR = '200000000000000002';
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: 'g', HOME_GUILD_ID: 'g', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x', OPENAI_API_KEY: 'x',
  MARKETPLACE_CHANNEL_ID: 'shop', REDEEM_LOGS_CHANNEL_ID: 'logs', RECEIPT_CHANNEL_ID: 'receipts', CONTROL_CHANNEL_ID: '',
  TICKET_CATEGORY_ID: '', ADMIN_ROLE_ID: '', AUTO_REMOVE_SOLD_OUT: 'false',
});
const src = (p) => require.resolve(`../src/${p}`);

// ---------------------------------------------------------------- fake Supabase
const tables = { items: [], users: [], purchases: [], bot_settings: [], point_log: [] };
const clone = (o) => JSON.parse(JSON.stringify(o));
let rpcCalls = 0;
const fakeDb = {
  // the EXISTING purchase function, mocked with the same rules as supabase/schema.sql redeem_item
  async rpc(name, args) {
    if (name !== 'redeem_item') return { data: null, error: null };
    rpcCalls++;
    await new Promise((r) => setTimeout(r, 5)); // a real round trip: concurrent clicks overlap
    const item = tables.items.find((i) => i.id === args.p_item);
    if (!item || !item.active) return { data: { ok: false, message: 'Item not found.' }, error: null };
    if (item.stock <= 0) return { data: { ok: false, message: '❌ This item is out of stock.' }, error: null };
    let user = tables.users.find((u) => u.user_id === args.p_user);
    if (!user) tables.users.push((user = { user_id: args.p_user, points: 0 }));
    if (user.points < item.price) return { data: { ok: false, message: 'not enough' }, error: null };
    user.points -= item.price;
    item.stock -= 1;
    const p = { id: tables.purchases.length + 1, user_id: args.p_user, item_id: item.id, item_name: item.name, item_type: item.type, price: item.price, status: 'pending', ticket_channel_id: null, created_at: new Date().toISOString() };
    tables.purchases.push(p);
    return { data: { ok: true, purchase_id: p.id, item_id: item.id, item_name: item.name, item_type: item.type, role_id: item.role_id, price: item.price, stock: item.stock }, error: null };
  },
  from(table) {
    const q = { op: 'select', f: [], single: false, ret: false };
    const api = {
      select: () => ((q.ret = true), api), order: () => api, limit: () => api,
      eq: (k, v) => (q.f.push((r) => r[k] === v || (k === 'guild_id' && r[k] === undefined)), api), is: (k, v) => (q.f.push((r) => (r[k] ?? null) === v), api),
      lte: (k, v) => (q.f.push((r) => r[k] <= v), api),
      single: () => ((q.single = true), api), maybeSingle: () => ((q.single = true), api),
      insert: (row) => ((q.op = 'insert'), (q.row = row), api), update: (p) => ((q.op = 'update'), (q.p = p), api),
      upsert: (row) => ((q.op = 'upsert'), (q.row = row), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = (tables[table] ||= []);
      if (q.op === 'insert') {
        const r = { id: rows.length + 1, active: true, description: '', image_url: null, channel_id: null, message_id: null, ...clone(q.row) };
        rows.push(r);
        return { data: q.single ? clone(r) : [clone(r)], error: null };
      }
      if (q.op === 'upsert') {
        const i = rows.findIndex((r) => r.key === q.row.key);
        if (i >= 0) rows[i] = { ...q.row };
        else rows.push({ ...q.row });
        return { data: null, error: null };
      }
      const m = rows.filter((r) => q.f.every((f) => f(r)));
      if (q.op === 'update') m.forEach((r) => Object.assign(r, clone(q.p)));
      return { data: q.single ? (m[0] ? clone(m[0]) : null) : m.map(clone), error: null };
    }
    return api;
  },
};
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };
let aiCalls = 0;
global.fetch = async () => {
  aiCalls++;
  throw new Error('no AI in the marketplace');
};

// ---------------------------------------------------------------- fake Discord
let seq = 100;
const warnings = [];
function makeChannel(id) {
  const messages = new Map();
  const ch = {
    id, name: id, isTextBased: () => true, messages: null, sent: [],
    send: async (m) => {
      const msg = makeMessage(ch, BOT, m);
      ch.sent.push(msg);
      return msg;
    },
    delete: async () => {},
  };
  ch.messages = {
    store: messages,
    fetch: async (arg) => {
      if (typeof arg === 'string') {
        if (!messages.has(arg)) throw new Error('Unknown Message');
        return messages.get(arg);
      }
      const all = [...messages.values()].sort((a, b) => Number(b.id) - Number(a.id)); // newest first
      const from = arg?.before ? all.filter((m) => Number(m.id) < Number(arg.before)) : all;
      return new Map(from.slice(0, arg?.limit || 50).map((m) => [m.id, m]));
    },
  };
  return ch;
}
function makeMessage(ch, authorId, m) {
  const json = (x) => (x?.toJSON ? x.toJSON() : x);
  const msg = {
    id: String(++seq), channelId: ch.id, author: { id: authorId },
    content: typeof m === 'string' ? m : m.content || '',
    embeds: (m.embeds || []).map(json),
    components: (m.components || []).map((r) => {
      const row = json(r);
      return { components: (row.components || []).map((c) => ({ ...c, customId: c.custom_id })) };
    }),
    allowedMentions: m.allowedMentions,
    edits: 0,
    edit: async (n) => {
      msg.edits++;
      const updated = makeMessage(ch, authorId, n);
      ch.messages.store.delete(updated.id); // (the helper stores a new message; an edit keeps the same one)
      Object.assign(msg, updated, { id: msg.id, edits: msg.edits, edit: msg.edit, delete: msg.delete });
      ch.messages.store.set(msg.id, msg);
      return msg;
    },
    delete: async () => ch.messages.store.delete(msg.id),
  };
  ch.messages.store.set(msg.id, msg);
  return msg;
}
const channels = { shop: makeChannel('shop'), logs: makeChannel('logs'), receipts: makeChannel('receipts') };
const created = []; // ticket channels
const guild = {
  id: 'g',
  channels: {
    create: async (opts) => {
      const ch = makeChannel(`ticket-ch-${created.length + 1}`);
      ch.name = opts.name;
      channels[ch.id] = ch;
      created.push(ch);
      return ch;
    },
  },
};
const client = { user: { id: BOT }, channels: { fetch: async (id) => channels[id] || null } };

// a component / slash interaction mock
function interaction({ user = BUYER, customId, values, message, options = {}, admin = false, name = 'Buyer One' } = {}) {
  const it = {
    customId, values, message, user: { id: user, username: name, tag: `${name}#0` }, client, guild,
    member: { displayName: name, roles: { add: async () => {} } },
    memberPermissions: { has: (p) => admin && p === PermissionFlagsBits.ManageGuild },
    options: {
      getString: (n) => options[n] ?? null, getInteger: (n) => options[n] ?? null, getRole: (n) => options[n] ?? null,
    },
    replies: [], deferred: false, replied: false, ackAt: null,
    deferReply: async () => ((it.deferred = true), (it.ackAt = Date.now())),
    deferUpdate: async () => ((it.deferred = true), (it.ackAt = Date.now())),
    reply: async (m) => ((it.replied = true), (it.ackAt = Date.now()), it.replies.push(m)),
    editReply: async (m) => it.replies.push(m),
    followUp: async (m) => it.replies.push(m),
    isButton: () => !values, isStringSelectMenu: () => !!values, isChatInputCommand: () => false, isAutocomplete: () => false,
  };
  return it;
}
const last = (it) => it.replies.at(-1);
const json = (x) => (x?.toJSON ? x.toJSON() : x);
const embedOf = (r) => json(r.embeds[0]);
const componentsOf = (r) => (r.components || []).map(json).flatMap((row) => row.components);

// ---------------------------------------------------------------- modules
const config = require(src('config.js'));
const marketplace = require(src('marketplace.js'));
const onInteraction = require(src('events/interactionCreate.js'));
const cmd = (n) => require(src(`commands/${n}.js`));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').slice(0, 6).join('\n      ')}`);
  }
}
const show = (l, v) => console.log(`      ${l}: ${v}`);

(async () => {
  // a shop channel as it looks today: old header, 3 old item cards, a member message, another bot message
  const shop = channels.shop;
  const oldHeader = makeMessage(shop, BOT, { embeds: [{ title: '🛒 Marketplace', description: 'old' }], components: [{ components: [{ custom_id: 'mypoints' }] }] });
  tables.bot_settings.push({ key: 'marketplace_header_message_id', value: oldHeader.id });
  for (let i = 1; i <= 3; i++) makeMessage(shop, BOT, { embeds: [{ title: `Old ${i}`, footer: { text: `Item #${i}` } }], components: [{ components: [{ custom_id: `redeem:${i}` }] }] });
  const memberMsg = makeMessage(shop, BUYER, { content: 'Item #1 looks cool', embeds: [{ footer: { text: 'Item #1' } }] });
  const otherBotMsg = makeMessage(shop, BOT, { content: 'Welcome to the shop!' });

  console.log('== 1. Shop channel ==');
  await test('sync: header edited IN PLACE with exactly two buttons; only the 3 old bot item cards are deleted', async () => {
    const r = await marketplace.syncShop(client);
    assert.strictEqual(r.removed, 3);
    assert.strictEqual(r.posted, false);
    const header = shop.messages.store.get(oldHeader.id);
    assert.ok(header, 'header was not kept');
    assert.strictEqual(header.edits, 1);
    const e = header.embeds[0];
    assert.strictEqual(e.title, '🛒 Marketplace');
    assert.strictEqual(e.description, 'Spend your points on prizes. Tap Purchase to browse.');
    const buttons = header.components.flatMap((row) => row.components);
    assert.deepStrictEqual(buttons.map((b) => `${b.emoji?.name} ${b.label}`), ['🪙 My Points', '🛍️ Purchase']);
    assert.ok(shop.messages.store.has(memberMsg.id) && shop.messages.store.has(otherBotMsg.id), 'deleted something else');
    assert.strictEqual([...shop.messages.store.values()].filter((m) => marketplace.isOldItemCard(m, BOT)).length, 0);
    show('shop channel now', [...shop.messages.store.values()].map((m) => (m.id === oldHeader.id ? '[header]' : m.author.id === BOT ? '[other bot msg]' : '[member msg]')).join(' '));
    const again = await marketplace.syncShop(client);
    assert.strictEqual(again.posted, false);
    assert.strictEqual(again.removed, 0);
    assert.strictEqual(shop.sent.length, 0, 'posted a new message instead of editing');
  });

  console.log('\n== 2. Admin commands: same data, same replies, no item cards ==');
  await test('/additem saves the same row and replies the same text; no item card is posted', async () => {
    const it = interaction({ admin: true, options: { name: 'Golden Badge', price: 50, stock: 3, type: 'other', description: 'Shiny' } });
    await cmd('additem').execute(it);
    const row = tables.items.at(-1);
    assert.deepStrictEqual(
      { name: row.name, price: row.price, stock: row.stock, type: row.type, role_id: row.role_id, description: row.description, image_url: row.image_url },
      { name: 'Golden Badge', price: 50, stock: 3, type: 'other', role_id: null, description: 'Shiny', image_url: null }
    );
    assert.strictEqual(last(it), `✅ Item **#${row.id} Golden Badge** has been added to the marketplace.`);
    assert.strictEqual(shop.sent.length, 0, 'something was posted in the shop channel');
    show('reply', last(it));
  });

  await test('/edititem, /listitems, /repostitem, /removeitem, /setupmarketplace: same replies, no cards posted', async () => {
    let it = interaction({ admin: true, options: { id: 1, price: 40 } });
    await cmd('edititem').execute(it);
    assert.strictEqual(last(it), '✅ Item #1 has been updated.');
    assert.strictEqual(tables.items[0].price, 40);
    it = interaction({ admin: true });
    await cmd('listitems').execute(it);
    assert.match(last(it), /\*\*#1\*\* Golden Badge — 40pts — stock 3 — other — ✅ card ok/);
    it = interaction({ admin: true, options: { id: 1 } });
    await cmd('repostitem').execute(it);
    assert.strictEqual(last(it), '✅ A fresh card for **#1 Golden Badge** has been posted.');
    it = interaction({ admin: true });
    await cmd('setupmarketplace').execute(it);
    assert.strictEqual(last(it), '✅ Marketplace header posted. 0 item card(s) reposted below it.');
    assert.strictEqual(shop.sent.length, 0);
    tables.items.push({ id: 99, name: 'Temp', price: 1, stock: 1, type: 'other', active: true, description: '' });
    it = interaction({ admin: true, options: { id: 99 } });
    await cmd('removeitem').execute(it);
    assert.strictEqual(last(it), '🗑️ Item #99 (Temp) has been removed.');
    assert.strictEqual(tables.items.find((i) => i.id === 99).active, false);
  });

  // shop data for the member tests
  tables.users.push({ user_id: BUYER, points: 500 }, { user_id: POOR, points: 10 });
  tables.items.push({ id: 2, name: 'VIP Role', price: 100, stock: 0, type: 'role', role_id: 'r', active: true, description: '' });
  tables.items.push({ id: 3, name: 'Merch Hoodie', price: 300, stock: 5, type: 'merch', active: true, description: 'Cozy' });

  console.log('\n== 3. My Points + Purchase list ==');
  await test('My Points: ephemeral "🪙 Your Points" embed with the balance', async () => {
    const it = interaction({ customId: 'mypoints' });
    await onInteraction(it);
    assert.strictEqual(embedOf(last(it)).title, '🪙 Your Points');
    assert.match(embedOf(last(it)).description, /\*\*500\*\*/);
  });

  await test('Purchase: balance on top, every item listed, only in-stock items selectable', async () => {
    const it = interaction({ customId: 'shop:open' });
    await onInteraction(it);
    const r = last(it);
    const e = embedOf(r);
    assert.strictEqual(e.title, '🛍️ Prize Shop');
    assert.match(e.description, /Your points: \*\*500\*\*/);
    assert.deepStrictEqual(e.fields.map((f) => f.name), ['#1 Golden Badge', '#2 VIP Role', '#3 Merch Hoodie']);
    assert.match(e.fields[1].value, /Sold out/);
    assert.match(e.fields[0].value, /40 points · 3 left · other/);
    const menu = componentsOf(r)[0];
    assert.strictEqual(menu.placeholder, 'Choose a prize');
    assert.deepStrictEqual(menu.options.map((o) => o.value), ['1', '3']);
    assert.ok(it.ackAt, 'not acknowledged');
    show('list', e.fields.map((f) => `${f.name} (${f.value})`).join(' | '));
  });

  await test('more than 25 items: Previous / Next pagination', async () => {
    const before = tables.items.length;
    for (let i = 0; i < 30; i++) tables.items.push({ id: 200 + i, name: `Sticker ${i}`, price: 5, stock: 2, type: 'other', active: true, description: '' });
    let it = interaction({ customId: 'shop:open' });
    await onInteraction(it);
    let r = last(it);
    assert.strictEqual(embedOf(r).fields.length, 25);
    let btns = componentsOf(r).filter((c) => c.type === 2);
    assert.deepStrictEqual(btns.map((b) => [b.label, !!b.disabled]), [['Previous', true], ['Next', false]]);
    it = interaction({ customId: btns[1].custom_id, message: { id: 'eph1' } });
    await onInteraction(it);
    r = last(it);
    assert.strictEqual(embedOf(r).fields.length, tables.items.filter((i) => i.active).length - 25);
    btns = componentsOf(r).filter((c) => c.type === 2);
    assert.deepStrictEqual(btns.map((b) => [b.label, !!b.disabled]), [['Previous', false], ['Next', true]]);
    show('pages', `${embedOf(r).footer.text}`);
    tables.items.splice(before); // back to the small shop
  });

  console.log('\n== 4. Item detail + Confirm ==');
  await test('Confirm enabled only with enough points and stock ("You need X more points" / "Sold out")', async () => {
    let it = interaction({ customId: 'shop:pick:0', values: ['3'], message: { id: 'eph2' } });
    await onInteraction(it);
    let e = embedOf(last(it));
    let confirm = componentsOf(last(it))[0];
    assert.strictEqual(e.title, 'Merch Hoodie');
    assert.strictEqual(e.description, 'Cozy');
    assert.deepStrictEqual(e.fields.map((f) => [f.name, f.value]), [['Price', '300 points'], ['Stock', '5 left'], ['Type', 'merch'], ['Your points', '500'], ['Points after purchase', '200']]);
    assert.strictEqual(confirm.label, 'Confirm purchase');
    assert.ok(!confirm.disabled);
    assert.strictEqual(componentsOf(last(it))[1].label, 'Back');
    it = interaction({ user: POOR, customId: 'shop:pick:0', values: ['3'], message: { id: 'eph3' } });
    await onInteraction(it);
    confirm = componentsOf(last(it))[0];
    assert.ok(confirm.disabled);
    assert.strictEqual(confirm.label, 'You need 290 more points');
    tables.items.find((i) => i.id === 2).stock = 0;
    const page = marketplace._test.itemDetail(tables.items.find((i) => i.id === 2), 500, 0);
    assert.ok(json(page.components[0]).components[0].disabled);
    assert.strictEqual(json(page.components[0]).components[0].label, 'Sold out');
  });

  await test('double click on Confirm buys ONCE (two clicks at the same moment, then a late click)', async () => {
    const calls = rpcCalls;
    const msg = { id: 'eph-double' };
    const a = interaction({ customId: 'shop:buy:3:0', message: msg });
    const b = interaction({ customId: 'shop:buy:3:0', message: msg });
    await Promise.all([onInteraction(a), onInteraction(b)]);
    const late = interaction({ customId: 'shop:buy:3:0', message: msg });
    await onInteraction(late);
    assert.strictEqual(rpcCalls - calls, 1, 'the purchase function ran more than once');
    assert.strictEqual(tables.purchases.length, 1);
    assert.strictEqual(tables.users.find((u) => u.user_id === BUYER).points, 200);
    assert.strictEqual(tables.items.find((i) => i.id === 3).stock, 4);
  });

  await test('receipt: "🧾 Purchase Receipt" with receipt number, price, points before/after, Discord timestamp, ticket button', async () => {
    const p = tables.purchases[0];
    const it = interaction({ customId: 'shop:buy:1:0', message: { id: 'eph-receipt' } });
    await onInteraction(it);
    const r = last(it);
    const e = embedOf(r);
    const f = Object.fromEntries(e.fields.map((x) => [x.name, x.value]));
    assert.strictEqual(e.title, '🧾 Purchase Receipt');
    assert.strictEqual(f.Receipt, '#000002');
    assert.strictEqual(f.Item, 'Golden Badge');
    assert.strictEqual(f.Price, '40 points');
    assert.strictEqual(f['Points before'], '200');
    assert.strictEqual(f['Points after'], '160');
    assert.match(f.Time, /^<t:\d+:f> \(<t:\d+:R>\)$/);
    assert.strictEqual(e.footer.text, 'Marketplace · Vexo');
    assert.strictEqual(componentsOf(r)[0].custom_id, `ticket:${tables.purchases[1].id}`);
    assert.ok(p);
    show('receipt', e.fields.map((x) => `${x.name}: ${x.value}`).join(' | '));
  });

  await test('staff copy in RECEIPT_CHANNEL_ID: "🧾 New purchase", buyer name + ID, nobody pinged', async () => {
    const copies = channels.receipts.sent;
    assert.strictEqual(copies.length, 2);
    const e = copies[1].embeds[0];
    assert.strictEqual(e.title, '🧾 New purchase');
    assert.match(e.fields.find((x) => x.name === 'Buyer').value, new RegExp(`Buyer One \\(ID ${BUYER}\\)`));
    assert.deepStrictEqual(copies[1].allowedMentions, { parse: [] });
    assert.ok(!JSON.stringify(e).includes(`<@${BUYER}>`));
  });

  await test('opening the ticket puts the receipt in the ticket channel too (existing ticket flow unchanged)', async () => {
    const pid = tables.purchases[1].id;
    const it = interaction({ customId: `ticket:${pid}` });
    await onInteraction(it);
    assert.match(last(it), /🎫 Ticket opened: <#ticket-ch-1>/);
    const ticket = created[0];
    assert.strictEqual(ticket.name, `ticket-${pid}`);
    assert.strictEqual(ticket.sent[0].embeds[0].title, `Ticket: Purchase #${pid}`); // the existing ticket message first
    const rec = ticket.sent[1].embeds[0];
    assert.strictEqual(rec.title, '🧾 Purchase Receipt');
    assert.strictEqual(rec.fields.find((x) => x.name === 'Receipt').value, '#000002');
    assert.strictEqual(rec.fields.find((x) => x.name === 'Ticket').value, '<#ticket-ch-1>');
  });

  await test('not enough points / zero stock: clear error, nothing changes', async () => {
    const snap = JSON.stringify([tables.users, tables.items, tables.purchases]);
    let it = interaction({ user: POOR, customId: 'shop:buy:3:0', message: { id: 'eph-poor' } });
    await onInteraction(it);
    assert.match(last(it).content, /Not enough points\. You need 300 points, but you have 10\.\nNothing was changed\./);
    it = interaction({ customId: 'shop:buy:2:0', message: { id: 'eph-soldout' } });
    await onInteraction(it);
    assert.match(last(it).content, /out of stock/);
    assert.strictEqual(JSON.stringify([tables.users, tables.items, tables.purchases]), snap);
    show('error', last(it).content.replace(/\n/g, ' / '));
  });

  await test('empty RECEIPT_CHANNEL_ID: the purchase still succeeds, one clear warning', async () => {
    const saved = config.channels.receipts;
    config.channels.receipts = '';
    const warn = console.warn;
    console.warn = (m) => warnings.push(String(m));
    try {
      const it = interaction({ customId: 'shop:buy:1:0', message: { id: 'eph-noreceipt' } });
      await onInteraction(it);
      assert.strictEqual(embedOf(last(it)).title, '🧾 Purchase Receipt');
      assert.strictEqual(tables.purchases.length, 3);
      assert.ok(warnings.some((w) => /RECEIPT_CHANNEL_ID is empty/.test(w)));
      config.channels.receipts = 'missing-channel'; // set but not reachable
      const it2 = interaction({ customId: 'shop:buy:1:0', message: { id: 'eph-badreceipt' } });
      await onInteraction(it2);
      assert.strictEqual(embedOf(last(it2)).title, '🧾 Purchase Receipt');
      assert.ok(warnings.some((w) => /not reachable/.test(w)));
    } finally {
      config.channels.receipts = saved;
      console.warn = warn;
    }
  });

  await test('after a "restart" (memory cleared) the buttons still work: customIds carry what they need', async () => {
    marketplace._test.buying.clear();
    marketplace._test.boughtOn.clear();
    marketplace._test.receipts.clear();
    const it = interaction({ customId: 'shop:back:0', message: { id: 'eph-old' } });
    await onInteraction(it);
    assert.strictEqual(embedOf(last(it)).title, '🛍️ Prize Shop');
    const pick = interaction({ customId: 'shop:pick:0', values: ['1'], message: { id: 'eph-old' } });
    await onInteraction(pick);
    assert.strictEqual(embedOf(last(pick)).title, 'Golden Badge');
  });

  await test('no AI calls anywhere in the shop', () => {
    assert.strictEqual(aiCalls, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('test crashed:', err);
  process.exit(1);
});
