// SOL Radar: 4 to 5 short SOL market updates a day in each server's SOL Radar channel.
//
//   numbers        come from src/web3/market.js (Binance public market data, CoinGecko as the backup,
//                  + calculations in code). Never from the AI.
//   the outlook    two short sentences. ONE small AI call is shared by every server (at most one per
//                  15 minutes); every $ number in it must be a real level, otherwise pre-written
//                  sentences are used. AI down = pre-written sentences.
//   no data        Binance AND the CoinGecko backup both down = nothing is posted. Nothing is invented.
//                  (No key is needed; COINGECKO_API_KEY is optional and only raises the limits.)
//   schedule       per server: settings.solRadar = { enabled, times: ['01:00', ...], timezone }.
//                  Only the newest due time is posted, and only within 2 hours of it, so a bot that
//                  slept never posts a burst of old updates.
//   no duplicates  a row in sol_radar_posts (guild_id + slot) is claimed BEFORE sending. It survives
//                  restarts and redeploys.
//
// Plan: "solRadar" (premium). HΛVØCZ uses SOL_RADAR_CHANNEL_ID; other servers their "📈・sol-radar" channel.
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const supabase = require('./db');
const config = require('./config');
const guilds = require('./guilds');
const plans = require('./plans');
const market = require('./web3/market');
const cache = require('./web3/cache');
const { getTextChannel } = require('./utils');

const TICK_MS = 60 * 1000;
const GRACE_MIN = 120; // a time slot can still be posted this long after its time
const MIN_SLOTS = 4;
const MAX_SLOTS = 5;
const OUTLOOK_MS = 15 * 60 * 1000;
const DISCLAIMER = '⚠️ Market analysis, not guaranteed predictions or financial advice.';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------- settings
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
function validZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
// "1:00, 06:00 11:00" -> ['01:00','06:00','11:00'] (sorted, no duplicates) or null when anything is not a time
function parseTimes(text) {
  const parts = String(text || '').split(/[\s,;]+/).filter(Boolean).map((p) => (/^\d:\d\d$/.test(p) ? `0${p}` : p));
  if (!parts.length || !parts.every(validTime)) return null;
  return [...new Set(parts)].sort();
}
const defaultTimes = () => {
  const t = parseTimes(config.solRadar.times.join(','));
  return t && t.length >= MIN_SLOTS && t.length <= MAX_SLOTS ? t : ['01:00', '06:00', '11:00', '16:00', '21:00'];
};
// this server's SOL Radar settings (stored in its guilds row; HΛVØCZ too)
function settingsOf(guildId) {
  const saved = guilds.get(guildId)?.settings?.solRadar || {};
  const times = Array.isArray(saved.times) ? parseTimes(saved.times.join(',')) : null;
  return {
    enabled: saved.enabled !== false, // on by default wherever the channel and the plan allow it
    times: times && times.length >= MIN_SLOTS && times.length <= MAX_SLOTS ? times : defaultTimes(),
    timezone: saved.timezone && validZone(saved.timezone) ? saved.timezone : validZone(config.solRadar.timezone) ? config.solRadar.timezone : 'UTC',
  };
}
async function saveSettings(guildId, patch) {
  const cur = settingsOf(guildId);
  return guilds.patchSettings(guildId, { solRadar: { enabled: cur.enabled, times: cur.times, timezone: cur.timezone, ...patch } });
}

// why SOL Radar is not posting in this server, or '' when everything is ready
function blocker(guildId) {
  const s = guilds.settings(guildId);
  if (!market.available()) return 'the market data key (COINGECKO_API_KEY) is not set on the bot';
  if (!s.known) return 'this server is not set up';
  if (!plans.hasFeature(guildId, 'solRadar')) return 'SOL Radar is a premium feature and this server is on the free plan';
  if (!s.channels.solRadar) return s.isHome ? 'SOL_RADAR_CHANNEL_ID is empty' : 'no SOL Radar channel is set (run /setup)';
  if (!settingsOf(guildId).enabled) return 'it is switched off (/solradar on)';
  return '';
}

