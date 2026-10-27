// Time helpers for tasks.
//  - The boss writes times in his own zone (BOSS_TIMEZONE). It is used ONLY to read his orders.
//  - Everything is stored in UTC (Supabase timestamptz).
//  - Everything shown to people is UTC, 24h: "14:30 UTC (in 12 minutes)". The local zone name is never shown.
const config = require('../config');

// Validate BOSS_TIMEZONE once; a typo falls back to the default instead of crashing
const BOSS_TZ = (() => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.bossTimezone });
    return config.bossTimezone;
  } catch {
    console.warn('BOSS_TIMEZONE is not a valid IANA time zone, using the default instead.');
    return 'Asia/Dhaka';
  }
})();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "in 12 minutes", "in 3 hours 20 min", "in 2 days", "5 minutes ago", "now"
function fromNow(date) {
  const mins = Math.round((new Date(date).getTime() - Date.now()) / 60000);
  const abs = Math.abs(mins);
  if (abs < 1) return 'now';
  let s;
  if (abs < 60) s = `${abs} minute${abs === 1 ? '' : 's'}`;
  else if (abs < 48 * 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    s = `${h} hour${h === 1 ? '' : 's'}${m && h < 6 ? ` ${m} min` : ''}`;
  } else s = `${Math.round(abs / 1440)} days`;
  return mins > 0 ? `in ${s}` : `${s} ago`;
}

// "14:30 UTC (in 12 minutes)"; another UTC day adds the date: "29 Oct, 14:30 UTC (in 2 days)"
function fmtUtc(date, { relative = true } = {}) {
  const d = new Date(date);
  const iso = d.toISOString();
  const sameDay = iso.slice(0, 10) === new Date().toISOString().slice(0, 10);
  const day = sameDay ? '' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, `;
  return `${day}${iso.slice(11, 16)} UTC${relative ? ` (${fromNow(d)})` : ''}`;
}

// Offset of `zone` at `date` in ms. zone: IANA name, "UTC"/"GMT", or "+05:30" / "UTC-4"
function zoneOffsetMs(zone, date) {
  if (/^(utc|gmt|z)$/i.test(zone)) return 0;
  const fixed = /^(?:utc|gmt)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(zone);
  if (fixed) return (fixed[1] === '-' ? -1 : 1) * (Number(fixed[2]) * 60 + Number(fixed[3] || 0)) * 60000;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Wall-clock "YYYY-MM-DDTHH:mm" in `zone` -> UTC Date (DST-safe). null if invalid.
function wallToUtc(wall, zone = BOSS_TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(wall || ''));
  if (!m) return null;
  try {
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    let ts = guess - zoneOffsetMs(zone, new Date(guess));
    ts = guess - zoneOffsetMs(zone, new Date(ts)); // second pass fixes daylight-saving edges
    return Number.isNaN(ts) ? null : new Date(ts);
  } catch {
    return null; // unknown zone name
  }
}

// Boss's wall clock for a date, for the AI prompt only: "2026-10-27 23:00 (Tuesday)"
function bossLocal(date) {
  const d = new Date(date);
  const local = new Date(d.getTime() + zoneOffsetMs(BOSS_TZ, d));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: BOSS_TZ, weekday: 'long' }).format(d);
  return `${local.toISOString().slice(0, 16).replace('T', ' ')} (${weekday})`;
}

// "2026-10-27 15:15 (Tuesday)" in UTC, for the AI prompt
function utcStamp(date) {
  const d = new Date(date);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(d);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} (${weekday})`;
}

// Time object from the AI -> UTC Date, or null.
//   {"in_minutes": 20}                       relative ("now" = 0)
//   {"local": "2026-10-27T23:00"}            boss's local wall clock
//   {"local": "...", "zone": "UTC"}          the boss named a zone explicitly
function resolveTime(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.in_minutes !== undefined && t.in_minutes !== null && Number.isFinite(Number(t.in_minutes))) {
    return new Date(Date.now() + Number(t.in_minutes) * 60000);
  }
  if (t.local) return wallToUtc(t.local, t.zone ? String(t.zone).trim() : BOSS_TZ);
  return null;
}

// Strip the boss's zone name / city from any text shown to people (belt and braces)
function hideLocalZone(text) {
  const parts = [BOSS_TZ, BOSS_TZ.split('/').pop().replace(/_/g, ' ')];
  return parts.reduce((s, p) => s.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ''), text);
}

// "06:00" -> 360 minutes after midnight; null if not a valid 24-hour HH:MM
function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Is "now" inside the boss's usual offline window (BOSS_OFFLINE_START..BOSS_OFFLINE_END on his own clock,
// BOSS_TIMEZONE)? Deterministic. Windows may cross midnight (22:00-04:00). start == end (or an invalid
// value) means the window is OFF: never offline. The hours are never shown to anyone.
function isBossOffline(now = Date.now(), { start = config.bossOfflineStart, end = config.bossOfflineEnd, zone = BOSS_TZ } = {}) {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === null || e === null || s === e) return false;
  const d = new Date(now);
  const local = new Date(d.getTime() + zoneOffsetMs(zone, d));
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  return s < e ? m >= s && m < e : m >= s || m < e;
}

module.exports = { fmtUtc, fromNow, bossLocal, utcStamp, resolveTime, hideLocalZone, isBossOffline, parseHHMM };
