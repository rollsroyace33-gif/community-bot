// NFT Radar: upcoming Solana NFT mints, researched by Vexo, published ONLY after an admin presses Approve.
//
//   AI research -> internal check -> approval request in vexo-logs -> Approve / Reject -> public post
//
//   find       (1) an admin adds a project: /nftradar add <link or name> (goes to that server only)
//              (2) web search (Tavily, src/web3/research.js) at NFT_RADAR_TIMES (UTC); one small AI call
//                  picks the project names out of the results
//              (3) Magic Eden's public launchpad list (no key; only projects whose launch is still ahead)
//   research   ONE web search + ONE AI call per project, shared by every server (never researched twice).
//   facts      only from the sources. A supply, price or date that is not written in the sources is
//              "Not announced" (checked in code, the AI cannot add numbers). Links must appear in the
//              sources and pass the scam link checker. Never invented.
//   filter     dropped: not a Solana NFT, mint already over, no official link, suspicious, score too low.
//   approval   each premium server with NFT Radar on gets the request in ITS logs channel (at most
//              maxRequestsPerGuildPerDay a day). Only Manage Server / Administrator / the boss of that
//              server can press. The first press counts (checked in the database).
//   no repeats nft_radar_reviews (guild_id + project_id) = a project reaches a server once.
//   runs       nft_radar_runs (slot) = a scheduled search is done once, also across restarts.
//
// Plan: "nftRadar" (premium). HΛVØCZ posts in NFT_RADAR_CHANNEL_ID; other servers in "📡・nft-radar".
// No TAVILY_API_KEY = NFT Radar is off everywhere (one log line); the bot and everything else still work.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits: P, MessageFlags } = require('discord.js');
const supabase = require('./db');
const config = require('./config');
const guilds = require('./guilds');
const plans = require('./plans');
const identity = require('./identity');
const research = require('./web3/research');
const { getTextChannel } = require('./utils');

const TICK_MS = 5 * 60 * 1000;
const GRACE_MIN = 180; // a scheduled search still runs this long after its time
const REVIEW_DAYS = 14; // a selected project is offered to servers for this long
const MAX_ADDS_PER_GUILD_PER_DAY = 5;
const MANUAL_HOURS = 6; // /nftradar scan: at most once per 6 hours for all servers together
const DISCLAIMER = '⚠️ Research independently before minting. No project success or profit is guaranteed.';
const ME_URL = 'https://api-mainnet.magiceden.dev/v2/launchpad/collections?offset=0&limit=100';
const DISCOVERY_QUERIES = [
  'upcoming Solana NFT mint announced mint date supply price',
  'new Solana NFT collection mint soon whitelist SOL',
  'NFT calendar Solana upcoming drops',
];
// hosts that are never a project's own website (news, lists, socials, marketplaces)
const NOT_A_WEBSITE = ['x.com', 'twitter.com', 't.me', 'telegram.me', 'discord.gg', 'discord.com', 'youtube.com', 'youtu.be', 'medium.com', 'reddit.com', 'instagram.com', 'tiktok.com', 'facebook.com',
  'magiceden.io', 'magiceden.us', 'tensor.trade', 'opensea.io', 'nftcalendar.io', 'airdropalert.com', 'cryptototem.com', 'coinmarketcap.com', 'coingecko.com', 'egamers.io', 'cryptonews.net',
  'linktr.ee', 'google.com', 'github.com', 'wikipedia.org', 'tavily.com', 'binance.com', 'bitrue.com', 'solana.com', 'solscan.io', 'thegrid.id'];
const GENERIC_HANDLES = ['solana', 'magiceden', 'tensor_hq', 'tensor', 'phantom', 'home', 'share', 'intent', 'search', 'i', 'hashtag'];

const DAY = 86400000;
const dayStart = (ms = Date.now()) => new Date(Math.floor(ms / DAY) * DAY).toISOString();

