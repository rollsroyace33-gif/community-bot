const supabase = require('../db');
const config = require('../config');
const points = require('../points');
const ai = require('../ai');
const { getTextChannel } = require('../utils');

const P = config.points;

const TEMPLATES = [
  (id, b) => `🏆 Today's **Top Chatter** is <@${id}>! You earned **+${b} bonus points**. Thanks for keeping the community active!`,
  (id, b) => `🔥 The most active member today was <@${id}>! **+${b} bonus points** for you. Keep it up!`,
  (id, b) => `🎉 Congrats <@${id}>, you're today's top member! **+${b} bonus points** have been added.`,
  (id, b) => `⭐ Today's MVP: <@${id}>! Great conversations and helpful chat, so here are **+${b} bonus points**.`,
];

// Score today's logged messages with AI, then give quality points
async function judgeAndAward(day) {
  const { data: rows, error } = await supabase
    .from('messages_log')
    .select('id,user_id,content')
    .eq('day', day)
    .is('score', null)
    .limit(2000);
  if (error) throw error;

  for (let i = 0; i < (rows || []).length; i += 40) {
    const batch = rows.slice(i, i + 40);
    const scores = await ai.judgeMessages(batch.map((r) => ({ id: r.id, text: r.content })));
    const upserts = batch
      .filter((r) => scores.has(r.id))
      .map((r) => ({ id: r.id, user_id: r.user_id, day, content: r.content, score: scores.get(r.id) }));
    if (upserts.length) {
      const { error: upErr } = await supabase.from('messages_log').upsert(upserts, { onConflict: 'id' });
      if (upErr) throw upErr;
    }
  }

  // sum scores per user
  const { data: scored } = await supabase
    .from('messages_log')
    .select('user_id,score')
    .eq('day', day)
    .not('score', 'is', null);

  const sums = new Map();
  for (const r of scored || []) sums.set(r.user_id, (sums.get(r.user_id) || 0) + r.score);

  for (const [userId, sum] of sums) {
    await supabase.from('daily_stats').update({ quality_score: sum }).eq('user_id', userId).eq('day', day);

    const target = Math.min(P.qualityCap, Math.floor(sum / P.qualityScorePerPoint));
    const { data: st } = await supabase
      .from('daily_stats')
      .select('quality_pts')
      .eq('user_id', userId)
      .eq('day', day)
      .maybeSingle();
    const need = target - (st?.quality_pts || 0); // idempotent on re-run
    if (need > 0) await points.awardQuality(userId, day, need);
  }
}

async function pickTop(day) {
  const { data } = await supabase
    .from('daily_stats')
    .select('user_id,msg_count,quality_score')
    .eq('day', day)
    .gte('msg_count', P.topMinMessages)
    .order('quality_score', { ascending: false })
    .order('msg_count', { ascending: false })
    .limit(1);
  return data && data.length ? data[0] : null;
}

async function runDailyJob(client, { force = false } = {}) {
  const day = points.today();

  if (!force) {
    const { data } = await supabase.from('daily_runs').select('day').eq('day', day).maybeSingle();
    if (data) return { skipped: true, day };
  }

  // 1) AI quality check (if AI fails, we continue: top 1 falls back to message count)
  let aiOk = true;
  try {
    await judgeAndAward(day);
  } catch (err) {
    aiOk = false;
    console.error('Quality judging failed:', err.message);
  }

  // 2) Top 1 (+bonus is OUTSIDE the daily cap)
  const top = await pickTop(day);
  let announced = null;
  if (top) {
    const { data: already } = await supabase
      .from('daily_stats')
      .select('user_id')
      .eq('day', day)
      .gt('bonus_pts', 0)
      .limit(1);

    if (!already || already.length === 0) {
      await points.adjustPoints(top.user_id, P.topBonus, 'daily top 1');
      await supabase.from('daily_stats').update({ bonus_pts: P.topBonus }).eq('user_id', top.user_id).eq('day', day);

      const ch = await getTextChannel(client, config.channels.general);
      if (ch) {
        const msg = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)](top.user_id, P.topBonus);
        await ch.send({ content: msg, allowedMentions: { users: [top.user_id] } }).catch((e) => console.error(e.message));
      }
      announced = top.user_id;
    }
  }

  // 3) record run + cleanup old logs
  await supabase.from('daily_runs').upsert({ day, top_user_id: top ? top.user_id : null });
  await supabase.from('messages_log').delete().lt('day', points.daysAgo(3));
  await supabase
    .from('reaction_log')
    .delete()
    .lt('created_at', new Date(Date.now() - 30 * 86400000).toISOString());
  require('../events/messageCreate').resetCounters();

  return { day, aiOk, top: top ? top.user_id : null, announced };
}

module.exports = { runDailyJob };
