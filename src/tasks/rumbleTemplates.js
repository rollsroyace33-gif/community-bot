// Rumble Royale template bank. EVERY line Vexo posts during a Rumble comes from here (zero AI calls).
//
// Editing tips:
//  - Keep lines short, family-friendly, cartoon slapstick only. No question marks.
//  - Emojis: elimination, final duel, revive and congrats lines carry 1-2 emojis (the first one is the
//    line's "theme"); every other line has at most one.
//  - Placeholders are filled in by the code: {victim} {killer} {player} {winner} {prize} {prize_line}
//    {start_time} {start_relative} {players} {round} {remaining} {kills} {rounds} {points} {min}. Names are already bold.
//  - RULES at the bottom says which placeholders each list must / may use, its minimum size and emoji range.
//    Run `node tests/rumble.test.js` after editing: it checks every list against RULES.

// ---------------- join window ----------------
const announce = [
  '⚔️ **RUMBLE ROYALE** is open! Hit **Join** below, the chaos starts {start_time}.\n{prize_line}',
  'The arena doors are open 🏟️ Press **Join** to enter the **Rumble Royale**. First bell rings {start_time}.\n{prize_line}',
  'Gather round, legends! A **Rumble Royale** is forming. Tap **Join**, the fighting starts {start_time}.\n{prize_line}',
  '🔔 Vexo is hosting a **Rumble Royale**! One button, one arena, one survivor. Battle begins {start_time}.\n{prize_line}',
  'Stretch those fingers and grab your rubber chicken. **Rumble Royale** sign-ups are open, rounds start {start_time}.\n{prize_line}',
  "It's rumble o'clock 🥊 Join now and hope the banana peels miss you. Fighting starts {start_time}.\n{prize_line}",
  'A wild **Rumble Royale** appeared! Press **Join** to throw your name in the ring. The madness starts {start_time}.\n{prize_line}',
  'The arena is polished, the floor is suspiciously wet, and the **Rumble Royale** is open. Gates close {start_time}.\n{prize_line}',
  '🎪 Step right up! The **Rumble Royale** is taking fighters. The gates slam shut {start_time}.\n{prize_line}',
  'Vexo just rolled out the battle mat. **Rumble Royale** joins are open, rounds start {start_time}.\n{prize_line}',
  'Calling all brave, lucky and slightly chaotic people: the **Rumble Royale** is live. Battle starts {start_time}.\n{prize_line}',
  '⚡ **Rumble Royale** loading… Press **Join** and become a legend, or at least a funny elimination line. Starts {start_time}.\n{prize_line}',
];

const preAnnounce = [
  '📣 Heads up! A **Rumble Royale** opens {start_time}. Warm up those button-pressing fingers.\n{prize_line}',
  'The arena crew is setting up: **Rumble Royale** sign-ups open {start_time}. Be there.\n{prize_line}',
  'Mark your calendar, or at least your brain: **Rumble Royale** opens {start_time} 🗓️\n{prize_line}',
  'Rumble alert! The Join button drops {start_time}. Snacks recommended.\n{prize_line}',
  'Something chaotic is coming {start_time}: a **Rumble Royale**, hosted by yours truly.\n{prize_line}',
  'Vexo is oiling the trampolines. **Rumble Royale** opens {start_time} ⚔️\n{prize_line}',
  'Stay close to this channel: the **Rumble Royale** gates open {start_time}.\n{prize_line}',
  'Fair warning, legends: a **Rumble Royale** kicks off {start_time}. Bring your luckiest socks.\n{prize_line}',
];

const joinAck = [
  "You're in! ⚔️ Try not to step on any banana peels.",
  "Welcome to the arena. Your helmet is on backwards, but you're in.",
  'Name written in glitter on the fighter list. Good luck out there.',
  'You joined the Rumble! Vexo believes in you, mostly.',
  'Locked in 🔒 May the odds be ridiculously in your favor.',
  'Fighter registered. Stretch, hydrate, and avoid the wet floor.',
  "You're on the list. Legends are made of moments like this.",
  'In you go! The rubber chickens are already warming up.',
];

const joinAlready = [
  "You're already in, champ. One of you is plenty 😄",
  'Already on the fighter list. Cloning is against the arena rules.',
  "Relax, you're in. Pressing harder doesn't add armor.",
  'You joined already. Save that energy for the arena.',
  'Still in, still legendary. No double entries.',
  'Your name is already shining on the list ✨',
];

const joinNotAllowed = [
  'This arena is for verified members only. Get verified and come back swinging.',
  'The bouncer says verified members only, sorry 🙏',
  'No verified role, no arena pass. Grab it and join the next one.',
  "Only verified members can rumble. The door's open once you're verified.",
  'Arena rules: verified fighters only. Catch the next round.',
  'Not this time, friend. Verified members only for the Rumble.',
];

const joinFull = [
  'The arena is packed to the rafters. Catch the next Rumble.',
  'Full house! No more fighters fit in the ring this time.',
  'Sold out, the arena is at max capacity 🎟️',
  'Too many legends, not enough arena. Next time for sure.',
];

const joinClosed = [
  'The join window is closed. The fighters are already rumbling.',
  'Too late for this one, the gates are shut 🚪',
  "This Rumble isn't taking new fighters anymore.",
  'Sign-ups are over. Grab popcorn and enjoy the show.',
];

