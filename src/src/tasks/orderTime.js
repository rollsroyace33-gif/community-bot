// Reads times and durations out of a control channel order, in code (deterministic). The AI only
// extracts fields as a fallback; the real instants are always computed here, on the boss's clock
// (BOSS_TIMEZONE) unless he writes a zone himself ("9 pm UTC").
//
// readOrder(text, { kind })  ->  what the boss said, phrase by phrase (nothing is guessed or dropped):
//   host:      { type: 'now' | 'in' | 'clock', ms?, clock?, phrase }   "host a rumble at 4.35 pm", "ekhoni", "in 20 min"
//   starts:    [{ type: 'after' | 'window' | 'at' | 'closes', ms?, clock?, phrase }]   Rumble only
//   remind:    { secs: [600, 120], phrase } | null                                     Rumble only
//   minPlayers, prizeText
//   leftovers: parts with a number / time word that no rule above understood (the caller asks about them)
//   extraHosts: more than one host time = leftovers too
// kind: 'rumble' (host + game start + reminders) or 'simple' (one start time: the number guess game)
const { localDay, wallAt, BOSS_TZ } = require('./time');

const MIN = 60 * 1000;

// ---------------- normalizing (Bangla script -> the same words in English letters) ----------------
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const BN_WORDS = [
  [/টায়|টাই|টা/g, ' tay'], [/রাত/g, 'raat'], [/সকাল/g, 'sokal'], [/বিকাল|বিকেল/g, 'bikal'], [/সন্ধ্যা/g, 'sondha'],
  [/দুপুর/g, 'dupur'], [/আজকে|আজ/g, 'aj'], [/আগামীকাল|কালকে|কাল/g, 'kal'], [/এখনই|এখনি|এখন/g, 'ekhoni'],
  [/মিনিট/g, ' min'], [/ঘণ্টা|ঘন্টা/g, ' ghonta'], [/সেকেন্ড/g, ' sec'], [/পরে|পর/g, ' pore'],
];
function normalize(text) {
  let t = String(text || '').replace(/[০-৯]/g, (c) => String(BN_DIGITS.indexOf(c)));
  for (const [re, to] of BN_WORDS) t = t.replace(re, to);
  return t.toLowerCase().replace(/[’']/g, "'");
}

// ---------------- building blocks ----------------
const NUM = '\\d+(?:\\.\\d+)?';
const UNIT = '(?:seconds?|secs?|s|minutes?|mins?|mint|minit|m|hours?|hrs?|hr|h|ghontay|ghonta|ghanta)(?![a-z])';
const DUR_RE = new RegExp(`(?:${NUM}\\s*-?\\s*${UNIT}(?:\\s*(?:and\\s*)?${NUM}\\s*-?\\s*${UNIT})?|half\\s+an?\\s+hour|an?\\s+hour)`, 'g');
const DAYW = '(?:today|tonight|tomorrow|tmrw|tmr|aj|ajke|aaj|kal|kalke|porshu|raat|rat|night|sokal|morning|bikal|afternoon|sondha|shondha|evening|dupur|noon)';
const CLOCK_RE = new RegExp(
  `(?:\\b(${DAYW})\\s+(?:(${DAYW})\\s+)?(?:at\\s+)?)?\\b(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(a\\.?m\\.?|p\\.?m\\.?)(?![a-z]))?` +
    `(?:\\s*(tay|ta|te|e|o'?clock|baje)(?![a-z]))?(?:\\s+(${DAYW})\\b)?(?:\\s*\\b(utc|gmt)\\b(?:\\s*([+-]\\d{1,2}(?::?\\d{2})?))?)?`,
  'g'
);
const NOW_RE = /\b(right\s+now|now|ekhoni|ekhuni|ekhon|immediately|asap|instantly)\b/g;

const unitMs = (u) => {
  if (/^(s|sec|secs|second|seconds)$/.test(u)) return 1000;
  if (/^(h|hr|hrs|hour|hours|ghonta|ghontay|ghanta)$/.test(u)) return 60 * MIN;
  return MIN;
};
// "30 min" / "4 hours" / "1.5 hours" / "1 hour 30 min" / "half an hour" -> ms (null if none)
function parseDuration(s) {
  const str = normalize(s);
  if (/half\s+an?\s+hour/.test(str)) return 30 * MIN;
  if (/^\s*an?\s+hour\s*$/.test(str)) return 60 * MIN;
  let ms = 0;
  let found = false;
  for (const m of str.matchAll(new RegExp(`(${NUM})\\s*-?\\s*(${UNIT})`, 'g'))) {
    ms += Number(m[1]) * unitMs(m[2]);
    found = true;
  }
  return found ? Math.round(ms) : null;
}

// "10 and 2 min", "10 min, 2 min", "5" -> seconds; a number without a unit takes the next unit given
function parseDurationList(s) {
  const parts = [...normalize(s).matchAll(new RegExp(`(${NUM})\\s*(${UNIT})?`, 'g'))].map((m) => ({ n: Number(m[1]), u: m[2] || null }));
  let unit = 'min';
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].u) unit = parts[i].u;
    else parts[i].u = unit;
  }
  return parts.map((p) => Math.round((p.n * unitMs(p.u)) / 1000)).filter((x) => x > 0);
}