// ---------------------------------------------------------------- time slots
// the local date and minutes-of-day in a time zone
function localClock(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
// The newest time slot that has started: { slot: '2026-11-14 11:00', ageMin } (may be yesterday's last one)
function newestSlot(times, zone, nowMs) {
  const now = localClock(nowMs, zone);
  const mins = times.map((t) => ({ t, m: Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) }));
  const today = mins.filter((x) => x.m <= now.minutes).pop();
  if (today) return { slot: `${now.date} ${today.t}`, ageMin: now.minutes - today.m };
  const last = mins[mins.length - 1];
  const yesterday = localClock(nowMs - 86400000, zone).date;
  return { slot: `${yesterday} ${last.t}`, ageMin: now.minutes + 1440 - last.m };
}

// ---------------------------------------------------------------- the text
const usd = (v) => {
  if (v === null || v === undefined) return null;
  const digits = v >= 1000 ? 0 : v >= 10 ? 2 : 3;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
const bigUsd = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : usd(v));
const area = (v) => `$${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}`; // "the $152 area"
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

function rsiWords(v) {
  if (v >= 70) return 'high: many buyers already, a cool-down is possible';
  if (v <= 30) return 'low: heavy selling, a bounce is possible';
  if (v >= 55) return 'buyers have the edge';
  if (v <= 45) return 'sellers have the edge';
  return 'balanced';
}

// pre-written outlook (used when the AI is unavailable or wrote a number that is not a real level)
function templateOutlook(d) {
  const up = d.resistance !== null
    ? pick([`If buying momentum continues, SOL could test the ${area(d.resistance)} area.`, `If buyers stay in control, the next area to watch is around ${area(d.resistance)}.`, `If the price pushes higher, the ${area(d.resistance)} area comes into view.`])
    : pick(['If buying momentum continues, SOL could move above its recent highs.', 'If buyers stay in control, SOL could make a new recent high.']);
  const down = d.support !== null
    ? pick([`If selling pressure increases, SOL may move toward ${area(d.support)}.`, `If sellers take over, the ${area(d.support)} area is the level to watch.`, `If the price drops from here, the ${area(d.support)} area will be tested first.`])
    : pick(['If selling pressure increases, SOL may slip below its recent lows.', 'If sellers take over, SOL could make a new recent low.']);
  return { bullish: up, bearish: down };
}

const OUTLOOK_SYSTEM = [
  'You write the two-sentence outlook of a SOL (Solana) market update for ordinary Discord members.',
  'You get the real numbers as JSON. Use ONLY those numbers. Never invent a price, level, percentage, date or news.',
  'Answer with JSON only: {"bullish":"...","bearish":"..."}',
  '- bullish: ONE sentence starting with "If": what could happen if buying continues. If "resistance" is given, name it as an area (for example "the $155 area"). If it is null, name no price.',
  '- bearish: ONE sentence starting with "If": what could happen if selling increases. If "support" is given, name it. If it is null, name no price.',
  '- Simple everyday English, no trading jargon, no emojis, no advice to buy or sell, no promises. Words like "could" and "may", never "will".',
  '- Each sentence under 140 characters.',
].join('\n');