const halfwayReminder = [
  'Halfway through the join window. The arena still has room for you.',
  '⏳ Half the sign-up time is gone. Press **Join** if you are feeling lucky.',
  'The arena is filling up. Half the join time is left.',
  'Halfway mark! Fortune favors the button-pressers.',
  'Still time to join, but the clock is very much ticking.',
  'Halfway there. Your future rubber-chicken victory awaits.',
  "Half the join window is done. Don't be the one who watches from the stands.",
  'Psst, the Rumble is still taking fighters. Half the time left.',
];

// verified-role reminder before the game starts (RUMBLE_REMIND_BEFORE_SECONDS, or the boss's "remind N min before").
// {start_time} = the start as a Discord time, {start_relative} = "in 2 minutes" style Discord timestamp
const reminderPing = [
  '⏰ The **Rumble Royale** starts at {start_time} ({start_relative}). Press **Join** now.',
  'Fighters wanted! The gates close {start_relative}, at {start_time}. Hit **Join** above.',
  'The arena fills up fast. Rounds start {start_relative} ({start_time}), so grab your spot.',
  'Last stretch before the chaos: the battle begins at {start_time}, {start_relative} ⚔️',
  'The rubber chickens are ready. The Rumble kicks off {start_relative} ({start_time}).',
  "Don't watch from the stands. Join before {start_time}, the fight starts {start_relative}.",
  'Sign-ups are still open until {start_time}. The first bell rings {start_relative} 🔔',
  'Fortune favors the button-pressers. The Rumble starts at {start_time} ({start_relative}).',
  'Helmets on, legends. The gates slam shut {start_relative}, at {start_time}.',
  'The arena is almost sealed: rounds begin {start_relative} ({start_time}). Press **Join**.',
];

// verified-role ping RUMBLE_FINAL_PING_SECONDS (default 10) before the start: short hype
const finalPing = [
  '🔟 **10 seconds** until the Rumble Royale begins. Last chance to join!',
  '**Ten seconds** left. The gates are about to slam shut ⏳',
  'Final countdown: **10 seconds** to the first bell.',
  '**10 seconds** to go. Brace for chaos 💥',
  'The arena locks in **10 seconds**. Join now or cheer from the stands.',
  '**Ten seconds**! The banana peels are in position.',
  'Almost go time: **10 seconds** until the Rumble starts ⚔️',
  '**10 seconds** left. Legends, take your places.',
  'Ten. Seconds. The Rumble Royale is about to begin 🔔',
  '**10 seconds** until fighting starts. Fortune favors the brave.',
];

// ---------------- the battle ----------------
const gameStart = [
  '🔔 The gates are shut! **{players} fighters** enter the arena. Let the Rumble begin.',
  '**{players} brave souls** signed up. Vexo is lowering the banana peels now.',
  "And we're off! **{players} players** in the arena, only one walks out a legend.",
  'Lights, camera, chaos 🎬 **{players} fighters** are ready to rumble.',
  "The arena is sealed with **{players} fighters** inside. Good luck, you'll need it.",
  '**{players} players** joined. Somebody please hide the rubber chickens.',
  'Here we go! **{players} fighters**, one crown, zero mercy (cartoon edition).',
  'The Rumble Royale has begun with **{players} legends** ⚔️',
  '**{players} contenders** step into the ring. May the funniest exit win.',
  'Bell rings, crowd roars, **{players} fighters** charge in.',
];

// first line of every round card (the card title already says "⚔️ Round N")
const roundIntro = [
  '_Round {round} · {remaining} fighters step forward._',
  '_Round {round} begins with {remaining} still standing._',
  '_Round {round}! {remaining} players, plenty of banana peels._',
  '_Round {round} · {remaining} fighters left in the arena._',
  '_Round {round} · The crowd counts {remaining} survivors._',
  '_Round {round} · {remaining} legends eye each other nervously._',
  '_Round {round} · The floor is wet and {remaining} fighters remain._',
  '_Round {round} · {remaining} players, one very loud referee._',
  '_Round {round} · Things are heating up with {remaining} left._',
  '_Round {round} · {remaining} fighters, zero chill._',
  '_Round {round} · The arena shakes as {remaining} players collide._',
  '_Round {round} · Popcorn ready, {remaining} still in._',
  '_Round {round} · {remaining} fighters roll up their sleeves._',
  '_Round {round} · Vexo rings the bell for {remaining} contenders._',
  '_Round {round} · {remaining} players dodge, duck, dip and dive._',
  '_Round {round} · The trampolines are bouncing for {remaining} fighters._',
  '_Round {round} · {remaining} warriors remain and the chaos does not stop._',
  '_Round {round} · A fresh wave of slapstick for {remaining} players._',
  '_Round {round} · {remaining} fighters, and someone smells like rubber chicken._',
  '_Round {round} · The crowd chants as {remaining} fighters circle up._',
  '_Round {round} · {remaining} players left. Somebody hold my mop._',
  '_Round {round} · Gas fees are low and tension is high, {remaining} remain._',
  '_Round {round} · {remaining} contenders, one dream._',
  '_Round {round} · Fighters ready: {remaining}. Banana peels ready: plenty._',
  '_Round {round} · The arena lights flicker on {remaining} survivors._',
];