const isPeriod = (w, list) => !!w && list.includes(w);
const NIGHT = ['tonight', 'raat', 'rat', 'night', 'sondha', 'shondha', 'evening'];
const AFTERNOON = ['bikal', 'afternoon', 'dupur', 'noon'];
const MORNING = ['sokal', 'morning'];
const TOMORROW = ['tomorrow', 'tmrw', 'tmr', 'kal', 'kalke'];

// one CLOCK regex match -> { h, min, hours: [possible 24h hours], day: 0|1|2|null, zone } or null (not a time)
function clockFromMatch(m, text) {
  const [full, w1, w2, hh, mm, ampm, suffix, w3, utc, offset] = m;
  const h = Number(hh);
  const min = mm ? Number(mm) : 0;
  const words = [w1, w2, w3].filter(Boolean);
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + full.length);
  const at = /(?:\bat|@|\bby|\btill|\buntil)\s*$/.test(before);
  // a number is a time only with a clear marker: "4.35", "8 pm", "9 tay", "tonight 9", "at 9", "20:00"
  if (!mm && !ampm && !suffix && !words.length && !at) return null;
  // not a duration / prize / player count / range ("1.5 hours", "20 points", "5 players", "1-100")
  if (new RegExp(`^\\s*(?:[.:]?\\d|-\\s*\\d|${UNIT}|points?\\b|pts?\\b|players?\\b|jon\\b|%)`).test(after)) return null;
  if (h > 23 || min > 59 || (ampm && (h < 1 || h > 12))) return null;

  let hours;
  const pm = ampm ? ampm.startsWith('p') : null;
  if (pm !== null) hours = [(h % 12) + (pm ? 12 : 0)];
  else if (h === 0 || h >= 13) hours = [h];
  else if (words.some((w) => isPeriod(w, NIGHT))) hours = [h === 12 ? 0 : h < 5 ? h : h + 12].map((x) => (x >= 24 ? x - 12 : x));
  else if (words.some((w) => isPeriod(w, AFTERNOON))) hours = [h === 12 ? 12 : h + 12];
  else if (words.some((w) => isPeriod(w, MORNING))) hours = [h === 12 ? 0 : h];
  else hours = [h % 12, (h % 12) + 12]; // "at 9": morning or evening, the caller picks the next one
  let day = null;
  if (words.some((w) => TOMORROW.includes(w))) day = 1;
  else if (words.includes('porshu')) day = 2;
  else if (words.some((w) => ['today', 'aj', 'ajke', 'aaj', 'tonight'].includes(w))) day = 0;
  const zone = utc ? (offset ? `UTC${offset}` : 'UTC') : BOSS_TZ;
  return { h, min, hours, day, zone, nightRollover: words.some((w) => isPeriod(w, NIGHT)) && h === 12 };
}

