// Task system entry point: control channel orders, scheduler, and live task chat.
const registry = require('./registry');
const control = require('./control');
const { startTaskScheduler, stopTaskScheduler } = require('./scheduler');

// true = a live task (e.g. a running number guess game) owns this message's channel
// mayReply: false = a boss message not addressed to Vexo (bossGate.js): the game still counts it, but
// sends no banter / flavor line back
async function handleMessage(message, { mayReply = true } = {}) {
  for (const handler of Object.values(registry.TASKS)) {
    if (handler.handleMessage && (await handler.handleMessage(message, { mayReply }))) return true;
  }
  return false;
}

module.exports = {
  startTaskScheduler,
  stopTaskScheduler,
  handleControlMessage: control.handleMessage,
  handleMessage,
};
