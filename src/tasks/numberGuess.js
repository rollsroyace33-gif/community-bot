// Number Guess Game task.
//
// Every task type module exports the same shape (see registry.js):
//   type, label        id used in the DB / parser, and a human name
//   about()            what this task does, told to the AI so Vexo can explain itself honestly
//   fields             which extra JSON fields the AI may extract for this task (besides time)
//   buildParams(p)     parsed order -> { params } or { error }
//   describe(task)     one-line summary for the control channel
//   tick(task, ctx)    called every scheduler tick while the task is pending/announced/running
//   cancel(task, ctx)  stop it (also ends a live game)
//   reschedule(task, date, ctx)
//   handleMessage(msg) optional: true = this task owns the message (Q&A stays out)
//
// Timeline for a game at time T: announce at T-10min (role ping), reminder at T-2min,
// start at T, end on the first correct guess or after GAME_DURATION_MINUTES.
//
// SECRET NUMBER: lives only in memory (games map) and in the DB task state. It is never
// logged, never given to the AI, and only shown publicly once the game is over.
const crypto = require('crypto');
const config = require('../config');
const personality = require('../personality');
const identity = require('../identity');
const store = require('./store');
const { report } = require('./report');
const { ts, when } = require('./time');
const { getTextChannel } = require('../utils');
// shared with Rumble Royale: the prize classifier and the safe, idempotent points payout
const { classifyPrize, payout } = require('./rumbleRoyale');

const type = 'number_guess';
const label = 'Number guess game';

const MIN = 60 * 1000;
const MISSED_GRACE_MS = 2 * MIN; // more than this late (bot was offline) = report, don't run
const REMIND_BEFORE_MS = 2 * MIN;
const GUESS_GAP_MS = 3000; // one guess per member every 3 seconds
const REACT_CHANCE = 1 / 3; // react to ~1 in 3 wrong guesses (never the same member twice in a row)
const BANTER_CHANCE = 1 / 3; // join in on ~1 in 3 chat messages nobody addressed to Vexo
const BANTER_GAP_MS = 20 * 1000; // channel-wide gap between unprompted AI banter replies (cost + spam)
const MENTION_GAP_MS = 15 * 1000; // per member, when they talk to Vexo during a game
const DEFAULT_RANGE = [1, 100];

const games = new Map(); // channelId -> live game (one game per channel)
const gameByTask = (id) => [...games.values()].find((g) => g.taskId === id) || null;

// ---------------------------------------------------------------- templates
const lastPick = new Map(); // template list -> last index, so the same line never repeats back to back
function vary(list) {
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastPick.get(list)) i = (i + 1) % list.length;
  lastPick.set(list, i);
  return list[i];
}
const mins = (m) => `${m} minute${m === 1 ? '' : 's'}`;
const prizeText = (p) => (p ? ` Prize: **${p}** 🎁` : '');