// {victim} is out. {killer} (optional) is a random fighter who survives the round and gets the kill.
// The leading emoji is the line's theme emoji in the round card.
const elimination = [
  // ---- with a killer ----
  '🍌 {killer} rolled a banana peel across the floor and {victim} took the express slide out.',
  "🤸 {victim} bounced on {killer}'s trampoline a little too hard and landed in the next server.",
  '🧹 {killer} mopped the arena and {victim} discovered the wet floor sign the hard way.',
  '🌉 {killer} sold {victim} a bridge to the wrong chain. {victim} is now stranded on a testnet.',
  '🧻 {victim} paper-handed at the worst moment while {killer} diamond-handed them out of the ring.',
  "⛽ {killer} cranked up the gas fees and {victim} couldn't afford to stay in the game.",
  '📈 {victim} chased a FOMO pump {killer} invented and ran straight out of the arena.',
  '🪂 {killer} airdropped a pillow on {victim}. Critical fluff damage.',
  '🔥 {killer} cast Fireball, but it was a marshmallow. {victim} still got toasted out of the round.',
  '🐸 {victim} challenged {killer} to a wizard duel and accidentally turned themselves into a frog.',
  '🐉 {killer} summoned a very polite dragon that escorted {victim} out of the arena.',
  '🌌 {killer} opened the airlock and {victim} drifted off into the cozy void of space.',
  '🌙 {victim} tried to moonwalk past {killer} and actually ended up on the moon.',
  '🎈 {killer} launched {victim} into orbit with a rocket made of party balloons.',
  '🐔 {killer} tossed a rubber chicken and {victim} fainted from pure surprise.',
  "🍝 {victim} slipped on {killer}'s spilled spaghetti and slid gracefully into retirement.",
  '🍳 {killer} swung a frying pan with a loud BONK and {victim} saw cartoon stars.',
  '🌶️ {killer} served {victim} a soup so spicy they had to leave the building.',
  "🍪 {victim} tried to steal {killer}'s last cookie and got caught in the cookie jar trap.",
  '🏐 {killer} spiked a volleyball and {victim} got sent straight to the bench.',
  '⚽ {killer} scored a goal using {victim} as the ball. The ref says it counts.',
  '🥅 {victim} took a penalty kick against {killer} and booted themselves out of bounds.',
  '🤾 {killer} beaned {victim} with a dodgeball from across the arena. Out.',
  '📧 {killer} hit reply-all so loudly that {victim} fled the office.',
  "📅 {victim} got stuck in {killer}'s three-hour meeting and never escaped.",
  '🖨️ {killer} jammed the printer and {victim} was swallowed by paper tray two.',
  '📨 {killer} booked {victim} into a meeting that could have been an email. {victim} is gone.',
  "💺 {victim} spun too fast in {killer}'s office chair and rolled out the door.",
  "🪑 {killer} rug-pulled {victim}'s chair. Literally. {victim} hit the floor and the exit.",
  '🖼️ {killer} minted a jpeg of {victim} looking surprised, and {victim} left to process it.',
  "💸 {victim} sent their bag to {killer}'s typo address and quietly left the arena.",
  '🌕 {killer} promised {victim} a guaranteed moon mission. Nothing is guaranteed. {victim} is out.',
  "🤧 {victim} got liquidated by {killer}'s perfectly timed sneeze.",
  '🍴 {killer} pushed a hard fork and {victim} ended up on the wrong side of it.',
  '🏃 {victim} tried to front-run {killer} and tripped over their own transaction.',
  '📡 {killer} unplugged the router and {victim} lagged into another dimension.',
  '💨 {killer} hid a whoopee cushion and {victim} laughed so hard they rolled out of the ring.',
  "🍂 {victim} stepped on {killer}'s rake. Classic. Out.",
  '📦 {killer} built a cardboard fort and {victim} got lost inside it forever.',
  '🥧 {killer} pied {victim} right in the face. Lemon meringue, very dramatic.',
  "🎳 {victim} tried to juggle {killer}'s bowling pins and dropped all of them on their own toes.",
  '✨ {killer} set off a glitter bomb and {victim} vanished in a sparkly cloud.',
  '🎁 {killer} offered {victim} a free NFT. It was a picture of the exit door.',
  "🪙 {victim} staked everything on {killer}'s coin flip and lost the whole stack.",
  '🔘 {killer} pressed the big red button and {victim} got yeeted by a spring-loaded floor.',
  '💪 {victim} challenged {killer} to arm wrestling and lost to a surprise tickle attack.',
  '🎻 {killer} played a sad violin solo and {victim} cried their way out of the arena.',
  '🐝 {killer} released a swarm of very friendly bees and {victim} ran for the hills.',
  "🛹 {victim} borrowed {killer}'s skateboard and went down the stairs instead.",
  "🧲 {killer} used a giant magnet and {victim}'s tin armor dragged them right off the map.",
  '😴 {killer} cast a sleep spell and {victim} is now napping peacefully on the sidelines.',
  '🎊 {victim} opened the mystery chest {killer} left behind. It held confetti and an eviction notice.',
  '🦄 {killer} rode in on a unicorn and {victim} got distracted by the sparkles.',
  '🧩 {killer} told {victim} a riddle and {victim} is still thinking about it outside the arena.',
  "🧪 {victim} drank {killer}'s potion of invisibility and now even the game can't find them.",
  '🛸 {killer} beamed {victim} up into a UFO for a very long interview.',
  '🪐 {killer} switched off the gravity and {victim} floated away waving.',
  "☄️ {victim} patched {killer}'s spaceship with duct tape and launched themselves into a comet.",
  '🌈 {killer} sent {victim} on a quest to find the end of the rainbow. Still walking.',
  '🥞 {killer} flipped a pancake so high it landed on {victim} like a warm blanket. Out cold.',
  "🥤 {victim} got caught in {killer}'s smoothie tornado.",
  '🍲 {killer} served {victim} a mystery casserole. {victim} has gone to lie down.',
  '🧅 {victim} tried to out-chop {killer} in an onion contest and cried themselves out of the game.',
  '🍉 {killer} dropped a watermelon from the balcony and {victim} got a very splashy exit.',
  '⚾ {killer} threw a curveball that curved around {victim} and came back for a bonk.',
  '🦆 {victim} raced {killer} in the sack race and hopped straight into a pond.',
  "🏀 {killer} landed a perfect slam dunk on {victim}'s game plan.",
  '🧊 {killer} tagged {victim} in freeze tag and {victim} is still frozen.',
  "🌭 {victim} entered {killer}'s hot dog eating contest and needed a nap immediately.",
  '✉️ {killer} replied "per my last email" and {victim} evaporated on the spot.',
  '💻 {killer} handed {victim} the Friday afternoon deploy. {victim} is gone.',
  "🪴 {victim} lost a staring contest to {killer}'s houseplant.",
  '🐟 {killer} set the office microwave to fish mode and {victim} evacuated.',
  '☎️ {killer} put {victim} on hold with the elevator music forever.',
  '🚫 {victim} clicked {killer}\'s "free gas refund" link and got ejected by the scam filter.',
  '🔐 {killer} gave {victim} a hardware wallet with no buttons. {victim} is still trying to log in.',
  "📉 {victim} bought {killer}'s top and sold the bottom in record time.",
  '🚪 {killer} shilled {victim} a coin called EXIT, and {victim} took it literally.',
  "🐌 {victim} tried to bridge to {killer}'s chain and arrived three business days late.",
  '🐶 {killer} launched a memecoin about {victim} and {victim} left out of pure embarrassment.',
  "👟 {killer} tied {victim}'s shoelaces together while they were busy flexing.",
  "🪃 {victim} tried to catch {killer}'s boomerang and caught it with their forehead.",
  '🎲 {killer} rolled a natural 20 and {victim} rolled a natural 1. Gone.',
  '🐑 {killer} turned {victim} into a very confused sheep for the rest of the round.',
  "🧌 {victim} poked {killer}'s sleeping troll. The troll was not amused.",
  '💡 {killer} hacked the arena lights and {victim} walked into a cardboard cutout of themselves.',
  '🔨 {killer} pulled out a giant foam hammer and {victim} got politely squished.',
  "🧗 {victim} tried to parkour off {killer}'s shoulders and parkoured straight out of bounds.",
  '✂️ {killer} challenged {victim} to rock paper scissors and played a fourth option.',
  "🐛 {victim} got tangled in {killer}'s spaghetti code and couldn't find the way out.",
  '💥 {killer} pushed to main on a Friday and {victim} got caught in the blast radius.',
  "👑 {killer} slid a whoopee cushion onto {victim}'s throne. Royal exit.",
  '📢 {killer} distracted {victim} with a fake airdrop announcement and walked them to the door.',
  "🎟️ {victim} tried to snipe {killer}'s mint and minted a ticket home instead.",
  '🍩 {killer} waved a donut and {victim} followed it all the way out of the arena.',
  // ---- solo accidents ----
  '🍌 {victim} slipped on a banana peel nobody admits to dropping.',
  '🤸 {victim} bounced on a trampoline and forgot to come back down.',
  '🧹 {victim} ignored the wet floor sign. The floor won.',
  '🧻 {victim} paper-handed their spot in the arena.',
  '⛽ {victim} paid a gas fee bigger than their whole bag and had to leave.',
  '🪑 {victim} rug-pulled their own chair and sat on the floor of defeat.',
  '🌉 {victim} bridged to the wrong chain and is now somewhere very confusing.',
  '😱 {victim} caught so much FOMO they ran into the next arena.',
  '👛 {victim} forgot which wallet they were using and wandered off to find it.',
  '📊 {victim} checked the charts mid-round and fainted.',
  '📉 {victim} tried to buy the dip and fell right into it.',
  '🔘 {victim} hit the wrong button and approved their own elimination.',
  '🔌 {victim} tripped over a loose power cord and took a scenic tumble out.',
  '🤧 {victim} sneezed so hard they launched themselves out of the ring.',
  '👟 {victim} stopped to tie a shoelace and the arena moved on without them.',
  '🌀 {victim} got stuck in a revolving door and is still going around.',
  '💨 {victim} sat on a whoopee cushion and left in shame.',
  '🙃 {victim} tried a backflip. It was mostly a back.',
  '🍿 {victim} accidentally cast a teleport spell to the snack bar.',
  '🫖 {victim} read the wrong scroll and turned into a teapot.',
  '🦅 {victim} was carried off by a very gentle giant eagle.',
  '🚪 {victim} opened a portal to grab snacks and forgot to come back.',
  '💣 {victim} pressed the self-destruct button just to see what it does.',
  '🌠 {victim} took a wrong turn at the asteroid belt.',
  '🌌 {victim} forgot to bring oxygen to the space round. Rookie move.',
  '👽 {victim} got abducted by aliens who just wanted to chat.',
  '🛰️ {victim} drifted off on a space walk and waved goodbye.',
  '🍞 {victim} burnt the toast and got escorted out by the smoke alarm.',
  '🌶️ {victim} taste-tested the hot sauce and left the building at top speed.',
  '🥫 {victim} got lost in the pantry looking for snacks.',
  '🎂 {victim} dropped the cake and had to go into hiding.',
  '🍜 {victim} got tangled in a pile of noodles and called it a day.',
  '⚽ {victim} scored an own goal so spectacular it ended their run.',
  '🦵 {victim} pulled a hamstring while celebrating way too early.',
  '⭕ {victim} got stuck in the hula hoop warm-up.',
  '🏃 {victim} ran the marathon in the wrong direction.',
  '💤 {victim} fell asleep in a meeting and nobody woke them up.',
  '📝 {victim} got trapped under a mountain of sticky notes.',
  '📣 {victim} replied all to the entire galaxy and had to flee.',
  '☕ {victim} spilled coffee on the keyboard and short-circuited their luck.',
  '📋 {victim} was dragged into a surprise performance review.',
  '🤖 {victim} challenged a vending machine and lost.',
  '🌵 {victim} tried to pet a cactus. Ouch. Out.',
  '🦋 {victim} chased a butterfly straight off the map.',
  '🐱 {victim} got distracted by a cat video and missed the entire round.',
  '🧱 {victim} stepped on a toy brick and needed a long lie-down.',
  '🛒 {victim} rode a shopping cart down a hill. The cart won.',
  '💺 {victim} sat on a rolling chair and rolled into another zip code.',
  '🎉 {victim} opened a mystery box and got confetti-blasted out of the arena.',
  '☁️ {victim} tried to lasso a cloud and floated away with it.',
  '🎢 {victim} slid down the stair rail and just kept going.',
  '📦 {victim} took a nap in the loot crate and got shipped somewhere else.',
  '🦙 {victim} tried to sneak past the guard llama. The llama noticed.',
  '🥥 {victim} got bonked by a falling coconut. Island rules.',
  '🎬 {victim} tripped on the red carpet during a victory walk. Way too early.',
  '🍿 {victim} went to grab popcorn and the arena locked the door.',
  '🎤 {victim} mistook a mop for a microphone and sang themselves off stage.',
  '🎲 {victim} rolled a natural 1 on a simple jump.',
  '🌵 {victim} hugged a cactus thinking it was a teammate.',
  '🌫️ {victim} got lost in the fog machine smoke and never came back.',
];

