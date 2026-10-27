// One source of "now" for the boss presence / offline window / cover features, so tests can use a fake clock.
const clock = { now: () => Date.now() };

module.exports = clock;
