const fs = require('fs');
const path = require('path');
const http = require('http');

const step = (msg) => console.log(`[startup] step: ${msg}`);
const STEP_TIMEOUT_MS = 15000;

// Promise.race with a timeout: logs which step timed out instead of hanging silently.
// Resolves to `fallback` on timeout or error (never throws), so callers can just continue.
function withTimeout(label, promiseOrFn, fallback = undefined, ms = STEP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.error(`[startup] TIMEOUT: "${label}" did not finish within ${ms / 1000}s, continuing without it`);
      resolve(fallback);
    }, ms);
  });
  const work = Promise.resolve()
    .then(() => (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn))
    .catch((err) => {
      console.error(`[startup] FAILED: "${label}":`, err && err.stack ? err.stack : err);
      return fallback;
    });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// process-level safety nets first, so nothing below can fail silently
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.stack ? e.stack : e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.stack ? e.stack : e));

step('loading discord.js...');
const { Client, GatewayIntentBits, Partials, Collection, Events } = require('discord.js');
step('discord.js loaded');

step('loading config (.env / environment)...');
const config = require('./config');
step('config loaded');

step('loading schedulers...');
const { startScheduler, stopScheduler } = require('./jobs/scheduler');
const { startTaskScheduler, stopTaskScheduler } = require('./tasks');
step('schedulers loaded');

step('checking required env vars...');
for (const key of ['token', 'clientId', 'guildId', 'supabaseUrl', 'supabaseKey']) {
  if (!config[key]) {
    console.error(`Missing config: ${key}. Please check your .env file.`);
    process.exit(1);
  }
}
step(`env vars ok (DISCORD_TOKEN length ${config.token.length})`);

// one line about BOSS_USER_ID (never its value) + a clear warning if it can't be right
require('./identity').checkBossConfig();

step('creating Discord client...');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent, // enable "Message Content Intent" in Developer Portal
    GatewayIntentBits.GuildMembers, // enable "Server Members Intent" in Developer Portal (welcomes)
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});
step('Discord client created');

step('loading slash command modules...');
client.commands = new Collection();
const dir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(dir, file));
  client.commands.set(cmd.data.name, cmd);
}
step(`${client.commands.size} slash command module(s) loaded (registered with Discord after login)`);

// ---------------- Discord diagnostics ----------------
let ready = false;
client.on(Events.Error, (e) => console.error('[discord] client error:', e && e.stack ? e.stack : e));
client.on(Events.Warn, (m) => console.error('[discord] warn:', m));
client.on(Events.ShardError, (e, id) => console.error(`[discord] shard ${id} error:`, e && e.stack ? e.stack : e));
client.on(Events.ShardDisconnect, (ev, id) => console.error(`[discord] shard ${id} disconnected: code ${ev?.code} ${ev?.reason || ''}`));
client.on(Events.ShardReconnecting, (id) => console.error(`[discord] shard ${id} reconnecting...`));
client.on(Events.ShardResume, (id, n) => console.log(`[discord] shard ${id} resumed (${n} events replayed)`));
client.on(Events.Invalidated, () => console.error('[discord] session invalidated'));
client.rest.on('rateLimited', (info) =>
  console.error(
    `[discord] REST rate limited: ${info.method} ${info.route} retry in ${info.timeToReset ?? info.retryAfter}ms (global: ${info.global}, limit: ${info.limit})`
  )
);
// Gateway/REST debug lines until 'ready' (they show exactly where login stops). Token is never in them.
client.on(Events.Debug, (m) => {
  if (!ready && !/heartbeat/i.test(m)) console.log('[discord debug]', m);
});

