// Unprompted answers: a member asks a real question in a normal chat channel WITHOUT mentioning Vexo.
// replies.js asks decide(); only when it says yes does Vexo answer (in the same channel, as a reply).
//
// Order (cheap first, so ordinary chat never costs an AI call):
//   1. prefilter (code only, no AI):
//        - the server has the premium chat features (HΛVØCZ: always; customer servers: trial / paid, else silent)
//        - an allowed chat channel (never logs, control, shop, rumble, giveaways, radar, X posts, welcome, rules,
//          tickets, receipts, excluded channels; only CHAT_CHANNEL_IDS when that list is set)
//        - not talking to another person (mention of / reply to another member)
//        - a clear question by RULES (detectIntent: floor, price, market, NFT pick, Vexo, mint / roadmap...) -> routed,
//          no AI check; otherwise it must look like an information question (English, Banglish, Bangla, "?")
//        - two people are chatting with each other and the message speaks to "you / bro / tumi..." -> silent
//   2. only for unclear messages: ONE small AI call (classify): should Vexo answer, and which topic?
//   3. limits (answerLimit, checked by replies.js before answering): HΛVØCZ none; customer servers generous
//      (config.unprompted), only sent answers count, a blocked real question gets one ⏳. QA_PER_HOUR is NOT used here.
const { ChannelType } = require('discord.js');
const config = require('./config');
const guilds = require('./guilds');
const plans = require('./plans');
const clock = require('./clock');
const chatContext = require('./chatContext');
const { isAboutVexo } = require('./aboutVexo');

const L = () => config.unprompted;
const HOUR = 3600000;

