// One row per Discord server (the "guilds" table) and THE place that answers
// "which channels / roles / boss / knowledge does THIS server use?".
//
//   settings(guild)  -> the per-server settings every feature reads
//       HΛVØCZ (HOME_GUILD_ID): the .env values, EXCEPT a channel / the game ping role / knowledge source
//                               channels an admin chose with /setup (saved in its guilds row), which win.
//                               Anything not chosen in /setup stays exactly the .env value. Nothing is ever
//                               created there automatically.
//       any other server:       the guilds row (settings JSON filled by auto setup and /setup)
//
// A missing server id means HΛVØCZ (older single-server callers). Every entry point that can be reached
// from another server (messages, slash commands, buttons) passes the real guild id.
// Rows are cached in memory (loaded at startup, updated on every write) so reading settings is instant.
const supabase = require('./db');
const config = require('./config');

const rows = new Map(); // guildId -> guilds row

const homeId = () => String(config.homeGuildId || '').trim();

// accepts a guild id, a Guild, or anything with .guildId / .guild.id (Message, Interaction, GuildMember)
function idOf(x) {
  if (x === null || x === undefined || x === '') return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x).trim();
  if (x.guildId) return String(x.guildId);
  if (x.guild?.id) return String(x.guild.id);
  // a Guild itself (has channels / members managers), never a User / Message id
  if (x.id && (x.channels || x.members || x.ownerId)) return String(x.id);
  return '';
}

const isHome = (x) => {
  const id = idOf(x);
  return !id || id === homeId();
};
const gid = (x) => idOf(x) || homeId(); // the id to store / filter by

const DEFAULT_TICKET_TEXT = 'Please open a ticket to claim your prize.';

// ---------------------------------------------------------------- settings
// HΛVØCZ channels that /setup may change: saved key (same names as other servers) -> settings.channels key
const HOME_CHANNEL_KEYS = {
  control: 'control',
  logs: 'logs',
  marketplace: 'marketplace',
  rumble: 'rumble',
  games: 'general', // number guess + daily top chatter (GENERAL_CHANNEL_ID)
  xDrop: 'xDrop',
  giveaway: 'giveaway',
  nftRadar: 'nftRadar',
  solRadar: 'solRadar',
  welcome: 'welcome',
  ask: 'ask',
};
// the HΛVØCZ channels from .env alone
function homeEnvChannels() {
  return {
    ...config.channels, // ask, general, marketplace, redeemLogs, receipts, ticketCategory, welcome, rules, control, ticket, giveaway, nftRadar, solRadar, assistant
    rumble: config.rumble.channelId,
    xDrop: config.xDrop.channelId,
    // no own .env variable: REDEEM_LOGS_CHANNEL_ID is the .env fallback, but NEVER when it is the shop channel
    logs: config.channels.redeemLogs && config.channels.redeemLogs !== config.channels.marketplace ? config.channels.redeemLogs : '',
  };
}
// the HΛVØCZ channels chosen in /setup ({ channels key: id }); empty values = not chosen
function homeChosen(row = rows.get(homeId())) {
  const saved = row?.settings?.channels || {};
  const out = {};
  for (const [savedKey, key] of Object.entries(HOME_CHANNEL_KEYS)) {
    const v = String(saved[savedKey] ?? '').trim();
    if (v) out[key] = v;
  }
  return out;
}
// /status in HΛVØCZ: where every channel comes from -> { channels key: { id, from: 'setup' | 'env' | '' } }
function homeChannelSources() {
  const env = homeEnvChannels();
  const chosen = homeChosen();
  return Object.fromEntries(Object.values(HOME_CHANNEL_KEYS).map((k) => [k, chosen[k] ? { id: chosen[k], from: 'setup' } : env[k] ? { id: env[k], from: 'env' } : { id: '', from: '' }]));
}