// ---------------- ready: everything that talks to the network runs AFTER login ----------------
client.once(Events.ClientReady, async (c) => {
  ready = true;
  console.log(`[startup] step: READY, logged in as ${c.user.tag} (${c.user.id}), in ${c.guilds.cache.size} guild(s)`);

  // ---- multi-server: load every server's row BEFORE anything reads settings (HΛVØCZ works from .env
  // even if this fails), make sure every server the bot is in has a row, import knowledge.md once
  const guilds = require('./guilds');
  const loaded = await withTimeout('guilds load (Supabase)', () => guilds.load(), null);
  step(loaded === null ? 'guilds NOT loaded (see error above): only the home server will work' : `guilds loaded: ${loaded} server row(s)`);
  if (loaded !== null) {
    for (const guild of c.guilds.cache.values()) {
      try {
        const known = !!guilds.get(guild.id);
        const { created } = await guilds.join(guild);
        // a server that added the bot while it was offline: run its automatic setup now
        if (!known && created && !guilds.isHome(guild.id)) await require('./setup').run(guild, { welcome: true });
      } catch (e) {
        console.error(`[startup] guild ${guild.id} row:`, e.message);
      }
    }
    // servers that already had Vexo get channels that were added to the automatic setup since (once, never HΛVØCZ)
    const up = await withTimeout('setup upgrade', () => require('./setup').upgradeExisting(c), null, 60000);
    if (up && (up.upgraded.length || up.failed.length)) step(`setup upgrade: ${up.upgraded.length} server(s) updated, ${up.failed.length} failed`);
    const imported = await withTimeout('knowledge import', () => require('./ai').importHomeKnowledge(), 'skipped');
    step(`home knowledge: ${imported === 'imported' ? 'knowledge.md imported into the database' : imported === 'already' ? 'already in the database' : 'using knowledge.md (not imported)'}`);
  }
  // slash commands: registered by the bot itself on every start, in two separate steps (global for all
  // servers, then the home-only /admin). A home server the bot is not in never blocks the global commands.
  withTimeout('slash command registration', () => require('./deploy-commands').registerCommands(c), null, 30000).then((r) => {
    if (r) require('./deploy-commands').logResult(r);
    else step('slash commands NOT registered (timed out); run "npm run deploy" to retry');
  });
  try {
    require('./jobs/expiry').start(client); // trial / paid period reminders (hourly)
    step('expiry reminders started');
  } catch (e) {
    console.error('[startup] expiry reminders failed:', e.stack);
  }

  // none of these can block or crash the bot; each logs its own start/end/timeout
  try {
    step('starting daily scheduler...');
    startScheduler(client);
    step('daily scheduler started');
  } catch (e) {
    console.error('[startup] daily scheduler failed:', e.stack);
  }
  try {
    step('starting task scheduler...');
    startTaskScheduler(client); // control channel tasks (number guess game); warns if CONTROL_CHANNEL_ID is empty
    step('task scheduler started');
  } catch (e) {
    console.error('[startup] task scheduler failed:', e.stack);
  }
  try {
    require('./xDrop').startupCheck(); // one warning when X_DROP_CHANNEL_ID is empty (feature off)
  } catch (e) {
    console.error('[startup] xDrop check failed:', e.stack);
  }

  // network steps run in parallel, each with a 15s timeout
  const jobs = [
    (async () => {
      step('rumble startup check...');
      await withTimeout('rumble startup check', () => require('./tasks/rumbleRoyale').startupCheck(client));
      step('rumble startup check done');
    })(),
    (async () => {
      step('loading boss presence (Supabase)...');
      await withTimeout('boss presence load (Supabase)', () => require('./bossPresence').load());
      step('boss presence loaded');
    })(),
    (async () => {
      // giveaways live in the database: start the end-time timer and end any that expired while offline
      step('starting giveaway timer...');
      await withTimeout('giveaway timer', () => require('./giveaway').startTimer(client), undefined, 60000);
      step('giveaway timer started');
    })(),
    (async () => {
      // SOL Radar: off by itself (with one clear warning) when COINGECKO_API_KEY is empty; never blocks startup
      try {
        const on = require('./solRadar').startTimer(client);
        step(on ? 'SOL Radar timer started' : 'SOL Radar is off (no market data key)');
      } catch (e) {
        console.error('[startup] SOL Radar failed to start:', e.stack);
      }
    })(),
    (async () => {
      // NFT Radar: off by itself (one clear warning) when TAVILY_API_KEY is empty; never blocks startup
      try {
        const on = require('./nftRadar').startTimer(client);
        step(on ? 'NFT Radar timer started' : 'NFT Radar is off (no TAVILY_API_KEY)');
      } catch (e) {
        console.error('[startup] NFT Radar failed to start:', e.stack);
      }
    })(),
    (async () => {
      step('loading knowledge (Supabase)...');
      const f = await withTimeout('knowledge load (Supabase)', () => require('./knowledge').loadFacts(), null);
      step(f ? `knowledge loaded: ${f.length} taught fact(s)` : 'knowledge NOT loaded (see error above)');
    })(),
  ];
  // shop channel: one header (edited in place), old per-item cards removed (bot-posted only)
  if (config.channels.marketplace) {
    jobs.push(
      (async () => {
        step('syncing marketplace...');
        await withTimeout('marketplace sync', () => require('./marketplace').syncShop(client), undefined, 60000);
        step('marketplace sync done');
      })()
    );
  }
  await Promise.allSettled(jobs);
  step('all post-login startup steps finished');
});

step('registering event handlers...');
client.on(Events.MessageCreate, require('./events/messageCreate'));
client.on(Events.MessageReactionAdd, require('./events/reactionAdd'));
client.on(Events.InteractionCreate, require('./events/interactionCreate'));
client.on(Events.GuildMemberAdd, require('./events/guildMemberAdd'));
client.on(Events.GuildCreate, require('./events/guildCreate')); // added to a server: row + trial + automatic setup
client.on(Events.GuildDelete, require('./events/guildDelete')); // removed: the row is kept, only marked
client.on(Events.ChannelDelete, (channel) => require('./setup').onChannelDelete(channel)); // a configured channel was deleted
step('event handlers registered');