// ---------------------------------------------------------------- small helpers (pure, tested)
const clean = (t, max = 300) => String(t ?? '').replace(/[`*_~|>\\]/g, '').replace(/[@<>]/g, '').replace(/\]\(/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
function slug(name) {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  return s.replace(/(nfts?|collection)$/, '') || s;
}
function hostOf(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
const inList = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));
// "x.com/abc", "https://twitter.com/abc/status/1", "@abc" -> "abc" (or '' when it is not a profile)
function xHandle(v) {
  const s = String(v || '').trim();
  const m = s.match(/^@?([A-Za-z0-9_]{2,15})$/) || s.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,15})(?:[/?#]|$)/i);
  const h = m ? m[1] : '';
  return h && !GENERIC_HANDLES.includes(h.toLowerCase()) ? h : '';
}
// is this number written in the text? (1111 matches "1,111" and "1111"; 0.2 matches "0.2" and ".2")
function numberInText(n, text) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  const t = String(text);
  const forms = new Set([String(n), n.toLocaleString('en-US', { maximumFractionDigits: 6 })]);
  if (n > 0 && n < 1) forms.add(String(n).replace(/^0/, ''));
  return [...forms].some((f) => new RegExp(`(^|[^\\d.,])${f.replace(/[.,]/g, (c) => `\\${c}`)}(?![\\d]|[.,]\\d)`).test(t));
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// is the date "2026-11-20" written in the text in some form (the ISO date, or the month name + the day)?
function dateInText(iso, text) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const t = String(text).toLowerCase();
  if (t.includes(iso)) return true;
  const mon = MONTHS[Number(m[2]) - 1];
  const day = String(Number(m[3]));
  const re = new RegExp(`\\b${mon}[a-z]*\\.?\\s+${day}(st|nd|rd|th)?\\b|\\b${day}(st|nd|rd|th)?\\s+(of\\s+)?${mon}[a-z]*\\b`);
  const numeric = new RegExp(`\\b0?${Number(m[2])}/0?${day}(/|\\b)|\\b0?${day}/0?${Number(m[2])}/`);
  return re.test(t) || numeric.test(t);
}
// when the mint starts, as a ms timestamp (date-only = end of that day UTC), or null
function mintMs(data) {
  if (!data?.mintAt) return null;
  const ms = Date.parse(data.mintAt);
  if (!Number.isFinite(ms)) return null;
  return data.mintHasTime ? ms : ms + DAY - 1;
}
const mintPassed = (data, now = Date.now()) => {
  const ms = mintMs(data);
  return ms !== null && ms < now - (data?.mintHasTime ? 6 * 3600000 : 0);
};

// a scam check of one link (reuses the scam protection link checker): '' = fine, else why not
function badLink(url) {
  try {
    const scam = require('./scam');
    const links = scam.extractLinks(scam.normalize(String(url)));
    const bad = links.find((l) => l.kind === 'lookalike' || l.kind === 'shortener');
    return bad ? (bad.kind === 'lookalike' ? `looks like a fake ${bad.brand} link` : 'a link shortener hides the real site') : '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- settings / why not
function settingsOf(guildId) {
  const saved = guilds.get(guildId)?.settings?.nftRadar || {};
  return { enabled: saved.enabled !== false };
}
async function saveSettings(guildId, patch) {
  return guilds.patchSettings(guildId, { nftRadar: { ...settingsOf(guildId), ...patch } });
}
const logsChannelId = (s) => guilds.logsChannelId(s); // logs channel, else REDEEM_LOGS / control; never the shop

function blocker(guildId) {
  const s = guilds.settings(guildId);
  if (!research.available()) return 'the web research key (TAVILY_API_KEY) is not set on the bot';
  if (!s.known) return 'this server is not set up';
  if (!plans.hasFeature(guildId, 'nftRadar')) return 'NFT Radar is a premium feature and this server is on the free plan';
  if (!guilds.getFeatureChannel(s, 'nftRadar')) return s.isHome ? 'no NFT Radar channel is set (choose one in /setup, or set NFT_RADAR_CHANNEL_ID)' : 'no NFT Radar channel is set (run /setup)';
  if (!logsChannelId(s)) return 'there is no logs channel for the approval requests (run /setup)';
  if (!settingsOf(guildId).enabled) return 'it is switched off (/nftradar on)';
  return '';
}
const targetGuilds = () => guilds.all().map((r) => String(r.guild_id)).filter((id) => !blocker(id));

// ---------------------------------------------------------------- AI
async function aiJson(system, payload, guildId, maxTokens) {
  const raw = await require('./ai').chat(system, JSON.stringify(payload), { json: true, maxTokens, temperature: 0.2, guildId });
  return JSON.parse((String(raw).match(/\{[\s\S]*\}/) || ['{}'])[0]);
}

const DISCOVERY_SYSTEM = [
  'You read web search results and list UPCOMING Solana NFT collection mints that are mentioned in them.',
  'Only NFT collections on Solana whose mint has NOT happened yet. Not tokens or memecoins, not other blockchains, not marketplaces, not articles or lists themselves.',
  'Use ONLY names and links written in the results. Never invent a project, website or handle.',
  'Answer with JSON only: {"projects":[{"name":"...","website":"https://... or null","x":"handle or null"}]} with at most 6 projects. No projects found = {"projects":[]}.',
].join('\n');

const RESEARCH_SYSTEM = [
  'You are a careful NFT research analyst for a Discord community. You check ONE possible upcoming Solana NFT mint.',
  'You get the project name and numbered web sources. Use ONLY facts written in the sources. If a fact is not there, use null. Never guess a date, supply or price.',
  'Answer with JSON only:',
  '{"name":"official project name","is_solana_nft":true/false,"upcoming":true/false (mint not finished yet),',
  '"mint_date":"YYYY-MM-DD or null","supply":number or null,"price_sol":number or null (0 = free mint),',
  '"website":"official website URL or null","x":"official X handle or null",',
  '"summary":"2 short sentences in simple English: what the project is",',
  '"reasons":["up to 4 short positive signals that ARE in the sources, e.g. clear art style, active community, team named, roadmap"],',
  '"risks":["up to 4 short risk notes, e.g. anonymous team, no roadmap, little information, hype words"],',
  '"score":0-10 (quality and how well documented; 0-3 weak, 4-5 unclear, 6-7 decent, 8-10 strong),',
  '"suspicious":true/false,"suspicious_reason":"short or null"}',
  'Mark suspicious for: drainer or "connect wallet to claim" wording, fake-brand links, guaranteed profit promises, copied well-known collections.',
  'No emojis, no advice to buy, no promises of profit.',
].join('\n');

// ---------------------------------------------------------------- finding candidates
// Magic Eden launchpad: Solana projects whose launch is still ahead. Facts here are structured data.
async function fromMagicEden(now = Date.now()) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(ME_URL, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Magic Eden HTTP ${res.status}`);
    const list = await res.json();
    return (Array.isArray(list) ? list : [])
      .filter((c) => c && c.chainId === 'solana' && c.name && c.symbol && Date.parse(c.launchDatetime) > now && Date.parse(c.launchDatetime) < now + 60 * DAY)
      .slice(0, 10)
      .map((c) => ({
        name: clean(c.name, 80),
        source: 'magiceden',
        trusted: {
          mintAt: new Date(Date.parse(c.launchDatetime)).toISOString(),
          mintHasTime: true,
          supply: Number.isFinite(Number(c.size)) && Number(c.size) > 0 && Number(c.size) <= 1e6 ? Number(c.size) : null,
          priceSol: Number.isFinite(Number(c.price)) && Number(c.price) >= 0 ? Number(c.price) : null,
          magicEden: `https://magiceden.io/launchpad/${encodeURIComponent(c.symbol)}`,
        },
        snippets: [{ url: `https://magiceden.io/launchpad/${encodeURIComponent(c.symbol)}`, title: `${c.name} on Magic Eden Launchpad`, content: clean(c.description, 1000) }],
      }));
  } catch (err) {
    console.error(`[nftRadar] Magic Eden launchpad list: ${err.name === 'AbortError' ? 'no answer in time' : err.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// web search -> project names (only names that really appear in the results)
async function fromWeb() {
  const results = [];
  for (const q of DISCOVERY_QUERIES) {
    try {
      results.push(...(await research.search(q, { maxResults: 6, timeRange: 'week' })));
    } catch (err) {
      console.error(`[nftRadar] web search: ${err.message}`);
      if (err.code === 'NO_KEY' || err.code === 'SEARCH_LIMIT') break;
    }
  }
  if (!results.length) return [];
  const text = results.map((r) => `${r.title}\n${r.url}\n${r.content}`).join('\n\n');
  let j;
  try {
    j = await aiJson(DISCOVERY_SYSTEM, { results: results.map((r, i) => ({ n: i + 1, title: r.title, url: r.url, text: r.content })) }, guilds.homeId(), 400);
  } catch (err) {
    if (err.code !== 'AI_LIMIT') console.error(`[nftRadar] picking projects from the search: ${err.message}`);
    return [];
  }
  const lower = text.toLowerCase();
  return (Array.isArray(j?.projects) ? j.projects : [])
    .map((p) => ({ name: clean(p?.name, 80), website: p?.website ? String(p.website).slice(0, 200) : '', x: xHandle(p?.x) }))
    .filter((p) => p.name.length >= 2 && lower.includes(p.name.toLowerCase())) // the AI may not add names
    .slice(0, 6)
    .map((p) => ({ ...p, source: 'web', snippets: results.filter((r) => `${r.title} ${r.content}`.toLowerCase().includes(p.name.toLowerCase())).slice(0, 3) }));
}

// ---------------------------------------------------------------- research one project
// c = { name?, website?, x?, source, trusted?, snippets? } -> { key, name, status, dropReason, data }
async function researchProject(c, { guildId = guilds.homeId() } = {}) {
  const host = c.website ? hostOf(c.website) : '';
  const query = c.name ? `"${c.name}" Solana NFT mint${host && !inList(host, NOT_A_WEBSITE) ? ` ${host}` : ''}` : `${host || c.x || ''} NFT mint Solana`;
  let found = [];
  try {
    found = await research.search(query, { maxResults: 6 });
  } catch (err) {
    if (err.code === 'NO_KEY' || err.code === 'SEARCH_LIMIT' || !(c.snippets || []).length) throw err;
  }
  const seen = new Set();
  const sources = [...(c.snippets || []), ...found].filter((s) => s?.url && !seen.has(s.url) && seen.add(s.url)).slice(0, 8);
  if (!sources.length) {
    const err = new Error('nothing about this project was found on the web');
    err.code = 'NOTHING_FOUND';
    throw err;
  }
  const corpus = sources.map((s) => `${s.title}\n${s.url}\n${s.content}`).join('\n\n');
  const j = await aiJson(RESEARCH_SYSTEM, {
    today: new Date().toISOString().slice(0, 10),
    project: { name: c.name || null, given_website: c.website || null, given_x: c.x || null },
    sources: sources.map((s, i) => ({ n: i + 1, url: s.url, title: s.title, text: s.content })),
  }, guildId, 700);
  return check(c, j, sources, corpus);
}

// The code check of the AI answer: every fact must be in the sources. Pure (tested without AI).
function check(c, j, sources, corpus, now = Date.now()) {
  const t = c.trusted || {};
  const name = clean(j?.name, 80) || clean(c.name, 80);
  const risks = (Array.isArray(j?.risks) ? j.risks : []).map((r) => clean(r, 120)).filter(Boolean).slice(0, 4);
  const reasons = (Array.isArray(j?.reasons) ? j.reasons : []).map((r) => clean(r, 120)).filter(Boolean).slice(0, 4);
  const lowerCorpus = corpus.toLowerCase();

  // supply / price / date: from Magic Eden data, or written in the sources, else not announced
  let supply = Number.isFinite(t.supply) ? t.supply : null;
  if (supply === null && Number.isInteger(j?.supply) && j.supply > 0 && j.supply <= 1e6 && numberInText(j.supply, corpus)) supply = j.supply;
  let priceSol = Number.isFinite(t.priceSol) ? t.priceSol : null;
  if (priceSol === null && typeof j?.price_sol === 'number' && j.price_sol >= 0 && j.price_sol <= 1000) {
    if (j.price_sol === 0 ? /\bfree(?:\s|-)?(?:to\s)?mint\b|\bfree\b/i.test(corpus) : numberInText(j.price_sol, corpus)) priceSol = j.price_sol;
  }
  let mintAt = t.mintAt || null;
  let mintHasTime = !!t.mintHasTime;
  if (!mintAt && typeof j?.mint_date === 'string' && dateInText(j.mint_date, corpus)) {
    mintAt = `${j.mint_date}T00:00:00.000Z`;
    mintHasTime = false;
  }

  // official links: given by the admin / Magic Eden, or written in the sources; never a news or social site
  const byAdmin = c.source === 'admin'; // only a link an admin typed is trusted without being in the sources
  let website = '';
  for (const w of [c.website, j?.website]) {
    const h = w ? hostOf(w) : '';
    if (!h || !h.includes('.') || inList(h, NOT_A_WEBSITE)) continue;
    if ((byAdmin && w === c.website) || lowerCorpus.includes(h)) {
      website = /^https?:\/\//i.test(w) ? String(w).slice(0, 200) : `https://${h}`;
      break;
    }
  }
  let x = '';
  for (const v of [c.x, j?.x, c.website && /(?:x|twitter)\.com\//i.test(c.website) ? c.website : '']) {
    const h = xHandle(v);
    if (h && ((byAdmin && (v === c.x || v === c.website)) || lowerCorpus.includes(h.toLowerCase()))) {
      x = h;
      break;
    }
  }
  const magicEden = t.magicEden || '';

  const data = {
    name, source: c.source, mintAt, mintHasTime, supply, priceSol, website, x: x ? `https://x.com/${x}` : '', magicEden,
    summary: clean(j?.summary, 350), reasons, risks, score: Math.max(0, Math.min(10, Math.round(Number(j?.score) || 0))),
    sources: sources.slice(0, 4).map((s) => s.url),
  };
  // risk notes from the code itself
  if (!data.supply) data.risks.push('Supply not announced');
  if (data.priceSol === null) data.risks.push('Mint price not announced');
  if (!data.mintAt) data.risks.push('Mint date not announced');
  if (!website) data.risks.push('No official website found');
  data.risks = [...new Set(data.risks)].slice(0, 6);

  const key = slug(name);
  const bad = [website, data.x].filter(Boolean).map(badLink).find(Boolean);
  let dropReason = '';
  if (!key) dropReason = 'no project name';
  else if (bad) dropReason = `unsafe link: ${bad}`;
  else if (j?.suspicious === true) dropReason = `suspicious: ${clean(j.suspicious_reason, 150) || 'flagged by the research'}`;
  else if (c.source !== 'admin') {
    if (j?.is_solana_nft !== true && c.source !== 'magiceden') dropReason = 'not clearly a Solana NFT collection';
    else if (j?.upcoming === false && c.source !== 'magiceden') dropReason = 'the mint is not upcoming';
    else if (mintPassed(data, now)) dropReason = 'the mint date has passed';
    else if (!website && !data.x && !magicEden) dropReason = 'no official link';
    else if (data.score < config.nftRadar.minScore) dropReason = `score ${data.score}/10 is below ${config.nftRadar.minScore}`;
  } else {
    // added by an admin: always shown to that admin (with the risks), unless it is unsafe
    if (j?.is_solana_nft !== true) data.risks.unshift('Not clearly a Solana NFT collection');
    if (mintPassed(data, now)) data.risks.unshift('The mint date seems to have passed');
    data.risks = data.risks.slice(0, 6);
  }
  return { key, name, status: dropReason ? 'dropped' : 'selected', dropReason, data };
}