// ---------------- revives (some rounds only) ----------------
// {player} came back from the elimination pile
const revive = [
  '💫 {player} crawled back out of the elimination pile!',
  '🧟 {player} rises again, slightly dusty but very determined.',
  '⚡ A lucky lightning bolt zapped {player} back into the arena!',
  '🔄 Plot twist: {player} respawned!',
  '🪄 Vexo waved a rubber chicken and {player} is back in the fight.',
  '🍀 {player} found a four-leaf clover in the snack bar and walked right back in.',
  '🛸 The aliens returned {player}. They said thanks for the chat.',
  '🎢 {player} rode the comeback coaster straight back into the ring!',
  '🧃 {player} had a juice box, felt better, and rejoined the chaos.',
  '🔋 {player} recharged to full power and is back online!',
  '🦸 {player} pulled a hero comeback out of nowhere!',
  '🌱 {player} sprouted back up like a very stubborn plant.',
  '📦 {player} climbed out of the lost and found box and back into the arena.',
  '🎯 Second chance unlocked: {player} is back!',
  '🧹 The janitor swept {player} back into the arena by accident. It counts!',
  '🐣 {player} hatched a brand new comeback!',
  '🛟 Someone threw {player} a lifebuoy and they are back in the game!',
];

// ---------------- final duel ----------------
// standalone suspense message right before the final duel card
const finalCountdown = [
  'Final duel next… 3… 2… 1…',
  'Two left. The final duel starts in 3… 2… 1…',
  'Countdown to the final duel: 3… 2… 1… 🔥',
  'Deep breaths, everyone. Final duel in 3… 2… 1…',
  'Clear the arena: final duel in 3… 2… 1…',
  'Grab the popcorn, the final duel is next. 3… 2… 1…',
];

