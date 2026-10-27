// Template banks for the boss features (ZERO AI): welcome back, the "boss may be resting" cover,
// and the note / anti-spam lines. Rules for every line (checked by tests/boss-offline.test.js):
//   statements only (no "?"), at most one emoji, family-friendly, no clock times / time zone / schedule,
//   no promises on the boss's behalf (see PROMISE_RE in bossCover.js).

// ---------------- welcome back (reply to the boss's first message after BOSS_AWAY_HOURS) ----------------
// gap under a day: {hours} = whole hours away
const welcomeHours = [
  "Look who's back after {hours} hours, boss. The server missed you 😎",
  'Boss is back online after {hours} hours. I kept your seat warm.',
  "{hours} hours away and the place is still standing, boss. You're welcome.",
  'Welcome back, boss. {hours} hours without you felt like a long loading screen.',
  'Boss detected after {hours} hours. Systems at full loyalty 🤖',
  "The legend returns after {hours} hours. I told everyone you'd be back, boss.",
  'Boss, {hours} hours away and I only panicked twice.',
  'Welcome back, boss. I guarded the fort for {hours} hours with zero snacks.',
  '{hours} hours later, the boss walks in like nothing happened. Iconic 👑',
  'Boss is back. I kept the chaos at a respectable level for {hours} hours.',
  'Welcome back, boss. The banana peels stayed in storage for all {hours} hours.',
  'There he is. {hours} hours of suspense, boss, and the server survived.',
  'Boss back after {hours} hours. My circuits are doing a little happy dance 🕺',
  'Welcome back, boss. {hours} hours felt like a whole season finale.',
  "Boss, you've been gone {hours} hours and the vibes still waited for you.",
  'Back after {hours} hours, boss. I held things together with duct tape and charm.',
];

// gap of a day or more (rough phrase, no number)
const welcomeDay = [
  'A whole day without the boss. I survived on pure loyalty 😎',
  'Boss is back after a whole day. Somebody roll out the red carpet.',
  'Welcome back, boss. A full day away and I still kept the lights on.',
  'The boss returns after a long break. The server breathes again 🙌',
  "Boss, you've been gone so long I started talking to the rubber chickens.",
  'Welcome back after a whole day, boss. The fort is still standing.',
  'Long time no see, boss. I kept your throne dusted.',
  'Boss is back after a long break, and honestly the place looks brighter already.',
  'A whole day, boss. I almost filed a missing legend report.',
  'Welcome back, boss. I ran the place solo and only tripped once.',
  'The boss has returned after a long adventure. Cue the dramatic music 🎺',
  'Welcome back, boss. A day without you is like a meme without a punchline.',
  'Boss online again after a long break. Everything is fine, mostly 😄',
  'Back after a whole day, boss. I saved you a virtual coffee ☕',
  'There he is. A full day away and still the main character, boss.',
  'Welcome back, boss. The server missed you more than it will admit.',
];

// ---------------- cover: a member mentions the boss while he may be resting ----------------
// mention-only / greeting / emoji / very short messages
const coverShort = [
  "Boss may be resting right now, so I'm on duty. Tell me what you need 🛡️",
  "Hey there! The boss is taking a breather, and I'm covering for him. Just tell me what you need.",
  "gm to you too! Boss may be resting, but I'm here and fully caffeinated ☕",
  "The boss is recharging his batteries right now. I'm holding the fort, so just tell me what you need.",
  "Boss may be away for a bit, and Vexo is on shift. Drop what you need and I'll help 😎",
  "Hi! The boss may be resting, so you've got me instead. I can help with pretty much anything.",
  "Shh, the boss may be resting. I'm on duty though, tell me what you need.",
  "The boss stepped away for a bit and left me in charge. Tell me what's up and I'll sort it.",
  'Boss is away from the keyboard for now, but his trusty sidekick is right here 🤖',
  "Hello hello! Boss may be resting, and I'm covering. Just tell me what you need.",
  "The boss is taking a well-deserved break. I'm here on his behalf and happy to help.",
  'Ping received! Boss may be resting, so Vexo is answering the door 🚪',
  "Boss may be catching some rest. I'm here, I'm awake, and I can help with almost anything.",
  "Hey! The boss is away for a bit. Tell me what you need and I'll do my best.",
  "The boss may be resting, but the helpdesk never sleeps. That's me 😄",
  "Greetings! Boss is on a little break and I'm on duty. Just say what you need.",
  "Boss may be resting right now. Vexo reporting for duty, tell me what's up.",
  "The boss is recharging. I've got the keys to the place, so tell me what you need 🔑",
  "Whatever the hour, I'm here. The boss may be resting, so tell me what you need.",
  "Boss may be taking a breather. You're stuck with me, and honestly I'm pretty helpful.",
  "Hi friend! The boss may be resting, and I'm covering his shift. Tell me what you need.",
  "The boss is away from the keyboard. I'm right here though, just tell me what you need 👋",
  "Boss may be resting, so I'm the one on call. Tell me what you need and I'll do my best.",
  "Hey hey! The boss stepped out and Vexo stepped in. Tell me what you need, I'm here for it.",
  "The boss may be resting right now. I'm here on his behalf, ready to help 🙌",
  "Boss is taking five. I'm on duty, so just tell me what you need.",
];