// ---------------- the reader ----------------
function readOrder(text, { kind = 'rumble' } = {}) {
  const raw = String(text || '');
  const t = normalize(raw);
  const same = t.length === raw.length; // ASCII input: quote the boss's own spelling
  const quote = (a, b) => (same ? raw.slice(a, b) : t.slice(a, b)).trim();
  const taken = []; // [start, end) spans already understood
  const isFree = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const take = (a, b) => taken.push([a, b]);
  const clauseStart = (i) => Math.max(t.lastIndexOf(',', i - 1), t.lastIndexOf(';', i - 1), t.lastIndexOf('\n', i - 1)) + 1;

  const out = { host: null, starts: [], remind: null, minPlayers: null, prizeText: null, leftovers: [], extraHosts: [] };
  const hosts = [];

  // 1. reminders: "remind 10 min before", "reminders at 10 and 2 min before the start"
  if (kind === 'rumble') {
    const re = new RegExp(
      `\\bremind(?:er|ers)?(?:\\s+(?:me|them|everyone|members|people|us))?\\s+(?:at\\s+|of\\s+)?((?:${NUM}\\s*(?:${UNIT})?)(?:\\s*(?:,|and|&|\\+)\\s*${NUM}\\s*(?:${UNIT})?)*)` +
        '(?:\\s*(?:before|age|ager|prior)(?:\\s+(?:the\\s+)?(?:start|game|rounds?|it|starting))?)?',
      'g'
    );
    for (const m of t.matchAll(re)) {
      const secs = parseDurationList(m[1]);
      if (!secs.length) continue;
      out.remind = { secs: [...new Set([...(out.remind?.secs || []), ...secs])].sort((a, b) => b - a), phrase: quote(m.index, m.index + m[0].length) };
      take(m.index, m.index + m[0].length);
    }
  }

  // 2. clock times ("4.35 pm", "tonight 9", "9 tay", "20:00"), classified by the words right before them
  for (const m of t.matchAll(CLOCK_RE)) {
    const a = m.index;
    const b = a + m[0].length;
    if (!isFree(a, b)) continue;
    const clock = clockFromMatch(m, t);
    if (!clock) continue;
    const lead = t.slice(clauseStart(a), a);
    let type = 'host';
    let from = a;
    if (kind === 'rumble') {
      const closes = /(join(?:ing)?\s*(?:window\s*)?(?:closes?|close|ends?|shuts?|closing)|(?:closes?|close|shuts?)(?:\s+(?:the\s+)?join(?:ing)?(?:\s*window)?)?)\s*(?:at|@|by)?\s*$/.exec(lead);
      const play = /((?:play|begin|fight|battle|game\s+starts?|rounds?\s+starts?|starts?\s+(?:the\s+)?(?:game|rounds|battle|fight))(?:\s+it)?\s*(?:at|@|by)?)\s*$/.exec(lead);
      const start = /(\bstart(?:s)?(?:\s+it)?\s*(?:at|@))\s*$/.exec(lead);
      if (closes) [type, from] = ['closes', a - closes[0].length];
      else if (play) [type, from] = ['at', a - play[0].length];
      else if (start) [type, from] = ['start_at', a - start[0].length]; // "start at 9": host, or the game start if a host is given
    }
    take(from, b);
    const item = { type, clock, phrase: quote(from, b), pos: from };
    if (type === 'host' || type === 'start_at') hosts.push(item);
    else out.starts.push(item);
  }

  // 3. "now" / "ekhoni"
  for (const m of t.matchAll(NOW_RE)) {
    if (!isFree(m.index, m.index + m[0].length)) continue;
    take(m.index, m.index + m[0].length);
    hosts.push({ type: 'now', phrase: quote(m.index, m.index + m[0].length), pos: m.index });
  }

  // 4. durations, classified by the words around them
  for (const m of t.matchAll(DUR_RE)) {
    let a = m.index;
    let b = a + m[0].length;
    if (!isFree(a, b)) continue;
    const ms = parseDuration(m[0]);
    if (!ms) continue;
    const lead = t.slice(clauseStart(a), a);
    const tail = t.slice(b);
    const ofHosting = /^\s+(?:of|from|after)\s+(?:the\s+)?(?:hosting|host|opening|it\s+opens|join(?:ing)?(?:\s+opens?)?|the\s+start)\b/.exec(tail);
    const pore = /^\s*(?:por|pore|porey|pre|later|baad|bad)(?![a-z])/.exec(tail);
    const dhore = /^\s*(?:dhore|long|window|join(?:ing)?\s*window|of\s+join(?:ing)?)(?![a-z])/.exec(tail);
    let type;
    let lm;
    if ((lm = /((?:play|begin|fight|battle|game\s+starts?|rounds?\s+starts?)(?:\s+(?:it|the\s+game|the\s+rounds))?\s+(?:after|in))\s*$/.exec(lead))) type = 'after';
    else if ((lm = /(\bstart(?:s)?(?:\s+(?:it|the\s+game|the\s+rounds))?\s+after)\s*$/.exec(lead))) type = 'after';
    else if ((lm = /(\bstart(?:s)?(?:\s+(?:it|the\s+game|the\s+rounds))?\s+in)\s*$/.exec(lead)) && ofHosting) type = 'after';
    else if (ofHosting) type = 'after';
    else if ((lm = /(join(?:ing)?\s*(?:window|time|period)?\s*(?:of|for|is|=|:|-)?)\s*$/.exec(lead))) type = 'window';
    else if (dhore) type = 'window';
    else if ((lm = /(\b(?:in|within))\s*$/.exec(lead))) type = 'in';
    else if (pore) type = 'pore';
    else if ((lm = /(\bafter)\s*$/.exec(lead))) type = 'pore';
    else type = 'window'; // a bare duration ("10 minute") is the join window, as before
    if (lm) a -= lm[0].length;
    if (ofHosting && type === 'after') b += ofHosting[0].length;
    else if (pore) b += pore[0].length;
    else if (dhore) b += dhore[0].length;
    take(a, b);
    const item = { type, ms, phrase: quote(a, b), pos: a };
    if (kind === 'simple') {
      if (type === 'in' || type === 'pore') hosts.push({ ...item, type: 'in' });
      continue; // a number guess game has no join window
    }
    if (type === 'in') hosts.push(item);
    else if (type === 'pore') hosts.push({ ...item, type: 'pore' });
    else out.starts.push(item);
  }

  // host = the first host phrase. "start at 9" / "30 min pore" become the GAME START when another host is given.
  const real = hosts.filter((h) => h.type !== 'start_at' && h.type !== 'pore');
  const ordered = (real.length ? real : hosts).sort((x, y) => x.pos - y.pos);
  const host = ordered[0] || null;
  for (const h of hosts) {
    if (h === host) continue;
    if (kind === 'rumble' && h.type === 'start_at') out.starts.push({ ...h, type: 'at' });
    else if (kind === 'rumble' && h.type === 'pore') out.starts.push({ ...h, type: 'after' });
    else out.extraHosts.push(h.phrase);
  }
  if (host) out.host = host.type === 'start_at' ? { ...host, type: 'clock' } : host.type === 'host' ? { ...host, type: 'clock' } : host.type === 'pore' ? { ...host, type: 'in' } : host;

  // 5. min players and the prize ("prize 20 points", "NFT prize", "500 points")
  const masked = () => t.split('').map((c, i) => (isFree(i, i + 1) ? c : ',')).join('');
  if (kind === 'rumble') {
    const mp = /\bmin(?:imum)?\s*(\d{1,4})\s*(?:players?|jon|person|people)\b|\b(\d{1,4})\s*players?(?:\s*min(?:imum)?)?\b/.exec(masked());
    if (mp) {
      out.minPlayers = Number(mp[1] || mp[2]);
      take(mp.index, mp.index + mp[0].length);
    }
  }
  const pz = /\bprize\s*(?:is|=|:|-)?\s*([^,;\n]*)/.exec(masked()) || /((?:[^\s,;]+\s+){0,2}[^\s,;]+)\s+prize\b/.exec(masked());
  if (pz && pz[1].trim()) {
    out.prizeText = quote(pz.index + pz[0].indexOf(pz[1]), pz.index + pz[0].indexOf(pz[1]) + pz[1].length).replace(/^(?:of|is|=|:)\s*/i, '');
    take(pz.index, pz.index + pz[0].length);
  }
  const pts = /\b\d[\d,_]*\s*(?:points?|pts?)\b/.exec(masked());
  if (pts) {
    if (!out.prizeText) out.prizeText = quote(pts.index, pts.index + pts[0].length);
    take(pts.index, pts.index + pts[0].length);
  }

  // 6. anything left that carries a number or a time word was NOT understood: the caller asks about it
  out.leftovers = masked()
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s && looksTimeish(s))
    .map((s) => s.slice(0, 60));
  out.leftovers.push(...out.extraHosts);
  return out;
}

