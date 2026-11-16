// Time helpers for tasks.
//  - The boss writes times in his own zone (BOSS_TIMEZONE). It is used ONLY to read his orders.
//  - Everything is stored in UTC (Supabase timestamptz).
//  - Everything shown to people is a Discord timestamp ("<t:UNIX:t> (<t:UNIX:R>)"): every viewer sees it in
//    their own local time. No zone name, "UTC", "GMT" or offset is ever written in a message.
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

// ---------------- shown to people: Discord timestamps only ----------------
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
// <t:UNIX:t> = "4:35 PM" in each viewer's own zone; <t:UNIX:R> = "in 5 minutes"
const ts = (d, f) => `<t:${unix(d)}:${f}>`;

// "<t:..:t> (<t:..:R>)"; another day on the boss's clock shows the date too ("<t:..:f>")
function when(date) {
  const d = new Date(date);
  const sameDay = localDay(d.getTime()).key === localDay(Date.now()).key;
  return `${ts(d, sameDay ? 't' : 'f')} (${ts(d, 'R')})`;
}

// minutes -> "30 min", "1 hour", "4 hours", "1 hour 30 min", "24 hours"
function fmtDuration(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} min` : ''}`;
}
// seconds -> "10 s", "2 min", "1 min 30 s" (ping lists)
function fmtSeconds(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s < 60) return `${s} s`;
  if (s % 60 === 0) return fmtDuration(s / 60);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
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

// The boss's calendar day for an instant: { y, m, d, h, min, key: "2026-10-28" }
function localDay(ms, zone = BOSS_TZ) {
  const local = new Date(ms + zoneOffsetMs(zone, new Date(ms)));
  return {
    y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(),
    h: local.getUTCHours(), min: local.getUTCMinutes(), key: local.toISOString().slice(0, 10),
  };
}

// The boss's wall clock (day + n days, hh:mm) -> UTC Date. zone: BOSS_TIMEZONE unless he named one.
function wallAt(day, plusDays, h, min, zone = BOSS_TZ) {
  const base = new Date(Date.UTC(day.y, day.m - 1, day.d + plusDays));
  const p2 = (n) => String(n).padStart(2, '0');
  return wallToUtc(`${base.toISOString().slice(0, 10)}T${p2(h)}:${p2(min)}`, zone);
}

// "YYYY-MM-DDTHH:mm" on the boss's clock, for drafts the AI may copy later
function bossWall(date) {
  const d = localDay(new Date(date).getTime());
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.key}T${p2(d.h)}:${p2(d.min)}`;
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

// Strip the boss's zone name / city and any "UTC" / "GMT" / "GMT+6" from text shown to people (belt and
// braces: the code itself only writes Discord timestamps)
function hideLocalZone(text) {
  const parts = [BOSS_TZ, BOSS_TZ.split('/').pop().replace(/_/g, ' ')];
  return parts
    .reduce((s, p) => s.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ''), text)
    .replace(/\s?\(?\b(?:UTC|GMT)(?:\s?[+-]\d{1,2}(?::?\d{2})?)?\b\)?/g, '');
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

module.exports = {
  ts, unix, when, fmtDuration, fmtSeconds, bossLocal, bossWall, localDay, wallAt, wallToUtc, resolveTime,
  hideLocalZone, isBossOffline, parseHHMM, BOSS_TZ,
};
