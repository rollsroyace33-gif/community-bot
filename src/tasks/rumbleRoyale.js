// Rumble Royale task: Vexo hosts a battle-royale style elimination game in RUMBLE_CHANNEL_ID.
//
// Two ways to start it, ONE engine:
//   A) a control channel order ("aj 9 tay rumble royale chalao, 10 minute, prize 100 points"), via planOrder()
//   B) the /rumble slash command (preview + Confirm button), via handleSlash() / handleButton()
// Both build params with buildRumbleParams() and create the task with createRumble().
//
// ZERO AI during the game: every line comes from rumbleTemplates.js, picked with a shuffle bag.
// This file never requires ai.js. Who gets eliminated and who wins is decided only by crypto.randomInt.
//
// Timeline (task statuses: pending -> announced -> running -> done/cancelled):
//   T - RUMBLE_PRE_ANNOUNCE_MINUTES  heads-up ping (skipped if the start was sooner than that)
//   T                                join message + Join button (state.phase = "join")
//   T + join_minutes                 button disabled; too few players = cancel, else rounds (phase "rounds")
//   every RUMBLE_ROUND_SECONDS (>=3) one embed card per round, sent one at a time; some rounds revive a player
//   2 players left                   "3… 2… 1…" message, ~4 s, FINAL DUEL card
//   1 player left                    payout, winner card, runners-up card, congratulation message (~2 s apart)
//   RUMBLE_MAX_MINUTES after the rounds start: safety timeout, ends with no winner
//
// Restart safety: the task row holds everything (players are saved every ~10s and after each round).
//   restart in the join window -> players restored, countdown continues
//   restart mid-rounds          -> ended safely, no winner and no payout (unless the winner was already recorded)
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, escapeMarkdown } = require('discord.js');
const config = require('../config');
const store = require('./store');
const { report } = require('./report');
const { fmtUtc } = require('./time');
const identity = require('../identity');
const supabase = require('../db');
const points = require('../points');
const T = require('./rumbleTemplates');
const { getTextChannel } = require('../utils');

const type = 'rumble_royale';
const label = 'Rumble Royale';

const MIN = 60 * 1000;
const MISSED_GRACE_MS = 2 * MIN; // bot was offline at start time by more than this = skip + report
const PULSE_MS = 2000; // join window heartbeat (close, reminders, count edit, save)
const COUNT_EDIT_MS = 20 * 1000; // live player count on the Join button: at most one edit per 20 s
const SAVE_MS = 10 * 1000; // persist the player list at most every 10 s
const CHAT_CHANCE = 0.2; // answer ~1 in 5 chat messages in the game channel
const CHAT_GAP_MS = 20 * 1000;
const PREVIEW_TTL_MS = 2 * MIN; // /rumble start preview buttons expire

const R = () => config.rumble; // read live, so tests can change settings

const games = new Map(); // channelId -> live game (one game per channel)
const gameByTask = (id) => [...games.values()].find((g) => g.taskId === id) || null;
let lastEnded = null; // for tests

// ---------------------------------------------------------------- small helpers
const randomInt = (n) => crypto.randomInt(n); // 0..n-1, crypto-secure
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
const ts = (d, f) => `<t:${unix(d)}:${f}>`; // Discord timestamp, shown in each viewer's own time zone
const fill = (line, vars) => line.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, ...extra });

// display name, safe in a message: no markdown, no pings, short
function safeName(name) {
  const s = escapeMarkdown(String(name || '').replace(/\s+/g, ' ').trim()).replace(/@/g, '@​').slice(0, 32);
  return s || 'Mystery fighter';
}
const nm = (p) => `**${safeName(p.name)}**`;

// RUMBLE_CHANNEL_ID, or '' when empty / not a Discord ID. Never falls back to another channel.
const rumbleChannelId = () => (/^\d{17,20}$/.test(R().channelId) ? R().channelId : '');
const MISSING_CHANNEL =
  "⚠️ RUMBLE_CHANNEL_ID is missing (or not a valid channel ID) in .env, so I can't host a Rumble. " +
  'Paste the Rumble channel ID there and restart me. I never use another channel instead.';

