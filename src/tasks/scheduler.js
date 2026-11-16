// Checks scheduled_tasks every 15 seconds and lets each task type act (announce, start, end...).
// Everything lives in the DB, so tasks survive a restart: the first tick after startup
// picks them up again (and reports anything that was missed while the bot was offline).
const config = require('../config');
const store = require('./store');
const registry = require('./registry');

const TICK_MS = 15 * 1000;

let client = null;
let timer = null;
let ticking = false;
let again = false;
let lastError = '';

async function tick() {
  if (!client) return;
  if (ticking) {
    again = true; // a tick is running: run once more right after it
    return;
  }
  ticking = true;
  try {
    const tasks = await store.listActive();
    lastError = '';
    for (const task of tasks) {
      const handler = registry.get(task.type);
      if (!handler) continue;
      try {
        await handler.tick(task, { client });
      } catch (err) {
        console.error(`task #${task.id} (${task.type}) tick:`, err.message);
      }
    }
  } catch (err) {
    // log a repeating error (e.g. table not created yet) only once
    if (err.message !== lastError) {
      lastError = err.message;
      console.error('task scheduler:', err.message, '(did you run supabase/schema.sql?)');
    }
  } finally {
    ticking = false;
    if (again) {
      again = false;
      setImmediate(tick);
    }
  }
}

// run a tick right away (e.g. after the boss confirms an order)
const tickSoon = () => setImmediate(tick);

function startTaskScheduler(discordClient) {
  // (the scheduler always runs now: other servers' games need it even if HΛVØCZ has no control channel)
  const home = require('../guilds').settings(require('../guilds').homeId()).channels; // HΛVØCZ: /setup first, then .env
  if (!home.control) {
    console.warn('⚠️  HΛVØCZ has no control channel (choose one in /setup or set CONTROL_CHANNEL_ID): no plain-language orders, no game reports there.');
  }
  if (!config.bossUserId && !config.staffRoleIds.length) {
    console.warn('⚠️  BOSS_USER_ID and STAFF_ROLE_IDS are both empty: nobody can give orders in the control channel.');
  }
  if (!home.general) console.warn('⚠️  HΛVØCZ has no number guess channel (choose one in /setup or set GENERAL_CHANNEL_ID): number guess games cannot be scheduled there.');
  client = discordClient;
  tick();
  timer = setInterval(tick, TICK_MS);
  console.log(`Task scheduler running (every ${TICK_MS / 1000}s), HΛVØCZ control channel ${home.control || '(none)'}`);
}

// graceful shutdown (SIGTERM): no new ticks. Tasks stay as they are in the DB, so the first
// tick after the restart handles them with the usual restart-safe rules (no late winners/payouts).
function stopTaskScheduler() {
  clearInterval(timer);
  timer = null;
  client = null; // a tick that was already queued returns right away
}

module.exports = { startTaskScheduler, stopTaskScheduler, tickSoon };
