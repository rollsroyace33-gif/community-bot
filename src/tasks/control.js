// Control channel: the boss (BOSS_USER_ID) and staff (STAFF_ROLE_IDS) talk to Vexo naturally in
// English / Bangla / Banglish. Each message gets ONE AI call (parser.js) that decides the intent
// and writes Vexo's reply. Every change is summarized first and only happens after a "yes".
// Orders are accepted ONLY in CONTROL_CHANNEL_ID, and only from authorized users.
const config = require('../config');
const store = require('./store');
const registry = require('./registry');
const { understand } = require('./parser');
const { tickSoon } = require('./scheduler');
const { fmtUtc, bossLocal, resolveTime, hideLocalZone } = require('./time');
const { tidy, stripPitch } = require('../personality');
const knowledge = require('../knowledge');
const identity = require('../identity');

// boss = BOSS_USER_ID only (shared check, same as every other channel)
const isBoss = (message) => identity.isBoss(message.author);

const PENDING_TTL_MS = 10 * 60 * 1000; // an unconfirmed action expires after 10 minutes
const MAX_HISTORY = 10; // control channel memory: last 10 messages
const MAX_AHEAD_MS = 30 * 86400000;
const MIN_NOTICE_MS = 60 * 1000; // "now" = in 1 minute, so members get a heads-up

// Memory is per control channel (there is only one): recent lines + the action awaiting yes/no
let history = []; // "Boss (name): ..." / "Vexo: ..."
let pending = null; // { kind, draft, describe, run, expiresAt }

// Used only when the AI is down: a plain yes / no still works for the pending action
const YES = /^(y|yes|yeah|yep|ok|okay|confirm|sure|go|do it|ha+|ha+n|hya|ji|thik ache|ha thik ache|হ্যাঁ|হ্যা|হা|জি|ঠিক আছে|ওকে)[\s.!👍✅]*$/iu;
const NO = /^(n|no|nope|nah|na+|cancel|stop|baad dao|bad dao|thak|na thak|lagbe na|না|নাহ|বাদ দাও|থাক|লাগবে না)[\s.!❌]*$/iu;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// backups for when the AI gives no usable opener / reply
const OPENERS = ['Got it, boss!', 'On it, boss!', 'Sure thing, boss!', 'Roger that, boss!'];
const GLITCH = [
  'My brain lagged for a sec, boss 😵 Say that again?',
  'Signal got fuzzy on my end, boss. Mind repeating that?',
  'Oops, I blanked out there, boss. One more time?',
];
const DROPPED = ['Dropped it, nothing changed.', 'Scrapped, nothing changed.', 'Forgotten. Nothing changed.'];

function isAuthorized(message) {
  if (isBoss(message)) return true;
  return !!message.member?.roles?.cache?.some((r) => config.staffRoleIds.includes(r.id));
}

const speakerName = (message) => `${isBoss(message) ? 'Boss' : 'Staff'} (${message.author.username})`;

function remember(line) {
  history.push(line.replace(/\s*\n\s*/g, ' / ').slice(0, 500)); // one line per message in the prompt
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
}

function getPending() {
  if (pending && Date.now() > pending.expiresAt) pending = null;
  return pending;
}

// Reply in the control channel and remember it. `note` is extra context for the AI's memory only.
async function say(message, content, note = '') {
  const text = hideLocalZone(content).slice(0, 1900);
  remember(`Vexo: ${text}${note ? ` [${note}]` : ''}`);
  await message
    .reply({ content: text, allowedMentions: { repliedUser: false, parse: [] } })
    .catch((err) => console.error('control reply:', err.message));
}

// AI text -> safe text (no mentions, max one emoji, no local zone name, no community pitch)
const clean = (s) => hideLocalZone(stripPitch(tidy(String(s || ''))));
// short opener for action replies; falls back if the AI wrote something long or nothing
const opener = (ai) => {
  const s = clean(ai?.reply);
  return s && s.length <= 80 ? s : pick(OPENERS);
};

// ---------------- helpers ----------------
// minNoticeMs: "now" becomes "in 1 minute" for the number guess game; a Rumble can open right away (0)
function checkTime(t, minNoticeMs = MIN_NOTICE_MS) {
  const d = resolveTime(t);
  if (!d) return { question: pick(['What time should I run it, boss?', 'When do you want it, boss?']) };
  const now = Date.now();
  if (d.getTime() < now - 2 * 60 * 1000) return { question: `${fmtUtc(d)} has already passed, boss. Want a later time?` };
  if (d.getTime() > now + MAX_AHEAD_MS) return { question: "That's more than 30 days away, boss. Pick a closer time?" };
  return { date: new Date(Math.max(d.getTime(), now + minNoticeMs)) };
}