// Shuffle bag: every line of a list is used once before any line comes back (per game).
// Lines drawn outside a game (heads-up, denials) use a module-wide bag.
const globalBags = { bags: new Map(), drawn: [] };
function draw(game, name) {
  const holder = game || globalBags;
  const list = T[name];
  let bag = holder.bags.get(name);
  if (!bag || !bag.length) {
    bag = list.map((_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = randomInt(i + 1); // Fisher-Yates
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    const last = holder.lastLine?.get(name);
    if (bag.length > 1 && bag[bag.length - 1] === last) bag.unshift(bag.pop()); // no repeat across refills
    holder.bags.set(name, bag);
  }
  const i = bag.pop();
  (holder.lastLine ||= new Map()).set(name, i);
  holder.drawn.push([name, i]);
  return list[i];
}

// ---------------------------------------------------------------- prize + duration (shared, deterministic)
// "100 points" -> points; any other text ("1 SOL", "NFT", "$50", "WL") -> ticket (manual delivery); empty -> none
function classifyPrize(raw) {
  const prize = String(raw ?? '')
    .replace(/@(everyone|here)/gi, '')
    .replace(/<[@#][!&]?\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  if (!prize) return { prize: null, prize_type: 'none', prize_points: null };
  const m = /^(\d[\d,_]*)\s*(points?|pts?)$/i.exec(prize);
  if (m) {
    const n = Number(m[1].replace(/[,_]/g, ''));
    if (Number.isSafeInteger(n) && n > 0) return { prize, prize_type: 'points', prize_points: n };
  }
  return { prize, prize_type: 'ticket', prize_points: null };
}

// Join window length from the boss's own words: "10 minute", "5 min", "10 minute dhore", "15 minutes".
// "in 10 minutes" / "10 min por" mean the START time, so they are skipped. null = not stated.
function parseJoinMinutes(input) {
  const text = String(input || '');
  const re = /(\d{1,3})\s*-?\s*(?:m|min|mins|mint|minit|minute|minutes|মিনিট)(?![a-z])/gi;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    if (/\b(in|after|within)\s*$/i.test(before)) continue; // "in 10 minutes"
    if (/^\s*(por|pore|পর|পরে|later|after|baad|bad|theke)(?![a-z])/i.test(after)) continue; // "10 min por"
    const n = Number(m[1]);
    if (n >= 1 && n <= 60) return n;
  }
  return null;
}

// "min 5 players", "minimum 5 players", "5 players minimum"
function parseMinPlayers(text) {
  const m = /\bmin(?:imum)?\s*(\d{1,3})\s*(?:players?|jon|person|people)\b/i.exec(text) || /\b(\d{1,3})\s*(?:players?)\s*min(?:imum)?\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

// The ONE place params are built, for both entry points. { params } or { error }
function buildRumbleParams({ join_minutes, prize, min_players } = {}) {
  const channelId = rumbleChannelId();
  if (!channelId) return { error: MISSING_CHANNEL };
  const jm = join_minutes === null || join_minutes === undefined || join_minutes === '' ? R().defaultJoinMinutes : Number(join_minutes);
  if (!Number.isInteger(jm) || jm < 1 || jm > 60) return { error: 'The join window must be 1 to 60 minutes.' };
  const mp = min_players === null || min_players === undefined || min_players === '' ? R().minPlayers : Number(min_players);
  if (!Number.isInteger(mp) || mp < 1 || mp > R().maxPlayers) return { error: `Min players must be between 1 and ${R().maxPlayers}.` };
  return { params: { channel_id: channelId, join_minutes: jm, ...classifyPrize(prize), min_players: mp } };
}

const isBigPrize = (params) => params.prize_type === 'points' && params.prize_points > R().maxPointsPrize;

// short prize text for lists / reports
function prizeShort(p) {
  if (p.prize_type === 'points') return `${p.prize_points} points (auto-paid)`;
  if (p.prize_type === 'ticket') return `${p.prize} (ticket)`;
  return 'no prize';
}

// public prize line in the announcements
function prizeLine(p) {
  if (p.prize_type === 'points') return `Prize: **${p.prize_points} points**, sent automatically to the winner`;
  if (p.prize_type === 'ticket') return `Prize: **${escapeMarkdown(p.prize)}**`;
  return 'No prize this time, just eternal glory';
}

// Summary shown before scheduling (control channel and /rumble preview)
function summary(params, runAt) {
  const end = new Date(new Date(runAt).getTime() + params.join_minutes * MIN);
  let prize;
  if (params.prize_type === 'points') prize = `**${params.prize_points} points** (type: points). ${params.prize_points} points will be sent automatically to the winner.`;
  else if (params.prize_type === 'ticket') prize = `**${escapeMarkdown(params.prize)}** (type: ticket, the winner opens a ticket and the team delivers it)`;
  else prize = 'none';
  const lines = [
    `**${label}** in <#${params.channel_id}>`,
    `Join opens: ${ts(runAt, 't')} (${ts(runAt, 'R')})`,
    `Join window closes: ${ts(end, 't')} (${ts(end, 'R')}) · ${params.join_minutes} min`,
    `Prize: ${prize}`,
    `Min players: ${params.min_players}`,
  ];
  if (isBigPrize(params)) lines.push(`⚠️ **That is more than ${R().maxPointsPrize} points.** Double-check it, this needs a second confirm.`);
  return lines.join('\n');
}

// another game (any type) scheduled or running in that channel
async function findClash(channelId) {
  const active = await store.listActive();
  return active.find((t) => t.channel_id === channelId) || null;
}
const clashText = (t) =>
  `There is already a game in <#${t.channel_id}> (#${t.id}, ${t.type}, ${t.status}). Only one game runs per channel, so cancel it first or wait for it to end.`;

// The ONE place a Rumble task is created (both entry points). { row } or { error }
async function createRumble({ params, runAt, createdBy, source }) {
  if (!rumbleChannelId() || params.channel_id !== rumbleChannelId()) return { error: MISSING_CHANNEL };
  const clash = (await findClash(params.channel_id)) || (games.has(params.channel_id) ? { channel_id: params.channel_id, id: '?', type, status: 'running' } : null);
  if (clash) return { error: clashText(clash) };
  const now = Date.now();
  const at = new Date(Math.max(new Date(runAt).getTime(), now));
  const row = await store.create({
    type,
    run_at: at.toISOString(),
    channel_id: params.channel_id,
    params: { ...params, source }, // source: "vexo" (control order) or "manual" (/rumble)
    status: 'pending',
    created_by: String(createdBy),
    state: { skipPre: at.getTime() - now < R().preAnnounceMinutes * MIN }, // too soon for a heads-up
  });
  require('./scheduler').tickSoon(); // required here: scheduler -> registry -> this file
  return { row };
}

// ---------------------------------------------------------------- what the AI is told (control channel only)
function about() {
  return (
    'Rumble Royale: a battle-royale elimination game in the Rumble channel (RUMBLE_CHANNEL_ID). At the start time Vexo ' +
    'posts a Join button (pings the verified role); after the join window (1-60 min, default ' +
    `${R().defaultJoinMinutes}) rounds run automatically and random players are eliminated until one wins. ` +
    'Prize: "N points" is paid automatically; any other prize (SOL, NFT, WL...) is claimed through a ticket. ' +
    `Min players default ${R().minPlayers}. Fully automatic, no AI during the game. Also available as /rumble.`
  );
}
const fields =
  '"join_minutes" (JOIN WINDOW length 1-60: "10 minute", "5 min", "10 minute dhore", "15 minutes" = 10/5/10/15. ' +
  'This is NOT the start time), "prize" (exact text as written: "100 points", "1 SOL", "NFT", or null), "min_players" (integer or null)';

// one line per task for the AI prompt (no secrets: players and winner are not included)
function aiLine(t, { bossLocal }) {
  const p = t.params || {};
  return (
    `#${t.id} rumble_royale | boss clock ${bossLocal(t.run_at)} | shown as ${fmtUtc(t.run_at)} | status ${t.status}` +
    ` | join ${p.join_minutes} min | prize ${p.prize || 'none'} | min players ${p.min_players}`
  );
}

// Control channel order -> plan (the control channel shows it and runs create() after "yes").
//   text: the boss's own words (durations / min players are read from them in code, the AI only helps)
async function planOrder({ ai, text, checkTime, createdBy }) {
  if (!rumbleChannelId()) return { error: MISSING_CHANNEL };
  const joinFromText = parseJoinMinutes(text);
  let time = ai.time;
  // "rumble 5 minute dhore" is a join window, not "start in 5 minutes"
  if (time && joinFromText !== null && Number(time.in_minutes) === joinFromText && !/\b(ekhoni|ekhon|now|right now|immediately)\b/i.test(text)) {
    time = null;
  }
  const when = checkTime(time);
  if (when.question) return { question: when.question };

  const built = buildRumbleParams({
    join_minutes: joinFromText ?? ai.join_minutes ?? null,
    prize: ai.prize,
    min_players: parseMinPlayers(text) ?? ai.min_players ?? null,
  });
  if (built.error) return { error: built.error };
  const { params } = built;
  const clash = await findClash(params.channel_id);
  if (clash) return { error: clashText(clash) };

  return {
    summary: summary(params, when.date),
    describe: `schedule rumble_royale at ${fmtUtc(when.date, { relative: false })}, join ${params.join_minutes} min, prize ${params.prize || 'none'}, min players ${params.min_players}`,
    draft: { task_type: type, prize: params.prize, join_minutes: params.join_minutes, min_players: params.min_players, time },
    doubleCheck: isBigPrize(params) ? `⚠️ Second check: **${params.prize_points} points** is above RUMBLE_MAX_POINTS_PRIZE (${R().maxPointsPrize}).` : null,
    create: () => createRumble({ params, runAt: when.date, createdBy, source: 'vexo' }),
  };
}

// ---------------------------------------------------------------- list / status lines
function phaseText(task) {
  const s = task.state || {};
  const live = gameByTask(task.id);
  const joined = live ? live.players.size : (s.players || []).length;
  if (task.status === 'pending' || task.status === 'announced') return `scheduled, join opens ${ts(task.run_at, 'R')}`;
  if (task.status !== 'running') return task.status;
  if (s.phase === 'join') return `join window open (${joined} joined), closes ${ts(s.joinEndsAt, 'R')}`;
  const left = live ? [...live.players.values()].filter((p) => p.alive).length : '?';
  return `rounds in progress (round ${live?.round ?? s.round ?? 0}, ${left} of ${joined} left)`;
}

function describe(task) {
  const p = task.params || {};
  return (
    `**#${task.id}** ${label} · ${ts(task.run_at, 't')} (${ts(task.run_at, 'R')}) · <#${task.channel_id}> · join ${p.join_minutes} min` +
    ` · ${prizeShort(p)} · min ${p.min_players} players · ${phaseText(task)}`
  );
}

// ---------------------------------------------------------------- Discord helpers
async function post(game, content, allowed = {}) {
  const channel = await getTextChannel(game.client, game.channelId);
  if (!channel) throw new Error(`channel ${game.channelId} not found`);
  return channel.send({ content, allowedMentions: { parse: [], ...allowed } });
}
const safePost = (game, content, allowed) => post(game, content, allowed).catch((err) => console.error(`rumble #${game.taskId} post:`, err.message));

// one embed per message, never pings anyone (mentions inside embeds don't ping anyway)
async function postEmbed(game, embed) {
  const channel = await getTextChannel(game.client, game.channelId);
  if (!channel) return console.error(`rumble #${game.taskId}: channel ${game.channelId} not found`);
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((err) => console.error(`rumble #${game.taskId} card:`, err.message));
}

const rolePing = () => (config.verifiedRoleId ? { text: `<@&${config.verifiedRoleId}> `, allowed: { roles: [config.verifiedRoleId] } } : { text: '', allowed: {} });

function joinRow(game, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rumble_join:${game.taskId}`)
      .setLabel(disabled ? `Join window closed (${game.players.size})` : `Join the Rumble (${game.players.size})`)
      .setEmoji('⚔️')
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

// edit the join message's button (live count, or disabled at the end of the window)
async function editJoin(game, disabled = false) {
  game.countDirty = false;
  game.lastCountEdit = Date.now();
  if (!game.joinMsg) return;
  await game.joinMsg.edit({ components: [joinRow(game, disabled)] }).catch((err) => console.error(`rumble #${game.taskId} join edit:`, err.message));
}

// persist players + state (guarded: a cancelled/finished task is never revived)
async function saveState(game) {
  game.dirty = false;
  game.lastSave = Date.now();
  game.state.players = [...game.players.values()];
  game.state.round = game.round;
  game.state.revives = game.revives;
  game.state.elimCounter = game.elimCounter;
  await store.update(game.taskId, { state: game.state }, ['running']).catch((err) => console.error(`rumble #${game.taskId} save:`, err.message));
}

// ---------------------------------------------------------------- game object
function newGame(task, client, state) {
  const game = {
    taskId: task.id,
    channelId: task.channel_id,
    params: task.params || {},
    createdBy: task.created_by,
    client,
    state,
    phase: state.phase || 'join',
    // id -> { id, name, avatar, kills, rounds, alive, eliminatedAt, elimOrder, revived, tie }
    players: new Map((state.players || []).map((p) => [p.id, { tie: randomInt(1e9), ...p }])),
    round: state.round || 0,
    revives: state.revives || 0,
    elimCounter: state.elimCounter || 0, // global elimination order
    bags: new Map(),
    drawn: [], // [listName, index] of every template line used (tests check for repeats)
    roundLog: [], // per round: start / after eliminations / end counts and the revived player
    joinMsg: null,
    pulse: null,
    timer: null,
    safety: null,
    dirty: false,
    countDirty: false,
    lastSave: 0,
    lastCountEdit: 0,
    lastChatAt: 0,
    lastChatTo: null,
    ended: false,
  };
  return game;
}
const aliveList = (game) => [...game.players.values()].filter((p) => p.alive);

// ---------------------------------------------------------------- scheduler tick
async function tick(task, { client }) {
  const live = gameByTask(task.id);
  if (live) {
    // backup for the safety timer (e.g. timers lost to a long event-loop stall)
    if (live.phase === 'rounds' && Date.now() > (live.state.roundsStartedAt || Date.now()) + R().maxMinutes * MIN) await stalled(live);
    return;
  }
  if (task.status === 'running') return resume(task, client); // in the DB but not in memory = restart

  const now = Date.now();
  const runAt = Date.parse(task.run_at);
  if (now > runAt + MISSED_GRACE_MS) return markMissed(task, client);

  const state = { ...(task.state || {}) };
  const pre = R().preAnnounceMinutes * MIN;
  if (task.status === 'pending' && !state.skipPre && pre > 0 && now < runAt && now >= runAt - pre) {
    state.preAnnounced = true;
    if (!(await store.update(task.id, { status: 'announced', state }, ['pending']))) return;
    const ping = rolePing();
    const content = ping.text + fill(draw(null, 'preAnnounce'), { prize_line: prizeLine(task.params || {}), start_time: ts(runAt, 'R') });
    const channel = await getTextChannel(client, task.channel_id);
    if (channel) await channel.send({ content, allowedMentions: { parse: [], ...ping.allowed } }).catch((err) => console.error('rumble heads-up:', err.message));
    return;
  }
  if (now >= runAt && ['pending', 'announced'].includes(task.status)) await openJoin({ ...task, state }, client);
}

// ---------------------------------------------------------------- join window
async function openJoin(task, client) {
  const cancelWith = async (reason, text) => {
    await store.update(task.id, { status: 'cancelled', state: { ...task.state, endReason: reason } }, ['pending', 'announced']);
    await report(client, text);
  };
  if (games.has(task.channel_id)) return cancelWith('channel_busy', `⚠️ Rumble #${task.id} was cancelled: another game is already running in <#${task.channel_id}>.`);
  const channel = await getTextChannel(client, task.channel_id);
  if (!channel) return cancelWith('no_channel', `⚠️ Rumble #${task.id} was cancelled: I can't find or post in <#${task.channel_id}>. Check RUMBLE_CHANNEL_ID and my permissions.`);

  const now = Date.now();
  const state = {
    ...task.state,
    phase: 'join',
    joinOpenedAt: now,
    joinEndsAt: now + (task.params?.join_minutes || R().defaultJoinMinutes) * MIN,
    players: [],
    halfwaySent: false,
    lastMinuteSent: false,
  };
  if (!(await store.update(task.id, { status: 'running', state }, ['pending', 'announced']))) return; // cancelled meanwhile

  const game = newGame(task, client, state);
  games.set(game.channelId, game);
  const ping = rolePing();
  // the prize right next to the role ping, on its own first line ("<@&role> 🎁 Prize: **10 points**"); no prize = as before.
  // Cut to 80 chars, markdown escaped, "@" / "<" defused so the text can never ping or break formatting.
  const prizeText = game.params.prize_type === 'points' ? `${game.params.prize_points} points` : game.params.prize_type === 'ticket' ? String(game.params.prize || '') : '';
  const shortPrize = prizeText.length > 80 ? `${prizeText.slice(0, 79)}…` : prizeText;
  const prizeTag = shortPrize ? `${ping.text}🎁 Prize: **${escapeMarkdown(shortPrize).replace(/@/g, '@​').replace(/</g, '<​')}**\n` : ping.text;
  const content = prizeTag + fill(draw(game, 'announce'), { prize_line: prizeLine(game.params), start_time: ts(state.joinEndsAt, 'R') });
  try {
    game.joinMsg = await channel.send({ content, components: [joinRow(game)], allowedMentions: { parse: [], ...ping.allowed } });
    game.state.joinMsgId = game.joinMsg.id;
    await saveState(game);
  } catch (err) {
    console.error(`rumble #${task.id} announce:`, err.message);
    await endGame(game, 'no_channel');
    return report(client, `⚠️ Rumble #${task.id} was cancelled: I couldn't post the join message in <#${task.channel_id}> (${err.message}).`);
  }
  startPulse(game);
}

function startPulse(game) {
  clearInterval(game.pulse);
  game.pulse = setInterval(() => pulse(game).catch((err) => console.error(`rumble #${game.taskId} pulse:`, err.message)), PULSE_MS);
}

// join window heartbeat: close on time, reminders, live count, periodic save
async function pulse(game) {
  if (game.ended || game.phase !== 'join' || game.pulsing) return;
  game.pulsing = true;
  try {
    const s = game.state;
    const now = Date.now();
    if (now >= s.joinEndsAt) return await closeJoin(game);
    const total = s.joinEndsAt - s.joinOpenedAt;
    const count = ` (**${game.players.size}** joined so far)`;
    // reminders only when they fit: halfway needs a 3+ min window, "1 minute left" a 2+ min window
    if (!s.halfwaySent && total >= 3 * MIN && now >= s.joinOpenedAt + total / 2 && s.joinEndsAt - now > 1.5 * MIN) {
      s.halfwaySent = true;
      game.dirty = true;
      await safePost(game, draw(game, 'halfwayReminder') + count);
    }
    if (!s.lastMinuteSent && total >= 2 * MIN && now >= s.joinEndsAt - MIN) {
      s.lastMinuteSent = true;
      game.dirty = true;
      const ping = rolePing();
      await safePost(game, ping.text + draw(game, 'lastMinuteReminder') + count, ping.allowed);
    }
    if (game.countDirty && now - game.lastCountEdit >= COUNT_EDIT_MS) await editJoin(game);
    if (game.dirty && now - game.lastSave >= SAVE_MS) await saveState(game);
  } finally {
    game.pulsing = false;
  }
}

async function closeJoin(game) {
  if (game.phase !== 'join' || game.ended) return;
  game.phase = 'closing';
  clearInterval(game.pulse);
  await editJoin(game, true);

  const players = [...game.players.values()];
  const min = game.params.min_players || R().minPlayers;
  if (players.length < min) {
    await safePost(game, fill(draw(game, 'cancelNotEnoughPlayers'), { min }));
    return endGame(game, 'not_enough_players');
  }

  game.phase = 'rounds';
  game.state.phase = 'rounds';
  game.state.roundsStartedAt = Date.now();
  await saveState(game);
  const ping = rolePing();
  await safePost(game, ping.text + fill(draw(game, 'gameStart'), { players: players.length }), ping.allowed);
  game.safety = setTimeout(() => stalled(game).catch((err) => console.error('rumble safety:', err.message)), R().maxMinutes * MIN);
  // the rounds run in ONE sequential async loop: send a card, wait, send the next
  runRounds(game).catch(async (err) => {
    console.error(`rumble #${game.taskId} rounds:`, err.message);
    if (game.ended) return;
    await safePost(game, draw(game, 'crashEnded'));
    await endGame(game, 'error');
    await report(game.client, `⚠️ Rumble #${game.taskId} hit an error during the rounds (${err.message}) and ended with no winner and no payout.`);
  });
}

// ---------------------------------------------------------------- pacing
const MIN_ROUND_SECONDS = 3; // RUMBLE_ROUND_SECONDS is never allowed below this
const FINAL_SUSPENSE_MS = 4000; // "3… 2… 1…" before the final duel
const END_GAP_MS = 2000; // between the final duel, winner card, runners-up card and congrats
const roundSeconds = () => Math.max(MIN_ROUND_SECONDS, Number(R().roundSeconds) || 0);
const roundMs = () => roundSeconds() * 1000;
// the only way the game waits; tests swap it for an instant fake that records the delays
const timing = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

// wait between cards; shows "Vexo is typing…" at most once per wait
async function pause(game, ms, { typing = false } = {}) {
  if (typing) {
    const channel = await getTextChannel(game.client, game.channelId);
    channel?.sendTyping?.().catch(() => {});
  }
  await timing.sleep(ms);
}

// Every round is posted one at a time: card -> save -> wait RUMBLE_ROUND_SECONDS -> next card.
// Never scheduled ahead and never in a burst. Stops as soon as the game ends (safety timeout).
async function runRounds(game) {
  await pause(game, roundMs(), { typing: true }); // a beat after "the gates are shut"
  while (!game.ended) {
    const left = aliveList(game).length;
    if (left <= 1) break;
    if (left === 2) {
      // short standalone suspense message, then the final duel card
      await safePost(game, draw(game, 'finalCountdown'));
      await pause(game, FINAL_SUSPENSE_MS);
      if (game.ended) return;
    }
    const card = playRound(game);
    await postEmbed(game, cardEmbed(card));
    await saveState(game);
    if (aliveList(game).length <= 1) break;
    await pause(game, roundMs(), { typing: true });
  }
  if (game.ended) return;
  await pause(game, END_GAP_MS);
  await crown(game);
}

// ---------------------------------------------------------------- rounds
const COLORS = { normal: 0xe74c3c, revive: 0xe67e22, final: 0xf1c40f, runners: 0x95a5a6 };
const DESC_BUDGET = 3800; // embed descriptions stay under Discord's 4096 (and our 4000)

function eliminate(game, p) {
  p.alive = false;
  p.eliminatedAt = game.round; // a revived player's LAST elimination overwrites this
  game.elimCounter += 1;
  p.elimOrder = game.elimCounter; // global elimination order
}

// hype line for the card: kill leader, a long survivor, or generic banter (~40 % of rounds)
function hypeLine(game, alive) {
  if (game.round < 2 || randomInt(100) >= 40) return '';
  const top = [...game.players.values()].sort((a, b) => b.kills - a.kills)[0];
  const kind = randomInt(3);
  if (kind === 0 && top && top.kills >= 2) return fill(draw(game, 'banterKills'), { player: nm(top), kills: top.kills });
  if (kind === 1 && game.round >= 3) {
    const s = alive[randomInt(alive.length)];
    return fill(draw(game, 'banterSurvivor'), { player: nm(s), rounds: s.rounds });
  }
  return draw(game, 'banter');
}

// Revive is allowed only after round 1, never with 3 or fewer players left after the eliminations
// (so never near or in the final duel), at most RUMBLE_MAX_REVIVES per game, once per player.
function reviveCandidate(game, survivorsLeft) {
  if (game.round <= 1 || survivorsLeft <= 3) return null;
  if (game.revives >= R().maxRevives) return null;
  if (randomInt(100) >= R().reviveChance) return null;
  // players eliminated in EARLIER rounds who were never revived; uniform pick, everyone has the same chance
  const pool = [...game.players.values()].filter((p) => !p.alive && !p.revived && p.eliminatedAt && p.eliminatedAt < game.round);
  return pool.length ? pool[randomInt(pool.length)] : null;
}

// One round: decides eliminations (and maybe a revive) with crypto.randomInt and returns the card data.
// Nothing here is async and nothing is sent: runRounds() posts the card.
function playRound(game) {
  game.round += 1;
  const alive = aliveList(game);
  const start = alive.length;
  const hype = hypeLine(game, alive); // "between rounds" hype rides inside this card

  // ---- final duel: exactly two left (never a revive after this point)
  if (start === 2) {
    const v = randomInt(2);
    const victim = alive[v];
    const killer = alive[1 - v];
    eliminate(game, victim);
    killer.kills += 1;
    killer.rounds += 1;
    game.roundLog.push({ round: game.round, kind: 'final', start, afterElims: 1, end: 1, revived: null });
    return {
      kind: 'final',
      title: '🔥 FINAL DUEL',
      description: [
        `${nm(alive[0])} ⚔️ ${nm(alive[1])}`,
        draw(game, 'finalDuelIntro'),
        '',
        fill(draw(game, 'finalDuelElimination'), { victim: nm(victim), killer: nm(killer) }),
      ].join('\n'),
      footer: '👥 1 player left',
    };
  }

  // ---- normal round: about 25-30 % of the remaining players, at least 1, never all
  const pct = 25 + randomInt(6);
  const k = Math.min(start - 1, Math.max(1, Math.round((start * pct) / 100)));
  const order = [...alive];
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const victims = order.slice(0, k);
  const survivors = order.slice(k);

  const elims = victims.map((v) => {
    const line = draw(game, 'elimination');
    // the killer is a random player who survives this round (solo-accident lines have none)
    const killer = line.includes('{killer}') ? survivors[randomInt(survivors.length)] : null;
    if (killer) killer.kills += 1;
    eliminate(game, v);
    return fill(line, { victim: nm(v), killer: killer ? nm(killer) : '' });
  });
  survivors.forEach((p) => {
    p.rounds += 1;
  });

  // ---- revive (some rounds only): back in the game for the next round, kills kept
  const revived = reviveCandidate(game, survivors.length);
  let reviveText = '';
  if (revived) {
    revived.alive = true;
    revived.revived = true;
    revived.revivedAt = game.round;
    revived.eliminatedAt = null;
    game.revives += 1;
    reviveText = `\n**🧟 REVIVE**\n${fill(draw(game, 'revive'), { player: nm(revived) })}`;
  }
  const end = survivors.length + (revived ? 1 : 0);
  game.roundLog.push({ round: game.round, kind: revived ? 'revive' : 'normal', start, afterElims: survivors.length, end, revived: revived?.id || null });

  // ---- description under the size budget: "...and N more fell" when there are many eliminations
  const intro = fill(draw(game, 'roundIntro'), { round: game.round, remaining: start });
  const tail = `${reviveText}${hype ? `\n\n_${hype}_` : ''}`;
  const body = [];
  let used = intro.length + tail.length + 40;
  for (let i = 0; i < elims.length; i++) {
    if (used + elims[i].length + 1 > DESC_BUDGET) {
      body.push(`...and **${elims.length - i}** more fell.`);
      break;
    }
    body.push(elims[i]);
    used += elims[i].length + 1;
  }
  return {
    kind: revived ? 'revive' : 'normal',
    title: `⚔️ Round ${game.round}`,
    description: `${intro}\n\n${body.join('\n')}${tail}`,
    footer: `👥 ${end} player${end === 1 ? '' : 's'} left`,
  };
}

function cardEmbed(card) {
  return new EmbedBuilder()
    .setTitle(card.title)
    .setColor(COLORS[card.kind] || COLORS.normal)
    .setDescription(card.description.slice(0, 4000))
    .setFooter({ text: card.footer });
}

// ---------------------------------------------------------------- winner + payout
const payoutReason = (taskId) => `rumble_royale_prize task #${taskId}`;
const paying = new Set();

// Credit the points prize. Idempotent: state.paid, plus the point_log entry (covers a crash between
// the credit and saving the flag), plus an in-process lock against a double call at the same moment.
// ctx: { taskId, state, winnerId, amount }   ->   { ok, balance } / { ok: false, error }
async function payout(ctx, deps = {}) {
  const pts = deps.points || points;
  const db = deps.db || supabase;
  const { taskId, state, winnerId, amount } = ctx;
  if (state.paid) return { ok: true, already: true, balance: state.paid.balance };
  if (paying.has(taskId)) return { ok: false, busy: true, error: 'payout already in progress' };
  paying.add(taskId);
  try {
    const reason = payoutReason(taskId);
    const { data, error } = await db.from('point_log').select('id').eq('reason', reason).limit(1);
    if (error) throw new Error(`point_log check: ${error.message}`);
    const alreadyLogged = !!(data && data.length);
    const balance = alreadyLogged ? null : await pts.adjustPoints(String(winnerId), amount, reason); // atomic RPC, creates the user row
    state.paid = { at: new Date().toISOString(), winnerId: String(winnerId), amount, balance, payoutId: reason };
    await store.update(taskId, { state }).catch((err) => console.error(`rumble #${taskId} paid flag save:`, err.message));
    return { ok: true, balance, already: alreadyLogged };
  } catch (err) {
    console.error(`rumble #${taskId} payout failed:`, err.message);
    return { ok: false, error: err.message };
  } finally {
    paying.delete(taskId);
  }
}

const ticketHint = () => (config.channels.ticket ? ` Ticket channel: <#${config.channels.ticket}>` : '');

// Runners-up = reverse order of the final elimination: eliminated last = 2nd. Same round -> more kills
// first, then a random tie-break (drawn once per player at join). A revived player counts with their
// LAST elimination.
const MEDALS = ['🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
function rankRunnersUp(game) {
  const shown = Math.max(0, Math.min(MEDALS.length, Number(R().runnersShown) || 0));
  return [...game.players.values()]
    .filter((p) => !p.alive && p.eliminatedAt)
    .sort((a, b) => b.eliminatedAt - a.eliminatedAt || b.kills - a.kills || a.tie - b.tie)
    .slice(0, shown);
}

// prize as shown in the winner card
function prizeField(p) {
  if (p.prize_type === 'points') return `${p.prize_points} points`;
  if (p.prize_type === 'ticket') return p.prize;
  return 'Glory';
}

function winnerEmbed(game, w) {
  const e = new EmbedBuilder()
    .setTitle('👑 RUMBLE CHAMPION')
    .setColor(COLORS.final)
    .setDescription(`# ${safeName(w.name)}\n${fill(draw(game, 'winner'), { winner: nm(w), kills: w.kills, rounds: w.rounds })}`)
    .addFields(
      { name: 'Eliminations', value: String(w.kills), inline: true },
      { name: 'Rounds survived', value: String(w.rounds), inline: true },
      { name: 'Players in the game', value: String(game.players.size), inline: true },
      { name: 'Prize', value: prizeField(game.params).slice(0, 1024), inline: true }
    )
    .setFooter({ text: 'Rumble Royale · hosted by Vexo' });
  if (game.revives > 0) e.addFields({ name: 'Revived', value: w.revived ? 'yes' : 'no', inline: true });
  if (typeof w.avatar === 'string' && /^https:\/\//.test(w.avatar)) e.setThumbnail(w.avatar); // skipped if unknown
  return e;
}

function runnersEmbed(game, runners) {
  const lines = runners.map((p, i) => `${MEDALS[i]} ${nm(p)} · ${p.kills} elimination${p.kills === 1 ? '' : 's'}`);
  return new EmbedBuilder()
    .setTitle('🏅 Runners-up')
    .setColor(COLORS.runners)
    .setDescription(`${draw(game, 'runnersUpIntro')}\n\n${lines.join('\n')}`);
}

// Winner card -> runners-up card -> congratulation message (the only ping), ~2 s apart.
// The points payout runs FIRST, so the congrats only says "sent" after the credit succeeded.
async function announceWinner(game, w) {
  const mention = `<@${w.id}>`;
  const p = game.params;
  let pay = null;
  let prizePart;
  if (p.prize_type === 'points') {
    pay = await payout({ taskId: game.taskId, state: game.state, winnerId: w.id, amount: p.prize_points });
    prizePart = pay.ok
      ? fill(draw(game, 'winnerPoints'), { winner: mention, points: p.prize_points })
      : `${fill(draw(game, 'winnerTicket'), { winner: mention, prize: `${p.prize_points} points` })}${ticketHint()}\nThe automatic payout hit a snag, so the team will deliver it by hand.`;
  } else if (p.prize_type === 'ticket') {
    prizePart = fill(draw(game, 'winnerTicket'), { winner: mention, prize: escapeMarkdown(p.prize) }) + ticketHint();
  } else {
    prizePart = fill(draw(game, 'winnerNoPrize'), { winner: mention });
  }

  await postEmbed(game, winnerEmbed(game, w));
  const runners = rankRunnersUp(game);
  game.state.runnersUp = runners.map((r, i) => ({ place: i + 2, id: r.id, name: r.name, kills: r.kills }));
  if (runners.length) {
    await pause(game, END_GAP_MS);
    await postEmbed(game, runnersEmbed(game, runners));
  }
  await pause(game, END_GAP_MS);
  await safePost(game, `${fill(draw(game, 'winnerCongrats'), { winner: mention })}\n${prizePart}`, { users: [w.id] });
  game.state.winnerAnnounced = true;
  return pay;
}

async function crown(game) {
  if (game.ended || game.crowning) return;
  game.crowning = true;
  const alive = aliveList(game);
  if (alive.length !== 1) return endGame(game, 'error');
  const w = alive[0];
  // record the winner BEFORE paying: after a crash, only a recorded winner may still be paid
  game.state.winner = { id: w.id, name: w.name, kills: w.kills, rounds: w.rounds, revived: !!w.revived };
  await saveState(game);
  const pay = await announceWinner(game, w);
  return endGame(game, 'winner', pay);
}

// ---------------------------------------------------------------- endings
async function endGame(game, reason, pay = null) {
  if (game.ended) return;
  game.ended = true;
  clearInterval(game.pulse);
  clearTimeout(game.timer);
  clearTimeout(game.safety);
  games.delete(game.channelId);
  lastEnded = game;

  const cancelled = ['cancelled', 'not_enough_players', 'no_channel'].includes(reason);
  game.state.players = [...game.players.values()];
  game.state.round = game.round;
  Object.assign(game.state, { endReason: reason, endedAt: new Date().toISOString(), aiCallsDuringGame: 0 });
  await store
    .update(game.taskId, { status: cancelled ? 'cancelled' : 'done', state: game.state })
    .catch((err) => console.error(`rumble #${game.taskId} end save:`, err.message));
  // this file never calls the AI: every line above came from rumbleTemplates.js
  console.log(`Rumble #${game.taskId} ended (${reason}). AI calls during game: 0`);

  const p = game.params;
  const how = p.source === 'manual' ? 'started via /rumble' : 'started via Vexo order';
  const players = game.players.size;
  if (reason === 'winner') {
    const w = game.state.winner;
    let paid = '';
    if (p.prize_type === 'points') {
      paid = pay?.ok
        ? `Points credited: **yes**${pay.balance !== null && pay.balance !== undefined ? ` (new balance: ${pay.balance})` : ' (already in point_log)'}`
        : `Points credited: **NO**, payout failed (${pay?.error || 'unknown error'}). Please add **${p.prize_points} points** to user ID \`${w.id}\` by hand (/addpoints). The winner was told to open a ticket.`;
    } else if (p.prize_type === 'ticket') paid = `Deliver **${p.prize}** when they open a ticket.`;
    const runners = (game.state.runnersUp || []).map((r) => `${r.place}. ${safeName(r.name)} (\`${r.id}\`, ${r.kills} kills)`).join(' · ');
    await report(
      game.client,
      [
        `🏆 Rumble #${game.taskId} is done! Winner: **${safeName(w.name)}** (<@${w.id}>, ID \`${w.id}\`)${w.revived ? ' (was revived)' : ''}`,
        `Prize: ${p.prize || 'none'} (type: ${p.prize_type})${paid ? ` · ${paid}` : ''}`,
        `Runners-up: ${runners || 'none'}`,
        `Players: ${players} · Rounds: ${game.round} · Revives: ${game.revives} · ${how} · AI calls during game: 0`,
      ].join('\n')
    );
  } else if (reason === 'not_enough_players') {
    await report(game.client, `🛑 Rumble #${game.taskId} cancelled: only ${players} player(s) joined, the minimum is ${p.min_players}. ${how} · AI calls during game: 0`);
  } else if (reason === 'timeout') {
    await report(game.client, `⏱️ Rumble #${game.taskId} hit the safety timeout (${R().maxMinutes} min) and ended with no winner and no payout. Players: ${players}, rounds: ${game.round}. AI calls during game: 0`);
  }
  // 'cancelled': the caller (control channel reply or /rumble cancel) reports it
}

// safety timeout after the rounds started
async function stalled(game) {
  if (game.ended || game.crowning) return;
  await safePost(game, draw(game, 'crashEnded'));
  await endGame(game, 'timeout');
}

// The bot restarted while the task was "running"
async function resume(task, client) {
  const s = task.state || {};
  if (s.phase === 'join') {
    const channel = await getTextChannel(client, task.channel_id);
    if (!channel) {
      await store.update(task.id, { status: 'cancelled', state: { ...s, endReason: 'no_channel' } }, ['running']);
      return report(client, `⚠️ Rumble #${task.id} was cancelled after a restart: I can't reach <#${task.channel_id}>.`);
    }
    const game = newGame(task, client, { ...s });
    games.set(game.channelId, game);
    if (s.joinMsgId) game.joinMsg = await channel.messages.fetch(s.joinMsgId).catch(() => null);
    game.countDirty = true;
    startPulse(game);
    return report(client, `⚠️ I restarted during the join window of Rumble #${task.id}. ${game.players.size} player(s) restored, the countdown continues.`);
  }

  // mid-rounds: claim the row first so two ticks can never handle it twice
  const row = await store.update(task.id, { status: 'done', state: { ...s, endReason: s.winner ? 'winner' : 'restart', endedAt: new Date().toISOString() } }, ['running']);
  if (!row) return;
  const game = newGame(task, client, { ...s });
  if (s.winner) {
    // the winner was decided and recorded BEFORE the crash: honor it (payout is idempotent)
    const w = game.players.get(s.winner.id) || { ...s.winner };
    let pay = null;
    if (!s.winnerAnnounced) pay = await announceWinner(game, w);
    else if (game.params.prize_type === 'points' && !s.paid) pay = await payout({ taskId: task.id, state: game.state, winnerId: w.id, amount: game.params.prize_points });
    await store.update(task.id, { state: game.state }).catch(() => {});
    return report(client, `⚠️ I restarted right after Rumble #${task.id} picked its winner (${safeName(w.name)}, ID \`${w.id}\`). Finished it${pay ? (pay.ok ? ', prize points credited' : `, payout FAILED: ${pay.error}`) : ''}. AI calls during game: 0`);
  }
  await safePost(game, draw(game, 'crashEnded'));
  return report(client, `⚠️ I restarted in the middle of Rumble #${task.id}'s rounds, so I ended it safely: no winner, no payout. Order a new one for a rematch.`);
}

async function markMissed(task, client) {
  const row = await store.update(task.id, { status: 'cancelled', state: { ...task.state, endReason: 'missed' } }, ['pending', 'announced']);
  if (!row) return;
  if (task.status === 'announced') {
    const channel = await getTextChannel(client, task.channel_id);
    if (channel) await channel.send({ content: '📅 Change of plans: the Rumble Royale is not happening at the announced time. Stay tuned.', allowedMentions: { parse: [] } }).catch(() => {});
  }
  await report(client, `⚠️ I was offline at the start time of Rumble #${task.id} (${fmtUtc(task.run_at, { relative: false })}), so I skipped it. Order a new one if you still want it.`);
}

// ---------------------------------------------------------------- control actions (shared by orders and /rumble)
// Cancel works until the rounds start. Returns { ok } / { refused } / null
async function cancel(task, { client }) {
  const refused = { refused: `Rumble #${task.id} is already in the rounds, so it can't be cancelled now. It ends by itself (safety timeout after ${R().maxMinutes} min).` };
  const live = gameByTask(task.id);
  if (live) {
    if (live.phase !== 'join') return refused;
    live.phase = 'cancelling';
    clearInterval(live.pulse);
    await editJoin(live, true);
    await safePost(live, draw(live, 'cancelledByBoss'));
    await endGame(live, 'cancelled');
    return { ok: true };
  }
  if (task.status === 'running' && task.state?.phase !== 'join') return refused;
  const row = await store.update(task.id, { status: 'cancelled', state: { ...task.state, endReason: 'cancelled' } }, ['pending', 'announced', 'running']);
  if (row && task.status !== 'pending') {
    const channel = await getTextChannel(client, task.channel_id);
    if (channel) await channel.send({ content: draw(null, 'cancelledByBoss'), allowedMentions: { parse: [] } }).catch(() => {});
  }
  return row ? { ok: true } : null;
}

async function reschedule(task, date, { client, quiet = false }) {
  if (task.status === 'running') return null;
  const skipPre = date.getTime() - Date.now() < R().preAnnounceMinutes * MIN;
  const row = await store.update(task.id, { run_at: date.toISOString(), status: 'pending', state: { ...task.state, preAnnounced: false, skipPre } }, ['pending', 'announced']);
  if (row && task.status === 'announced' && !quiet) {
    const channel = await getTextChannel(client, task.channel_id);
    if (channel) await channel.send({ content: `📅 Change of plans: the Rumble Royale moved to ${ts(date, 't')} (${ts(date, 'R')}).`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return row;
}

// ---------------------------------------------------------------- chat in the game channel
// The game owns its channel: Q&A / personality stay out. ~1 in 5 messages get a template one-liner
// (channel cooldown, never the same person twice in a row, never a question, no AI).
// mayReply: false = the boss is not talking to Vexo (bossGate.js): no one-liner for that message.
async function handleMessage(message, { mayReply = true } = {}) {
  const game = games.get(message.channelId);
  if (!game || game.ended) return false;
  const now = Date.now();
  if (mayReply && now - game.lastChatAt >= CHAT_GAP_MS && game.lastChatTo !== message.author.id && Math.random() < CHAT_CHANCE) {
    game.lastChatAt = now;
    game.lastChatTo = message.author.id;
    await message.reply({ content: draw(game, 'chatReply'), allowedMentions: { repliedUser: false, parse: [] } }).catch((err) => console.error('rumble chat reply:', err.message));
  }
  return true;
}

const isLiveIn = (channelId) => games.has(channelId);

// ---------------------------------------------------------------- buttons
function hasRole(member, roleId) {
  const roles = member?.roles;
  if (!roles) return false;
  if (roles.cache) return roles.cache.has(roleId);
  return Array.isArray(roles) && roles.map(String).includes(String(roleId)); // uncached API member
}

// boss (BOSS_USER_ID) or a STAFF_ROLE_IDS role, compared as strings
function isStaff(interaction) {
  if (identity.isBoss(interaction.user)) return true;
  return config.staffRoleIds.some((id) => hasRole(interaction.member, String(id)));
}

async function handleJoin(interaction, taskId) {
  const game = gameByTask(taskId);
  if (!game || game.phase !== 'join') return interaction.reply(ephemeral(draw(null, 'joinClosed')));
  const uid = String(interaction.user.id);
  if (game.players.has(uid)) return interaction.reply(ephemeral(draw(game, 'joinAlready')));
  const vr = config.verifiedRoleId;
  if (R().requireVerified && vr && !hasRole(interaction.member, vr)) return interaction.reply(ephemeral(draw(game, 'joinNotAllowed')));
  if (game.players.size >= R().maxPlayers) return interaction.reply(ephemeral(draw(null, 'joinFull')));
  const name = interaction.member?.displayName || interaction.member?.nick || interaction.user.globalName || interaction.user.username;
  let avatar = null; // winner card thumbnail; skipped when Discord gives none
  try {
    avatar = interaction.member?.displayAvatarURL?.({ size: 128 }) || interaction.user.displayAvatarURL?.({ size: 128 }) || null;
  } catch {
    avatar = null;
  }
  game.players.set(uid, {
    id: uid,
    name: String(name || 'fighter').slice(0, 64),
    avatar,
    kills: 0,
    rounds: 0,
    alive: true,
    eliminatedAt: null,
    elimOrder: null,
    revived: false,
    tie: randomInt(1e9), // random tie-break for runners-up eliminated in the same round with equal kills
  });
  game.dirty = true;
  game.countDirty = true;
  return interaction.reply(ephemeral(draw(game, 'joinAck')));
}

// ---------------------------------------------------------------- /rumble (no AI anywhere)
const previews = new Map(); // token -> { userId, params, startIn, big, presses, expiresAt, content }

function previewRow(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rumble_ok:${token}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`rumble_no:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
}

async function slashStart(interaction) {
  const opt = interaction.options;
  const startIn = opt.getInteger('start_in') ?? 0;
  const built = buildRumbleParams({
    join_minutes: opt.getInteger('minutes') ?? null,
    prize: opt.getString('prize') ?? null,
    min_players: opt.getInteger('min_players') ?? null,
  });
  if (built.error) return interaction.editReply(built.error);
  if (!Number.isInteger(startIn) || startIn < 0 || startIn > 30 * 1440) return interaction.editReply('start_in must be between 0 and 43200 minutes.');
  const clash = await findClash(built.params.channel_id);
  if (clash) return interaction.editReply(clashText(clash));

  const token = crypto.randomBytes(8).toString('hex');
  const expiresAt = Date.now() + PREVIEW_TTL_MS;
  const runAt = new Date(Date.now() + startIn * MIN);
  const content = `${summary(built.params, runAt)}\n\nNothing is scheduled until you press **Confirm**. This preview expires ${ts(expiresAt, 'R')}.`;
  previews.set(token, { userId: String(interaction.user.id), params: built.params, startIn, big: isBigPrize(built.params), presses: 0, expiresAt, content });
  return interaction.editReply({ content, components: [previewRow(token)] });
}

async function slashCancel(interaction) {
  const active = (await store.listActive()).filter((t) => t.type === type);
  if (!active.length) return interaction.editReply('No Rumble is scheduled or running right now.');
  const task = active[0];
  const res = await cancel(task, { client: interaction.client });
  if (res?.refused) return interaction.editReply(res.refused);
  if (!res) return interaction.editReply(`Rumble #${task.id} already finished.`);
  await report(interaction.client, `🛑 Rumble #${task.id} cancelled via /rumble by ${interaction.user.tag || interaction.user.id}.`);
  return interaction.editReply(`Rumble #${task.id} is cancelled. I posted it in <#${task.channel_id}> and the control channel.`);
}

async function slashStatus(interaction) {
  const active = (await store.listActive()).filter((t) => t.type === type);
  if (!active.length) return interaction.editReply('No Rumble is scheduled or running right now.');
  const lines = active.map((t) => {
    const p = t.params || {};
    return `**#${t.id}** · ${phaseText(t)} · prize ${p.prize || 'none'} (type: ${p.prize_type}) · min ${p.min_players} players · ${p.source === 'manual' ? 'started via /rumble' : 'started via Vexo order'}`;
  });
  return interaction.editReply(lines.join('\n'));
}

async function handleSlash(interaction) {
  if (!isStaff(interaction)) return interaction.reply(ephemeral(draw(null, 'denial'))); // always checked in code
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // acknowledge within 3 s
  try {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') return await slashStart(interaction);
    if (sub === 'cancel') return await slashCancel(interaction);
    if (sub === 'status') return await slashStatus(interaction);
    return await interaction.editReply('Unknown subcommand.');
  } catch (err) {
    console.error('/rumble:', err.message);
    return interaction.editReply('Something glitched on my side. Nothing was changed.').catch(() => {});
  }
}

async function handlePreviewButton(interaction, action, token) {
  const p = previews.get(token);
  if (!p || Date.now() > p.expiresAt) {
    previews.delete(token);
    return interaction.update({ content: 'This preview expired. Run /rumble start again.', components: [] });
  }
  if (String(interaction.user.id) !== p.userId) return interaction.reply(ephemeral('Only the person who ran /rumble start can use these buttons.'));
  if (action === 'no') {
    previews.delete(token);
    return interaction.update({ content: 'Cancelled. Nothing was scheduled.', components: [] });
  }
  if (p.big && p.presses === 0) {
    p.presses = 1; // typo guard: a huge points prize needs a second press
    return interaction.update({
      content: `${p.content}\n\n⚠️ **Second check: ${p.params.prize_points} points is above ${R().maxPointsPrize}. Press Confirm once more to schedule it.**`,
      components: [previewRow(token)],
    });
  }
  previews.delete(token);
  await interaction.deferUpdate();
  const res = await createRumble({ params: p.params, runAt: new Date(Date.now() + p.startIn * MIN), createdBy: interaction.user.id, source: 'manual' });
  if (res.error) return interaction.editReply({ content: res.error, components: [] });
  await report(interaction.client, `🎮 Rumble #${res.row.id} scheduled via /rumble by ${interaction.user.tag || interaction.user.id}: ${describe(res.row)}`);
  return interaction.editReply({ content: `Scheduled! ${describe(res.row)}`, components: [] });
}

// every button whose customId starts with "rumble_" (routed from interactionCreate)
async function handleButton(interaction) {
  try {
    const [action, id] = interaction.customId.split(':');
    if (action === 'rumble_join') return await handleJoin(interaction, Number(id));
    if (action === 'rumble_ok') return await handlePreviewButton(interaction, 'ok', id);
    if (action === 'rumble_no') return await handlePreviewButton(interaction, 'no', id);
  } catch (err) {
    console.error('rumble button:', err.message);
    const msg = ephemeral('Something went wrong, please try again.');
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
}

// ---------------------------------------------------------------- startup check (no secrets)
// one warning line when RUMBLE_ROUND_SECONDS is below the minimum ('' when fine)
function roundSecondsNote() {
  const raw = Number(R().roundSeconds);
  return !(raw >= MIN_ROUND_SECONDS) ? `⚠️  RUMBLE_ROUND_SECONDS=${R().roundSeconds} is below the minimum, using ${MIN_ROUND_SECONDS} seconds between rounds.` : '';
}

async function startupCheck(client) {
  try {
    const note = roundSecondsNote();
    if (note) console.warn(note);
    const raw = R().channelId;
    if (!raw) return console.warn('RUMBLE_CHANNEL_ID: not set. Rumble Royale is off until you add it to .env (no other channel is ever used).');
    if (!rumbleChannelId()) return console.warn('RUMBLE_CHANNEL_ID: set but NOT a valid channel ID (should be 17-20 digits, no quotes or spaces). Rumble Royale is off.');
    const channel = await getTextChannel(client, raw);
    if (!channel) return console.warn('RUMBLE_CHANNEL_ID: set, but the channel was NOT found (wrong ID, not a text channel, or the bot cannot see it). Rumble Royale cannot run.');
    const perms = channel.permissionsFor?.(client.user);
    const need = [
      ['ViewChannel', 'View Channel'],
      ['SendMessages', 'Send Messages'],
      ['ReadMessageHistory', 'Read Message History'],
    ];
    const missing = perms ? need.filter(([flag]) => !perms.has(PermissionFlagsBits[flag])).map(([, n]) => n) : [];
    console.log(`RUMBLE_CHANNEL_ID: set, channel found (#${channel.name})${missing.length ? '' : ', permissions OK'}`);
    if (missing.length) console.warn(`⚠️  Rumble channel: the bot is missing ${missing.join(', ')}.`);
    if (config.verifiedRoleId) {
      const role = await channel.guild.roles.fetch(config.verifiedRoleId).catch(() => null);
      const canMentionAll = perms?.has(PermissionFlagsBits.MentionEveryone);
      if (!role) console.warn('⚠️  Rumble: VERIFIED_ROLE_ID was not found in the server, so the join ping and the verified-only rule cannot work.');
      else if (!role.mentionable && !canMentionAll) console.warn('⚠️  Rumble: the verified role is not mentionable and the bot lacks "Mention @everyone, @here and All Roles" in the Rumble channel, so the ping will not notify anyone.');
    } else if (R().requireVerified) {
      console.warn('⚠️  Rumble: RUMBLE_REQUIRE_VERIFIED is true but VERIFIED_ROLE_ID is empty, so anyone can join and nobody is pinged.');
    }
  } catch (err) {
    console.error('rumble startup check:', err.message);
  }
}

module.exports = {
  type,
  label,
  about,
  fields,
  aiLine,
  planOrder,
  buildParams: buildRumbleParams,
  describe,
  tick,
  cancel,
  reschedule,
  handleMessage,
  isLive: (taskId) => !!gameByTask(taskId),
  isLiveIn,
  // shared by both entry points
  classifyPrize,
  parseJoinMinutes,
  parseMinPlayers,
  buildRumbleParams,
  createRumble,
  summary,
  payout,
  handleSlash,
  handleButton,
  startupCheck,
  MISSING_CHANNEL,
  // for tests only
  _test: {
    games, gameByTask, closeJoin, playRound, previews, getLastEnded: () => lastEnded, globalBags, pulse,
    timing, roundSeconds, roundSecondsNote, rankRunnersUp, newGame, FINAL_SUSPENSE_MS, END_GAP_MS,
  },
};
