// X post drop reward: in X_DROP_CHANNEL_ID only, a member's message with a valid X post link earns
// X_DROP_POINTS instantly (EXTRA points, outside the daily activity cap). No AI.
//
// Anti-farming:
//   - one credit per status id, EVER, for anyone (x_post_drops.status_id is the primary key)
//   - at most X_DROP_MAX_PER_DAY credited drops per member per day (0 = unlimited; same day as the points system)
//   - not credited (duplicate / over the limit / invalid) = Vexo stays silent, no limit is ever mentioned
// Crediting goes through the same atomic points RPC the Rumble payout uses (adjust_points: creates the
// user row, writes point_log), with the same point_log check first, so a message is never credited twice.
const config = require('./config');
const supabase = require('./db');
const points = require('./points');

const X = () => config.xDrop;

// x.com / twitter.com (+ www. / mobile.) and the fxtwitter / vxtwitter mirrors, numeric status id only
const LINK_RE = /https?:\/\/(?:(?:www|mobile)\.)?(?:x|twitter|fxtwitter|vxtwitter)\.com\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{1,25})(?!\d)/i;

// the FIRST valid link of a message -> its status id (query strings / trailing text ignored), or null
function statusIdOf(content) {
  const m = LINK_RE.exec(String(content || ''));
  return m ? m[1].replace(/^0+(?=\d)/, '') : null;
}

const isXChannel = (channelId) => !!X().channelId && channelId === X().channelId;

// confirmation lines: each one states the credit, max one emoji, never a limit
const LINES = [
  "You've been credited {points} points for dropping this post 🎉",
  'Nice drop! {points} points have been added to your balance.',
  '{points} points credited for sharing this post, thank you 🙌',
  'Post received, {points} points are now in your balance.',
  'Thanks for the drop! You just earned {points} points 🔥',
  '{points} points added to your balance for this post. Keep spreading the word!',
  'Credited: {points} points for dropping this post 💎',
  'Great share! {points} points have been sent to your balance.',
  'This drop earned you {points} points, nice work 🚀',
  'Boom, {points} points credited for this post.',
];
let bag = [];
let lastLine = null;
// shuffle bag: every line once before any comes back, never the same line twice in a row
function nextLine() {
  if (!bag.length) {
    bag = [...LINES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag.length > 1 && bag[bag.length - 1] === lastLine) bag.unshift(bag.pop());
  }
  lastLine = bag.pop();
  return lastLine;
}

// UTC instant of today's midnight in config.timezone (the same day points.today() uses)
function dayStartIso() {
  const day = points.today(); // YYYY-MM-DD in config.timezone
  const guess = Date.parse(`${day}T00:00:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value])
  );
  const asLocal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guess - (asLocal - guess)).toISOString();
}

const release = (statusId, messageId) =>
  supabase.from('x_post_drops').delete().eq('status_id', statusId).eq('message_id', messageId).then(({ error }) => {
    if (error) console.error('x drop release:', error.message);
  });

// true = the message was a drop attempt in the X channel (a valid link), whether credited or not
async function handle(message) {
  if (!isXChannel(message.channelId) || message.author.bot || !message.guild) return false;
  const statusId = statusIdOf(message.content);
  if (!statusId) return false;
  const uid = String(message.author.id);
  const amount = Math.floor(Number(X().points) || 0);
  if (amount <= 0) return true;

  try {
    // 1. claim the status id (primary key): a duplicate post, a double event or a restart can never pass twice
    const { error: claimErr } = await supabase.from('x_post_drops').insert({ status_id: statusId, user_id: uid, message_id: message.id });
    if (claimErr) {
      if (claimErr.code !== '23505') console.error('x drop claim:', claimErr.message); // 23505 = already dropped: silent
      return true;
    }

    // 2. daily limit, counted AFTER the claim (two drops at the same moment can't both slip through)
    const max = Math.floor(Number(X().maxPerDay) || 0);
    if (max > 0) {
      const { count, error } = await supabase
        .from('x_post_drops')
        .select('status_id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .gte('created_at', dayStartIso());
      if (error) throw new Error(`daily count: ${error.message}`);
      if (count > max) {
        await release(statusId, message.id); // over the limit: not credited, the post can still be dropped another day
        return true;
      }
    }

    // 3. credit: same point_log check + atomic adjust_points RPC as the Rumble payout
    const reason = `x_post_drop message #${message.id}`;
    const { data, error } = await supabase.from('point_log').select('id').eq('reason', reason).limit(1);
    if (error) throw new Error(`point_log check: ${error.message}`);
    if (data && data.length) return true; // already credited (never twice)
    try {
      await points.adjustPoints(uid, amount, reason);
    } catch (err) {
      await release(statusId, message.id); // not credited: free the post again
      throw err;
    }

    // 4. one confirmation line, replying to the member (nobody pinged)
    await message
      .reply({ content: nextLine().replace('{points}', amount), allowedMentions: { repliedUser: false, parse: [] } })
      .catch((err) => console.error('x drop reply:', err.message));
  } catch (err) {
    console.error(`x drop failed (message ${message.id}):`, err.message);
  }
  return true;
}

function startupCheck() {
  if (!X().channelId) console.warn('X_DROP_CHANNEL_ID is empty: the X post drop reward is off.');
}

module.exports = { handle, isXChannel, statusIdOf, startupCheck };
