// Prizes for every game (Rumble Royale, number guess): ONE classifier and ONE points payout.
//
// classifyPrize: "20 points" / "20 point" / "20 pts" / "20pts" / "20 Points" / "prize: 20 points" -> points
//                any other text ("1 SOL", "NFT", "$50", "WL") -> ticket (manual delivery); empty -> none
// resolvePrize:  task params -> prize fields; params saved by an older version (no prize_type / prize_points)
//                are re-derived from the prize text with the same classifier
// payout:        credits the winner through the atomic adjust_points RPC (users.points, creates the user row,
//                writes point_log), then READS BACK users.points and checks the credit landed. Idempotent:
//                state.paid (set only after a verified credit) + the point_log reason + an in-process lock.
const store = require('./store');
const supabase = require('../db');
const points = require('../points');

function classifyPrize(raw) {
  const prize = String(raw ?? '')
    .replace(/@(everyone|here)/gi, '')
    .replace(/<[@#][!&]?\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  if (!prize) return { prize: null, prize_type: 'none', prize_points: null };
  // optional "prize" / "prize:" in front and "prize" / "to the winner" after: "prize 20 points", "20 pts prize"
  const core = prize
    .replace(/^prize\s*(?:is|of|=|:|-)?\s*/i, '')
    .replace(/\s+(?:prize|to the winner|for the winner)$/i, '')
    .replace(/\.$/, '');
  const m = /^(\d[\d,_]*)\s*(points?|pts?)$/i.exec(core);
  if (m) {
    const n = Number(m[1].replace(/[,_]/g, ''));
    if (Number.isSafeInteger(n) && n > 0) return { prize, prize_type: 'points', prize_points: n };
  }
  return { prize, prize_type: 'ticket', prize_points: null };
}

// edit distance (small strings only)
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

// "20 pints" / "20 poitns" / "20 piont": a number + a word that LOOKS like "points" but isn't.
// Never changes the prize (it stays a ticket prize as written); returns a warning line for the
// confirmation, or null.
function prizeTypoWarning(params = {}) {
  if (params.prize_type !== 'ticket' || !params.prize) return null;
  const core = String(params.prize).replace(/^prize\s*(?:is|of|=|:|-)?\s*/i, '').replace(/\s+prize$/i, '').replace(/\.$/, '');
  const m = /^(\d[\d,_]*)\s*([a-z]{2,8})$/i.exec(core);
  if (!m) return null;
  const word = m[2].toLowerCase();
  const near = ['point', 'points', 'pts'].some((w) => editDistance(word, w) <= (word.length >= 4 ? 2 : 1));
  if (!near) return null;
  const n = m[1].replace(/[,_]/g, '');
  return `⚠️ "${params.prize}" looks like a typo of **${n} points**. As written it is a **ticket prize** (no automatic payout). To pay points automatically, say no and send the order again with "${n} points".`;
}

function resolvePrize(params = {}) {
  const ok = params.prize_type === 'none' || params.prize_type === 'ticket' || (params.prize_type === 'points' && Number.isSafeInteger(Number(params.prize_points)) && Number(params.prize_points) > 0);
  if (ok) return { ...params, prize_points: params.prize_type === 'points' ? Number(params.prize_points) : params.prize_points };
  return { ...params, ...classifyPrize(params.prize) };
}

const paying = new Set();

// ctx: { taskId, game?, state, winnerId, amount, reason?, persist? }  ->  { ok, balance, already } / { ok: false, error }
//   game:    'rumble_royale' (default) | 'number_guess' | ...; the point_log reason is "<game>_prize task #<id>"
//   persist: false = don't save state.paid into scheduled_tasks (the check script has no task row)
async function payout(ctx, deps = {}) {
  const pts = deps.points || points;
  const db = deps.db || supabase;
  const { taskId, state, amount } = ctx;
  const game = ctx.game || 'rumble_royale';
  const winnerId = String(ctx.winnerId ?? '');
  const reason = ctx.reason || `${game}_prize task #${taskId}`;
  const log = (result, extra = '') => console.log(`[payout] task #${taskId} game=${game} winner=${winnerId} amount=${amount} result=${result}${extra}`);

  if (state.paid) {
    log('ok', ' (already paid earlier)');
    return { ok: true, already: true, balance: state.paid.balance };
  }
  const lockKey = `${game}:${taskId}`;
  if (paying.has(lockKey)) return { ok: false, busy: true, error: 'payout already in progress' };
  paying.add(lockKey);
  try {
    if (!/^\d{5,25}$/.test(winnerId)) throw new Error(`winner id "${winnerId}" is not a Discord user id`);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`prize amount ${amount} is not a positive whole number`);
    const { data, error } = await db.from('point_log').select('id').eq('reason', reason).limit(1);
    if (error) throw new Error(`point_log check: ${error.message}`);
    const alreadyLogged = !!(data && data.length);

    let balance = null;
    if (!alreadyLogged) {
      // read-back check only where the points module can read balances (always in the real bot)
      const canVerify = typeof pts.getBalance === 'function';
      const before = canVerify ? await pts.getBalance(winnerId) : null;
      balance = await pts.adjustPoints(winnerId, amount, reason); // atomic RPC: creates the user row, writes point_log
      if (canVerify) {
        const after = await pts.getBalance(winnerId);
        if (after === null) throw new Error('credit not found: the winner has no users row after adjust_points');
        // ok when the balance grew by the prize, or matches what adjust_points returned (other points may land at the same moment)
        if (after - (before || 0) !== amount && after !== Number(balance)) {
          throw new Error(`credit not verified: balance was ${before ?? 'no row'}, adjust_points returned ${balance}, read back ${after}`);
        }
        balance = after;
      }
    }
    // the "paid" flag only after the verified credit, with the payout id
    state.paid = { at: new Date().toISOString(), winnerId, amount, balance, payoutId: reason };
    if (ctx.persist !== false) await store.update(taskId, { state }).catch((err) => console.error(`${game} #${taskId} paid flag save:`, err.message));
    log('ok', alreadyLogged ? ' (already in point_log, not paid twice)' : ` balance=${balance}`);
    return { ok: true, balance, already: alreadyLogged };
  } catch (err) {
    log('failed', ` error=${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    paying.delete(lockKey);
  }
}

module.exports = { classifyPrize, resolvePrize, prizeTypoWarning, payout };