const finalDuelIntro = [
  '_The crowd goes silent. Only two remain._',
  '_🥁 It all comes down to this._',
  '_Two fighters, one crown, one very slippery floor._',
  '_The final showdown is here. Vexo is holding its breath._',
  '_Last two standing. Somebody dim the lights for drama._',
  '_This is it: the final duel of the Rumble Royale._',
  '_The arena shrinks to a spotlight. Two legends face off._',
  '_Popcorn down, phones up. The final duel begins._',
  '_Only one can leave with the crown._',
  '_The final bell is about to ring._',
];

const finalDuelElimination = [
  '💨 {killer} dodges at the last second and {victim} slides gracefully off the stage.',
  '🌀 {victim} winds up the ultimate move, but {killer} sidesteps and {victim} spins right out.',
  '🐔 {killer} pulls out the legendary rubber chicken. {victim} never stood a chance.',
  '👀 {victim} and {killer} lock eyes. {victim} blinks first. Game over.',
  '🛏️ {killer} lands a perfectly timed pillow smack and {victim} floats out of the ring.',
  '🎌 {victim} trips over the victory banner while {killer} just stands there, crowned by luck.',
  '🪑 {killer} rug-pulls the final stage, and {victim} goes down with the floorboards.',
  '🦘 {victim} goes for a dramatic leap, {killer} ducks, and gravity does the rest.',
  '💃 {killer} challenges {victim} to a dance-off and wins with one legendary spin.',
  '👑 {victim} reaches for the crown, {killer} reaches faster.',
  '🍌 {killer} drops a banana peel with surgical precision. {victim} slides into history.',
  '⏱️ {victim} calls for a timeout, but {killer} is already celebrating.',
  '🎉 {killer} fires a confetti cannon and {victim} is blasted into the crowd.',
  '💎 {victim} paper-hands the final moment, {killer} diamond-hands the crown.',
  "🤸 {killer} bounces off the trampoline and lands right on {victim}'s comeback plan.",
];