// a phrase with a number or a time word: never silently ignored
const TIMEISH = /\d|\b(?:am|pm|tonight|tomorrow|kal|raat|tay|hours?|ghonta|minutes?|mins?|secs?|seconds?|before|after|pore|closes?|window|remind\w*|play|start\s+at)\b/i;
const looksTimeish = (s) => TIMEISH.test(normalize(s));

// ---------------- instants ----------------
// every instant a clock can mean on the given days, sorted
function clockInstants(clock, from, days) {
  const day = localDay(from, clock.zone);
  const list = [];
  for (const plus of days) for (const h of clock.hours) {
    const extra = clock.nightRollover && h === 0 ? 1 : 0; // "raat 12" = midnight at the END of that day
    const d = wallAt(day, plus + extra, h, clock.min, clock.zone);
    if (d) list.push(d.getTime());
  }
  return [...new Set(list)].sort((a, b) => a - b);
}

// Host / game time from a clock, relative to now:
//   { at }                   upcoming (or within the last minute)
//   { recent: at }           already passed, by at most 30 minutes  -> "host it right now instead"
//   { old: at, tomorrow }    passed longer ago                       -> "did you mean tomorrow"
function resolveClockFromNow(clock, now = Date.now()) {
  const days = clock.day === null ? [-1, 0, 1] : [clock.day];
  const all = clockInstants(clock, now, days);
  const future = all.find((x) => x >= now - MIN);
  const recent = all.filter((x) => x < now - MIN && x >= now - 30 * MIN).pop();
  if (recent && (clock.day !== null || !future || future - now > 6 * 60 * MIN || clock.hours.length === 1)) return { recent: new Date(recent) };
  // a clock with an explicit day / am-pm that already passed today: offer the same time tomorrow
  const today = clockInstants(clock, now, [clock.day ?? 0]).filter((x) => x < now - MIN).pop();
  if (clock.hours.length === 1 && today && (clock.day !== null || !future || localDay(future).key !== localDay(now).key) && clock.day !== 1) {
    return { old: new Date(today), tomorrow: new Date(today + 24 * 60 * MIN) };
  }
  return future ? { at: new Date(future) } : null;
}