// at = start time as a Discord timestamp ("<t:UNIX:t>": each member sees their own local time)
const ANNOUNCE = [
  (who, m, p, at) => `${who}🎲 Vexo's **Number Guess Game** starts in **${mins(m)}** (${at})!${p} Stretch those lucky fingers and come join!`,
  (who, m, p, at) => `${who}Heads up! In **${mins(m)}** (${at}) I'm hiding a secret number and you get to hunt it down 🔍${p} Be there!`,
  (who, m, p, at) => `${who}Game time is close! **Number Guess Game** in **${mins(m)}** (${at}) right here.${p} Bring your best guesses 🎯`,
  (who, m, p, at) => `${who}Clear your schedule: the **Number Guess Game** kicks off in **${mins(m)}** (${at})!${p} Don't miss it ✨`,
];
const REMIND = [
  (m) => `⏰ Only **${mins(m)}** until the Number Guess Game! Last call, grab your snacks.`,
  (m) => `**${mins(m)}** to go! Warming up my secret-number vault 🔐`,
  (m) => `Almost time! The game starts in **${mins(m)}**. Get those fingers ready 🎯`,
];
const START = [
  (lo, hi) => `🎮 **The game is ON!** I'm thinking of a number between **${lo} and ${hi}**. Type a number in this chat to guess!`,
  (lo, hi) => `🎲 Let's go! My secret number is somewhere between **${lo} and ${hi}**. First correct guess wins!`,
  (lo, hi) => `🔐 Number locked in! It's between **${lo} and ${hi}**. Start guessing, detectives!`,
];
// NO HINTS: wrong guesses get (sometimes) a playful line that says NOTHING about the number.
// No higher/lower, no "close", no warm/cold. The same lines go to every wrong guess at random,
// so even which guesses get a reaction carries no information.
const REACTIONS = [
  'Bold guess, I respect it 😄', 'Not it, but I love the confidence!', 'Nope! The vault stays shut 🔐',
  'Swing and a miss! Keep going.', 'Not today, my friend.', 'Denied! But the energy is great.',
  'Plot twist: not it.', 'Respectfully, no 😄', 'Ooh, brave. Still not it!', 'Wrong, but stylish.',
  'Not it! The suspense continues.', 'Miss! But nobody can say you didn\'t try.', 'Not the one. The hunt goes on!',
  'Negative, detective. Keep digging 🔍', 'My poker face is holding strong 😐', 'Nope, and the tension is real 😬',
];
const OUT_OF_RANGE = [
  (lo, hi) => `Whoa there! Stay inside the range: **${lo} to ${hi}** 😄`,
  (lo, hi) => `That's off the map! Only numbers from **${lo} to ${hi}** count.`,
  (lo, hi) => `Nice try, but my number lives between **${lo} and ${hi}** 🙃`,
];
const OUT_OF_GUESSES = [
  'You\'ve used all your guesses this round! Cheer the others on 📣',
  'Out of guesses, champ! Time to be the hype squad 🎉',
];
const REPEAT = ['You already tried that one 👀', 'Same number again? Bold strategy.', 'Déjà vu! You guessed that already.'];
const REPEAT_BOSS = REPEAT.filter((l) => !l.includes('?'));
const WIN = [
  (u, n, p) => `🎉 **WE HAVE A WINNER!** ${u} cracked it, the number was **${n}**!${p}`,
  (u, n, p) => `🏆 BOOM! ${u} guessed **${n}** and takes the crown!${p}`,
  (u, n, p) => `✨ Legendary! ${u} found my secret number **${n}**!${p} GG everyone!`,
];
const TIMEOUT = [
  (n) => `⏱️ Time's up! Nobody found it this round. The secret number was **${n}**. Thanks for playing, you were all amazing!`,
  (n) => `⏱️ That's the buzzer! The number was **${n}**, sneaky one, huh? Thanks for playing, see you next round!`,
];
const CANCELLED = [(n) => `🛑 The boss called this round off. The secret number was **${n}**. Thanks for playing, see you next time!`];
const RESTARTED = [(n) => `😵 Oops, I glitched and the game got cut short. No winner this round. (The number was **${n}**.) Sorry, we'll play again soon!`];
const POSTPONED = ['📅 Change of plans: the Number Guess Game is not happening at the announced time. Stay tuned!'];
const MOVED = [(at) => `📅 Change of plans: the Number Guess Game moved to **${at}**. See you then!`];

// ---------------------------------------------------------------- what the AI is told
function about() {
  const g = config.game;
  return (
    `Number guess game: hosted in the general channel at the scheduled time. ${g.announceMinutes} minutes before, ` +
    'Vexo posts an announcement that pings the verified role; 2 minutes before, a reminder. At start Vexo picks a secret ' +
    'number (default 1-100, custom range allowed). Members guess by typing numbers. There are NO hints (no higher/lower): ' +
    'Vexo only reacts playfully now and then and chats with everyone. One guess ' +
    `every 3 seconds, max ${g.maxGuessesPerUser} guesses each. First correct guess wins and the boss gets a report ` +
    `(winner, number, stats). If nobody wins in ${g.durationMinutes} minutes, the number is revealed. ` +
    'Optional prize: a points prize ("50 points") is sent to the winner automatically; any other prize (NFT, SOL, WL...) ' +
    'is claimed via a ticket. One game per channel at a time.'
  );
}
const fields = '"prize" (short text like "50 points", or null), "range" ([min,max] or null for 1-100)';

// a points prize above RUMBLE_MAX_POINTS_PRIZE needs a second confirm (typo guard, same limit as Rumble)
const isBigPrize = (params) => params.prize_type === 'points' && params.prize_points > config.rumble.maxPointsPrize;