const strip = (text) =>
  String(text || '')
    .replace(/<a?:\w+:\d+>/g, ' ') // custom emoji
    .replace(/<@[!&]?\d+>|<#\d+>/g, ' ') // mentions
    .replace(/https?:\/\/\S+/g, ' ') // links
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------- is it a question?
const QUESTION_START =
  /^(what|whats|what's|wat|when|wen|where|who|whom|whose|why|how|which|is|are|was|were|will|would|can|could|do|does|did|should|shall|has|have|any|anyone|anybody|tell me|explain|show me|pls|please|plz)\b/i;
// Banglish question words (anywhere in the message) and requests
const BANGLISH = /\b(ki|keno|kno|kobe|kothay|kothai|koto|kototuku|kivabe|kibhabe|kemne|kemon|kon|konta|konti|kader|kar|bolo|bolen|bolben|bolba|janen|jano|janao|janaw|bujhao|bujhiye)\b/i;
const BANGLA = /(কি|কী|কেন|কবে|কোথায়|কত|কিভাবে|কীভাবে|কেমন|কোন|বলো|বলেন|জানেন|জানো)/;
const REQUEST = /\b(price of|floor of|tell me|explain|show me|give me|any idea|anyone know|need help|how to)\b/i;
function looksLikeQuestion(text) {
  const t = strip(text);
  if (t.length < 6 || t.length > 400) return false;
  if (t.split(' ').length < 2) return false;
  return t.includes('?') || QUESTION_START.test(t) || BANGLISH.test(t) || BANGLA.test(t) || REQUEST.test(t);
}

// A question only reaches the AI check when it is information-seeking: a topic word (project, crypto, web3, tech,
// Vexo) or a "what is / how do / why does / explain" shape. Social questions ("anyone watching the match tonight?",
// "how are you all?") never cost an AI call.
const TOPIC_WORDS =
  /\b(mint(s|ing|ed)?|wl|whitelist|allow ?list|presale|supply|price|prices|floor|collection|nfts?|roadmap|phases?|rules?|points?|marketplace|shop|redeem|stak(e|ing)|tokens?|airdrop|launch|reveal|team|founders?|lore|giveaways?|rumble|holders?|utility|website|roles?|verif(y|ied|ication)|tickets?|rewards?|earn|project|community|ecosystem|crypto|bitcoin|btc|eth|ethereum|sol|solana|coin|coins|market|bull|bear|wallet|phantom|defi|dex|swap|blockchain|web3|scam|rug|seed phrase|ledger|metamask|chart|vexo|bot|setup|trial|premium|ai|chatgpt|internet|app|software|code|coding|python|javascript|discord|server|phone|laptop|computer|windows|android|iphone|error|bug|api)\b/i;
const INFO_START =
  /^(what (is|are|was|were|does|do|did)|what's (a|an|the)|whats (a|an|the)|how (do|does|did|to|can|could|much|many|long)|why (is|are|was|do|does|did|can't|cant)|who (is|was|invented|created|made|founded|owns)|when (did|was|is|will|does|do)|where (can|do|does|is|are)|which (is|are|one|coin|nft|wallet|chain)|explain|define|tell me|is it (safe|true|legit|possible)|can (i|we|someone)|difference between|meaning of)\b/i;
const BANGLISH_INFO = /\b(keno|kobe|kothay|kothai|koto|kototuku|kivabe|kibhabe|kemne|konta|konti|bujhao|bujhiye|janao|janaw)\b|কেন|কবে|কোথায়|কত|কিভাবে|কীভাবে|কোনটা/i;
const infoSeeking = (t) => TOPIC_WORDS.test(t) || INFO_START.test(t) || BANGLISH_INFO.test(t) || REQUEST.test(t);

// ---------------------------------------------------------------- deterministic intents (no AI)
// Clear questions are routed by rules first; only unclear messages need the small AI check.
//   nft_floor  "<name> nft floor?", "<name> floor", "floor of <name>", "<name> floor price", "<name> er flooe koto?"
//   market     a coin / the market + a forecast or "why up / down" ("will btc go up?", "bull run kobe?", "sol keno down?")
//   price      a coin + price words ("What's eth price now?", "btc er dam koto?", "sol price")
//   ("which NFT can grow?" needs collection names: the AI check routes it)
//   vexo      about Vexo itself (aboutVexo.js)
//   project    this server's mint / whitelist / roadmap / supply / presale / reveal / launch / lore / team ("Wen mint?")
const FLOOR_WORD = /\bfl(?:o{1,3}r{1,2}e?|o{2,3}[er]?|r)\b/i; // same as marketAnswers.FLOOR_WORD
const FLOOR_STATEMENT = /^(floor (of|for)\b)|\bfl(?:o{1,3}r{1,2}e?|o{2,3}[er]?|r)( price)?[\s?!.]*$/i; // "degods floor", "floor of degods"
const PRICE_WORDS = /\b(price|prices|prc|dam|daam|rate|value|worth|koto|how much|trading at)\b/i;
const PRICE_STATEMENT = /^(price of\b)|\b(price|dam|daam|rate)[\s?!.]*$/i; // "eth price", "price of sol"
const FORECAST =
  /\b(will|predict(ion)?|forecast|target|bull ?run|bullrun|bear market|pump|dump|crash|moon|go(ing)? (up|down)|up or down|how (high|low|far) can|hobe|jabe|barbe|kombe|uthbe|nambe|porbe|grow)\b/i;
const WHY_MOVE = /\b(why|keno|kno)\b.*\b(up|down|dump(ing|ed)?|pump(ing|ed)?|crash(ing|ed)?|fall(ing)?|falling|ris(e|ing)|bar(che|lo)|kom(che|lo)|por(che|lo)|red|green)\b/i;
const MARKET_WORD = /\b(market|bull ?run|bullrun|bear market|crypto market)\b/i;
const PROJECT_WORD = /\b(mint(s|ing|ed)?|wl|whitelist|allow ?list|presale|pre-sale|supply|roadmap|reveal|launch(es|ing)?|lore|founders?|team|utility|website|snapshot)\b/i;

// coin tickers in the text. Tickers that are also normal words ("link", "ton", "dot"...) only count as $LINK or LINK.
const WORD_TICKERS = new Set(['link', 'dot', 'ton', 'pol', 'ada', 'wif', 'sui', 'jup', 'pepe', 'bonk', 'shib', 'trx', 'matic', 'ripple', 'ether', 'binance']);
function coinsIn(text) {
  const { COIN_NAMES } = require('./marketAnswers');
  const out = new Set();
  for (const m of String(text || '').matchAll(/(\$?)([A-Za-z]+)/g)) {
    const w = m[2].toLowerCase();
    if (!COIN_NAMES[w]) {
      if (m[1] && /^[A-Za-z]{2,10}$/.test(m[2])) out.add(m[2].toUpperCase()); // "$FAKE": a ticker Vexo has no name for
      continue;
    }
    if (WORD_TICKERS.has(w) && !m[1] && m[2] !== m[2].toUpperCase()) continue;
    out.add(COIN_NAMES[w]);
  }
  return [...out];
}

// -> { topic, coins, collections, prediction, needs_search, rule } | null (unclear: the AI check decides)
function detectIntent(raw) {
  const text = strip(String(raw || '').replace(/^\s*(hey |yo |hi )?@?vexo\b[,:!]?/i, ' '));
  if (!text || text.length > 400) return null;
  const isQ = looksLikeQuestion(text);
  const base = { coins: [], collections: [], prediction: false, needs_search: false };
  if (FLOOR_WORD.test(text) && (isQ || FLOOR_STATEMENT.test(text)) && text.split(' ').length <= 12) {
    const name = require('./marketAnswers').collectionNameOf(text);
    return { ...base, topic: 'nft_floor', collections: name ? [name] : [], rule: 'floor question' };
  }
  const coins = coinsIn(text);
  if (isQ && (coins.length || MARKET_WORD.test(text)) && (FORECAST.test(text) || WHY_MOVE.test(text))) {
    return { ...base, topic: 'market', coins, prediction: FORECAST.test(text), rule: 'market / forecast question' };
  }
  if (coins.length && ((isQ && PRICE_WORDS.test(text)) || PRICE_STATEMENT.test(text) || (isQ && text.split(' ').length <= 3))) {
    return { ...base, topic: 'price', coins, rule: 'coin price question' };
  }
  if (isQ && isAboutVexo(text, { talkingToVexo: false })) return { ...base, topic: 'vexo', rule: 'question about Vexo' };
  if (isQ && PROJECT_WORD.test(text)) return { ...base, topic: 'project', rule: 'project question (mint / roadmap / ...)' };
  return null;
}

// words that (with a question) usually mean crypto / web3 info: used for mentions of Vexo (see classifyAddressed)
const MARKET_HINT = /\b(price|prices|dam|floor|btc|bitcoin|eth|ethereum|sol|solana|bnb|xrp|doge|market|bull ?run|bullrun|bear|pump|dump|chart|ath|fear|greed|grow|moon|nfts?)\b/i;
const WEB3_HINT = /\b(wallet|phantom|defi|tokens?|staking|stake|airdrop|seed phrase|scam|rug|blockchain|crypto|dex|swap|gas fee|ledger|metamask|minting|web3|smart contract)\b/i;

// ---------------------------------------------------------------- channel
function isQaChannel(message, s = guilds.settings(message)) {
  const ch = message.channel;
  if (!ch || (ch.type !== ChannelType.GuildText && ch.type !== undefined)) return false; // text channels only
  const c = s.channels || {};
  const blocked = [c.marketplace, c.redeemLogs, c.logs, c.control, c.welcome, c.rules, c.ticket, c.receipts, c.xDrop, c.rumble, c.giveaway, c.raffle, c.nftRadar, c.solRadar, c.assistant].filter(Boolean);
  if (blocked.includes(message.channelId)) return false;
  if ((s.excludedChannels || []).includes(message.channelId)) return false;
  if (c.ticketCategory && ch.parentId === c.ticketCategory) return false;
  if (/^ticket-|log|rumble|guess|giveaway|radar|marketplace|control/i.test(ch.name || '')) return false; // vexo-logs & co. by name too
  if (s.chatChannelIds && s.chatChannelIds.length) return s.chatChannelIds.includes(message.channelId);
  return true;
}

// ---------------------------------------------------------------- people talking to each other
function talksToSomeoneElse(message) {
  const botId = message.client?.user?.id;
  const others = [...(message.mentions?.users?.keys?.() || [])].filter((id) => id !== botId);
  if (others.length) return true;
  const replied = message.mentions?.repliedUser;
  return !!replied && replied.id !== botId;
}

const recent = new Map(); // `${guildId}:${channelId}` -> [{ authorId, at }] last human messages (memory only)
// every member message that reaches replies.respond() (call once per message, before decide)
function note(message) {
  const key = `${guilds.gid(message)}:${message.channelId}`;
  const list = recent.get(key) || [];
  list.push({ authorId: message.author.id, at: clock.now() });
  if (list.length > 8) list.shift();
  recent.set(key, list);
}
// a back-and-forth: in the last 3 minutes this member and someone else took turns in this channel
function inConversation(message) {
  const list = (recent.get(`${guilds.gid(message)}:${message.channelId}`) || []).filter((m) => clock.now() - m.at < 3 * 60000);
  const before = list.slice(0, -1); // without the current message (note() ran first)
  if (!before.length) return false;
  const prev = before[before.length - 1];
  if (prev.authorId === message.author.id) return false;
  return before.some((m) => m.authorId === message.author.id); // he wrote, someone answered, he writes again
}
const SECOND_PERSON = /\b(you|u|ur|your|bro|bruh|bhai|vai|tui|tumi|apni|tor|tomar|apnar|tora|tomra)\b/i;

// ---------------------------------------------------------------- limits
// HOME SERVER (HΛVØCZ): no answer limits at all. CUSTOMER SERVERS: generous limits from config.unprompted, counting
// only answers actually sent. This is the bucket for routed answers (floor, price, market, mint / project, Vexo,
// web3, general); it is never shared with QA_PER_HOUR (casual AI chat, ratelimit.js).
const lastReplyUser = new Map(); // `${g}:${user}` -> ts
const repliesCh = new Map(); // `${g}:${ch}` -> [ts] (last hour)
const repliesGuild = new Map(); // `${g}` -> [ts] (last hour)
const checksCh = new Map(); // `${g}:${ch}` -> [ts] (last hour)
const lastNotice = new Map(); // `${g}:${user}` -> ts of the last ⏳ "limit reached" reaction
const answered = new Set(); // message ids already answered (never answer the same message twice)
const lastHour = (map, key) => (map.get(key) || []).filter((t) => clock.now() - t < HOUR);
const isHome = (message) => !!guilds.settings(message).isHome;

// a routed answer may be sent? -> null, or the exact rule that blocks it ("rule: value / limit")
function answerLimit(message) {
  if (answered.has(message.id)) return 'already answered this message';
  if (isHome(message)) return null; // home: no limits
  const g = guilds.gid(message);
  const now = clock.now();
  const since = now - (lastReplyUser.get(`${g}:${message.author.id}`) || 0);
  if (since < L().userCooldownSec * 1000) return `member cooldown (last answer ${Math.floor(since / 1000)}s ago, limit ${L().userCooldownSec}s)`;
  const ch = lastHour(repliesCh, `${g}:${message.channelId}`).length;
  if (ch >= L().channelMaxPerHour) return `channel answers per hour (${ch} / ${L().channelMaxPerHour})`;
  const all = lastHour(repliesGuild, g).length;
  if (all >= L().guildMaxPerHour) return `server answers per hour (${all} / ${L().guildMaxPerHour})`;
  return null;
}
// the AI check (only for unclear messages) may run? -> null, or the blocking rule
function classifierLimit(message) {
  if (isHome(message)) return null;
  const n = lastHour(checksCh, `${guilds.gid(message)}:${message.channelId}`).length;
  return n >= L().classifierMaxPerChannelPerHour ? `channel AI checks per hour (${n} / ${L().classifierMaxPerChannelPerHour})` : null;
}
// a routed answer was SENT: count it (only sent answers count)
function noteReplied(message) {
  const g = guilds.gid(message);
  const now = clock.now();
  answered.add(message.id);
  if (answered.size > 500) answered.delete(answered.values().next().value);
  lastReplyUser.set(`${g}:${message.author.id}`, now);
  repliesCh.set(`${g}:${message.channelId}`, [...lastHour(repliesCh, `${g}:${message.channelId}`), now]);
  repliesGuild.set(g, [...lastHour(repliesGuild, g), now]);
}
// a real question hit a limit: never drop it silently. One ⏳ reaction per member per minute (or per cooldown window).
async function limitNotice(message) {
  if (answered.has(message.id)) return;
  const key = `${guilds.gid(message)}:${message.author.id}`;
  const windowMs = Math.max(60, L().userCooldownSec) * 1000;
  if (clock.now() - (lastNotice.get(key) || 0) < windowMs) return;
  lastNotice.set(key, clock.now());
  await message.react('⏳').catch((err) => console.error('react:', err.message));
}

// ---------------------------------------------------------------- 1. prefilter (no AI)
// -> { ok: true, inConversation, intent } | { ok: false, reason }
function prefilter(message) {
  if (message.author?.bot) return { ok: false, reason: 'author is a bot' };
  if (message.author?.id && message.author.id === message.client?.user?.id) return { ok: false, reason: 'own message' };
  const s = guilds.settings(message);
  // home always passes (hasFeature is always true there); customer servers need trial / premium
  if (!plans.hasFeature(message, 'aiChat') || !plans.hasFeature(message, 'knowledgeQa')) return { ok: false, reason: 'premium chat not available in this server (plan)' };
  if (!isQaChannel(message, s)) return { ok: false, reason: 'not an allowed chat channel (logs / control / games / radar / shop / excluded / not in CHAT_CHANNEL_IDS)' };
  if (talksToSomeoneElse(message)) return { ok: false, reason: 'talking to someone else (reply to / mention of another member)' };
  const text = message.content || '';
  const intent = detectIntent(text); // a clear floor / price / market / mint / Vexo question: no other checks needed
  if (!intent) {
    if (!looksLikeQuestion(text)) return { ok: false, reason: 'not a question' };
    if (!infoSeeking(strip(text))) return { ok: false, reason: 'social / casual question (no topic, not information-seeking)' };
  }
  const convo = inConversation(message);
  if (convo && SECOND_PERSON.test(strip(text))) return { ok: false, reason: 'two members are chatting with each other' };
  return { ok: true, inConversation: convo, intent };
}

// ---------------------------------------------------------------- 3. the small AI check
const TOPICS = ['project', 'vexo', 'price', 'nft_floor', 'nft_pick', 'market', 'web3', 'general'];
const MARKET_TOPICS = ['price', 'nft_floor', 'nft_pick', 'market'];
const WEB_TOPICS = ['web3', 'general'];

function routerPrompt(serverName, { inConversation: convo, addressed }) {
  return [
    `You route Discord messages for Vexo, the bot of the server "${serverName}". Reply with JSON only.`,
    addressed
      ? 'The member is talking to Vexo directly, so should_answer is true unless the message is not a question or request at all.'
      : 'Nobody mentioned Vexo. should_answer = true ONLY for a real question or request for information that is meant for anyone / the bot.',
    'should_answer = false for: casual talk, jokes, greetings, opinions, memes, reactions, statements, rhetorical questions, questions clearly',
    'meant for one specific member ("bro did you eat?", "where are you?"), and anything personal.',
    convo ? 'These members are in a back-and-forth with each other: answer only if the message is CLEARLY meant for everyone or the bot.' : '',
    'The message may be English, Banglish or Bangla. Understand it, but every field stays English.',
    `topic: "project" = about ${serverName} / this server / its community (its mint, roadmap, rules, points, marketplace, giveaways, team);`,
    '"vexo" = about Vexo the bot itself (what it is, features, updates, what is coming, trial, premium, setup, /setup /status /help);',
    '"price" = the current price of one or more coins; "nft_floor" = the floor price of a specific NFT collection;',
    '"nft_pick" = which NFT / collection is good or can grow; "market" = why the market or a coin is up / down, how far it can go, when a bull run starts;',
    '"web3" = how crypto, NFTs, Solana, wallets, minting, DeFi, tokens, staking, airdrops, scams or marketplaces work;',
    '"general" = any other web, tech or general knowledge question; "none" = none of these.',
    'A question about minting / staking / tokens IN GENERAL is "web3"; "when is the mint?" without a project name means this server = "project".',
    'coins: tickers like ["BTC","SOL"] (empty if none). collections: NFT collection names or Magic Eden links mentioned (empty if none).',
    'prediction: true if they ask for a forecast (price target, will it go up / down, which NFT will grow, when a bull run starts).',
    'needs_search: true if a good answer needs current information from the web (news, recent events, today\'s facts).',
    '{"should_answer":true|false,"topic":"...","coins":[],"collections":[],"prediction":false,"needs_search":false}',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseRoute(raw) {
  try {
    const s = String(raw || '');
    const j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
    const topic = TOPICS.includes(j.topic) ? j.topic : 'none';
    const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 5) : []);
    return {
      should_answer: j.should_answer === true && topic !== 'none',
      topic,
      coins: list(j.coins).map((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean),
      collections: list(j.collections).map((c) => c.slice(0, 80)),
      prediction: j.prediction === true,
      needs_search: j.needs_search === true,
    };
  } catch {
    return { should_answer: false, topic: 'none', coins: [], collections: [], prediction: false, needs_search: false };
  }
}

async function classify(message, { inConversation: convo = false, addressed = false } = {}) {
  const ai = require('./ai'); // here, not at the top (ai.js loads modules that load this one)
  const s = guilds.settings(message);
  const context = chatContext.get(message.channelId).slice(-4);
  const user = `${context.length ? `RECENT CHAT (context only):\n${context.join('\n')}\n\n` : ''}MESSAGE: ${strip(message.content).slice(0, 500)}`;
  const raw = await ai.chat(routerPrompt(s.name, { inConversation: convo, addressed }), user, { json: true, maxTokens: 120, temperature: 0, guildId: s.guildId });
  return parseRoute(raw);
}

// ---------------------------------------------------------------- entry points
// -> { ok: true, topic, coins, collections, prediction, needs_search, aboutVexo } | { ok: false, reason }
// The limits are checked in replies.js right before the answer (answerLimit), so a blocked real question gets a ⏳.
async function decide(message) {
  const p = prefilter(message);
  if (!p.ok) return p;
  if (p.intent) return { ok: true, ...p.intent, via: `rule: ${p.intent.rule}`, aboutVexo: p.intent.topic === 'vexo' || isAboutVexo(message.content) };
  const limited = classifierLimit(message);
  if (limited) return { ok: false, reason: `unclear message, AI check skipped: ${limited}` };
  const ch = `${guilds.gid(message)}:${message.channelId}`;
  checksCh.set(ch, [...lastHour(checksCh, ch), clock.now()]);
  let r;
  try {
    r = await classify(message, { inConversation: p.inConversation });
  } catch (err) {
    return { ok: false, reason: err.code === 'AI_LIMIT' ? 'AI not available for this server (plan or daily AI limit)' : `AI check failed: ${err.message}` };
  }
  if (!r.should_answer) return { ok: false, reason: `AI check: not a question for Vexo (topic ${r.topic})` };
  return { ok: true, ...r, via: 'AI check', aboutVexo: r.topic === 'vexo' || isAboutVexo(message.content) };
}

// Vexo was mentioned / replied to / named, or the message is in the Ask channel. A clear floor / price / market /
// mint / Vexo question is routed by the rules (detectIntent); an unclear crypto / web3 question gets the small AI
// check. Everything else -> null = the normal conversation, as before.
//   marketOnly = the boss: only live-data answers (floor, price, market, NFT pick) are routed, never his chat.
async function classifyAddressed(message, { marketOnly = false } = {}) {
  const text = strip(String(message.content || '').replace(/\bvexo\b[,:!]?/gi, ' '));
  const intent = detectIntent(text);
  if (intent && (!marketOnly || MARKET_TOPICS.includes(intent.topic))) {
    return { ok: true, ...intent, via: `rule: ${intent.rule}`, aboutVexo: intent.topic === 'vexo' };
  }
  if (marketOnly) return null;
  if (!looksLikeQuestion(text) || !(MARKET_HINT.test(text) || WEB3_HINT.test(text))) return null;
  if (!plans.hasFeature(message, 'aiChat')) return null;
  try {
    const r = await classify(message, { addressed: true });
    return r.should_answer && [...MARKET_TOPICS, ...WEB_TOPICS].includes(r.topic) ? { ok: true, ...r, via: 'AI check' } : null;
  } catch {
    return null; // the normal conversation handles it
  }
}

module.exports = {
  decide,
  classifyAddressed,
  detectIntent,
  answerLimit,
  limitNotice,
  note,
  noteReplied,
  prefilter,
  looksLikeQuestion,
  infoSeeking,
  isQaChannel,
  talksToSomeoneElse,
  inConversation,
  parseRoute,
  MARKET_TOPICS,
  WEB_TOPICS,
  _test: {
    reset: () => [recent, lastReplyUser, repliesCh, repliesGuild, checksCh, lastNotice, answered].forEach((m) => m.clear()),
  },
};
