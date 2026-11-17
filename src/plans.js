// Plans: free vs premium, the free trial, and the per-server daily AI call limit.
// The feature map itself lives in config.js (config.features), one place, easy to edit.
//
//   hasFeature(guild, 'aiChat')  -> may this server use this feature right now?
//   allowAi(guild)               -> may this server make ONE more AI call today? (also counts it)
//
// HΛVØCZ (the home server) always has every feature and no AI limit.
const supabase = require('./db');
const config = require('./config');
const guilds = require('./guilds');

const DAY = 86400000;
const ms = (v) => (v ? Date.parse(v) : NaN);

// { kind: 'home' | 'paid' | 'trial' | 'free' | 'unknown', premium, endsAt (Date | null), daysLeft (number | null) }
function plan(x, now = Date.now()) {
  if (guilds.isHome(x)) return { kind: 'home', premium: true, endsAt: null, daysLeft: null };
  const row = guilds.get(x);
  if (!row || row.status === 'left') return { kind: 'unknown', premium: false, endsAt: null, daysLeft: null };
  const paid = ms(row.paid_until);
  const trial = ms(row.trial_ends_at);
  const until = (t) => ({ endsAt: new Date(t), daysLeft: Math.max(0, Math.ceil((t - now) / DAY)) });
  if (paid > now) return { kind: 'paid', premium: true, ...until(paid) };
  if (trial > now) return { kind: 'trial', premium: true, ...until(trial) };
  return { kind: 'free', premium: false, endsAt: null, daysLeft: null };
}

const isPremium = (x) => plan(x).premium;

// THE check every feature calls before it runs
function hasFeature(x, feature) {
  if (guilds.isHome(x)) return true;
  const level = config.features[feature];
  if (!level) return false; // not in the map (HΛVØCZ-only extras): off everywhere else
  const p = plan(x);
  if (p.kind === 'unknown') return false; // a server the bot has no row for (or has left)
  return level === 'free' ? true : p.premium;
}

// feature -> true / false for /status
const featureList = (x) => Object.fromEntries(Object.keys(config.features).map((f) => [f, hasFeature(x, f)]));

// the day AI calls are counted for (same calendar day as the points system)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());

// One more AI call for this server? Counted in the database (atomic), so the limit also holds across restarts.
//   HΛVØCZ: always yes. The call is counted in the background and never delays or blocks a reply.
//   others: premium only, and at most DEFAULT_DAILY_AI_LIMIT per day. If the counter can't be reached,
//           the answer is no (cost control comes first).
async function allowAi(x) {
  const id = guilds.gid(x);
  if (guilds.isHome(id)) {
    Promise.resolve()
      .then(() => supabase.rpc('count_ai_call', { p_guild: id, p_day: today(), p_limit: 0 }))
      .catch(() => {});
    return true;
  }
  if (!isPremium(id)) return false;
  try {
    const limit = Math.max(1, Math.floor(Number(config.defaultDailyAiLimit) || 0));
    const { data, error } = await supabase.rpc('count_ai_call', { p_guild: id, p_day: today(), p_limit: limit });
    if (error) throw new Error(error.message);
    return Number(data) > 0;
  } catch (err) {
    console.error(`AI limit check failed for guild ${id}:`, err.message);
    return false;
  }
}

// Which feature a slash command / button belongs to. Checked in ONE place (events/interactionCreate.js)
// before anything runs. Commands that are not listed (setup, status, help, admin) always work.
const COMMAND_FEATURES = {
  ask: 'knowledgeQa',
  knowledge: 'knowledgeQa',
  points: 'points',
  leaderboard: 'points',
  addpoints: 'points',
  removepoints: 'points',
  rundaily: 'points',
  additem: 'marketplace',
  edititem: 'marketplace',
  removeitem: 'marketplace',
  repostitem: 'marketplace',
  listitems: 'marketplace',
  pending: 'marketplace',
  refund: 'marketplace',
  setupmarketplace: 'marketplace',
  ticket: 'marketplace',
  automod: 'automod',
  rumble: 'rumble',
  guess: 'numberGuess',
  giveaway: 'giveaway',
  solradar: 'solRadar',
  nftradar: 'nftRadar',
  raffle: 'raffle',
};
// buttons / menus by the start of their customId
function componentFeature(customId) {
  const id = String(customId || '');
  if (id.startsWith('rumble_')) return 'rumble';
  if (id.startsWith('guess_')) return 'numberGuess';
  if (id.startsWith('gw:')) return 'giveaway';
  if (id.startsWith('nftr:')) return 'nftRadar';
  if (id.startsWith('rf:')) return 'raffle';
  if (id.startsWith('shop:') || id === 'mypoints' || /^(redeem|ticket|deliver):/.test(id)) return 'marketplace';
  return null;
}

const FEATURE_NAMES = {
  rumble: 'Rumble Royale host',
  numberGuess: 'Number guess game host',
  aiChat: 'AI chat with Vexo',
  knowledgeQa: 'Knowledge Q&A',
  automod: 'Auto mod',
  points: 'Points',
  marketplace: 'Marketplace',
  giveaway: 'Giveaways (/giveaway)',
  giveaway_orders: 'Giveaway orders in the control channel',
  solRadar: 'SOL Radar (daily SOL market updates)',
  nftRadar: 'NFT Radar (upcoming Solana mints, admin approval)',
  raffle: 'Points raffles (/raffle)',
};

// short text for a locked feature: admins learn how to unlock it, members just that it is off
function lockedText(isAdmin) {
  if (!isAdmin) return 'This feature is not available in this server right now.';
  return `⭐ This is a **premium feature**, and this server is on the free plan.${config.supportContact ? ` To unlock it: ${config.supportContact}` : ''}`;
}

module.exports = { plan, isPremium, hasFeature, featureList, allowAi, COMMAND_FEATURES, componentFeature, FEATURE_NAMES, lockedText };
