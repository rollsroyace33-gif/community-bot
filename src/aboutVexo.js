// What Vexo can say about ITSELF (the bot), in every server. Global, never per server, and never mixed into
// a server's own knowledge. Used only when a message is really about Vexo (isAboutVexo below), so every other
// prompt stays exactly as it was.
//
// Free / premium comes from the live feature map (config.features), so this text can never drift from what
// the bot really does. The "planned next" list comes ONLY from docs/VEXO_UPGRADE_SPEC.md and
// docs/VEXO_UPGRADE_PROGRESS.md (phases 5 to 15, not built yet, no dates promised).
const config = require('./config');

// one plain line per feature key in config.features (the names members understand)
const FEATURE_LINES = {
  rumble: 'Rumble Royale: a battle game with a Join button, hosted with /rumble or by an order in the control channel',
  numberGuess: 'Number Guess Game: members guess a secret number, hosted with /guess',
  aiChat: 'AI chat: members can talk with Vexo (mention it, reply to it or say "vexo")',
  knowledgeQa: "Knowledge Q&A: answers about the server's own project from that server's knowledge (/ask, or just ask in chat); Vexo learns it from the knowledge source channels chosen in /setup",
  automod: 'Auto mod and scam protection: rule-based moderation (/automod) and scam message / link checks',
  points: 'Points: members earn points for real activity and X post drops, /points and /leaderboard, daily top chatter',
  marketplace: 'Marketplace: a points shop with Purchase and My Points buttons; prizes that need delivery go through a ticket',
  giveaway: 'Giveaways: /giveaway with a Join button, one entry per member',
  giveaway_orders: 'Giveaway orders: admins write "host a giveaway for ..." in the control channel',
  solRadar: 'SOL Radar: 4 to 5 simple SOL market updates a day in the SOL Radar channel (/solradar)',
  nftRadar: 'NFT Radar: researched upcoming Solana NFT mints, posted only after an admin presses Approve (/nftradar)',
  raffle: 'Points raffles: admins host a raffle with /raffle, members buy tickets with their server points, winners drawn at random (more tickets = better odds), the host sends the prize',
};

// planned work, in the agreed order (VEXO_UPGRADE_PROGRESS.md "Phases" 5-15). Not built yet, no dates.
const PLANNED = [
  'a full Web3 assistant (prices, NFT floors, wallets and project research)',
  'Personal Vexo: a private personal assistant per member, switched on by admin approval (HΛVØCZ first)',
  'a personal wallet and portfolio view (read-only public addresses)',
  'personal alerts and reminders',
  'personal memory and preferences that the member can delete',
  'HΛVØCZ knowledge inside Personal Vexo',
  'joining Rumble and giveaways for its owner (one entry per person, never twice)',
  'reviews of logs and admin permissions, database and security, and cost, then final testing',
];

function block() {
  const features = config.features || {};
  const line = (k) => `  - ${FEATURE_LINES[k] || k}`;
  const free = Object.keys(features).filter((k) => features[k] === 'free');
  const premium = Object.keys(features).filter((k) => features[k] !== 'free');
  return [
    '=== ABOUT VEXO (the bot itself; true in every server) ===',
    `Vexo is a Discord community bot created by ${config.creatorName}. It runs in many servers; each server has its own settings, knowledge, points and data.`,
    'Features that work in every server (free plan):',
    ...free.map(line),
    'Premium features (paid plan or free trial):',
    ...premium.map(line),
    `Plans: every new server gets a ${config.trialDays}-day free trial with all premium features (one trial per server, ever). After the trial the server is on the free plan until premium is activated${config.supportContact ? ` (${config.supportContact})` : ''}.`,
    'Setup: when Vexo joins a server it sets itself up and creates its channels (vexo-control, vexo-logs, marketplace, rumble, x-posts, giveaways, raffle, nft-radar, sol-radar).',
    'Commands: /setup (admins: choose channels, game ping role, knowledge source channels, boss, ticket text), /status (plan, days left, features, channels), /help (what Vexo can do in this server).',
    'Planned next (in development, no dates announced, plans may change):',
    ...PLANNED.map((p) => `  - ${p}`),
  ].join('\n');
}

// the rules that come with the block (added to the prompt only together with it)
function rules(serverName) {
  return [
    'QUESTIONS ABOUT VEXO ITSELF (the bot: what Vexo is, what it can do, its features, commands, setup, trial, free vs premium,',
    'its updates or what is coming next for Vexo) are genuine questions too: answer them from ABOUT VEXO, never with NO_REPLY.',
    `- Only when Vexo itself is the subject. Naming Vexo just to talk to it ("vexo, what's the roadmap?", "vexo when mint?") is a ${serverName}`,
    `  question: answer that from KNOWLEDGE as usual, not from ABOUT VEXO.`,
    '- Use the same tags and size limits as above. Never invent a Vexo feature, command, price or date. Planned items are',
    '  "planned", never "live" and never with a date.',
  ].join('\n');
}

// ---------------- Is this message about Vexo itself? ----------------
// Vexo is the subject: its name, "you/your" when the member is talking to Vexo, or "the bot / this bot"
const VEXO_TOPIC =
  /\b(what (can|could|does|do) (you|vexo|it|the bot|this bot) do|what (is|are) (you|vexo)\b|who (is|are) (you|vexo)\b|features?|commands?|updates?|what'?s new|new(est)? (features?|stuff)|what'?s (next|coming)|coming (next|soon)|next for|roadmap|plans?|upcoming|in development|trial|premium|free plan|paid plan|pricing|set ?up|install|invite|add (you|vexo|it|the bot) to|abilit(y|ies)|capabilit(y|ies)|can (you|vexo|it|the bot) )/i;
// words that only ever mean Vexo, even without its name
const VEXO_ONLY = /(^|\s)\/(setup|status|help)\b|\b(sol|nft)[ -]?radar\b|\bfree trial\b|\b(15|fifteen)[- ]day trial\b/i;

// talkingToVexo: the member mentions / replies to Vexo, so "you" means Vexo
function isAboutVexo(text, { talkingToVexo = false } = {}) {
  const t = String(text || '');
  if (VEXO_ONLY.test(t)) return true;
  const ref = /\bvexo\b/i.test(t) || /\b(the|this|a|your) bot\b/i.test(t) || (talkingToVexo && /\b(you|your|yourself|u)\b/i.test(t));
  return ref && VEXO_TOPIC.test(t);
}

module.exports = { block, rules, isAboutVexo, PLANNED };
