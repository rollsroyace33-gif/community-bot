const cron = require('node-cron');
const config = require('../config');
const { runDailyJob } = require('./daily');

let job = null; // the cron task, kept so shutdown can stop it

function startScheduler(client) {
  if (!cron.validate(config.dailyCron)) {
    console.error(`DAILY_CRON invalid: "${config.dailyCron}"`);
    return;
  }
  job = cron.schedule(
    config.dailyCron,
    () => runDailyJob(client).then((r) => console.log('Daily job:', r)).catch((e) => console.error('Daily job failed:', e)),
    { timezone: config.timezone }
  );
  console.log(`Daily job scheduled: "${config.dailyCron}" (${config.timezone})`);
}

// graceful shutdown (SIGTERM): no new daily runs
function stopScheduler() {
  if (job) job.stop();
  job = null;
}

module.exports = { startScheduler, stopScheduler };
