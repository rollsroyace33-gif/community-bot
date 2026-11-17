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
    redeemLogs: process.env.REDEEM_LOGS_CHANNEL_ID || '', // purchase records ONLY (shop content); never feature logs
    // HΛVØCZ's private logs channel for feature logs and notices (SOL / NFT Radar, approvals, giveaways, auto mod,
    // scam alerts, settings changes). /setup can choose it too (that choice wins). Empty + nothing chosen = not sent.
    logs: (process.env.LOGS_CHANNEL_ID || '').trim(),
    receipts: (process.env.RECEIPT_CHANNEL_ID || '').trim(), // staff copy of every shop receipt (empty = skipped)
    ticketCategory: process.env.TICKET_CATEGORY_ID || '',
    welcome: process.env.WELCOME_CHANNEL_ID || '',
    rules: process.env.RULES_CHANNEL_ID || '',
    control: process.env.CONTROL_CHANNEL_ID || '', // private channel for orders (empty = task system off)
    ticket: process.env.TICKET_CHANNEL_ID || '', // linked in the game winner message
    giveaway: (process.env.GIVEAWAY_CHANNEL_ID || '').trim(), // HΛVØCZ's giveaway channel (empty = /giveaway needs its channel option)
    raffle: (process.env.RAFFLE_CHANNEL_ID || '').trim(), // HΛVØCZ's raffle channel fallback (/setup wins; empty + not chosen = /raffle says "not set")
    // HΛVØCZ's channels for the radar / Personal Vexo features. Made by hand, never auto-created. Empty = off there.
    nftRadar: (process.env.NFT_RADAR_CHANNEL_ID || '').trim(),
    solRadar: (process.env.SOL_RADAR_CHANNEL_ID || '').trim(),
    assistant: (process.env.VEXO_ASSISTANT_CHANNEL_ID || '').trim(), // "get-vexo-assistant": members request Personal Vexo here
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
    maxJoinMinutes: num(process.env.RUMBLE_MAX_JOIN_MINUTES, 1440), // longest join window (24 h)
    remindBeforeSeconds: num(process.env.RUMBLE_REMIND_BEFORE_SECONDS, 120), // role-ping reminder before the start
    finalPingSeconds: num(process.env.RUMBLE_FINAL_PING_SECONDS, 10), // last role ping before the start
  },

  adminRoleId: process.env.ADMIN_ROLE_ID || '',
  verifiedRoleId: process.env.VERIFIED_ROLE_ID || '',

  timezone: process.env.TIMEZONE || 'Asia/Dhaka',
  // zone the boss writes times in (control channel orders). Only used to READ orders; Vexo shows
  // Discord timestamps (every viewer sees their own local time), never a zone name.
  bossTimezone: (process.env.BOSS_TIMEZONE || 'Asia/Dhaka').trim(),
  dailyCron: process.env.DAILY_CRON || '55 23 * * *',

  points: {
    dailyCap: num(process.env.DAILY_CAP, 20), // Discord activity points per member per day (X drops are extra)
    messageCap: num(process.env.MESSAGE_CAP, 10),
    reactionCap: num(process.env.REACTION_CAP, 4),
    qualityCap: num(process.env.QUALITY_CAP, 6),
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

  // casual AI chat with Vexo per member per hour, customer servers only (HΛVØCZ: no limit). Real questions that
  // Vexo routes (floor, price, mint, project, Vexo, web3) do not count here: see unprompted below.
  qa: { perHour: num(process.env.QA_PER_HOUR, 30) },

  // X post drop reward (src/xDrop.js). Empty channel = feature off. Points are extra (outside the daily cap)
  xDrop: {
    channelId: (process.env.X_DROP_CHANNEL_ID || '').trim(),
    points: num(process.env.X_DROP_POINTS, 10),
    maxPerDay: num(process.env.X_DROP_MAX_PER_DAY, 5), // credited drops per member per day, 0 = unlimited
  },

  // SOL Radar (src/solRadar.js): daily SOL market updates. No COINGECKO_API_KEY = the feature is off everywhere.
  solRadar: {
    apiKey: (process.env.COINGECKO_API_KEY || '').trim(),
    times: list(process.env.SOL_RADAR_TIMES || '01:00,06:00,11:00,16:00,21:00'), // default post times (each server can change its own)
    timezone: (process.env.SOL_RADAR_TIMEZONE || 'UTC').trim(), // the clock those default times are on
  },

  // NFT Radar (src/nftRadar.js): upcoming Solana NFT mints, researched on the web, published only after an
  // admin presses Approve. No TAVILY_API_KEY = the feature is off everywhere (the bot still starts).
  nftRadar: {
    tavilyKey: (process.env.TAVILY_API_KEY || '').trim(),
    times: list(process.env.NFT_RADAR_TIMES || '09:00,21:00'), // when Vexo looks for new projects (UTC), shared by all servers
    maxNewPerDay: 5, // at most this many new projects researched per day (keeps the free 1,000 searches a month safe)
    maxSearchesPerDay: 30, // hard stop for web searches per day
    maxRequestsPerGuildPerDay: 3, // approval requests per server per day
    minScore: 6, // AI score out of 10 a project needs to be sent for approval
  },

  marketplace: {
    autoRemoveSoldOut: (process.env.AUTO_REMOVE_SOLD_OUT || 'false').toLowerCase() === 'true',
  },

  // ================= multi-server =================
  // The home server (HΛVØCZ). It keeps every setting above, always has every feature, and nothing is
  // auto-created there. HOME_GUILD_ID empty = GUILD_ID is used.
  homeGuildId: (process.env.HOME_GUILD_ID || process.env.GUILD_ID || '').trim(),
  homeGuildName: (process.env.HOME_GUILD_NAME || 'HΛVØCZ').trim(), // only used if the guilds table can't be read
  creatorName: (process.env.CREATOR_NAME || 'remo.sol').trim(), // who made Vexo (said in every server)
  // the bot owner: the only user who can use /admin (activate / deactivate / extendtrial / list)
  ownerId: (process.env.OWNER_ID || '').trim(),
  trialDays: num(process.env.TRIAL_DAYS, 15), // free trial length for a new server (one trial per server, ever)
  defaultDailyAiLimit: num(process.env.DEFAULT_DAILY_AI_LIMIT, 300), // AI calls per server per day (not HΛVØCZ)
  supportContact: (process.env.SUPPORT_CONTACT || '').trim(), // payment / contact text shown in expiry notices

  // ================= unprompted answers (src/unprompted.js) =================
  // Vexo answering a real question (floor, price, market, mint / project, Vexo itself, web3, general) in chat.
  // Fixed numbers (no .env), change them here. The home server (HΛVØCZ) has NO answer limits at all: these only
  // apply to customer servers, and only answers actually sent are counted. Routed answers have their OWN bucket
  // (QA_PER_HOUR is only for casual AI chat with Vexo, never for these answers).
  unprompted: {
    userCooldownSec: 5, // customer servers: a member gets at most 1 answer per this many seconds
    channelMaxPerHour: 200, // customer servers: answers per channel per hour
    guildMaxPerHour: 500, // customer servers: answers per server per hour (all channels together)
    classifierMaxPerChannelPerHour: 300, // customer servers: "should I answer?" AI checks per channel per hour (only unclear messages need one)
    webSearchesPerDay: 8, // chat web searches (Tavily) per day, all servers together
    webSearchReserve: 15, // never use the last N of NFT Radar's daily Tavily searches for chat
    liveDataCacheSec: 45, // prices, floors, Fear & Greed are fetched at most once per this time
  },

  // THE feature map: 'free' = every server, 'premium' = trial or paid servers only (HΛVØCZ: everything).
  // Change a word here to move a feature between plans. Free features never call the AI.
  features: {
    rumble: 'free', // Rumble Royale host (/rumble)
    numberGuess: 'free', // number guess game host (/guess), pre-written lines only
    aiChat: 'premium', // talking with Vexo in the server, AI banter in games, plain-language control channel orders
    knowledgeQa: 'premium', // answers about the project from this server's knowledge
    automod: 'premium', // rule-based auto moderation
    points: 'premium', // activity points, leaderboard, daily top chatter
    marketplace: 'premium', // points shop
    giveaway: 'free', // giveaways with /giveaway (pre-written lines only, zero AI calls)
    giveaway_orders: 'premium', // "host a giveaway for..." written in the control channel (one small AI call)
    solRadar: 'premium', // SOL Radar: 4 to 5 SOL market updates a day in the SOL Radar channel
    nftRadar: 'premium', // NFT Radar: researched upcoming Solana mints, posted only after admin approval
    raffle: 'premium', // points raffles (/raffle): members buy tickets with this server's points (same plan as points)
  },
};