// params saved before prize_type existed: classified the same way
const prizeInfo = (params = {}) => (params.prize_type ? params : { ...params, ...classifyPrize(params.prize) });

function buildParams(p) {
  let range = DEFAULT_RANGE;
  if (Array.isArray(p.range) && p.range.length === 2) {
    const [lo, hi] = p.range.map(Number);
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi - lo < 9 || hi - lo > 1000000) {
      return { error: 'That number range looks off, boss. Try something like 1-100.' };
    }
    range = [lo, hi];
  }
  // same classifier as Rumble: "20 points" = auto-paid points, other text = ticket prize, empty = none
  const { prize, prize_type, prize_points } = classifyPrize(typeof p.prize === 'string' ? p.prize : '');
  return { params: { range, prize, prize_type, prize_points } };
}

function describe(task) {
  const [lo, hi] = task.params?.range || DEFAULT_RANGE;
  const prize = task.params?.prize ? ` · prize: ${task.params.prize}` : '';
  return `**#${task.id}** ${label} · ${when(task.run_at)} · <#${task.channel_id}> · ${lo}-${hi}${prize} · ${task.status}`;
}

// ---------------------------------------------------------------- helpers
async function send(client, channelId, content, allowedMentions = { parse: [] }) {
  const channel = await getTextChannel(client, channelId);
  if (!channel) throw new Error(`channel ${channelId} not found`);
  return channel.send({ content, allowedMentions });
}

const reply = (message, content) =>
  message.reply({ content, allowedMentions: { repliedUser: false, parse: [] } }).catch((err) => console.error('game reply:', err.message));

// ---------------------------------------------------------------- scheduler tick
async function tick(task, { client }) {
  const now = Date.now();
  const runAt = Date.parse(task.run_at);

  // a game from this process is live: only check the clock
  const live = gameByTask(task.id);
  if (live) {
    if (now >= live.endsAt) await endGame(live, client, 'timeout');
    return;
  }
  // "running" in the DB but not in memory = the bot restarted mid-game
  if (task.status === 'running') return endAfterRestart(task, client);
  // the bot was offline at start time: tell the boss instead of starting very late
  if (now > runAt + MISSED_GRACE_MS) return markMissed(task, client);

  let { status } = task;
  const state = { ...(task.state || {}) };

  if (status === 'pending' && now >= runAt - config.game.announceMinutes * MIN) {
    // DB first, so a failed post can never turn into a repeated announcement every tick
    state.reminded = runAt - now <= REMIND_BEFORE_MS + MIN || config.game.announceMinutes <= 2;
    if (!(await store.update(task.id, { status: 'announced', state }, ['pending']))) return;
    status = 'announced';
    const role = config.verifiedRoleId;
    const left = Math.max(1, Math.round((runAt - now) / MIN));
    const at = ts(runAt, 't');
    await send(client, task.channel_id, vary(ANNOUNCE)(role ? `<@&${role}> ` : '', left, prizeText(task.params?.prize), at), {
      roles: role ? [role] : [], // only the verified role is pinged. never @everyone / @here
    }).catch((err) => report(client, `⚠️ Boss, I couldn't post the announcement for game #${task.id}: ${err.message}`));
  }

  if (status === 'announced' && !state.reminded && now >= runAt - REMIND_BEFORE_MS && now < runAt) {
    state.reminded = true;
    if (!(await store.update(task.id, { state }, ['announced']))) return;
    const left = Math.max(1, Math.round((runAt - now) / MIN));
    await send(client, task.channel_id, vary(REMIND)(left)).catch((err) => console.error('game reminder:', err.message));
  }

  if (status === 'announced' && now >= runAt) await startGame({ ...task, state }, client);
}