// ---------------- hype inside the round cards ----------------
const banter = [
  'The crowd is losing its mind right now.',
  'Somebody call a referee, this is getting wild.',
  'Vexo has seen many rumbles. This one is spicy 🌶️',
  'The janitor is not getting paid enough for this arena.',
  'Banana peel supply is running low, but spirits are high.',
  'This rumble has more twists than a pretzel factory.',
  'Commentary booth update: absolute chaos.',
  'The trampolines have filed a complaint.',
  'Fun fact: nobody has ever read the arena rules.',
  'The arena floor is mostly confetti now.',
  'Rubber chicken count: dangerously high.',
  "Vexo's circuits are buzzing with excitement.",
  'Every round, a new legend. Every round, a new banana peel.',
  'Not financial advice, but staying alive is bullish.',
  'The vibes are immaculate and the floor is slippery.',
  'Somewhere a soundtrack just switched to epic mode.',
  'Spectators, please keep your arms inside the arena.',
  'If chaos had a trophy, this rumble would win it.',
  'The popcorn machine is working overtime 🍿',
  'This is the most dramatic thing Vexo has hosted all week.',
  'The survivors are getting suspiciously confident.',
  'Gas fees are zero, but the drama is priceless.',
  'Someone just tripped over nothing. Classic arena.',
  'The crowd demands more slapstick. The arena delivers.',
  'Pro tip: luck is the only stat that matters here.',
  'Vexo is keeping score and also eating snacks.',
  'The arena DJ just dropped the beat.',
  'Nobody is safe. Not even the referee.',
  'This is the part of the movie where the music gets intense.',
  'Legends are forged in chaos, and there is plenty of chaos.',
  'Arena update: the mop is winning.',
  "The ring is shrinking and so is everyone's patience.",
  "Somebody's lucky socks are clearly working.",
  'Breaking news: the banana peels have formed a union.',
  'Every fighter left deserves a tiny trophy already.',
  'The crowd is chanting nonsense, and Vexo loves it.',
  "Stay hydrated, survivors. It's a long road to glory.",
  'History is being written. In crayon, but still.',
  'The arena just got a little more dramatic.',
  'Plot armor is real and some of you have it.',
];

const banterKills = [
  '{player} is on fire with **{kills} eliminations** 🔥',
  'Watch out for {player}: **{kills} knockouts** and counting.',
  '{player} has sent **{kills} fighters** to the snack bar already.',
  '{player} is collecting eliminations like trading cards: **{kills}** so far.',
  'Shout-out to {player}, **{kills} eliminations** and not even sweating.',
  '{player} has **{kills} eliminations**. The rubber chickens fear them.',
  'Arena MVP so far: {player} with **{kills}** takedowns.',
  '{player} is having a day: **{kills} eliminations**.',
  "Someone stop {player}, that's **{kills}** already.",
  '{player} just hit **{kills} eliminations**. Legendary behavior.',
  'The crowd chants for {player}: **{kills}** knockouts.',
  '{player} has turned **{kills}** fighters into spectators.',
];

const banterSurvivor = [
  '{player} is still standing against all odds after **{rounds} rounds**.',
  '{player} has dodged everything for **{rounds} rounds**. Built different.',
  'Respect to {player}: **{rounds} rounds** survived and still smiling.',
  '{player} keeps surviving. **{rounds} rounds** of pure luck 🍀',
  'Underdog alert: {player} has made it through **{rounds} rounds**.',
  '{player} has survived **{rounds} rounds** without touching a single banana peel.',
  '{player} is unshakeable, **{rounds} rounds** strong.',
  'Nobody expected {player} to last **{rounds} rounds**. Yet here we are.',
  '{player} has been ducking and weaving for **{rounds} rounds**.',
  "{player}'s plot armor has lasted **{rounds} rounds**.",
  'Quiet but deadly: {player} has survived **{rounds} rounds**.',
  '{player} is living rent-free in this arena, **{rounds} rounds** and counting.',
];