// every $ amount in the text must be (close to) one of the real levels
function onlyRealNumbers(text, d) {
  const allowed = [d.price, d.support, d.resistance, d.high24h, d.low24h].filter((v) => v !== null && v !== undefined);
  const found = [...String(text).matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  if (/\d\s?%/.test(text)) return false; // no percentages in the outlook
  const bare = [...String(text).replace(/\$\s?[\d,]+(?:\.\d+)?/g, '').matchAll(/\d+(?:\.\d+)?/g)]; // numbers without a $ are not allowed either
  if (bare.length) return false;
  return found.every((n) => allowed.some((a) => Math.abs(a - n) <= Math.max(0.51, a * 0.005)));
}

// { bullish, bearish, source: 'ai' | 'template' }. One AI call for all servers per 15 minutes.
async function outlook(d) {
  const bucket = Math.floor(Date.now() / OUTLOOK_MS);
  try {
    return await cache.get(`solradar:outlook:${bucket}`, OUTLOOK_MS, async () => {
      const facts = { price: d.price, change_24h_percent: d.change24h, high_24h: d.high24h, low_24h: d.low24h, rsi_14h: d.rsi, volume_trend: d.volumeTrend, momentum: d.momentum, support: d.support === null ? null : Number(area(d.support).slice(1)), resistance: d.resistance === null ? null : Number(area(d.resistance).slice(1)) };
      // the bot owner pays for this one shared call (it is not charged to any single server's daily limit)
      const raw = await require('./ai').chat(OUTLOOK_SYSTEM, JSON.stringify(facts), { json: true, maxTokens: 160, temperature: 0.8, guildId: guilds.homeId() });
      const j = JSON.parse((String(raw).match(/\{[\s\S]*\}/) || ['{}'])[0]);
      const clean = (t) => String(t || '').replace(/[*_`>#@]/g, '').replace(/\s+/g, ' ').trim();
      const bullish = clean(j.bullish);
      const bearish = clean(j.bearish);
      const ok = (t) => t.length >= 20 && t.length <= 200 && /^if\b/i.test(t) && onlyRealNumbers(t, d) && !/\b(buy now|sell now|guarantee|will definitely|financial advice)\b/i.test(t);
      if (!ok(bullish) || !ok(bearish)) throw new Error('the AI outlook did not pass the number check');
      return { bullish, bearish, source: 'ai' };
    }, { failMs: OUTLOOK_MS });
  } catch (err) {
    if (err.code !== 'AI_LIMIT') console.error('[solRadar] outlook from pre-written lines:', err.message);
    return { ...templateOutlook(d), source: 'template' };
  }
}

// The message. Lines whose value is not available are left out (never a made-up number).
function buildPost(d, look) {
  const lines = ['📈 **SOL RADAR**', '', `**SOL Price:** ${usd(d.price)}`, '', "**Today's Movement**"];
  if (d.high24h !== null) lines.push(`High: ${usd(d.high24h)}`);
  if (d.low24h !== null) lines.push(`Low: ${usd(d.low24h)}`);
  if (d.change24h !== null) lines.push(`24h Change: ${pct(d.change24h)}`);
  const signals = [];
  if (d.rsi !== null) signals.push(`RSI: ${Math.round(d.rsi)} (${rsiWords(d.rsi)})`);
  if (d.volume24h !== null) signals.push(`Volume: ${d.volumeTrend ? `${d.volumeTrend} · ` : ''}${bigUsd(d.volume24h)} traded in 24h${d.volumeSource === 'Binance' ? ' on Binance' : ''}`);
  if (d.momentum) signals.push(`Momentum: ${d.momentum}`);
  if (d.support !== null) signals.push(`Support (price floor to watch): around ${area(d.support)}`);
  if (d.resistance !== null) signals.push(`Resistance (price ceiling to watch): around ${area(d.resistance)}`);
  if (signals.length) lines.push('', '**Market Signals**', ...signals);
  lines.push('', '**Near-Term Outlook**', look.bullish, '', look.bearish, '', DISCLAIMER, `-# Data: ${d.source || 'Binance (SOL/USDT)'}${d.volumeSource && d.source && !d.source.startsWith(d.volumeSource) ? `, volume: ${d.volumeSource}` : ''} · levels are approximate · updated <t:${Math.floor(d.updatedAt / 1000)}:R>`);
  return lines.join('\n').slice(0, 1990);
}

// the finished text of one update (throws when the market data is not available)
async function compose() {
  const d = await market.solSnapshot();
  return { text: buildPost(d, await outlook(d)), data: d };
}

// ---------------------------------------------------------------- posting
const lastWarn = new Map(); // guildId -> last time a problem was reported to its logs channel
async function warn(client, guildId, text) {
  console.error(`[solRadar] guild ${guildId}: ${text}`);
  if (Date.now() - (lastWarn.get(guildId) || 0) < 6 * 3600000) return; // at most one note every 6 hours
  lastWarn.set(guildId, Date.now());
  try {
    const s = guilds.settings(guildId);
    const ch = await getTextChannel(client, s.channels.logs || s.channels.redeemLogs);
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setTitle('📈 SOL Radar problem').setColor(0xe67e22).setDescription(text.slice(0, 1500)).setTimestamp()], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[solRadar] log:', err.message);
  }
}

// send one update to this server's SOL Radar channel -> { ok } | { error }
async function postTo(client, guildId, text) {
  const s = guilds.settings(guildId);
  const channel = await getTextChannel(client, s.channels.solRadar);
  if (!channel) return { error: `I cannot find the SOL Radar channel${s.isHome ? ' (check SOL_RADAR_CHANNEL_ID)' : ' (run /setup)'}.` };
  const me = channel.guild?.members?.me;
  const perms = me && channel.permissionsFor ? channel.permissionsFor(me) : null;
  if (perms && !(perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages))) return { error: `I cannot write in <#${channel.id}>: give my role **View Channel** and **Send Messages** there.` };
  try {
    const message = await channel.send({ content: text, allowedMentions: { parse: [] } });
    return { ok: true, channelId: channel.id, messageId: message?.id || null };
  } catch (err) {
    return { error: `I could not post in <#${channel.id}> (${err.message}).` };
  }
}

// ---------------------------------------------------------------- the timer
let timer = null;
let ticking = false;
let tableMissing = false;
const done = new Set(); // "guildId|slot" handled in this process (saves database calls)

async function tick(client, nowMs = Date.now()) {
  if (ticking || !market.available()) return;
  ticking = true;
  try {
    // which servers have a time slot that is due and not posted yet?
    const due = [];
    for (const row of guilds.all()) {
      const id = String(row.guild_id);
      if (blocker(id)) continue;
      const st = settingsOf(id);
      const { slot, ageMin } = newestSlot(st.times, st.timezone, nowMs);
      if (ageMin > GRACE_MIN || done.has(`${id}|${slot}`)) continue;
      due.push({ id, slot });
    }
    if (!due.length) return;

    let post;
    try {
      post = await compose();
    } catch (err) {
      console.error(`[solRadar] no update posted: ${err.message}`); // tried again on the next tick, inside the 2 hours
      return;
    }
    for (const { id, slot } of due) {
      // claim the slot in the database first: only one process can, and only once
      const { error } = await supabase.from('sol_radar_posts').insert({ guild_id: id, slot, channel_id: guilds.settings(id).channels.solRadar });
      if (error) {
        if (error.code === '23505') done.add(`${id}|${slot}`); // already posted (before a restart, or by another process)
        else if (!tableMissing) {
          tableMissing = true;
          console.error(`[solRadar] cannot save posts (${error.message}). Did you run supabase/migration_radar.sql? Nothing is posted until the table exists.`);
        }
        continue;
      }
      tableMissing = false;
      done.add(`${id}|${slot}`);
      const res = await postTo(client, id, post.text);
      if (res.error) {
        // not posted: give the slot back so it is tried again while it is still fresh
        await supabase.from('sol_radar_posts').delete().eq('guild_id', id).eq('slot', slot);
        done.delete(`${id}|${slot}`);
        await warn(client, id, res.error);
      } else if (res.messageId) {
        await supabase.from('sol_radar_posts').update({ message_id: res.messageId }).eq('guild_id', id).eq('slot', slot);
      }
    }
    if (done.size > 5000) done.clear();
  } catch (err) {
    console.error('[solRadar] tick:', err.message);
  } finally {
    ticking = false;
  }
}

function startTimer(client) {
  if (timer) clearInterval(timer);
  timer = null;
  if (!market.available()) return false;
  timer = setInterval(() => tick(client), TICK_MS);
  timer.unref?.();
  console.log(`[solRadar] market data: Binance public market data (SOL/USDT, no key needed), backup: CoinGecko ${market.hasKey() ? 'with your API key' : 'without a key'}`);
  console.log(`[solRadar] running (checks every minute; default times ${defaultTimes().join(', ')} ${settingsOf(guilds.homeId()).timezone})`);
  tick(client);
  return true;
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startTimer, stopTimer, tick, compose, buildPost, outlook, templateOutlook, onlyRealNumbers, postTo,
  settingsOf, saveSettings, blocker, parseTimes, validZone, newestSlot, defaultTimes,
  MIN_SLOTS, MAX_SLOTS, GRACE_MIN, DISCLAIMER,
  _test: { done, lastWarn, reset: () => (done.clear(), lastWarn.clear(), (tableMissing = false)) },
};
