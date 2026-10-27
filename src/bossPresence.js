// When did the boss last write? Used for the welcome-back line and the offline cover.
//   lastMessageAt: any guild text channel EXCEPT the control channel (welcome back). Persisted in the
//                  existing bot_settings table (one key, a timestamp, nothing about members), so a
//                  restart can never cause a false welcome.
//   lastSeenAt:    any channel including the control channel ("is the boss around right now").
// The boss is recognized by the caller (BOSS_USER_ID only).
const supabase = require('./db');
const clock = require('./clock');

const KEY = 'boss_last_message_at';
let lastMessageAt = null; // ms
let lastSeenAt = null; // ms

// read the saved timestamp once at startup; nothing saved / an error = unknown = no welcome
async function load() {
  try {
    const { data, error } = await supabase.from('bot_settings').select('value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message);
    const t = Number(data?.value);
    if (Number.isFinite(t) && t > 0) lastMessageAt = Math.max(lastMessageAt || 0, t);
  } catch (err) {
    console.error('boss presence load:', err.message);
  }
}

function save(t) {
  Promise.resolve()
    .then(() => supabase.from('bot_settings').upsert({ key: KEY, value: String(t), updated_at: new Date(t).toISOString() }))
    .then((res) => res?.error && console.error('boss presence save:', res.error.message))
    .catch((err) => console.error('boss presence save:', err.message));
}

// Call for EVERY boss message, before anything is sent. Returns the gap since his previous message
// (ms, outside the control channel) or null when unknown. Updated immediately, so the same return is
// never welcomed twice.
function note({ isControl = false } = {}) {
  const now = clock.now();
  lastSeenAt = now;
  if (isControl) return null;
  const prev = lastMessageAt;
  lastMessageAt = now;
  save(now);
  return prev === null ? null : now - prev;
}

// the boss wrote anything (any channel) within the last N minutes
const recentlyActive = (minutes) => lastSeenAt !== null && clock.now() - lastSeenAt < minutes * 60 * 1000;

module.exports = {
  load,
  note,
  recentlyActive,
  _test: { reset: () => ((lastMessageAt = null), (lastSeenAt = null)), get: () => ({ lastMessageAt, lastSeenAt }) },
};