// short replies to people chatting in the Rumble channel during a game (never a question)
const chatReply = [
  'The arena hears you 👀',
  'Noted. The rubber chickens have been informed.',
  'Cheering is allowed, bribing the referee is not.',
  'Vexo appreciates the commentary.',
  'Strong words from the stands.',
  'The crowd is getting rowdy, I love it.',
  'Keep the hype coming.',
  'No hints, no favorites, just pure chaos.',
  'The arena is fair, the banana peels are not.',
  "That's the spirit.",
  'Spectator energy: maximum.',
  'Vexo is taking notes for the highlight reel.',
  'Fortune is listening, maybe.',
  'Bold commentary, I respect it.',
  'The popcorn is on Vexo today 🍿',
  "Can't change the outcome, but you can change the vibe.",
  'Every legend needs a loud crowd.',
  "Stay tuned, it's getting good.",
  'The referee nods approvingly.',
  'Hype received and amplified.',
  'That message gave the arena extra drama.',
  'The fighters heard that, probably.',
  'Vexo stays neutral. Mostly.',
  'Chaos levels rising nicely.',
  'Pure luck decides this one, no matter how loud you cheer.',
  'The arena announcer approves this message.',
  'Love the energy in here.',
  'Somebody give this person a foam finger.',
  'The trampolines bounced a little higher after that.',
  'Words of a true arena fan.',
  'Keep it friendly, keep it loud.',
  'The banana peels are trembling.',
  'Vexo has filed that under legendary quotes.',
  'The crowd goes wild.',
  'Big talk. The arena likes big talk.',
  'Your enthusiasm has been noted by the arena gods.',
  "That's going on the commemorative poster.",
  "Somebody's been practicing their friendly trash talk.",
  'Excellent heckling, ten out of ten.',
  'The show must go on, and it is going on.',
];

// ---------------- the end ----------------
// winner card description ({winner} is the bold display name, no ping inside the card)
const winner = [
  '🏆 **{winner} wins the Rumble Royale!** {kills} eliminations, {rounds} rounds survived. Absolute legend.',
  'And the last one standing is {winner}! {kills} knockouts across {rounds} rounds 👑',
  '👑 {winner} takes the crown with {kills} eliminations after {rounds} rounds of chaos.',
  'Victory royale for {winner}! {kills} eliminations, {rounds} rounds, zero banana peels touched.',
  'The arena bows to {winner}: {kills} eliminations and {rounds} rounds survived 🎉',
  '{winner} is the champion! {kills} takedowns in {rounds} rounds. Frame it.',
  'Confetti everywhere: {winner} wins with {kills} eliminations over {rounds} rounds 🎊',
  'Ladies, gentlemen and rubber chickens: {winner} wins! {kills} eliminations, {rounds} rounds.',
  '{winner} survived it all: {rounds} rounds, {kills} eliminations, one crown 👑',
  "The Rumble has a champion and it's {winner}! {kills} eliminations across {rounds} rounds.",
  '{winner} walks out of the arena a legend. Stats: {kills} eliminations, {rounds} rounds 🏆',
  'Nobody could stop {winner}. {kills} eliminations, {rounds} rounds, all style.',
  '🥇 {winner} wins! {rounds} rounds survived and {kills} fighters sent home.',
  'Crown delivered to {winner}! {kills} eliminations in {rounds} rounds of glorious chaos.',
  'The last legend standing: {winner}, with {kills} eliminations and {rounds} rounds survived ✨',
];

// runners-up card description (above the ranked list)
const runnersUpIntro = [
  'These legends fought hard and almost had it 🏅',
  'So close to the crown, still absolutely iconic.',
  'The podium of near-glory.',
  'Honorable mentions from the arena floor ✨',
  "They didn't win, but they made it dramatic.",
  'A round of applause for the runners-up 👏',
  'The crown slipped by a whisker for these fighters.',
];

// standalone congratulation message ({winner} is a real mention: the only ping at the end)
const winnerCongrats = [
  'Okayy, congratulations {winner}! 🎉🏆 The arena is yours.',
  'WE HAVE A CHAMPION! Huge congrats, {winner} 👑🎊',
  '{winner}, you absolute legend! 🏆✨ Last one standing.',
  'Congratulations {winner}! 🥳 The banana peels never stood a chance.',
  'Crown secured! Massive congrats, {winner} 👑🔥',
  'Okay okay okay, {winner} takes it all! 🎉🏆',
  'Bow down, everyone: {winner} wins the Rumble 👑🙌',
  '{winner} survived the chaos and won it all! 🎊🏆',
  'Champion alert! Congratulations {winner} 🚨🏆',
  "That's a wrap and {winner} is the last legend standing! 🎬🥇",
  '{winner}, the arena salutes you! 🫡🏆',
  'Confetti cannons ready: congratulations {winner}! 🎉🎊',
  'History made! {winner} is our Rumble champion 🏆🌟',
];

// prize part of the congratulation message
const winnerPoints = [
  '**{points} points** have been sent to {winner} automatically 💰',
  "{winner}'s balance just got **{points} points** heavier.",
  "Prize delivered: **{points} points** are already in {winner}'s account.",
  "Ka-ching! **{points} points** landed in {winner}'s balance.",
  '**{points} points** sent to {winner}. Spend them wisely, champ.',
  'The prize is paid: **{points} points** for {winner} 🎁',
  '{winner} pockets **{points} points**, credited automatically.',
  "**{points} points** have been added to {winner}'s balance. Enjoy.",
];