async function startGame(task, client) {
  const [lo, hi] = task.params?.range || DEFAULT_RANGE;

  if (games.has(task.channel_id)) {
    await store.update(task.id, { status: 'cancelled', state: { ...task.state, endReason: 'channel_busy' } }, ['announced']);
    return report(client, `⚠️ Boss, game #${task.id} was cancelled: another game is already running in <#${task.channel_id}>.`);
  }
  if (!(await getTextChannel(client, task.channel_id))) {
    await store.update(task.id, { status: 'cancelled', state: { ...task.state, endReason: 'no_channel' } }, ['announced']);
    return report(client, `⚠️ Boss, game #${task.id} was cancelled: I can't find or post in <#${task.channel_id}>.`);
  }

  const now = Date.now();
  const game = {
    taskId: task.id,
    channelId: task.channel_id,
    min: lo,
    max: hi,
    secret: crypto.randomInt(lo, hi + 1), // crypto-secure, upper bound is exclusive
    prize: task.params?.prize || null,
    params: prizeInfo(task.params || {}),
    startedAt: now,
    endsAt: now + config.game.durationMinutes * MIN,
    maxGuesses: config.game.maxGuessesPerUser,
    state: task.state,
    guesses: new Map(), // userId -> guess count
    lastGuessAt: new Map(), // userId -> timestamp
    lastGuessValue: new Map(), // userId -> last number
    lastMentionAt: new Map(), // userId -> timestamp
    lastReactedTo: null, // userId of the last wrong-guess reaction (never the same member twice in a row)
    decks: new Map(), // line list -> lines not used yet (no repeats)
    lastLine: new Map(), // line list -> last line used
    outNotified: new Set(),
    totalGuesses: 0,
    lastBanterAt: 0,
    winner: null,
    ended: false,
  };
  // memory first: if the DB write fails, the tick still sees the live game and won't start a second one
  games.set(game.channelId, game);
  const row = await store
    .update(task.id, { status: 'running', state: { ...task.state, secret: game.secret, startedAt: new Date(now).toISOString() } }, ['announced'])
    .catch((err) => {
      console.error(`game #${task.id} start save:`, err.message);
      return true; // keep the game going, it is already live in memory
    });
  if (!row) {
    games.delete(game.channelId); // cancelled by the boss at the same moment
    return;
  }

  const rules = `\n_One guess every 3 seconds · max ${game.maxGuesses} guesses each · ${mins(config.game.durationMinutes)} on the clock._`;
  await send(client, game.channelId, vary(START)(lo, hi) + prizeText(game.prize) + rules).catch((err) =>
    console.error('game start message:', err.message)
  );
}

// reason: winner | timeout | cancelled
async function endGame(game, client, reason) {
  if (game.ended) return;
  game.ended = true;
  games.delete(game.channelId); // from here on, messages in this channel go back to normal

  const players = game.guesses.size;
  const w = game.winner;
  const prizeParams = game.params || prizeInfo({ prize: game.prize });
  const isPoints = reason === 'winner' && prizeParams.prize_type === 'points';
  // points prize: credited BEFORE the announcement, through the Rumble payout (point_log + "paid" flag = never twice)
  let pay = null;
  if (isPoints) {
    game.state = { ...game.state, secret: game.secret, winner: { id: w.id, tag: w.tag, guesses: w.guesses } };
    pay = await payout({ taskId: game.taskId, state: game.state, winnerId: w.id, amount: prizeParams.prize_points, reason: `number_guess_prize task #${game.taskId}` });
  }
  try {
    if (reason === 'winner') {
      const claim = config.channels.ticket
        ? ` Open a ticket in <#${config.channels.ticket}> to claim your prize!`
        : ' Open a ticket to claim your prize!';
      // points sent = say so; payout failed or ticket prize = open a ticket; no prize = just celebrate
      const tail = isPoints && pay.ok ? ` **${prizeParams.prize_points} points** have been sent to your balance! 💰` : prizeParams.prize_type === 'none' ? '' : claim;
      await send(client, game.channelId, vary(WIN)(`<@${w.id}>`, game.secret, prizeText(game.prize)) + tail, { users: [w.id] });
    } else {
      await send(client, game.channelId, vary(reason === 'cancelled' ? CANCELLED : TIMEOUT)(game.secret));
    }
  } catch (err) {
    console.error('game end message:', err.message);
  }

  await store
    .update(game.taskId, {
      status: reason === 'cancelled' ? 'cancelled' : 'done',
      state: {
        ...game.state,
        secret: game.secret,
        endReason: reason,
        endedAt: new Date().toISOString(),
        winner: w ? { id: w.id, tag: w.tag, guesses: w.guesses } : null,
        totalGuesses: game.totalGuesses,
        participants: players,
      },
    })
    .catch((err) => console.error(`game #${game.taskId} end save:`, err.message));

  const stats = `Secret number: **${game.secret}** · ${game.totalGuesses} guesses from ${players} player${players === 1 ? '' : 's'}`;
  const prize = game.prize ? `Prize: **${game.prize}**` : 'Prize: none set';
  if (reason === 'winner') {
    let prizeLine;
    if (isPoints && pay.ok) {
      const bal = typeof pay.balance === 'number' ? ` New balance: **${pay.balance}** points.` : ' (already in the point log, not paid twice)';
      prizeLine = `${prize}. ✅ **${prizeParams.prize_points} points credited automatically** to ID \`${w.id}\`.${bal}`;
    } else if (isPoints) {
      prizeLine = `${prize}. ❌ **Payout FAILED** for winner ID \`${w.id}\`, amount **${prizeParams.prize_points} points**: ${pay.error}. They were told to open a ticket, please credit it by hand.`;
    } else if (prizeParams.prize_type === 'ticket') {
      prizeLine = `${prize} (ticket prize). Deliver it once they open a ticket.`;
    } else {
      prizeLine = prize;
    }
    await report(client, `🏆 Boss, game #${game.taskId} is done!\nWinner: **${w.tag}** (<@${w.id}>, ID \`${w.id}\`), won on their guess #${w.guesses}\n${stats}\n${prizeLine}`);
  } else if (reason === 'timeout') {
    await report(client, `⏱️ Boss, game #${game.taskId} ended with **no winner**.\n${stats}\n${prize} (not given out).`);
  } else {
    await report(client, `🛑 Game #${game.taskId} cancelled while running.\n${stats}`);
  }
}

