// Registers the slash commands with Discord, in TWO separate steps:
//   1. GLOBAL: every command that is not homeOnly (it appears in every server the bot is in), server-only (no DMs).
//      This is what customer servers use (/setup, /status, /help, /nftradar, /solradar, /giveaway, /automod, ...).
//   2. HOME: commands marked homeOnly (the owner's /admin), ONLY in the home server (HΛVØCZ, HOME_GUILD_ID / GUILD_ID).
//      This also replaces the old "HΛVØCZ only" copies of the commands, so nothing shows up twice there.
// A failure in one step never stops the other. If the bot is not in the home server (for example a test bot),
// step 2 is skipped with one short line.
// The bot runs this by itself on every start (index.js). You can also run it by hand:  npm run deploy
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const config = require('./config');

function loadCommands() {
  const dir = path.join(__dirname, 'commands');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => require(path.join(dir, f)));
}

const json = (c) => ({ ...c.data.toJSON(), contexts: [0], integration_types: [0] }); // 0 = inside servers only
function bodies() {
  const all = loadCommands();
  return { globalBody: all.filter((c) => !c.homeOnly).map(json), homeBody: all.filter((c) => c.homeOnly).map(json) };
}

// Discord's answer when the bot is not in that server (or cannot see it)
const NOT_REACHABLE = new Set([50001, 10004]); // Missing Access, Unknown Guild
const shortError = (err) => String(err?.rawError?.message || err?.message || err).split('\n')[0].slice(0, 200);

// client (optional): the logged-in bot, used to see whether it is in the home server before trying.
// Returns { global: { ok, count, error? }, home: { ok, count, skipped?, error? } }. Never throws.
async function registerCommands(client = null, { rest: restOverride = null } = {}) {
  const { globalBody, homeBody } = bodies();
  const rest = restOverride || new REST({ version: '10' }).setToken(config.token);
  const out = { global: { ok: false, count: globalBody.length }, home: { ok: false, count: homeBody.length } };

  // step 1: global commands (customer servers)
  try {
    await rest.put(Routes.applicationCommands(config.clientId), { body: globalBody });
    out.global.ok = true;
  } catch (err) {
    out.global.error = shortError(err);
  }

  // step 2: home-only commands (/admin), only if the bot is in the home server
  const homeId = String(config.homeGuildId || '').trim();
  if (!homeId) {
    out.home.skipped = 'no HOME_GUILD_ID / GUILD_ID set';
  } else if (client?.guilds?.cache && client.isReady?.() && !client.guilds.cache.has(homeId)) {
    out.home.skipped = 'not a member';
  } else {
    try {
      await rest.put(Routes.applicationGuildCommands(config.clientId, homeId), { body: homeBody });
      out.home.ok = true;
    } catch (err) {
      if (NOT_REACHABLE.has(err?.code) || /Missing Access|Unknown Guild/i.test(String(err?.message))) out.home.skipped = 'not reachable';
      else out.home.error = shortError(err);
    }
  }
  return out;
}

// one log line per step
function logResult(r, log = console.log, logError = console.error) {
  if (r.global.ok) log(`[commands] global: registered ${r.global.count} command(s) for all servers`);
  else logError(`[commands] global: FAILED to register ${r.global.count} command(s): ${r.global.error} (run "npm run deploy" to retry)`);
  if (r.home.ok) log(`[commands] home guild: registered ${r.home.count} command(s) (/admin)`);
  else if (r.home.skipped) log('[commands] home guild not reachable, skipped /admin commands');
  else logError(`[commands] home guild: FAILED to register ${r.home.count} command(s): ${r.home.error}`);
}

module.exports = { registerCommands, logResult, bodies };

// run directly: node src/deploy-commands.js  (npm run deploy)
if (require.main === module) {
  registerCommands().then((r) => {
    logResult(r);
    if (!r.global.ok) process.exitCode = 1;
  });
}