// ---------------------------------------------------------------- texts
const fmtDate = (data) => {
  const ms = Date.parse(data.mintAt || '');
  if (!Number.isFinite(ms)) return 'Not announced';
  return data.mintHasTime ? `<t:${Math.floor(ms / 1000)}:f>` : new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
};
const fmtSupply = (d) => (d.supply ? d.supply.toLocaleString('en-US') : 'Not announced');
const fmtPrice = (d) => (d.priceSol === null || d.priceSol === undefined ? 'Not announced' : d.priceSol === 0 ? 'Free' : `${d.priceSol} SOL`);
const officialLinks = (d) => [d.website && `[Website](${d.website})`, d.x && `[X](${d.x})`, d.magicEden && `[Magic Eden](${d.magicEden})`].filter(Boolean).join(' · ') || 'none found';

// the public post (spec format), only after Approve
function buildPost(d) {
  const lines = ['📡 **NFT RADAR**', '', `**Project:** ${d.name}`, `**Mint:** ${fmtDate(d)}`, `**Supply:** ${fmtSupply(d)}`, `**Mint Price:** ${fmtPrice(d)}`];
  if (d.reasons?.length) lines.push('', "**Why it caught Vexo's attention:**", ...d.reasons.map((r) => `• ${r}`));
  lines.push('', `**Official:** ${officialLinks(d)}`, '', DISCLAIMER);
  return lines.join('\n').slice(0, 1990);
}