async function endAfterRestart(task, client) {
  const state = task.state || {};
  const row = await store.update(task.id, { status: 'done', state: { ...state, endReason: 'restart', endedAt: new Date().toISOString() } }, ['running']);
  if (!row) return;
  if (state.secret !== undefined) {
    await send(client, task.channel_id, vary(RESTARTED)(state.secret)).catch((err) => console.error('game restart message:', err.message));
  }
  await report(client, `⚠️ Boss, I restarted while game #${task.id} was running, so I ended it safely with no winner. Order a new one if you want a rematch.`);
}

async function markMissed(task, client) {
  const row = await store.update(task.id, { status: 'cancelled', state: { ...task.state, endReason: 'missed' } }, ['pending', 'announced']);
  if (!row) return;
  if (task.status === 'announced') {
    await send(client, task.channel_id, vary(POSTPONED)).catch((err) => console.error('game postponed message:', err.message));
  }
  await report(
    client,
    `⚠️ Boss, I was offline at ${ts(task.run_at, 't')}, so I skipped game #${task.id} instead of starting it late. Give me a new time (or say "run a game now") if you still want it.`
  );
}

// ---------------------------------------------------------------- control actions
async function cancel(task, { client }) {
  const live = gameByTask(task.id);
  if (live) return endGame(live, client, 'cancelled');
  const row = await store.update(task.id, { status: 'cancelled', state: { ...task.state, endReason: 'cancelled' } }, ['pending', 'announced']);
  if (row && task.status === 'announced') {
    await send(client, task.channel_id, vary(POSTPONED)).catch((err) => console.error('game cancel message:', err.message));
  }
  return row;
}

// quiet = don't post "game moved" (used by "run now": the new announcement says it all)
async function reschedule(task, date, { client, quiet = false }) {
  // back to pending: the announcement + reminder run again for the new time
  const row = await store.update(
    task.id,
    { run_at: date.toISOString(), status: 'pending', state: { ...task.state, reminded: false } },
    ['pending', 'announced']
  );
  if (row && task.status === 'announced' && !quiet) {
    await send(client, task.channel_id, vary(MOVED)(when(date))).catch((err) => console.error('game moved message:', err.message));
  }
  return row;
}

