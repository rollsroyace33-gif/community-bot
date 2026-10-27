const config = require('./config');

const hits = new Map();

// Max N AI questions per user per hour (keeps API cost under control)
function allowQa(userId) {
  const now = Date.now();
  const recent = (hits.get(userId) || []).filter((t) => now - t < 3600000);
  if (recent.length >= config.qa.perHour) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

module.exports = { allowQa };
