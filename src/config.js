// load .env only when it exists (local dev). On Render there is no .env: real env vars are used as-is.
const fs = require('fs');
const path = require('path');
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) require('dotenv').config({ path: envFile });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,

  ai: {
    provider: (process.env.AI_PROVIDER || 'openai').toLowerCase(),
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
  },

  channels: {
    ask: process.env.ASK_CHANNEL_ID || '',
    general: process.env.GENERAL_CHANNEL_ID || '',
    marketplace: process.env.MARKETPLACE_CHANNEL_ID || '',
    redeemLogs: process.env.REDEEM_LOGS_CHANNEL_ID || '',
    receipts: (process.env.RECEIPT_CHANNEL_ID || '').trim(), // staff copy of every shop receipt (empty = skipped)
    ticketCategory: process.env.TICKET_CATEGORY_ID || '',
    welcome: process.env.WELCOME_CHANNEL_ID || '',
    rules: process.env.RULES_CHANNEL_ID || '',
    control: process.env.CONTROL_CHANNEL_ID || '', // private channel for orders (empty = task system off)
    ticket: process.env.TICKET_CHANNEL_ID || '', // linked in the game winner message
  },

  // Discord user ID of remo.sol (Vexo's creator). Answers "who made you" and can give orders in the control channel.
  bossUserId: (process.env.BOSS_USER_ID || '').trim(),
  // members with any of these roles can also give orders in the control channel
  staffRoleIds: list(process.env.STAFF_ROLE_IDS),

  // ---- the boss's presence (welcome back, offline window, cover). The hours are never shown to anyone.
  bossAwayHours: num(process.env.BOSS_AWAY_HOURS, 4), // a gap this long = one welcome-back line
  bossOfflineStart: (process.env.BOSS_OFFLINE_START || '06:00').trim(), // HH:MM on the boss's clock (BOSS_TIMEZONE)
  bossOfflineEnd: (process.env.BOSS_OFFLINE_END || '18:00').trim(),
  bossActiveRecentMinutes: num(process.env.BOSS_ACTIVE_RECENT_MINUTES, 15), // boss wrote this recently = he is around
  bossNoteCooldownMinutes: num(process.env.BOSS_NOTE_COOLDOWN_MINUTES, 30), // max one boss ping per member
  bossNoteChannelMax: num(process.env.BOSS_NOTE_CHANNEL_MAX, 3), // max boss pings per channel per hour
  offline: {
    quietMinutes: num(process.env.OFFLINE_QUIET_MINUTES, 10), // channel quiet this long = Vexo may chat
    maxLines: num(process.env.OFFLINE_CHAT_MAX_LINES, 2),
    softReplies: num(process.env.OFFLINE_CHAT_SOFT_REPLIES, 2), // then only if the member keeps addressing Vexo
  },
  // optional: channels where Vexo may chat with a lone member (empty = every normal text channel)
  chatChannelIds: list(process.env.CHAT_CHANNEL_IDS),

  game: {
    durationMinutes: num(process.env.GAME_DURATION_MINUTES, 15),
    maxGuessesPerUser: num(process.env.GAME_MAX_GUESSES_PER_USER, 30),
    announceMinutes: num(process.env.GAME_ANNOUNCE_MINUTES, 10), // lower it only for testing
  },

  // Rumble Royale (src/tasks/rumbleRoyale.js). Runs ONLY in RUMBLE_CHANNEL_ID (empty = feature off, never a fallback)
  rumble: {
    channelId: (process.env.RUMBLE_CHANNEL_ID || '').trim(),
    minPlayers: num(process.env.RUMBLE_MIN_PLAYERS, 3),
    maxPlayers: num(process.env.RUMBLE_MAX_PLAYERS, 100),
    roundSeconds: num(process.env.RUMBLE_ROUND_SECONDS, 6), // the engine never goes below 3
    reviveChance: num(process.env.RUMBLE_REVIVE_CHANCE, 25), // % chance per eligible round that one player comes back
    maxRevives: num(process.env.RUMBLE_MAX_REVIVES, 2), // per game
    runnersShown: num(process.env.RUMBLE_RUNNERS_SHOWN, 5), // runners-up listed under the winner card
    maxMinutes: num(process.env.RUMBLE_MAX_MINUTES, 20), // safety timeout after the rounds start
    requireVerified: (process.env.RUMBLE_REQUIRE_VERIFIED || 'true').toLowerCase() !== 'false',
    defaultJoinMinutes: num(process.env.RUMBLE_DEFAULT_JOIN_MINUTES, 5),
    maxPointsPrize: num(process.env.RUMBLE_MAX_POINTS_PRIZE, 100000), // above this, a second confirm is needed
    preAnnounceMinutes: num(process.env.RUMBLE_PRE_ANNOUNCE_MINUTES, 5), // heads-up before a scheduled start
  },

  adminRoleId: process.env.ADMIN_ROLE_ID || '',
  verifiedRoleId: process.env.VERIFIED_ROLE_ID || '',

  timezone: process.env.TIMEZONE || 'Asia/Dhaka',
  // zone the boss writes times in (control channel orders). Only used to READ orders; Vexo shows UTC.
  bossTimezone: (process.env.BOSS_TIMEZONE || 'Asia/Dhaka').trim(),
  dailyCron: process.env.DAILY_CRON || '55 23 * * *',

  points: {
    dailyCap: num(process.env.DAILY_CAP, 10),
    messageCap: num(process.env.MESSAGE_CAP, 5),
    reactionCap: num(process.env.REACTION_CAP, 2),
    qualityCap: num(process.env.QUALITY_CAP, 3),
    topBonus: num(process.env.TOP_BONUS, 5), // given OUTSIDE the daily cap
    messagesPerPoint: num(process.env.MESSAGES_PER_POINT, 2),
    qualityScorePerPoint: num(process.env.QUALITY_SCORE_PER_POINT, 3),
    topMinMessages: num(process.env.TOP_MIN_MESSAGES, 5),
  },

  filters: {
    minLength: num(process.env.MIN_MESSAGE_LENGTH, 8),
    minGapSeconds: num(process.env.MIN_SECONDS_BETWEEN_MESSAGES, 5),
    minAccountAgeDays: num(process.env.MIN_ACCOUNT_AGE_DAYS, 7),
    maxLoggedPerUser: num(process.env.MAX_LOGGED_MESSAGES_PER_USER, 30),
    excludedChannels: list(process.env.EXCLUDED_CHANNEL_IDS),
  },

  qa: { perHour: num(process.env.QA_PER_HOUR, 10) },

  marketplace: {
    autoRemoveSoldOut: (process.env.AUTO_REMOVE_SOLD_OUT || 'false').toLowerCase() === 'true',
  },
};
