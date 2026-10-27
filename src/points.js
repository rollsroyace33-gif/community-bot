const supabase = require('./db');
const config = require('./config');

const P = config.points;

function fmt(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(date);
}
const today = () => fmt(new Date());
const daysAgo = (n) => fmt(new Date(Date.now() - n * 86400000));

// Anti-farming: account age + optional verified role
function isEligible(member, user) {
  const ageDays = (Date.now() - user.createdTimestamp) / 86400000;
  if (ageDays < config.filters.minAccountAgeDays) return false;
  if (config.verifiedRoleId && !member.roles.cache.has(config.verifiedRoleId)) return false;
  return true;
}

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

const recordMessage = (userId) =>
  rpc('record_message', {
    p_user: userId,
    p_day: today(),
    p_per_point: P.messagesPerPoint,
    p_cat_cap: P.messageCap,
    p_total_cap: P.dailyCap,
  });

const recordReaction = (messageId, userId) =>
  rpc('record_reaction', {
    p_message: messageId,
    p_user: userId,
    p_day: today(),
    p_cat_cap: P.reactionCap,
    p_total_cap: P.dailyCap,
  });

const awardQuality = (userId, day, amount) =>
  rpc('award_points', {
    p_user: userId,
    p_day: day,
    p_category: 'quality',
    p_amount: amount,
    p_cat_cap: P.qualityCap,
    p_total_cap: P.dailyCap,
  });

const adjustPoints = (userId, amount, reason) =>
  rpc('adjust_points', { p_user: userId, p_amount: amount, p_reason: reason });

module.exports = {
  today,
  daysAgo,
  isEligible,
  recordMessage,
  recordReaction,
  awardQuality,
  adjustPoints,
};