const winnerTicket = [
  '{winner}, your prize is **{prize}**. Open a ticket to claim it 🎟️',
  'Prize: **{prize}**. {winner}, open a ticket and the team will deliver it.',
  '{winner} wins **{prize}**. Pop open a ticket to collect.',
  '**{prize}** is waiting for {winner}. Open a ticket to claim it.',
  '{winner}, claim your **{prize}** by opening a ticket.',
  'The team will hand over **{prize}** to {winner}. Just open a ticket.',
  '{winner}, open a ticket to receive **{prize}** 🎁',
  'Your reward, **{prize}**, is one ticket away, {winner}.',
];

const winnerNoPrize = [
  'No prize this time, just eternal bragging rights.',
  'The reward is glory, and glory looks great on you.',
  'No loot today, but the crown is shiny.',
  'Prize: the respect of the entire arena.',
  'No prize on the line, just pure legend status 😎',
  'Bragging rights unlocked. Use them responsibly.',
];

const cancelNotEnoughPlayers = [
  'Not enough fighters showed up (we needed at least **{min}**). The Rumble is called off. Next time.',
  'The arena needs at least **{min}** fighters to rumble. Calling this one off 😅',
  'Only a few brave souls joined, and we need **{min}**. Rumble cancelled.',
  'Too quiet in here. With fewer than **{min}** players, the Rumble is off.',
  'We needed **{min}** fighters and fell short. The banana peels go back in storage.',
  'Rumble cancelled: the minimum is **{min}** players. Rematch soon.',
];

const cancelledByBoss = [
  '🛑 The boss called off this Rumble. Everyone back to the stands.',
  'This Rumble has been cancelled by the boss. The arena lights dim.',
  'Change of plans: the boss cancelled the Rumble. See you at the next one.',
  'The Rumble is off by order of the boss. Snacks remain available.',
];

// the bot restarted mid-rounds, or the safety timeout hit: no winner is picked
const crashEnded = [
  '😵 Vexo tripped over the power cord and the Rumble got cut short. No winner this time, sorry everyone.',
  'The arena had a technical knockout. This Rumble ends with no winner.',
  'Glitch in the arena! This Rumble is over without a winner. A rematch will come.',
  'Vexo blinked and the arena reset. No winner this round, sorry.',
];

// /rumble used by someone who is not the boss or staff
const denial = [
  'Only the boss and staff can host a Rumble.',
  'Nice try, but the Rumble controls are staff-only.',
  'This command is for the boss and staff.',
  'The arena keys belong to the boss and staff.',
  'Rumble hosting is staff-only. Join the next one as a fighter instead.',
  'Not your arena to run, friend. Staff only.',
];

// Which placeholders each list must (required) or may (optional) use, its minimum size, and how many
// emojis a line must have (emoji: [min, max]; default [0, 1]).
// minWith: minimum number of lines that use an optional placeholder.
const EMOJI_1_2 = [1, 2];
const RULES = {
  announce: { min: 12, required: ['prize_line', 'start_time'] },
  preAnnounce: { min: 8, required: ['prize_line', 'start_time'] },
  joinAck: { min: 8 },
  joinAlready: { min: 6 },
  joinNotAllowed: { min: 6 },
  joinFull: { min: 4 },
  joinClosed: { min: 4 },
  halfwayReminder: { min: 8 },
  reminderPing: { min: 10, required: ['start_time', 'start_relative'] },
  finalPing: { min: 10 },
  gameStart: { min: 10, required: ['players'] },
  roundIntro: { min: 25, required: ['round', 'remaining'] },
  elimination: { min: 150, required: ['victim'], optional: ['killer'], minWith: { killer: 90 }, emoji: EMOJI_1_2 },
  revive: { min: 15, required: ['player'], emoji: EMOJI_1_2 },
  finalCountdown: { min: 6 },
  finalDuelIntro: { min: 10 },
  finalDuelElimination: { min: 15, required: ['victim', 'killer'], emoji: EMOJI_1_2 },
  banter: { min: 40 },
  banterKills: { min: 12, required: ['player', 'kills'] },
  banterSurvivor: { min: 12, required: ['player', 'rounds'] },
  chatReply: { min: 40 },
  winner: { min: 15, required: ['winner', 'kills', 'rounds'] },
  runnersUpIntro: { min: 6 },
  winnerCongrats: { min: 12, required: ['winner'], emoji: EMOJI_1_2 },
  winnerPoints: { min: 8, required: ['winner', 'points'] },
  winnerTicket: { min: 8, required: ['winner', 'prize'] },
  winnerNoPrize: { min: 6, optional: ['winner'] },
  cancelNotEnoughPlayers: { min: 6, required: ['min'] },
  cancelledByBoss: { min: 4 },
  crashEnded: { min: 4 },
  denial: { min: 6 },
};

module.exports = {
  announce, preAnnounce, joinAck, joinAlready, joinNotAllowed, joinFull, joinClosed,
  halfwayReminder, reminderPing, finalPing, gameStart, roundIntro, elimination, revive,
  finalCountdown, finalDuelIntro, finalDuelElimination,
  banter, banterKills, banterSurvivor, chatReply,
  winner, runnersUpIntro, winnerCongrats, winnerPoints, winnerTicket, winnerNoPrize,
  cancelNotEnoughPlayers, cancelledByBoss, crashEnded, denial,
  RULES,
};