// tiny web server so Render (Web Service) sees an open port + uptime pings work.
// GET/HEAD /health (and /) -> 200 "ok", anything else -> 404. It never shows any bot info.
step('starting HTTP /health server...');
const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  const ok = (req.method === 'GET' || req.method === 'HEAD') && (url === '/health' || url === '/');
  res.writeHead(ok ? 200 : 404, { 'Content-Type': 'text/plain' });
  res.end(ok ? 'ok' : 'not found');
});
server.on('error', (e) => console.error('[startup] HTTP server error:', e.stack));
server.listen(process.env.PORT || 3000, () => step(`HTTP /health server listening on port ${process.env.PORT || 3000}`));

// graceful shutdown: Render sends SIGTERM on every redeploy/restart.
// Only stops timers and disconnects; running games are NOT ended here. Their state stays in
// Supabase, and the restart-safe startup logic handles them (no late winner, no payout).
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);
  setTimeout(() => process.exit(0), 10000).unref(); // never hang past Render's grace period
  stopTaskScheduler();
  stopScheduler();
  require('./jobs/expiry').stop();
  require('./giveaway').stopTimer(); // running giveaways stay in the database and continue after the restart
  require('./solRadar').stopTimer(); // posted updates are remembered in the database: nothing is posted twice
  require('./nftRadar').stopTimer(); // runs and approval requests are in the database: nothing is repeated
  server.close();
  try {
    await client.destroy();
  } catch (e) {
    console.error('Discord disconnect:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl+C locally

// Diagnostic only (does NOT block login): asks Discord directly whether this server's IP may log in.
// A 429 here (often an HTML Cloudflare page "error code: 1015") means Discord is rate-limiting / banning
// the shared outbound IP of this host. discord.js then waits silently, which looks like "no logs at all".
async function probeGateway() {
  step('probing Discord API (GET /gateway/bot)...');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), STEP_TIMEOUT_MS);
  try {
    const res = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers: { Authorization: `Bot ${config.token}` },
      signal: ctrl.signal,
    });
    const text = await res.text();
    const body = text.slice(0, 300).replace(/\s+/g, ' ');
    if (res.ok) {
      let j = {};
      try {
        j = JSON.parse(text);
      } catch {}
      const s = j.session_start_limit;
      step(`Discord API reachable: HTTP 200${s ? `, session starts left today: ${s.remaining}/${s.total}` : ''}`);
      if (s && s.remaining === 0) console.error(`[startup] NO session starts left! Resets in ${Math.round(s.reset_after / 60000)} min.`);
    } else {
      console.error(
        `[startup] Discord API probe: HTTP ${res.status} retry-after=${res.headers.get('retry-after')} global=${res.headers.get('x-ratelimit-global')} scope=${res.headers.get('x-ratelimit-scope')} body: ${body}`
      );
      if (res.status === 401) console.error('[startup] 401 = DISCORD_TOKEN is invalid (reset it in the Developer Portal and update Render).');
      if (res.status === 429) console.error('[startup] 429 = this host IP is rate-limited/banned by Discord. Login will wait until it clears. Fix: Render "Clear build cache & deploy" / restart to get a new IP, or move hosts.');
    }
  } catch (e) {
    console.error(`[startup] Discord API probe failed: ${e.name === 'AbortError' ? 'TIMEOUT after 15s (network to discord.com blocked?)' : e.message}`);
  } finally {
    clearTimeout(t);
  }
}

// ---------------- login: nothing above awaits the network, so nothing can block this ----------------
async function login() {
  const probe = probeGateway(); // runs in parallel, never blocks login

  const pending = setTimeout(() => {
    if (!ready) console.error('[startup] login still pending after 30s ("ready" has not fired). See [discord debug] / probe lines above.');
  }, 30000);
  const pending2 = setInterval(() => {
    if (ready) return clearInterval(pending2);
    console.error('[startup] still not ready, waiting on Discord...');
  }, 60000);

  try {
    step('logging in to Discord...');
    await client.login(config.token);
    step('login resolved (waiting for "ready" event)');
  } catch (err) {
    clearTimeout(pending);
    clearInterval(pending2);
    // exit on login failure, otherwise the web server keeps a dead bot alive holding the port
    console.error('Discord login failed:', err.stack);
    if (/disallowed intents/i.test(err.message)) {
      console.error('Turn ON "Server Members Intent" and "Message Content Intent" in the Developer Portal (Bot page).');
    }
    await probe; // let the API probe print its result first (it has its own 15s timeout)
    process.exit(1);
  }
}
login();
