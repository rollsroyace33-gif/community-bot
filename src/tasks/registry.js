// All task types Vexo can run. To add one later (announcement, poll, giveaway...):
//   1. create src/tasks/<name>.js exporting the same shape as numberGuess.js
//   2. add it to the list below
// The order parser, scheduler and control channel pick it up automatically.
const numberGuess = require('./numberGuess');
const rumbleRoyale = require('./rumbleRoyale');

const TASKS = Object.fromEntries([numberGuess, rumbleRoyale].map((t) => [t.type, t]));

module.exports = {
  TASKS,
  get: (type) => TASKS[type] || null,
};
