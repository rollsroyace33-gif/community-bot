// One-off payout check: credits exactly 1 point to a member through the SAME shared payout the games use
// (src/tasks/prize.js), reads the balance back and prints PASS or FAIL with the exact reason.
// Usage: node scripts/check-payout.js <discordUserId>
// The point shows up in point_log as "payout_check <time>". No secrets are printed.
const path = require('path');
process.chdir(path.join(__dirname, '..')); // so config.js finds .env
const { payout } = require('../src/tasks/prize');
const points = require('../src/points');

(async () => {
  const userId = String(process.argv[2] || '').trim();
  if (!/^\d{17,20}$/.test(userId)) {
    console.log('FAIL: give a Discord user ID (17-20 digits). Usage: node scripts/check-payout.js <discordUserId>');
    process.exit(1);
  }
  try {
    const before = await points.getBalance(userId);
    const res = await payout({ taskId: 0, game: 'payout_check', state: {}, winnerId: userId, amount: 1, reason: `payout_check ${new Date().toISOString()}`, persist: false });
    if (!res.ok) {
      console.log(`FAIL: ${res.error}`);
      process.exit(1);
    }
    const after = await points.getBalance(userId);
    if (after === null) {
      console.log('FAIL: no users row for this ID after the credit.');
      process.exit(1);
    }
    if (after - (before || 0) < 1) {
      console.log(`FAIL: balance did not go up (before ${before ?? 'no row'}, after ${after}).`);
      process.exit(1);
    }
    console.log(`PASS: 1 point credited. Balance before ${before ?? 'no row (created now)'}, after ${after}. The shop "My Points" reads this same balance.`);
    process.exit(0);
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    process.exit(1);
  }
})();
