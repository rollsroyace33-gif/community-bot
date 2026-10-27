// Shuffle bag for template lists: every line of a list is used once before any line comes back,
// and a refill never starts with the line that was just used. Zero AI.
const crypto = require('crypto');

function createBag() {
  const bags = new Map(); // list name -> remaining indexes
  const last = new Map(); // list name -> last index used
  return function draw(name, list) {
    let bag = bags.get(name);
    if (!bag || !bag.length) {
      bag = list.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1); // Fisher-Yates
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.length > 1 && bag[bag.length - 1] === last.get(name)) bag.unshift(bag.pop());
      bags.set(name, bag);
    }
    const i = bag.pop();
    last.set(name, i);
    return list[i];
  };
}

module.exports = { createBag };