// channel the boss named -> id; null = none named; undefined = named but not found
function resolveChannel(message, name) {
  if (!name) return null;
  const mentioned = message.mentions.channels.first();
  if (mentioned) return mentioned.id;
  const wanted = String(name).replace(/^<#(\d+)>$/, '$1').replace(/^#/, '').trim().toLowerCase();
  if (/^\d{15,}$/.test(wanted)) return wanted;
  if (wanted === 'general') return config.channels.general;
  const found = message.guild.channels.cache.find((c) => c.name.toLowerCase() === wanted && c.isTextBased());
  return found ? found.id : undefined;
}

const listLines = (tasks) => tasks.map((t) => registry.get(t.type)?.describe(t) || `#${t.id} ${t.type}`).join('\n');

// One line per task for the AI: the boss's clock (to understand him) + the UTC form (to quote)
function taskLine(t) {
  const custom = registry.get(t.type)?.aiLine; // task types with other fields (Rumble Royale) describe themselves
  if (custom) return custom(t, { bossLocal });
  const [lo, hi] = t.params?.range || [1, 100];
  return (
    `#${t.id} ${t.type} | boss clock ${bossLocal(t.run_at)} | shown as ${fmtUtc(t.run_at)} | status ${t.status}` +
    ` | prize ${t.params?.prize || 'none'} | range ${lo}-${hi}` +
    ` | channel ${t.channel_id === config.channels.general ? 'general' : 'other'}`
  );
}

// which scheduled task the boss means
async function pickTarget(message, ai, active) {
  const target = ai.task_id ? active.find((t) => t.id === ai.task_id) : active.length === 1 ? active[0] : null;
  if (target) return target;
  if (!active.length) await say(message, `${opener(ai)} Nothing is scheduled right now, though 🗓️`);
  else await say(message, `Which one, boss? Tell me the number:\n${listLines(active)}`);
  return null;
}

// store an action that runs on "yes", and show its summary
function propose(message, kind, draft, describe, summary, run) {
  pending = { kind, draft, describe, run, expiresAt: Date.now() + PENDING_TTL_MS };
  return say(message, summary);
}

// ---------------- actions ----------------
// Task types with their own planning (Rumble Royale): the handler checks everything and builds the
// summary; this file only runs the usual yes/no flow (plus a second yes for a huge points prize).
async function plannedOrder(message, ai, handler) {
  const plan = await handler.planOrder({
    ai,
    text: message.content,
    checkTime: (t) => checkTime(t, 0),
    createdBy: message.author.id,
  });
  if (plan.question || plan.error) return say(message, plan.question || plan.error);

  const create = async () => {
    const res = await plan.create();
    if (res.error) return { text: res.error };
    tickSoon();
    return { text: `Scheduled ${handler.describe(res.row)}`, note: `task #${res.row.id} created: ${plan.describe}` };
  };
  const summary = `${opener(ai)}\n${plan.summary}\nConfirm? (yes/no)`;
  if (!plan.doubleCheck) return propose(message, 'schedule', plan.draft, plan.describe, summary, create);
  // typo guard: the first yes asks once more
  return propose(message, 'schedule', plan.draft, plan.describe, summary, async () => {
    pending = { kind: 'schedule', draft: plan.draft, describe: `${plan.describe} (waiting for the second yes)`, run: create, expiresAt: Date.now() + PENDING_TTL_MS };
    return { text: `${plan.doubleCheck}\nConfirm again? (yes/no)`, note: 'waiting for the second yes (big points prize)' };
  });
}

async function scheduleOrder(message, ai, active) {
  const handler = registry.get(ai.task_type) || registry.get('number_guess');
  if (handler.planOrder) return plannedOrder(message, ai, handler);
  if (!config.channels.general) {
    return say(message, "Boss, GENERAL_CHANNEL_ID is missing in .env, so I have nowhere to host the game. Add it, restart me, and ask again.");
  }
  const time = checkTime(ai.time);
  if (time.question) return say(message, time.question);

  let channelId = config.channels.general;
  let note = '';
  if (ai.channel) {
    const id = resolveChannel(message, ai.channel);
    if (id === undefined) return say(message, `I can't find a channel called "${clean(ai.channel)}", boss. Which one should I use?`);
    if (id && id !== config.channels.general) {
      channelId = id;
      note += `\n⚠️ That's **not** the general channel. Sure you want it in <#${id}>?`;
    }
  }

  const built = handler.buildParams(ai);
  if (built.error) return say(message, built.error);
  const { params } = built;

  // only one game per channel at a time: warn early about overlaps
  const windowMs = (config.game.durationMinutes + config.game.announceMinutes) * 60 * 1000;
  const clash = active.find(
    (t) => t.type === handler.type && t.channel_id === channelId && Math.abs(Date.parse(t.run_at) - time.date) < windowMs
  );
  if (clash) note += `\n⚠️ Heads up: it overlaps with #${clash.id} (${fmtUtc(clash.run_at)}). Only one game runs per channel, so the later one would be cancelled.`;

  const [lo, hi] = params.range || [1, 100];
  const prize = params.prize ? `prize: **${params.prize}**` : 'no prize';
  const summary = `${opener(ai)} ${handler.label} at **${fmtUtc(time.date)}** in <#${channelId}>, numbers ${lo}-${hi}, ${prize}.${note}\nConfirm? (yes/no)`;
  const describe =
    `schedule ${handler.type} at boss clock ${bossLocal(time.date)} (shown as ${fmtUtc(time.date, { relative: false })}), ` +
    `prize ${params.prize || 'none'}, range ${lo}-${hi}, channel ${channelId === config.channels.general ? 'general' : 'other'}`;

  return propose(message, 'schedule', { task_type: handler.type, prize: params.prize, range: params.range, channel: ai.channel }, describe, summary, async () => {
    // confirmed late? still give members at least a minute's notice
    const runAt = new Date(Math.max(time.date.getTime(), Date.now() + MIN_NOTICE_MS));
    const row = await store.create({
      type: handler.type,
      run_at: runAt.toISOString(), // UTC
      channel_id: channelId,
      params,
      status: 'pending',
      created_by: message.author.id,
      state: {},
    });
    tickSoon(); // announces right away if we're already inside the announcement window
    return { text: `Scheduled ${handler.describe(row)}`, note: `task #${row.id} created: ${describe}` };
  });
}

async function cancelOrder(message, ai, active) {
  const task = await pickTarget(message, ai, active);
  if (!task) return;
  const handler = registry.get(task.type);
  const summary = `${opener(ai)} Cancel ${handler.describe(task)}?\nConfirm? (yes/no)`;
  return propose(message, 'cancel', null, `cancel task #${task.id}`, summary, async () => {
    const fresh = await store.get(task.id);
    if (!fresh || !store.ACTIVE.includes(fresh.status)) return { text: `#${task.id} is already finished.` };
    const res = await handler.cancel(fresh, { client: message.client });
    if (res?.refused) return { text: res.refused }; // e.g. a Rumble that is already in the rounds
    return { text: `#${task.id} is cancelled.`, note: `task #${task.id} cancelled` };
  });
}

async function runNowOrder(message, ai, active) {
  const task = await pickTarget(message, ai, active);
  if (!task) return;
  if (task.status === 'running') return say(message, `#${task.id} is already running, boss 🎮`);
  const handler = registry.get(task.type);
  const summary = `${opener(ai)} Start ${handler.describe(task)} **now**? Members get a 1-minute heads-up.\nConfirm? (yes/no)`;
  return propose(message, 'run_now', null, `start task #${task.id} now`, summary, async () => {
    const fresh = await store.get(task.id);
    if (!fresh || !['pending', 'announced'].includes(fresh.status)) return { text: `#${task.id} can't be started now (it's ${fresh?.status || 'gone'}).` };
    const at = new Date(Date.now() + MIN_NOTICE_MS);
    await handler.reschedule(fresh, at, { client: message.client, quiet: true });
    tickSoon();
    return { text: `#${task.id} starts at ${fmtUtc(at)}!`, note: `task #${task.id} moved to now` };
  });
}

async function rescheduleOrder(message, ai, active) {
  // "make it 9" while a new game is still waiting for yes = update that draft instead
  const p = getPending();
  if (!ai.task_id && p?.kind === 'schedule') {
    const merged = { ...ai, task_type: p.draft.task_type };
    // keep what wasn't changed (join_minutes / min_players / time only exist in Rumble drafts)
    for (const k of ['prize', 'range', 'channel', 'join_minutes', 'min_players', 'time']) merged[k] = ai[k] ?? p.draft[k];
    return scheduleOrder(message, merged, active);
  }
  const task = await pickTarget(message, ai, active);
  if (!task) return;
  if (task.status === 'running') return say(message, `#${task.id} is already running, boss. I can only cancel it now.`);
  const time = checkTime(ai.time);
  if (time.question) return say(message, time.question);
  const handler = registry.get(task.type);
  const summary = `${opener(ai)} Move ${handler.describe(task)} to **${fmtUtc(time.date)}**?\nConfirm? (yes/no)`;
  const describe = `move task #${task.id} to boss clock ${bossLocal(time.date)} (shown as ${fmtUtc(time.date, { relative: false })})`;
  return propose(message, 'reschedule', null, describe, summary, async () => {
    const fresh = await store.get(task.id);
    if (!fresh || !['pending', 'announced'].includes(fresh.status)) return { text: `#${task.id} can't be moved now (it's ${fresh?.status || 'gone'}).` };
    const row = await handler.reschedule(fresh, time.date, { client: message.client });
    tickSoon();
    return row ? { text: `Moved: ${handler.describe(row)}`, note: describe } : { text: `Couldn't move #${task.id}. Check the list?` };
  });
}

// ---------------- knowledge: only the boss can teach / edit / forget ----------------
const ONLY_BOSS = ['Only the boss can teach me facts, sorry 🙏', "Facts come from the boss only, so I can't take that one."];
const factText = (s) => String(s || '').replace(/@(everyone|here)/gi, '').replace(/\s+/g, ' ').trim().slice(0, 500);
const secretWarning = (kind) =>
  `⚠️ Boss, that looks like ${kind}. I won't save it. Please never paste passwords, seed phrases or keys anywhere, including here.`;
const factLines = (facts) => facts.map((f) => `#${f.id} ${f.fact}`).join('\n');

// mark unanswered questions this fact answers; returns a short note for the reply
async function resolveQuestions(ids) {
  if (!ids.length) return '';
  try {
    const done = await knowledge.resolveUnanswered(ids);
    return done.length ? ` That also answers ${done.length} open question${done.length === 1 ? '' : 's'}.` : '';
  } catch (err) {
    console.error('resolve unanswered:', err.message);
    return '';
  }
}

async function pickFact(message, ai) {
  const facts = knowledge.getFacts();
  const fact = ai.fact_id ? facts.find((f) => f.id === ai.fact_id) : null;
  if (fact) return fact;
  if (!facts.length) await say(message, "You haven't taught me anything yet, boss.");
  else await say(message, `Which fact, boss? Tell me the number:\n${factLines(facts)}`);
  return null;
}

async function teachFact(message, ai) {
  if (!isBoss(message)) return say(message, pick(ONLY_BOSS));
  const text = factText(ai.fact);
  if (!text) return say(message, 'What should I remember, boss?');
  const secret = knowledge.looksSecret(text);
  if (secret) return say(message, secretWarning(secret));
  const same = knowledge.findSameFact(text);
  if (same) return say(message, `I already know that one, boss (fact #${same.id}).`);
  const row = await knowledge.addFact(text, message.author.id);
  return say(message, `${opener(ai)} Saved as fact #${row.id}.${await resolveQuestions(ai.resolves)}`, `fact #${row.id} saved: ${text}`);
}

async function editFact(message, ai) {
  if (!isBoss(message)) return say(message, pick(ONLY_BOSS));
  const fact = await pickFact(message, ai);
  if (!fact) return;
  const text = factText(ai.fact);
  if (!text) return say(message, `What should fact #${fact.id} say now, boss?`);
  const secret = knowledge.looksSecret(text);
  if (secret) return say(message, secretWarning(secret));
  const row = await knowledge.editFact(fact.id, text);
  if (!row) return say(message, `I couldn't find fact #${fact.id} anymore, boss.`);
  return say(message, `${opener(ai)} Fact #${row.id} updated.${await resolveQuestions(ai.resolves)}`, `fact #${row.id} now: ${text}`);
}

async function forgetFact(message, ai) {
  if (!isBoss(message)) return say(message, pick(ONLY_BOSS));
  const fact = await pickFact(message, ai);
  if (!fact) return;
  const row = await knowledge.forgetFact(fact.id);
  if (!row) return say(message, `Fact #${fact.id} was already gone, boss.`);
  return say(message, `${opener(ai)} Forgot fact #${row.id}: "${row.fact.slice(0, 120)}".`);
}

async function listUnanswered(message, ai) {
  let top;
  try {
    top = await knowledge.topUnanswered(10);
  } catch (err) {
    console.error('list unanswered:', err.message);
    return say(message, "I couldn't load the question list, boss. Is the vexo_unanswered table set up?");
  }
  if (!top.length) return say(message, `${opener(ai)} No open questions right now 🎉`);
  const lines = top.map((q) => `#${q.id} (asked ${q.times_asked}×) ${q.question}`).join('\n');
  return say(message, `${opener(ai)}\n${lines}\nTeach me an answer and I'll tick it off.`);
}

async function confirmPending(message, p, lead) {
  pending = null;
  const result = await p.run();
  return say(message, `${lead} ${result.text}`, result.note);
}

// ---------------- entry point ----------------
async function handleOrder(message) {
  const text = message.content.trim();
  if (!text) return;
  const speaker = speakerName(message);

  // a password / seed phrase / key is never sent to the AI, stored, or kept in memory
  const secret = knowledge.looksSecret(text);
  if (secret) {
    remember(`${speaker}: [message withheld: looked like a secret]`);
    return say(message, secretWarning(secret));
  }

  await message.channel.sendTyping().catch(() => {});
  const active = await store.listActive();
  const unanswered = await knowledge.topUnanswered(10).catch(() => []); // table may not exist yet
  const p = getPending();
  let ai;
  try {
    // the AI sees id / type / time / status / prize, never the task state (secret number)
    ai = await understand(text, speaker, {
      tasks: active.map(taskLine),
      facts: knowledge.getFacts().slice(-60).map((f) => `#${f.id} ${f.fact.slice(0, 200)}`),
      unanswered: unanswered.map((q) => `#${q.id} (asked ${q.times_asked}x) ${q.question}`),
      pending: p?.describe,
      history,
    });
  } catch (err) {
    console.error('control AI:', err.message);
    remember(`${speaker}: ${text}`);
    if (p && YES.test(text)) return confirmPending(message, p, pick(OPENERS));
    if (p && NO.test(text)) {
      pending = null;
      return say(message, `Okay boss. ${pick(DROPPED)}`);
    }
    return say(message, pick(GLITCH));
  }
  remember(`${speaker}: ${text}`);

  switch (ai.intent) {
    case 'schedule_game':
      return scheduleOrder(message, ai, active);
    case 'reschedule':
      return rescheduleOrder(message, ai, active);
    case 'cancel_task':
      return cancelOrder(message, ai, active);
    case 'run_now':
      return runNowOrder(message, ai, active);
    case 'teach_fact':
      return teachFact(message, ai);
    case 'edit_fact':
      return editFact(message, ai);
    case 'forget_fact':
      return forgetFact(message, ai);
    case 'list_facts': {
      const facts = knowledge.getFacts();
      return say(message, facts.length ? `${opener(ai)}\n${factLines(facts)}` : "You haven't taught me anything yet, boss.");
    }
    case 'list_unanswered':
      return listUnanswered(message, ai);
    case 'list_tasks':
      return say(message, active.length ? `${opener(ai)}\n${listLines(active)}` : `${opener(ai)} Nothing is scheduled yet 🗓️`);
    case 'confirm_yes':
      if (p) return confirmPending(message, p, opener(ai));
      return say(message, `${opener(ai)} There's nothing waiting for a yes right now, though.`);
    case 'confirm_no':
      if (p) {
        pending = null;
        return say(message, `${opener(ai)} ${pick(DROPPED)}`);
      }
      return say(message, `${opener(ai)} Nothing was pending anyway.`);
    default: {
      // question_about_bot / small_talk / clarify: the AI's own words
      const reply = clean(ai.reply);
      return say(message, reply || pick(GLITCH));
    }
  }
}

// Returns true for every message in the control channel, so no other feature
// (Q&A, points, greetings) runs there. Unauthorized users are silently ignored
// and never reach the AI or the conversation memory.
async function handleMessage(message) {
  if (!config.channels.control || message.channelId !== config.channels.control) return false;
  if (!isAuthorized(message)) return true;
  if (isBoss(message)) identity.noteBoss(message, 'control');
  try {
    await handleOrder(message);
  } catch (err) {
    console.error('control order:', err.message);
    await say(message, 'Something glitched on my side, boss 😵 Nothing was changed. Try again?');
  }
  return true;
}

module.exports = { handleMessage };
