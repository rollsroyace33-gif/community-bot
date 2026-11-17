// Trial / paid period reminders for every server except HΛVØCZ. Checked once an hour.
//   3 days before the trial or paid period ends -> one notice in that server's control channel
//   when it has ended                            -> one notice; premium features are locked from then on
//                                                   (plans.js decides that from the dates), free ones keep working
// Each notice is sent once: it is remembered in the server's settings, keyed by the end date, so a new
// period (after /admin activate or extendtrial) gets its own notices.
const config = require('../config');
const guilds = require('../guilds');
const plans = require('../plans');
const { getTextChannel } = require('../utils');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let timer = null;

const contact = () => (config.supportContact ? `\n${config.supportContact}` : '');

async function notify(client, guildId, key, content) {
  const s = guilds.settings(guildId);
  const ch = (await getTextChannel(client, s.channels.control)) || (await getTextChannel(client, s.channels.logs));
  if (!ch) return false;
  await ch.send({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
  const sent = guilds.get(guildId)?.settings?.notices || {};
  // keep only the last few keys so the settings stay small
  const next = Object.fromEntries([...Object.entries(sent).slice(-6), [key, new Date().toISOString()]]);
  await guilds.patchSettings(guildId, { notices: next });
  return true;
}

async function checkGuild(client, row, now = Date.now()) {
  const id = String(row.guild_id);
  if (guilds.isHome(id) || row.status === 'left') return;
  const sent = row.settings?.notices || {};
  const p = plans.plan(id, now);
  if (p.premium) {
    const end = p.endsAt.getTime();
    const key = `soon:${p.endsAt.toISOString()}`;
    if (end - now <= 3 * DAY && !sent[key]) {
      const what = p.kind === 'trial' ? 'free trial' : 'premium period';
      await notify(client, id, key, `⏳ Heads up, boss: this server's **${what}** ends <t:${Math.floor(end / 1000)}:R> (<t:${Math.floor(end / 1000)}:f>). After that the premium features lock (AI chat, knowledge Q&A, auto mod, points, marketplace) and the free games keep working.${contact()}`);
    }
    return;
  }
  // not premium: say it once for the period that just ended
  const ends = [row.paid_until, row.trial_ends_at].map((v) => (v ? Date.parse(v) : NaN)).filter((t) => t <= now);
  if (!ends.length) return;
  const last = Math.max(...ends);
  if (now - last > 7 * DAY) return; // ended long ago (e.g. the bot was away): no late notice
  const key = `ended:${new Date(last).toISOString()}`;
  if (sent[key]) return;
  const what = row.paid_until && Date.parse(row.paid_until) === last ? 'premium period' : 'free trial';
  await notify(client, id, key, `🔒 This server's **${what}** has ended. Premium features are now locked (AI chat, knowledge Q&A, auto mod, points, marketplace). Rumble Royale (/rumble) and the Number Guess Game (/guess) keep working for free. Nothing was deleted: everything comes back when premium is active again.${contact()}`);
}

async function checkAll(client) {
  for (const row of guilds.all()) {
    try {
      await checkGuild(client, row);
    } catch (err) {
      console.error(`expiry check (guild ${row.guild_id}):`, err.message);
    }
  }
}

function start(client) {
  stop();
  checkAll(client);
  timer = setInterval(() => checkAll(client), HOUR);
  timer.unref?.();
}
function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, checkAll, checkGuild };