// first line of a real answer given on the boss's behalf
const coverLead = [
  "Boss may be resting right now, so I'm covering 🛡️",
  'The boss is taking a breather, so Vexo is on duty.',
  "Boss may be away for a bit, so here's me instead 😎",
  "The boss may be resting, but I've got this one.",
  'Covering for the boss while he recharges 🔋',
  'Boss may be resting, so his trusty sidekick is answering.',
  "The boss stepped away for a bit, so I'll take this one.",
  'Boss is on a little break, so Vexo to the rescue 🦸',
];

// something only the boss can handle: a note with a mention is left for him
const needsBoss = [
  "This one needs the boss himself. I left him a note with a mention, so he'll see it as soon as he's online, no need to repeat it 📌",
  "That's a boss-level decision, so I can't answer it for him. I pinned a note for him and he'll see it when he's back, so you don't need to ask again.",
  "Only the boss can handle this one. I left him a note with a mention, so it's waiting for him the moment he's online.",
  "I can't decide this one on the boss's behalf. Note left for him with a mention, so sit tight, no need to repeat it 🙌",
  'This one is above my pay grade, which is zero. The boss has a note from me with a mention and will see it when he is online.',
  "That needs the boss personally. I wrote him a note and tagged him, so he'll see it as soon as he's back.",
  "I'd love to help, but this one is the boss's call. My note to him is already posted with a mention, no need to ask again 📌",
  "This one goes straight to the boss. I left a note with a mention, so he'll catch it the moment he's online.",
  "That's for the boss to answer. I tagged him in a note, so you can relax, it won't get lost.",
  "Boss territory, so I won't guess. I left him a note with a mention and he'll see it when he's back online.",
];

// the same member again within BOSS_NOTE_COOLDOWN_MINUTES: no new ping
const noteAlreadyLeft = [
  "I already left the boss a note about you, so he'll see it when he's online 📌",
  'Your note is already pinned for the boss. No need to send it again.',
  'Already on it, the boss has my note about your message.',
  'The boss already has a note from me about this. Sit tight 🙌',
  'No worries, my note to the boss is already there.',
  "Note already delivered to the boss. He'll catch it when he's back.",
];

// BOSS_NOTE_CHANNEL_MAX reached in this channel: Vexo answers, but no new ping
const bossNotified = [
  "The boss has already been notified about this channel, so he'll catch up when he's online.",
  "The boss already has notes waiting from this channel. He'll see them when he's back 📌",
  "I've already flagged this channel for the boss, so he'll catch up when he's back.",
  "The boss has been notified, and he'll read through everything when he's online.",
  'Notes for the boss are already waiting from here. No need to repeat anything.',
  'The boss is already notified about this channel 🙌',
];

// a wall of text (over 500 characters)
const keepBrief = [
  "That's a lot of text for me to carry to the boss. Keep it short and I'll help right away 😄",
  "Whoa, that's an essay. A short version works best, then I can help.",
  "Keep it brief, please. A sentence or two and I'm on it.",
  "That message is a bit long for me. Give me the short version and I'll help.",
  'Short and sweet works best here. Try a quick summary.',
  'My circuits like short messages. Give me the quick version 🙏',
];

// casual offline-chat replies when the AI is unavailable (statements, no questions)
const offlineFallback = [
  'Ha, fair enough 😄',
  'Respect. That made my circuits smile.',
  'You said it, not me 😏',
  'Big if true.',
  'Love the energy in here.',
  'Noted, and honestly, iconic.',
];

// reactions for the boss's closing remarks ("ok", "lol", "let's see", pure emoji)
const bossReactions = ['🫡', '👍', '😎', '✅', '🙌'];

module.exports = {
  welcomeHours, welcomeDay, coverShort, coverLead, needsBoss, noteAlreadyLeft, bossNotified, keepBrief,
  offlineFallback, bossReactions,
};
