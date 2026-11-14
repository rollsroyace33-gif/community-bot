// When did the boss last write? Used for the welcome-back line and the offline cover.
//   lastMessageAt: any guild text channel EXCEPT the control channel (welcome back). Persisted in the
//                  existing bot_settings table (one key, a timestamp, nothing about members), so a
//                  restart can never cause a false welcome.
//   lastSeenAt:    any channel including the control channel ("is the boss around right now").
// The boss is recognized by the caller (user ID only). Every server has its own boss, so both
// timestamps are kept per server (guildId left out = HΛVØCZ).
const supabase = require('./db');
const clock = require('./clock');
const guilds = require('./guilds');

const KEY = 'boss_last_message_at';
const states = new Map(); // guildId -> { lastMessageAt (ms | null), lastSeenAt (ms | null) }

function stateOf(guildId) {
  const id = guilds.gid(guildId);
  if (!states.has(id)) states.set(id, { lastMessageAt: null, lastSeenAt: null });
  return states.get(id);
}

// read the saved timestamps once at startup; nothing saved / an error = unknown = no welcome
async function load() {
  try {
    const { data, error } = await supabase.from('bot_settings').select('guild_id,value').eq('key', KEY);
    if (error) throw new Error(error.message);
    // (a single row object is also accepted: older test doubles answer every query with one row)
    const list = Array.isArray(data) ? data : data ? [data] : [];
    for (const row of list) {
      const t = Number(row?.value);
      const st = stateOf(row?.guild_id);
      if (Number.isFinite(t) && t > 0) st.lastMessageAt = Math.max(st.lastMessageAt || 0, t);
    }
  } catch (err) {
    console.error('boss presence load:', err.message);
  }
}

function save(guildId, t) {
  Promise.resolve()
    .then(() =>
      supabase
        .from('bot_settings')
        .upsert({ guild_id: guilds.gid(guildId), key: KEY, value: String(t), updated_at: new Date(t).toISOString() }, { onConflict: 'guild_id,key' })
    )
    .then((res) => res?.error && console.error('boss presence save:', res.error.message))
    .catch((err) => console.error('boss presence save:', err.message));
}

// Call for EVERY boss message, before anything is sent. Returns the gap since his previous message
// (ms, outside the control channel) or null when unknown. Updated immediately, so the same return is
// never welcomed twice.
function note({ isControl = false, guildId } = {}) {
  const st = stateOf(guildId);
  const now = clock.now();
  st.lastSeenAt = now;
  if (isControl) return null;
  const prev = st.lastMessageAt;
  st.lastMessageAt = now;
  save(guildId, now);
  return prev === null ? null : now - prev;
}

// the boss wrote anything (any channel of that server) within the last N minutes
function recentlyActive(minutes, guildId) {
  const st = stateOf(guildId);
  return st.lastSeenAt !== null && clock.now() - st.lastSeenAt < minutes * 60 * 1000;
}

module.exports = {
  load,
  note,
  recentlyActive,
  _test: { reset: () => states.clear(), get: () => ({ ...stateOf() }) },
};