function homeSettings() {
  const row = rows.get(homeId());
  const s = row?.settings || {};
  return {
    guildId: homeId(),
    isHome: true,
    known: true,
    name: config.homeGuildName, // fixed spelling for Vexo's prompts (never the live Discord server name)
    channels: { ...homeEnvChannels(), ...homeChosen(row) }, // /setup first, then .env
    bossUserId: config.bossUserId,
    staffRoleIds: config.staffRoleIds,
    adminRoleId: config.adminRoleId,
    verifiedRoleId: config.verifiedRoleId, // points eligibility + Rumble join rule (always .env)
    pingRoleId: typeof s.pingRoleId === 'string' ? s.pingRoleId : config.verifiedRoleId, // role pinged for games: /setup first, then .env
    requireVerified: config.rumble.requireVerified,
    chatChannelIds: config.chatChannelIds,
    excludedChannels: config.filters.excludedChannels,
    ticketInstructions: null, // null = keep the existing HΛVØCZ wording everywhere
    knowledgeSources: Array.isArray(s.knowledgeSources) ? s.knowledgeSources.map(String) : [], // learned into a SEPARATE sheet (learn.js)
    automod: row?.settings?.automod || {}, // every rule OFF unless switched on with /automod
    scam: row?.settings?.scam || {}, // scam protection: OFF here until switched on with /automod scam
    bossHours: true, // offline window, boss cover, lone-member chat
    personalVexo: true, // Personal Vexo: on in the home server
  };
}

function otherSettings(id) {
  const row = rows.get(id);
  const s = row?.settings || {};
  const ch = s.channels || {};
  return {
    guildId: id,
    isHome: false,
    known: !!row && row.status !== 'left',
    name: row?.name || 'this server',
    channels: {
      ask: '',
      general: ch.games || ch.rumble || '', // number guess + daily top chatter
      marketplace: ch.marketplace || '',
      redeemLogs: ch.logs || '',
      receipts: '',
      ticketCategory: '',
      welcome: '',
      rules: '',
      control: ch.control || '',
      ticket: '',
      rumble: ch.rumble || '',
      xDrop: ch.xDrop || '', // X posts channel (auto setup creates "x-posts"; /setup can change it)
      giveaway: ch.giveaway || '', // giveaway channel (auto setup creates "giveaways"; /setup can change it)
      nftRadar: ch.nftRadar || '', // auto setup creates "📡・nft-radar"
      solRadar: ch.solRadar || '', // auto setup creates "📈・sol-radar"
      assistant: s.personalVexo === true ? ch.assistant || '' : '', // "🤖・get-vexo-assistant", only where Personal Vexo is on
      logs: ch.logs || '',
    },
    bossUserId: String(row?.boss_user_id || '').trim(),
    staffRoleIds: Array.isArray(s.staffRoleIds) ? s.staffRoleIds.map(String) : [],
    adminRoleId: '',
    verifiedRoleId: '',
    pingRoleId: String(s.pingRoleId || ''),
    requireVerified: false,
    chatChannelIds: [],
    excludedChannels: Array.isArray(s.excludedChannels) ? s.excludedChannels.map(String) : [],
    ticketInstructions: (row?.ticket_instructions || '').trim() || DEFAULT_TICKET_TEXT,
    knowledgeSources: Array.isArray(s.knowledgeSources) ? s.knowledgeSources.map(String) : [],
    automod: s.automod || {},
    scam: s.scam || {}, // scam protection: ON (auto mode) by default, see scam.js
    bossHours: false,
    personalVexo: s.personalVexo === true, // per-server flag, off unless the bot owner turns it on (/admin personalvexo)
  };
}

function settings(x) {
  const id = gid(x);
  return id === homeId() ? homeSettings() : otherSettings(id);
}

// ---------------------------------------------------------------- THE channel of a feature
// Every feature gets its channel here (or from settings(x).channels, which is built by the same rules):
//   1. the channel chosen in /setup for THIS server (guilds table)
//   2. HΛVØCZ only: the .env variable as fallback
//   3. otherwise '' = not set: the feature skips posting. There is NO fallback to another channel, and a
//      feature that is not the shop never gets the shop (marketplace) channel, even if a setting points there.
// feature names: control, logs, marketplace (or shop), rumble, games (or numberGuess, general), xDrop, giveaway,
// nftRadar, solRadar, welcome, ask, assistant, receipts, ticket, ticketCategory, rules, redeemLogs (purchase log)
const FEATURE_ALIASES = { shop: 'marketplace', games: 'general', numberGuess: 'general' };
function getFeatureChannel(x, feature) {
  const s = x && typeof x === 'object' && 'isHome' in x && x.channels ? x : settings(x); // a settings object or anything settings() takes
  const key = FEATURE_ALIASES[feature] || feature;
  const id = String(s.channels[key] || '');
  if (!id) return '';
  if (key !== 'marketplace' && key !== 'redeemLogs' && id === s.channels.marketplace) return ''; // never the shop (purchase logs may live there)
  return id;
}
// feature logs and notices (SOL / NFT Radar, giveaways, auto mod, scam alerts, settings changes): ONLY the logs
// channel. Not set = nothing is sent (no fallback to control, general or the shop).
const logsChannelId = (x) => getFeatureChannel(x, 'logs');