// ---------------------------------------------------------------- live game chat
// Returns true when a game is running in this channel (the game then owns the channel).
// mayReply: false = the boss is not talking to Vexo (bossGate.js): no banter and no flavor line on his
// wrong guesses. His guesses still count, a win still ends the game, rule notices are still sent.
async function handleMessage(message, { mayReply = true } = {}) {
  const game = games.get(message.channelId);
  if (!game || game.ended) return false;

  // a guess is a message that is just a number: "42", "42!", "#42"
  const m = /^#?\s*(-?\d{1,9})\s*[!?.]*$/.exec(message.content.trim());
  if (!m) {
    if (mayReply) await maybeBanter(message, game);
    return true;
  }

  const uid = message.author.id;
  const now = Date.now();
  if (now - (game.lastGuessAt.get(uid) || 0) < GUESS_GAP_MS) return true; // too fast, ignored
  game.lastGuessAt.set(uid, now);

  const n = Number(m[1]);
  if (n < game.min || n > game.max) {
    await reply(message, vary(OUT_OF_RANGE)(game.min, game.max));
    return true;
  }

  const used = game.guesses.get(uid) || 0;
  if (used >= game.maxGuesses) {
    if (!game.outNotified.has(uid)) {
      game.outNotified.add(uid);
      await reply(message, vary(OUT_OF_GUESSES));
    }
    return true;
  }
  game.guesses.set(uid, used + 1);
  game.totalGuesses += 1;

  // Winner check: no await between reading and setting game.winner, so even two correct
  // guesses arriving at the same moment can only produce one winner.
  if (n === game.secret) {
    if (!game.winner) {
      game.winner = { id: uid, tag: message.author.tag, guesses: used + 1 };
      await endGame(game, message.client, 'winner');
    }
    return true;
  }

  // wrong guess: the secret is NOT used below this line, so nothing here can leak it
  const repeated = game.lastGuessValue.get(uid) === n;
  game.lastGuessValue.set(uid, n);
  const line = mayReply ? guessReaction(game, uid, { repeated }) : null;
  if (line) await reply(message, line);
  return true;
}

// Deal lines like cards: every line is used once before any line comes back, and the first
// line of a new round is never the one just used. So no repeated wording in a row.
function deal(game, list) {
  let deck = game.decks.get(list);
  if (!deck || !deck.length) {
    deck = [...list];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); // Fisher-Yates shuffle
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    if (deck.length > 1 && deck[deck.length - 1] === game.lastLine.get(list)) deck.unshift(deck.pop());
    game.decks.set(list, deck);
  }
  const line = deck.pop();
  game.lastLine.set(list, line);
  return line;
}

// Reaction to a wrong guess, or null = stay silent. Never looks at the secret number.
// ~1 in 3 guesses get one, and never the same member twice in a row.
function guessReaction(game, uid, { repeated = false } = {}, rand = Math.random) {
  if (game.lastReactedTo === uid) return null;
  if (!repeated && rand() >= REACT_CHANCE) return null; // a repeated number always gets a friendly nudge
  game.lastReactedTo = uid;
  // the boss is never asked anything, not even "Same number again?"
  if (repeated && identity.isBoss(uid)) return deal(game, REPEAT_BOSS);
  return deal(game, repeated ? REPEAT : REACTIONS);
}

// Non-guess chat during a game. Talking to Vexo (mention, reply to Vexo, "vexo", or asking for a
// hint) always gets an answer (per-member gap); other chat only ~1 in 3, with a channel-wide gap.
async function maybeBanter(message, game) {
  const now = Date.now();
  const botId = message.client.user.id;
  const talkingToVexo =
    message.mentions.users.has(botId) ||
    message.mentions.repliedUser?.id === botId ||
    /\bvexo\b/i.test(message.content) ||
    personality.isHintRequest(message.content);
  if (talkingToVexo) {
    if (now - (game.lastMentionAt.get(message.author.id) || 0) < MENTION_GAP_MS) return;
    game.lastMentionAt.set(message.author.id, now);
  } else if (Math.random() >= BANTER_CHANCE || now - game.lastBanterAt < BANTER_GAP_MS) {
    return;
  }
  game.lastBanterAt = now;
  // the AI is never told the secret number, so no message can trick it into revealing it
  const line = await personality.gameBanter(message.content.replace(/<@!?\d+>/g, '').trim(), {
    min: game.min,
    max: game.max,
    guesses: game.totalGuesses,
    players: game.guesses.size,
    isBoss: identity.isBoss(message.author), // the boss is "boss" in the game channel too
  });
  await reply(message, line);
}

module.exports = {
  type,
  label,
  about,
  fields,
  buildParams,
  isBigPrize,
  describe,
  tick,
  cancel,
  reschedule,
  handleMessage,
  isLive: (taskId) => !!gameByTask(taskId),
  // for tests only: the no-hint reaction generator and its line lists
  _test: { guessReaction, REACTIONS, REPEAT, REPEAT_BOSS },
};
