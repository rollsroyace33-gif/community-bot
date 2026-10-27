const fs = require('fs');
const path = require('path');
const http = require('http');
const { Client, GatewayIntentBits, Partials, Collection, Events } = require('discord.js');
const config = require('./config');
const { startScheduler, stopScheduler } = require('./jobs/scheduler');
const { startTaskScheduler, stopTaskScheduler } = require('./tasks');

for (const key of ['token', 'clientId', 'guildId', 'supabaseUrl', 'supabaseKey']) {
  if (!config[key]) {
    console.error(`Missing config: ${key}. Please check your .env file.`);
    process.exit(1);
  }
}

// one line about BOSS_USER_ID (never its value) + a clear warning if it can't be right
require('./identity').checkBossConfig();

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

client.commands = new Collection();
const dir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(dir, file));
  client.commands.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startScheduler(client);
  startTaskScheduler(client); // control channel tasks (number guess game); warns if CONTROL_CHANNEL_ID is empty
  require('./tasks/rumbleRoyale').startupCheck(client); // one line about RUMBLE_CHANNEL_ID + permission warnings
  require('./bossPresence').load(); // the boss's last message time (welcome back survives restarts)
  // shop channel: one header (edited in place), old per-item cards removed (bot-posted only)
  if (config.channels.marketplace) {
    require('./marketplace')
      .syncShop(client)
      .catch((e) => console.error('Marketplace sync:', e.message));
  }
  // facts the boss taught in the control channel (cached; refreshed after every change)
  require('./knowledge')
    .loadFacts()
    .then((f) => console.log(`Loaded ${f.length} taught fact(s)`));
});
client.on(Events.MessageCreate, require('./events/messageCreate'));
client.on(Events.MessageReactionAdd, require('./events/reactionAdd'));
client.on(Events.InteractionCreate, require('./events/interactionCreate'));
client.on(Events.GuildMemberAdd, require('./events/guildMemberAdd'));

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

// tiny web server so Render (Web Service) sees an open port + uptime pings work.
// GET/HEAD /health (and /) -> 200 "ok", anything else -> 404. It never shows any bot info.
const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  const ok = (req.method === 'GET' || req.method === 'HEAD') && (url === '/health' || url === '/');
  res.writeHead(ok ? 200 : 404, { 'Content-Type': 'text/plain' });
  res.end(ok ? 'ok' : 'not found');
});
server.listen(process.env.PORT || 3000);

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

// exit on login failure, otherwise the web server keeps a dead bot alive holding the port
client.login(config.token).catch((e) => {
  console.error('Discord login failed:', e.message);
  if (/disallowed intents/i.test(e.message)) {
    console.error('Turn ON "Server Members Intent" and "Message Content Intent" in the Developer Portal (Bot page).');
  }
  process.exit(1);
});