// A game-start clock: the first matching instant after the hosting time (same day or the next one)
function resolveClockAfter(clock, hostAt) {
  const days = clock.day === null ? [0, 1] : [clock.day];
  const all = clockInstants(clock, hostAt, days);
  const hit = all.find((x) => x > hostAt);
  return hit ? new Date(hit) : null;
}

// The boss's reply to "which start time": index of the option, or null when it is not a clear pick.
// "first", "1", "2nd", "the later one", "7.35", "8.35 pm", "yes the first one"
function pickOption(reply, options) {
  const t = normalize(reply).trim();
  // a time in the reply ("7.35", "8:35 pm") picks the option shown at that time on the boss's clock
  const host = readOrder(t, { kind: 'simple' }).host;
  if (host?.type === 'clock') {
    const { hours, min } = host.clock;
    const hits = options.map((o, i) => [i, localDay(o.at)]).filter(([, d]) => hours.includes(d.h) && d.min === min);
    if (hits.length === 1) return hits[0][0];
  }
  if (options.length >= 3 && /\b(3|3rd|third|three)\b/.test(t)) return 2;
  if (/\b(2|2nd|second|two|ditiyo|ditiyota|later|latter|last|porer\s*ta|porerta)\b/.test(t)) return 1;
  if (/\b(1|1st|first|prothom|prothomta|earlier|former|ager\s*ta|agerta)\b/.test(t) || /^\s*one\s*$/.test(t)) return 0;
  return null;
}

module.exports = { readOrder, parseDuration, parseDurationList, resolveClockFromNow, resolveClockAfter, normalize, looksTimeish, pickOption };