// ---------------------------------------------------------------- rows
const get = (x) => rows.get(gid(x)) || null;
const all = () => [...rows.values()];

function check(error, what) {
  if (error) throw new Error(`guilds ${what}: ${error.message}`);
}

// load every row once at startup (never throws: HΛVØCZ works from .env even if the table is missing)
async function load() {
  try {
    const { data, error } = await supabase.from('guilds').select('*');
    check(error, 'load');
    rows.clear();
    for (const r of data || []) rows.set(String(r.guild_id), r);
    return rows.size;
  } catch (err) {
    console.error(`${err.message} (did you run supabase/migration_multiserver.sql?)`);
    return null;
  }
}

// update one row and the cache; returns the new row
async function update(x, patch) {
  const id = gid(x);
  const { data, error } = await supabase.from('guilds').update(patch).eq('guild_id', id).select().maybeSingle();
  check(error, 'update');
  if (data) rows.set(id, data);
  return data || null;
}

// merge keys into settings JSON (read-modify-write on the fresh row, so two edits don't overwrite each other's keys)
async function patchSettings(x, patch) {
  const id = gid(x);
  const { data: fresh, error } = await supabase.from('guilds').select('settings').eq('guild_id', id).maybeSingle();
  check(error, 'read settings');
  const cur = fresh?.settings || {};
  const next = { ...cur, ...patch };
  if (patch.channels) next.channels = { ...(cur.channels || {}), ...patch.channels };
  if (patch.automod) next.automod = { ...(cur.automod || {}), ...patch.automod };
  if (patch.scam) next.scam = { ...(cur.scam || {}), ...patch.scam };
  return update(id, { settings: next });
}

// The bot joined a server (or sees it at startup). Creates the row once; a server that comes back keeps
// its old row, so its trial is never restarted. Returns { row, created }.
async function join(guild, { trialDays = config.trialDays } = {}) {
  const id = String(guild.id);
  const { data: existing, error } = await supabase.from('guilds').select('*').eq('guild_id', id).maybeSingle();
  check(error, 'read');
  if (existing) {
    const patch = { name: guild.name || existing.name, status: 'active', left_at: null };
    if (!existing.boss_user_id && id !== homeId() && guild.ownerId) patch.boss_user_id = String(guild.ownerId);
    return { row: await update(id, patch), created: false };
  }
  const now = new Date();
  const row = { guild_id: id, name: guild.name || null, status: 'active' };
  if (id !== homeId()) {
    row.boss_user_id = guild.ownerId ? String(guild.ownerId) : null; // the server owner, changeable in /setup
    row.trial_started_at = now.toISOString();
    row.trial_ends_at = new Date(now.getTime() + Math.max(0, Number(trialDays) || 0) * 86400000).toISOString();
  }
  const { data, error: insErr } = await supabase.from('guilds').insert(row).select().single();
  check(insErr, 'insert');
  rows.set(id, data);
  return { row: data, created: true };
}

// The bot was removed: the row is KEPT (only marked), so the trial can never be taken twice
async function leave(guildId) {
  if (isHome(guildId)) return null;
  return update(guildId, { status: 'left', left_at: new Date().toISOString() });
}

module.exports = {
  homeId,
  idOf,
  gid,
  isHome,
  settings,
  logsChannelId,
  getFeatureChannel,
  homeChannelSources,
  HOME_CHANNEL_KEYS,
  get,
  all,
  load,
  update,
  patchSettings,
  join,
  leave,
  DEFAULT_TICKET_TEXT,
  _test: { rows },
};