const SOURCE_NAMES = { admin: 'added by an admin', web: 'web search', magiceden: 'Magic Eden launchpad' };
function approvalEmbed(p) {
  const d = p.data || {};
  const v = (t) => String(t || '—').slice(0, 1020);
  return new EmbedBuilder()
    .setTitle(`📡 NFT Radar: approve this project? ${d.name || p.name}`.slice(0, 250))
    .setColor(0x9b59b6)
    .setDescription(v(d.summary || 'No summary.'))
    .addFields(
      { name: 'Mint date', value: fmtDate(d), inline: true },
      { name: 'Supply', value: fmtSupply(d), inline: true },
      { name: 'Mint price', value: fmtPrice(d), inline: true },
      { name: 'Official links', value: v(officialLinks(d)) },
      { name: 'Why Vexo selected it', value: v(d.reasons?.length ? d.reasons.map((r) => `• ${r}`).join('\n') : 'No clear positive signals found.') },
      { name: 'Risk indicators', value: v(d.risks?.length ? d.risks.map((r) => `• ${r}`).join('\n') : 'None found (still research it yourself).') },
      { name: 'Score', value: `${d.score ?? '?'}/10`, inline: true },
      { name: 'Found by', value: `${SOURCE_NAMES[d.source] || 'Vexo'}${p.added_by ? ` (<@${p.added_by}>)` : ''}`, inline: true },
      { name: 'Sources', value: v((d.sources || []).map((u) => `<${u}>`).join('\n') || '—') }
    )
    .setFooter({ text: `Project #${p.id} · Nothing is posted until an admin presses Approve.` })
    .setTimestamp();
}
const approvalButtons = (projectId, disabledLabel = null) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`nftr:approve:${projectId}`).setLabel(disabledLabel || 'Approve').setStyle(ButtonStyle.Success).setDisabled(!!disabledLabel),
    new ButtonBuilder().setCustomId(`nftr:reject:${projectId}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(!!disabledLabel)
  );

// ---------------------------------------------------------------- database
let tableMissing = false;
function dbProblem(error, what) {
  if (!tableMissing) console.error(`[nftRadar] ${what}: ${error.message}. Did you run supabase/migration_radar.sql? NFT Radar does nothing until its tables exist.`);
  tableMissing = true;
}
async function recentProjects() {
  const { data, error } = await supabase.from('nft_radar_projects').select('*').order('created_at', { ascending: false }).limit(300);
  if (error) throw Object.assign(new Error(error.message), { db: true });
  tableMissing = false;
  return data || [];
}
// an existing project with the same name or the same website
function findKnown(known, { key, website }) {
  const h = website ? hostOf(website) : '';
  return known.find((p) => (key && p.project_key === key) || (h && !inList(h, NOT_A_WEBSITE) && hostOf(p.data?.website || '') === h)) || null;
}
async function saveProject(r, extra = {}) {
  const row = { project_key: r.key, name: r.name, source: r.data.source, status: r.status, drop_reason: r.dropReason || null, data: r.data, researched_at: new Date().toISOString(), ...extra };
  const { data, error } = await supabase.from('nft_radar_projects').insert(row).select().maybeSingle();
  if (error) {
    if (error.code === '23505') return null; // saved meanwhile by another run
    throw Object.assign(new Error(error.message), { db: true });
  }
  return data;
}
async function researchedToday() {
  const { data, error } = await supabase.from('nft_radar_projects').select('id').gte('researched_at', dayStart());
  if (error) throw Object.assign(new Error(error.message), { db: true });
  return (data || []).length;
}
async function requestsToday(guildId) {
  const { data } = await supabase.from('nft_radar_reviews').select('project_id').eq('guild_id', guildId).gte('created_at', dayStart());
  return (data || []).length;
}

// ---------------------------------------------------------------- approval requests
const lastWarn = new Map();
async function warn(client, guildId, text) {
  console.error(`[nftRadar] guild ${guildId}: ${text}`);
  if (Date.now() - (lastWarn.get(guildId) || 0) < 6 * 3600000) return;
  lastWarn.set(guildId, Date.now());
  try {
    const ch = await getTextChannel(client, logsChannelId(guilds.settings(guildId)));
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setTitle('📡 NFT Radar problem').setColor(0xe67e22).setDescription(text.slice(0, 1500)).setTimestamp()], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[nftRadar] log:', err.message);
  }
}

// send ONE approval request to this server's logs channel -> { ok } | { exists, status } | { error }
async function sendApproval(client, guildId, project) {
  const s = guilds.settings(guildId);
  const { error } = await supabase.from('nft_radar_reviews').insert({ guild_id: guildId, project_id: project.id, status: 'pending' });
  if (error) {
    if (error.code === '23505') {
      const { data } = await supabase.from('nft_radar_reviews').select('status').eq('guild_id', guildId).eq('project_id', project.id).maybeSingle();
      return { exists: true, status: data?.status || 'pending' };
    }
    dbProblem(error, 'cannot save an approval request');
    return { error: 'the NFT Radar tables are missing (run supabase/migration_radar.sql)' };
  }
  const giveBack = () => supabase.from('nft_radar_reviews').delete().eq('guild_id', guildId).eq('project_id', project.id);
  const ch = await getTextChannel(client, logsChannelId(s));
  if (!ch) {
    await giveBack();
    return { error: 'I cannot find the logs channel for NFT Radar approval requests (run /setup).' };
  }
  try {
    const msg = await ch.send({ embeds: [approvalEmbed(project)], components: [approvalButtons(project.id)], allowedMentions: { parse: [] } });
    await supabase.from('nft_radar_reviews').update({ log_channel_id: ch.id, log_message_id: msg?.id || null }).eq('guild_id', guildId).eq('project_id', project.id);
    return { ok: true, channelId: ch.id };
  } catch (err) {
    await giveBack();
    return { error: `I could not post the approval request in <#${ch.id}> (${err.message}).` };
  }
}

// offer the recent selected projects to every server that has not seen them (respecting the daily limit)
async function distribute(client, known) {
  const since = Date.now() - REVIEW_DAYS * DAY;
  const offer = known.filter((p) => p.status === 'selected' && Date.parse(p.created_at) > since && !mintPassed(p.data)).reverse(); // oldest first
  let sent = 0;
  const targets = targetGuilds();
  for (const guildId of targets) {
    let left = config.nftRadar.maxRequestsPerGuildPerDay - (await requestsToday(guildId));
    for (const p of offer) {
      if (left <= 0) break;
      if (p.added_guild_id) continue; // admin-added: sent to its own server when it was added, never to others
      const res = await sendApproval(client, guildId, p);
      if (res.ok) {
        sent++;
        left--;
      } else if (res.error) {
        await warn(client, guildId, res.error);
        break;
      }
    }
  }
  return sent;
}

// ---------------------------------------------------------------- one discovery run
let running = false;
async function run(client) {
  if (running) return { busy: true };
  running = true;
  const out = { found: 0, researched: 0, selected: 0, sent: 0 };
  try {
    let known = await recentProjects();
    let budget = config.nftRadar.maxNewPerDay - (await researchedToday());
    if (budget > 0) {
      const candidates = [...(await fromMagicEden()), ...(await fromWeb())];
      const seen = new Set();
      const fresh = candidates.filter((c) => {
        const k = slug(c.name);
        if (!k || seen.has(k) || findKnown(known, { key: k, website: c.website })) return false;
        seen.add(k);
        return true;
      });
      out.found = fresh.length;
      for (const c of fresh) {
        if (budget <= 0) break;
        try {
          budget--;
          const r = await researchProject(c);
          out.researched++;
          if (findKnown(known, { key: r.key, website: r.data.website })) continue;
          const row = await saveProject(r);
          if (row) {
            known = [row, ...known];
            if (r.status === 'selected') out.selected++;
            else console.log(`[nftRadar] dropped "${r.name}": ${r.dropReason}`);
          }
        } catch (err) {
          if (err.db) throw err;
          if (err.code !== 'AI_LIMIT') console.error(`[nftRadar] research "${c.name}": ${err.message}`);
          if (err.code === 'NO_KEY' || err.code === 'SEARCH_LIMIT') break;
        }
      }
    }
    out.sent = await distribute(client, known);
    console.log(`[nftRadar] run: ${out.found} new candidates, ${out.researched} researched, ${out.selected} selected, ${out.sent} approval requests sent`);
    return out;
  } catch (err) {
    if (err.db) dbProblem(err, 'database');
    else console.error('[nftRadar] run:', err.message);
    return { ...out, error: err.message };
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------- /nftradar add
// -> { ok, project, channelId } | { exists, status, project } | { error }
async function addProject(client, guildId, userId, input) {
  const text = String(input || '').trim().slice(0, 200);
  if (!text) return { error: 'Give me the project\'s website or X link, or its name.' };
  const isLink = /^https?:\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text);
  const bad = isLink ? badLink(text) : '';
  if (bad) return { error: `I will not research that link: it ${bad}.` };
  const c = { source: 'admin' };
  if (isLink && /(?:x|twitter)\.com\//i.test(text)) c.x = xHandle(text);
  else if (isLink) c.website = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  else c.name = clean(text, 80);
  if (isLink && !c.x && !c.website) return { error: 'That X link is not a profile link. Give me the project\'s X profile (x.com/name) or website.' };

  let known;
  try {
    known = await recentProjects();
  } catch (err) {
    dbProblem(err, 'database');
    return { error: 'The NFT Radar tables are missing. Run `supabase/migration_radar.sql` in Supabase first.' };
  }
  const already = findKnown(known, { key: c.name ? slug(c.name) : c.x ? slug(c.x) : '', website: c.website });
  if (already && already.status !== 'dropped') {
    const res = await sendApproval(client, guildId, already);
    return res.ok ? { ok: true, project: already, channelId: res.channelId, reused: true } : res.exists ? { exists: true, status: res.status, project: already } : res;
  }
  const addsToday = known.filter((p) => p.added_guild_id === guildId && Date.parse(p.created_at) >= Date.parse(dayStart())).length;
  if (addsToday >= MAX_ADDS_PER_GUILD_PER_DAY) return { error: `This server already added ${MAX_ADDS_PER_GUILD_PER_DAY} projects today. Try again tomorrow (each one uses web searches).` };

  let r;
  try {
    r = await researchProject(c, { guildId });
  } catch (err) {
    if (err.code === 'NOTHING_FOUND') return { error: 'I found nothing about that project on the web. Check the link or name and try again.' };
    if (err.code === 'AI_LIMIT') return { error: 'The AI is not available for this server right now (plan or daily limit).' };
    if (err.code === 'SEARCH_LIMIT') return { error: 'Vexo used all of today\'s web searches. Try again tomorrow.' };
    return { error: `The research did not work (${err.message}).` };
  }
  if (r.status === 'dropped') return { error: `I will not send this one for approval: ${r.dropReason}.` };
  const twin = findKnown(known, { key: r.key, website: r.data.website });
  let project = twin;
  if (!project || project.status === 'dropped') {
    try {
      project = await saveProject({ ...r, key: twin ? `${r.key}-${Date.now().toString(36)}` : r.key }, { added_by: String(userId), added_guild_id: guildId });
    } catch (err) {
      dbProblem(err, 'database');
      return { error: 'The NFT Radar tables are missing. Run `supabase/migration_radar.sql` in Supabase first.' };
    }
    if (!project) return { error: 'Somebody added this project at the same moment. Check the logs channel.' };
  }
  const res = await sendApproval(client, guildId, project);
  return res.ok ? { ok: true, project, channelId: res.channelId } : res.exists ? { exists: true, status: res.status, project } : res;
}

// /nftradar run: one run now, at most once per MANUAL_HOURS for all servers together.
// The bot owner (OWNER_ID) may run it any time, for testing (the daily search stop still applies).
async function scanNow(client, { byOwner = false } = {}) {
  const d = new Date();
  const slot = byOwner ? `manual owner ${d.toISOString()}` : `manual ${d.toISOString().slice(0, 10)} ${Math.floor(d.getUTCHours() / MANUAL_HOURS)}`;
  const { error } = await supabase.from('nft_radar_runs').insert({ slot });
  if (error) {
    if (error.code === '23505') return { cooldown: true };
    dbProblem(error, 'cannot save a run');
    return { error: 'The NFT Radar tables are missing. Run `supabase/migration_radar.sql` in Supabase first.' };
  }
  const out = await run(client);
  await supabase.from('nft_radar_runs').update({ found: out.found ?? 0 }).eq('slot', slot);
  return out;
}

// ---------------------------------------------------------------- Approve / Reject buttons
async function handleButton(interaction) {
  const eph = { flags: MessageFlags.Ephemeral };
  const [, action, rawId] = String(interaction.customId).split(':');
  const projectId = Number(rawId);
  if (!['approve', 'reject'].includes(action) || !Number.isInteger(projectId)) return null;
  const guildId = guilds.gid(interaction);
  const perms = interaction.memberPermissions;
  const may = !!perms?.has(P.Administrator) || !!perms?.has(P.ManageGuild) || identity.isBoss(interaction.user, interaction);
  if (!may) return interaction.reply({ content: 'Only admins (Manage Server) or the boss can approve or reject NFT Radar projects.', ...eph });
  await interaction.deferUpdate();
  const tell = (content) => interaction.followUp({ content, ...eph, allowedMentions: { parse: [] } }).catch(() => {});
  const close = async (label, note) => {
    let embed = null;
    try {
      const old = interaction.message?.embeds?.[0];
      embed = old ? EmbedBuilder.from(old.toJSON ? old.toJSON() : old).addFields({ name: 'Decision', value: note.slice(0, 1000) }) : null;
    } catch {
      embed = null;
    }
    return interaction.editReply({ ...(embed ? { embeds: [embed] } : { content: note }), components: [approvalButtons(projectId, label)], allowedMentions: { parse: [] } });
  };

  const { data: project } = await supabase.from('nft_radar_projects').select('*').eq('id', projectId).maybeSingle();
  if (!project) return tell('I cannot find this project any more.');
  const claim = async (status) => {
    const { data } = await supabase.from('nft_radar_reviews').update({ status, decided_by: String(interaction.user.id), decided_at: new Date().toISOString() })
      .eq('guild_id', guildId).eq('project_id', projectId).eq('status', 'pending').select();
    return (data || []).length > 0;
  };
  const decidedAlready = async () => {
    const { data } = await supabase.from('nft_radar_reviews').select('status, decided_by').eq('guild_id', guildId).eq('project_id', projectId).maybeSingle();
    return tell(data ? `This project was already handled: **${data.status}**${data.decided_by ? ` by <@${data.decided_by}>` : ''}.` : 'This approval request is not for this server.');
  };

  if (action === 'reject') {
    if (!(await claim('rejected'))) return decidedAlready();
    return close('Rejected', `❌ Rejected by <@${interaction.user.id}>. Nothing was posted.`);
  }
  if (mintPassed(project.data)) {
    if (!(await claim('expired'))) return decidedAlready();
    return close('Mint is over', `⌛ Not posted: the mint date of this project has passed. (Pressed by <@${interaction.user.id}>.)`);
  }
  if (!plans.hasFeature(guildId, 'nftRadar')) return tell(plans.lockedText(true));
  if (!(await claim('approved'))) return decidedAlready();
  const res = await postTo(interaction.client, guildId, buildPost(project.data || {}));
  if (res.error) {
    await supabase.from('nft_radar_reviews').update({ status: 'pending', decided_by: null, decided_at: null }).eq('guild_id', guildId).eq('project_id', projectId);
    return tell(`⚠️ Not posted: ${res.error} The request is still open, press Approve again after fixing it.`);
  }
  await supabase.from('nft_radar_reviews').update({ post_channel_id: res.channelId, post_message_id: res.messageId }).eq('guild_id', guildId).eq('project_id', projectId);
  return close('Approved', `✅ Approved by <@${interaction.user.id}> and posted in <#${res.channelId}>.`);
}

// the public post in this server's NFT Radar channel -> { ok, channelId, messageId } | { error }
async function postTo(client, guildId, text) {
  const s = guilds.settings(guildId);
  const channel = await getTextChannel(client, guilds.getFeatureChannel(s, 'nftRadar')); // not set = nothing is posted
  if (!channel) return { error: `I cannot find the NFT Radar channel${s.isHome ? ' (choose it in /setup, or check NFT_RADAR_CHANNEL_ID)' : ' (run /setup)'}.` };
  const me = channel.guild?.members?.me;
  const perms = me && channel.permissionsFor ? channel.permissionsFor(me) : null;
  if (perms && !(perms.has(P.ViewChannel) && perms.has(P.SendMessages))) return { error: `I cannot write in <#${channel.id}>: give my role **View Channel** and **Send Messages** there.` };
  try {
    const message = await channel.send({ content: text, allowedMentions: { parse: [] } });
    return { ok: true, channelId: channel.id, messageId: message?.id || null };
  } catch (err) {
    return { error: `I could not post in <#${channel.id}> (${err.message}).` };
  }
}

// pending requests of one server (for /nftradar status)
async function pendingCount(guildId) {
  const { data } = await supabase.from('nft_radar_reviews').select('project_id').eq('guild_id', guildId).eq('status', 'pending');
  return (data || []).length;
}

// /nftradar pending: this server's open requests, newest first -> [{ projectId, name, data, link }]
async function pendingList(guildId, max = 10) {
  const { data: reviews } = await supabase.from('nft_radar_reviews').select('*').eq('guild_id', guildId).eq('status', 'pending').order('created_at', { ascending: false }).limit(max);
  const out = [];
  for (const r of reviews || []) {
    const { data: p } = await supabase.from('nft_radar_projects').select('*').eq('id', r.project_id).maybeSingle();
    if (!p) continue;
    out.push({
      projectId: p.id, name: p.data?.name || p.name, data: p.data || {}, createdAt: r.created_at,
      link: r.log_channel_id && r.log_message_id ? `https://discord.com/channels/${guildId}/${r.log_channel_id}/${r.log_message_id}` : '',
    });
  }
  return out;
}

// /nftradar status: the latest run and how many projects Vexo has looked at (shared by all servers)
async function stats() {
  const { data: runs } = await supabase.from('nft_radar_runs').select('*').order('created_at', { ascending: false }).limit(1);
  const { data: projects } = await supabase.from('nft_radar_projects').select('status').limit(5000);
  const list = projects || [];
  return {
    lastRun: runs?.[0] ? { at: runs[0].created_at, found: runs[0].found, manual: String(runs[0].slot).startsWith('manual') } : null,
    projects: list.length,
    selected: list.filter((p) => p.status === 'selected').length,
    dropped: list.filter((p) => p.status === 'dropped').length,
  };
}

// /nftradar preview: the newest real project this server was offered (or any selected one); null = none yet
async function previewProject(guildId) {
  const { data: mine } = await supabase.from('nft_radar_reviews').select('project_id').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(1);
  const id = mine?.[0]?.project_id;
  if (id) {
    const { data } = await supabase.from('nft_radar_projects').select('*').eq('id', id).maybeSingle();
    if (data) return data;
  }
  const { data: any } = await supabase.from('nft_radar_projects').select('*').eq('status', 'selected').order('created_at', { ascending: false }).limit(1);
  return any?.[0] || null;
}
// a clearly marked layout example (never posted; only used when no real project exists yet)
const EXAMPLE = { name: 'Example Project (made up, layout only)', mintAt: null, mintHasTime: false, supply: 1111, priceSol: 0.2, website: 'https://example.com', x: '', magicEden: '', reasons: ['Interesting artwork', 'Active community', 'Clear project direction'] };

// ---------------------------------------------------------------- the timer
let timer = null;
const done = new Set();
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const runTimes = () => {
  const t = [...new Set(config.nftRadar.times.map((v) => (/^\d:\d\d$/.test(v) ? `0${v}` : v)).filter(validTime))].sort();
  return t.length ? t : ['09:00', '21:00'];
};

// switched on and allowed, but no NFT Radar channel: nothing is ever posted there; tell the admins once
async function checkChannels(client) {
  const notices = require('./notices');
  for (const row of guilds.all()) {
    const id = String(row.guild_id);
    const s = guilds.settings(id);
    if (!s.known || !plans.hasFeature(id, 'nftRadar') || !settingsOf(id).enabled) continue;
    if (!guilds.getFeatureChannel(s, 'nftRadar')) await notices.missingChannelOnce(client, id, 'nftRadar', 'NFT Radar');
    else await notices.channelBack(id, 'nftRadar');
  }
}

async function tick(client, nowMs = Date.now()) {
  if (running || !research.available()) return;
  await checkChannels(client).catch((e) => console.error('[nftRadar] channel check:', e.message));
  const { slot, ageMin } = require('./solRadar').newestSlot(runTimes(), 'UTC', nowMs);
  if (ageMin > GRACE_MIN || done.has(slot)) return;
  if (!targetGuilds().length) return; // nobody uses NFT Radar: no searches are spent
  const { error } = await supabase.from('nft_radar_runs').insert({ slot });
  if (error) {
    if (error.code === '23505') done.add(slot);
    else dbProblem(error, 'cannot save a run');
    return;
  }
  done.add(slot);
  const out = await run(client);
  await supabase.from('nft_radar_runs').update({ found: out.found ?? 0 }).eq('slot', slot);
}

function startTimer(client) {
  stopTimer();
  if (!research.available()) {
    console.warn('[nftRadar] off: TAVILY_API_KEY is not set (add it to .env / Render to switch NFT Radar on). Everything else works.');
    return false;
  }
  timer = setInterval(() => tick(client).catch((e) => console.error('[nftRadar] tick:', e.message)), TICK_MS);
  timer.unref?.();
  console.log(`[nftRadar] running (looks for new projects at ${runTimes().join(', ')} UTC; nothing is posted without an admin's Approve)`);
  tick(client).catch((e) => console.error('[nftRadar] tick:', e.message));
  return true;
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startTimer, stopTimer, tick, run, scanNow, addProject, handleButton, sendApproval, distribute, postTo, buildPost, approvalEmbed,
  researchProject, check, fromWeb, fromMagicEden, settingsOf, saveSettings, blocker, pendingCount, pendingList, stats, previewProject, EXAMPLE, runTimes, fmtDate,
  slug, hostOf, xHandle, numberInText, dateInText, mintPassed, badLink,
  DISCLAIMER, MAX_ADDS_PER_GUILD_PER_DAY,
  _test: { done, lastWarn, reset: () => (done.clear(), lastWarn.clear(), (tableMissing = false), (running = false)) },
};
