# Community Bot

AI Q&A + activity points + daily top chatter + #marketplace (prize redeem) + tickets.
Node.js (discord.js) + Supabase (free) + OpenAI / Claude API.

## File structure (what lives where)

```
community-bot/
├── .env.example          <- COPY it to ".env" and fill in your keys/IDs
├── knowledge.md          <- Write your community info here (mint, price, rules...)
├── package.json
├── supabase/
│   └── schema.sql        <- PASTE into the Supabase SQL Editor and Run
└── src/
    ├── index.js              (bot start)
    ├── config.js             (point rules / settings, read from .env)
    ├── ai.js                 (OpenAI/Claude call, conversation + Q&A, quality scoring)
    ├── replies.js            (the ONE place that decides if/how Vexo replies to chat)
    ├── identity.js           (boss check by BOSS_USER_ID, startup check)
    ├── bossPresence.js       (when the boss last wrote; welcome back survives restarts)
    ├── bossCover.js          (covers for the boss during his offline window, leaves him notes)
    ├── offlineChat.js        (chats with a lone member during the offline window)
    ├── bossTemplates.js      (welcome-back / cover lines, no AI), bag.js (shuffle bag), clock.js
    ├── personality.js        (Vexo persona, no-pitch filter, "who made you" replies, welcome lines, game banter)
    ├── knowledge.js          (facts taught by the boss, unanswered questions, secret detection)
    ├── chatContext.js        (last 12 messages per channel, memory only)
    ├── points.js, db.js, utils.js, ratelimit.js
    ├── marketplace.js        (shop header, private Purchase flow + receipts, redeem, ticket, delivered, refund)
    ├── deploy-commands.js    (slash command register)
    ├── events/   messageCreate.js, reactionAdd.js, interactionCreate.js, guildMemberAdd.js
    ├── tasks/    control channel + scheduled tasks
    │             control.js (orders), parser.js (AI order -> JSON), scheduler.js (15s check),
    │             registry.js (task types), numberGuess.js (the game), store.js, report.js, time.js,
    │             rumbleRoyale.js (Rumble Royale engine), rumbleTemplates.js (all Rumble lines, easy to edit)
    ├── jobs/     daily.js (nightly quality check + top 1), scheduler.js
    └── commands/ ask, points, leaderboard, ticket, rumble,
                  additem, edititem, removeitem, listitems,
                  addpoints, removepoints, pending, refund, rundaily
tests/boss.test.js            (offline test: boss recognition, no pitch, no game hints. Run: npm test)
```

**You only need to work in 3 places:** `.env`, `knowledge.md`, and Supabase `schema.sql`. You don't need to touch the rest of the code.

## Setup (one time)

1. Install **Node.js 22**, then run `npm install` in the folder
2. **Create a Discord bot** (https://discord.com/developers/applications)
   - New Application > Bot > copy the Token (`DISCORD_TOKEN`)
   - On the Bot page, turn ON **Message Content Intent** and **Server Members Intent**
     (Server Members Intent is needed for welcome messages. If it is OFF, the bot will
     **fail to log in** with "Used disallowed intents".)
   - General Information > Application ID = `CLIENT_ID`
   - OAuth2 > URL Generator: scopes `bot` + `applications.commands`
     Permissions: View Channels, Send Messages, Embed Links, Attach Files,
     Read Message History, Add Reactions, Manage Channels, Manage Roles
   - Use the generated link to add the bot to your server
3. **Supabase**: New project > SQL Editor > paste `supabase/schema.sql` > Run
   Project Settings > API: copy `SUPABASE_URL` and the `service_role` key (`SUPABASE_SERVICE_KEY`)
4. Copy `.env.example` to `.env` and fill in everything
   (in Discord, turn on Developer Mode, then right-click a channel/role/server > Copy ID)
5. Write your community info in `knowledge.md`
6. Register commands: `npm run deploy`
7. Start the bot: `npm start`

## Discord channel permissions

- `#marketplace`: members get only **View + Read History** (Send Messages OFF). The bot needs View Channel, Send Messages,
  Embed Links and Read Message History (it only ever deletes its own old item cards, which needs no extra permission).
- Receipts channel (`RECEIPT_CHANNEL_ID`, staff only): the bot needs View Channel, Send Messages, Embed Links, Read Message History.
- `#redeem-logs`: only admins/mods can see it. The bot needs Send + Attach Files.
- `#ask-here`: everyone can write. The bot replies only to real HΛVØCZ questions and stays quiet during casual chat (unless someone talks to it).
- For **role rewards**: in Server Settings > Roles, place the bot's role **above** the reward roles.
- If admins with the `ADMIN_ROLE_ID` role can't see the slash commands: Server Settings > Integrations > bot > allow them in command permissions.

## How it works

- **Talking to Vexo**: Vexo speaks when it is mentioned, replied to, or called by name ("vexo"), in `#ask-here`, and with `/ask`.
  It never butts into other conversations. The AI decides from the meaning (and recent chat) whether a message is a real HΛVØCZ
  question: then it answers from `knowledge.md` + taught facts. Otherwise it just chats back, witty and short (1-2 sentences).
- **Answer style**: HΛVØCZ answers are a brief in Vexo's own words, plain conversational prose (no lists, headings or bold).
  Broad questions ("what's the roadmap?") get a 4-7 sentence overview that names every roadmap stage (stage names are read
  from the `### Phase ... - Name` headings in `knowledge.md`). Specific questions ("when is the mint?") get 1-3 sentences.
  "Give me everything" gets a longer, still compact answer. Unknown details are mentioned in a light way, never invented.
  Wording varies between answers. Answers stay under 1800 characters; an over-long answer gets one extra AI call to tighten it.
  Vexo also knows how the bot's own points and marketplace work, so "where do we use points?" is answered from the code's settings.
  Check the style any time with `npm run test:qa` (asks your real AI model about 7-10 small questions; Supabase is not touched).
  It never pitches the community or offers help ("ready to help with community questions" etc. is filtered out even if the AI writes it).
  Edits to `knowledge.md` don't need a restart.
- **The boss**: recognized only by `BOSS_USER_ID` (the Discord user ID), in every channel, on mentions, replies, "vexo", `/ask`,
  greetings and in the game. Vexo always calls him "boss", is never rate limited for him, and gives him HΛVØCZ info only if he asks.
  Vexo never asks the boss a question outside the control channel order flow: every reply to him is a statement (question
  sentences and follow-ups like "what's next?" are cut in code; if nothing is left, it regenerates once, then uses a fixed line).
  It never messages the boss on its own; it only answers when he talks to it.

## The boss's presence (welcome back, offline window, cover)

- **Replies to the boss only when he talks to Vexo**: an @mention, a reply to a Vexo message, a direct "vexo, ..." / "hey vexo ...",
  or a question in `#ask-here`. His chat with others, remarks, "gm" and emojis get no reply. Closing remarks to Vexo ("ok", "lol",
  "let's see", pure emoji) get a reaction at most. Without an explicit mention / reply, Vexo answers him at most once a minute
  per channel and at most twice in a row.
- **Welcome back**: when the boss writes after `BOSS_AWAY_HOURS` without a message (control channel not counted), Vexo replies
  to that message with ONE funny welcome-back line (template, no AI), then goes back to the rule above. The time of his last
  message is saved in the `bot_settings` table, so a restart never causes a false welcome.
- **Offline window** (`BOSS_OFFLINE_START`-`BOSS_OFFLINE_END`, read on the boss's own clock `BOSS_TIMEZONE`; these hours are never
  shown to anyone): when a member writes in a chat channel that has been quiet for `OFFLINE_QUIET_MINUTES`, Vexo chats with them
  like a friendly server member (at most `OFFLINE_CHAT_MAX_LINES` short lines, never a question). After
  `OFFLINE_CHAT_SOFT_REPLIES` replies it only continues if the member keeps addressing Vexo; when another person joins, Vexo steps
  back. Chat channels = `CHAT_CHANNEL_IDS` if set, otherwise normal text channels except marketplace, logs, control, `#ask-here`,
  welcome, rules, tickets and announcement channels. Outside the window nothing changes.
- **HΛVØCZ questions** are answered right away at any time, with light humor (about 1 in 3 answers gets a short playful extra
  sentence), never ending in a question.
- **Cover**: during the offline window, when a member mentions the boss (or replies to him) and he has not written anything in the
  last `BOSS_ACTIVE_RECENT_MINUTES`, Vexo replies that the boss may be resting and that it is covering for him:
  - a greeting / bare mention gets a short template line (no AI);
  - a question Vexo can answer from `knowledge.md` + taught facts is answered in the same reply (one AI call);
  - anything only the boss can handle (decisions, prizes, payments, WL spots, partnerships, dates not in the knowledge, support,
    complaints) gets an honest "this needs the boss" reply plus ONE separate note that pings the boss with a short summary and a
    link to the message. That note is the only thing that pings him. Limits: one note per member per `BOSS_NOTE_COOLDOWN_MINUTES`,
    at most `BOSS_NOTE_CHANNEL_MAX` notes per channel per hour.
  - Vexo never promises anything on the boss's behalf (no prizes, dates, approvals, WL spots or refunds), never pretends to be him
    and never shares his schedule. Notes and limits are kept in memory only (nothing about members is stored).

| Variable | Default | What it does |
|---|---|---|
| `BOSS_AWAY_HOURS` | 4 | Gap that earns one welcome-back line |
| `BOSS_OFFLINE_START` / `BOSS_OFFLINE_END` | see `.env.example` | Your usual offline window (24-hour HH:MM, your clock). Same value twice = off |
| `OFFLINE_QUIET_MINUTES` | 10 | A channel must be quiet this long before Vexo chats with a lone member |
| `OFFLINE_CHAT_MAX_LINES` | 2 | Max short lines per offline-chat reply |
| `OFFLINE_CHAT_SOFT_REPLIES` | 2 | After this many replies, only if the member keeps addressing Vexo |
| `BOSS_ACTIVE_RECENT_MINUTES` | 15 | The boss wrote this recently = he is around, no cover |
| `BOSS_NOTE_COOLDOWN_MINUTES` | 30 | One note (ping) per member in this time |
| `BOSS_NOTE_CHANNEL_MAX` | 3 | Max notes (pings) per channel per hour |
| `CHAT_CHANNEL_IDS` | (empty) | Optional: only these channels for offline chat |
  At startup the console says whether `BOSS_USER_ID` is set and looks valid (17-20 digits).
- **Message points**: 2 valid messages = 1 point (max 5/day). Short, repeated, link-only messages, messages within 5 seconds of each other, new accounts, and bot messages don't count.
- **Reaction points**: reacting to someone else's message = 1 point (max 2/day). Reactions on your own or the bot's messages don't count.
- **Quality bonus**: at night the AI scores messages (0-3). Every 3 points of total score = 1 point (max 3/day).
- **Daily cap**: 10 points (message + reaction + quality combined).
- **Top 1**: at night, the member with the best quality score wins (ties go to whoever sent more messages). They get **+5 bonus** (outside the cap) + an announcement in `#general`. At least 5 valid messages are required.
- **Marketplace**: `#marketplace` holds ONE message: "🛒 Marketplace" with two buttons, **🪙 My Points** and **🛍️ Purchase**
  (posted once, then edited in place; the bot removes its old per-item cards at startup and logs how many). Everything after the
  click is private (only the member sees it):
  **Purchase** > "🛍️ Prize Shop" with your balance and every prize (sold-out ones shown but not selectable, Previous/Next above
  25 prizes) > pick a prize > details with "Points after purchase" > **✅ Confirm purchase** (only clickable with enough points and
  stock; a double click buys once) > points are deducted and stock goes down through the same purchase function as always >
  a **🧾 Purchase Receipt** (receipt number, price, points before/after, time). A staff copy goes to `RECEIPT_CHANNEL_ID`
  (if set; a missing channel never blocks a purchase) and the receipt is also posted in the ticket when one is opened.
  `/additem` just adds the prize to the database: it shows up in Purchase right away, no card is posted.
  As before: a Pending log appears in `#redeem-logs` > role items are delivered automatically; otherwise the member clicks
  **Open Ticket** > an admin delivers and clicks **Mark Delivered** > the transcript is saved and the ticket closes.
- **Refund**: `/refund purchase_id` (pending purchases only).
- **Vexo persona**: the bot is called Vexo. Ask it "who made you?" (mention it or ask in `#ask-here`) and it says its boss is remo.sol,
  mentioning `BOSS_USER_ID`. Only the boss gets pinged. If `BOSS_USER_ID` is empty, it writes "remo.sol" as plain text.
  Claiming to be the boss gives nobody any extra powers.
- **Welcome**: new members get a short AI welcome in `WELCOME_CHANNEL_ID`, with links to `RULES_CHANNEL_ID` / `MARKETPLACE_CHANNEL_ID` if set.
  Bots are ignored. If more than 3 people join within 60 seconds, the 4th joiner onward gets one combined welcome. Someone who leaves and
  rejoins within 24 hours is not welcomed again. No DMs are sent. Needs **Server Members Intent** (see Setup).

## Control channel + Number Guess Game

Talk to Vexo naturally in English, Bangla or Banglish in a **private** channel (`CONTROL_CHANNEL_ID`).
Only `BOSS_USER_ID` and members with a role in `STAFF_ROLE_IDS` are listened to. Everyone else is ignored there.
Each message is understood by the AI (one small-model call) with the last 10 messages as memory, so follow-ups work.

- Orders: `ajke raat 11 tay game chalao` · `a number guess game tonight at 10:30 with 50 points prize` · `game ta ekhoni shuru koro`
- Follow-ups: `ok` · `ha thik ache` · `na thak` · `make it 9 instead` · `time ta 9 tay koro` · `same but tomorrow` · `oita cancel kore dao`
- Questions: `ki ki korte paro?` · `kon kon game schedule kora ache?` · `how does the game work?`

Vexo repeats every change back and only acts after you say yes. A pending change expires after 10 minutes.
If something important is unclear (morning or night? which game?), it asks one short question.

**Times:** you write times in your own zone (`BOSS_TIMEZONE`, e.g. `11 tay`, `tonight at 10:30`, `in 20 minutes`), or name a zone
explicitly (`14:00 UTC`). Times are stored in UTC and Vexo always **shows** them in UTC, 24-hour, e.g. `14:30 UTC (in 12 minutes)`.

Game timeline (always in `GENERAL_CHANNEL_ID`):
1. **T-10 min**: announcement that pings `VERIFIED_ROLE_ID` (never @everyone / @here). Posted immediately if you order less than 10 minutes ahead.
2. **T-2 min**: short reminder (no ping).
3. **T**: the game starts. Vexo picks a secret number (default 1-100). Members guess by typing a number. **No hints**: Vexo never says
   higher/lower, close, warm/cold. It reacts to about 1 in 3 wrong guesses with a playful line that says nothing about the number
   (never the same member twice in a row, no repeated lines), refuses hint requests playfully, and chats/jokes with everyone.
   One guess per 3 seconds, `GAME_MAX_GUESSES_PER_USER` per member.
4. The first correct guess wins. The winner is told to open a ticket (`TICKET_CHANNEL_ID`), and you get a report in the control channel
   (winner, secret number, guesses, players, prize). The prize is **not** given automatically.
5. No winner after `GAME_DURATION_MINUTES`: the number is revealed and you get a "no winner" report.

While a game runs, the general channel belongs to the game: Q&A replies pause there, points still count.
Tasks are stored in Supabase (`scheduled_tasks`), so they survive restarts. If the bot was offline at start time, it tells you
instead of starting late. If it restarts mid-game, it ends that game and tells you.

**Permissions** in the general channel and the control channel: View Channel, Send Messages, Read Message History.
For the role ping: make the verified role **mentionable** (Server Settings > Roles), or give the bot **Mention @everyone, @here, and All Roles**.
**Message Content Intent** must be ON (Developer Portal > Bot).

## Rumble Royale

A battle-royale elimination game hosted by Vexo, in its **own channel** (`RUMBLE_CHANNEL_ID`). If that is empty or wrong,
no Rumble is scheduled or started anywhere (you get a clear message) and Vexo never falls back to another channel.
At startup the console says whether the channel was found and warns about missing permissions.

**Two ways to host, same game:**
- **Ask Vexo** in the control channel (English / Bangla / Banglish), then confirm with yes:
  `aj 9 tay rumble royale chalao, 10 minute, prize 100 points` · `ekhoni rumble start koro 10 min, NFT prize` ·
  `tonight 10pm rumble royale, 15 minutes, 500 points` · `min 5 players`. "10 minute" / "5 min dhore" is the **join window**,
  not the start time. `cancel the rumble`, `rumble status` / `list`, reschedule and "run now" work too.
- **Slash command** (boss and `STAFF_ROLE_IDS` only, no AI): `/rumble start minutes:5 prize:"100 points" min_players:3 start_in:0`
  shows a private preview with **Confirm / Cancel** (2 minutes, only you can press them; nothing is scheduled before Confirm).
  `/rumble cancel` (until the rounds start) and `/rumble status`.

**Prize types** (same rule for both): `"100 points"` = paid **automatically** to the winner (through the normal points system,
logged in `point_log` as `rumble_royale_prize task #ID`, never twice). Anything else (`1 SOL`, `NFT`, `WL`, `$50`, a role...)
= the winner opens a ticket and the team delivers it. Empty = no prize. A points prize above `RUMBLE_MAX_POINTS_PRIZE` needs a second confirm.

**How it plays:** at the start time Vexo posts a Join button (pings `VERIFIED_ROLE_ID`; a scheduled game also gets a heads-up
5 minutes before). Only verified members can join (`RUMBLE_REQUIRE_VERIFIED`). Reminders at halfway and 1 minute left.
When the window closes: fewer than `RUMBLE_MIN_PLAYERS` = cancelled; otherwise the rounds start.

- **Round cards:** every round is its own embed card ("⚔️ Round N", red), posted one at a time with `RUMBLE_ROUND_SECONDS`
  between cards (minimum 3; lower values are raised to 3 with a warning at startup). Each card has an intro line, the
  eliminations (about a quarter of the players per round, each line with its own emoji, names in bold, nobody pinged),
  sometimes a hype line, and "👥 N players left". With 2 left, a short "3… 2… 1…" message, then the gold "🔥 FINAL DUEL" card.
- **Revives:** from round 2, each round has a `RUMBLE_REVIVE_CHANCE` % chance that ONE earlier-eliminated player comes back
  (orange card with a "🧟 REVIVE" section; they keep their kills and can be eliminated again). Never in round 1, never with
  3 or fewer players left, never in the final duel, at most `RUMBLE_MAX_REVIVES` per game, once per player. Everyone
  eliminated has the same chance.
- **The end** (about 2 seconds apart): a gold **👑 RUMBLE CHAMPION** card (name, avatar, eliminations, rounds survived,
  players, prize, revived), a **🏅 Runners-up** card (the last `RUMBLE_RUNNERS_SHOWN` players eliminated, 🥈 🥉 4️⃣ 5️⃣ 6️⃣,
  with their kills; same round = more kills first), then a congratulation message that pings the winner and says the points
  were sent (only after they really were), or to open a ticket, or just celebrates.
- The winner and every elimination are picked in code with `crypto.randomInt`: nobody can influence it.

You get a report in the control channel (winner, prize, payout + new balance, runners-up, players, rounds, revives).

**Zero AI cost:** every line comes from `src/tasks/rumbleTemplates.js` (edit it freely; `node tests/rumble.test.js` checks it).
The only AI call is understanding your control channel order. `/rumble` and the game itself use none.

**Restarts:** during the join window the players are restored and the countdown continues; mid-rounds the game is ended
safely with no winner and no payout (unless the winner was already decided). The safety timeout `RUMBLE_MAX_MINUTES`
ends a stuck game.

**Setup:** put the channel ID in `RUMBLE_CHANNEL_ID`, run `npm run deploy` once (registers `/rumble`), restart.
Bot permissions in the Rumble channel: View Channel, Send Messages, Read Message History, and for the role ping either a
**mentionable** verified role or **Mention @everyone, @here, and All Roles**. `/rumble` is hidden from members without
Manage Server; to let a staff role see it, allow it in Server Settings > Integrations > the bot > /rumble.

| Variable | Default | What it does |
|---|---|---|
| `RUMBLE_CHANNEL_ID` | (empty) | The only channel Rumbles run in. Empty = Rumble off |
| `RUMBLE_MIN_PLAYERS` | 3 | Fewer players when the window closes = cancelled |
| `RUMBLE_MAX_PLAYERS` | 100 | Join cap |
| `RUMBLE_ROUND_SECONDS` | 6 | Seconds between round cards (minimum 3) |
| `RUMBLE_REVIVE_CHANCE` | 25 | % chance per eligible round that one eliminated player is revived (0 = no revives) |
| `RUMBLE_MAX_REVIVES` | 2 | Max revives per game |
| `RUMBLE_RUNNERS_SHOWN` | 5 | Runners-up listed under the winner card (max 9) |
| `RUMBLE_MAX_MINUTES` | 20 | Safety timeout after the rounds start |
| `RUMBLE_REQUIRE_VERIFIED` | true | Only `VERIFIED_ROLE_ID` members can join |
| `RUMBLE_DEFAULT_JOIN_MINUTES` | 5 | Join window when none is given |
| `RUMBLE_MAX_POINTS_PRIZE` | 100000 | A bigger points prize needs a second confirm |
| `RUMBLE_PRE_ANNOUNCE_MINUTES` | 5 | Optional: heads-up before a scheduled Rumble |

### Personality / welcome env vars

| Variable | What it does |
|---|---|
| `BOSS_USER_ID` | Discord user ID of remo.sol (digits only, no quotes/spaces). Vexo recognizes the boss by it everywhere and mentions it in "who made you" answers (empty = plain "remo.sol") |
| `WELCOME_CHANNEL_ID` | Channel for welcome messages (empty = welcomes off) |
| `RULES_CHANNEL_ID` | Optional rules channel, linked in welcomes |
| `MARKETPLACE_CHANNEL_ID` | Already used by the marketplace, also linked in welcomes |

## What Vexo learns (and what it doesn't)

Vexo learns **only from the boss (`BOSS_USER_ID`) in the control channel**. It never learns from members and stores nothing about them.

- **Teach**: `remember: the mint is on 5 November` · `eta shikho: whitelist spots are 500`. Vexo confirms in one sentence.
- **Edit / forget / list**: `fact 3 should say 600 spots` · `forget the fact about the mint` · `ki ki shikhiyechi?`
- Staff (`STAFF_ROLE_IDS`) can list facts and open questions, but only the boss can teach, edit or forget.
- Facts live in Supabase `vexo_knowledge` (forgetting sets `active = false`, so mistakes can be undone in Supabase).
- When a member asks about HΛVØCZ (in `#ask-here`, by mentioning Vexo, or with `/ask`), Vexo answers from `knowledge.md` + the taught facts.
  If neither has the answer, it says so playfully and the question text (no name, no user ID) goes to `vexo_unanswered`,
  merged with similar questions. Ask `ki proshno uttor dite parini?` to see the top ones; teaching a fact that answers one ticks it off.
- What members say is never treated as fact. Vexo keeps the last 12 messages per channel **in memory only** (lost on restart)
  just to understand follow-up questions.
- Messages that look like a password, seed phrase, private key or token are never saved (and in the control channel they are not even sent to the AI).

### Control channel / game env vars

| Variable | What it does |
|---|---|
| `CONTROL_CHANNEL_ID` | Private order channel. Empty = control channel + tasks disabled (warning at startup) |
| `STAFF_ROLE_IDS` | Comma separated roles that can also give orders (besides `BOSS_USER_ID`) |
| `GENERAL_CHANNEL_ID` | Where games run (already used for the daily top chatter). Empty = games can't be scheduled |
| `VERIFIED_ROLE_ID` | Role pinged in the 10-minute announcement (already used for points eligibility) |
| `TICKET_CHANNEL_ID` | Optional ticket channel linked in the winner message |
| `GAME_DURATION_MINUTES` | Game length before "no winner" (default 15) |
| `GAME_MAX_GUESSES_PER_USER` | Guesses per member per game (default 30) |
| `GAME_ANNOUNCE_MINUTES` | Minutes before start for the announcement (default 10; lower it for testing) |
| `BOSS_TIMEZONE` | IANA time zone you write order times in. Only used to understand you; everything is shown in UTC |

After updating, run `supabase/schema.sql` again in the Supabase SQL Editor (it's safe to re-run) to create `scheduled_tasks`.

## Commands

Member: `/ask` `/points` `/leaderboard` `/ticket`
Admin: `/setupmarketplace` `/additem` `/edititem` `/removeitem` `/repostitem` `/listitems` `/addpoints` `/removepoints` `/pending` `/refund` `/rundaily`

For `/additem`, use a permanent link in `image_url` (Discord attachment links expire after a few days).

## Changing settings

Point rules, caps, and filters are all set in `.env` (listed in `.env.example`). No code changes needed.
AI switch: `AI_PROVIDER=openai` or `anthropic`.

## Deploy on Render

1. Render > **New > Web Service** > connect the GitHub repo.
2. Settings:
   - **Root Directory**: the folder that contains `package.json`. If `package.json` is at the top of the repo,
     leave it empty; if the repo has a `community-bot/` folder with `package.json` inside, enter `community-bot`.
   - **Runtime**: Node (version 22 is picked from `engines` in `package.json`)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health` (answers `ok`, shows nothing else)
3. **Environment**: add every variable from `.env.example` with your real values (Render has no `.env` file;
   the bot reads Render's env vars directly). Never commit `.env`. Don't set `PORT`, Render sets it.
4. Run `npm run deploy` once from your own computer (registers the slash commands); it is not needed on Render.
5. On redeploy Render sends SIGTERM: the bot stops its timers, disconnects from Discord and exits. A game that was
   running follows the normal restart rules (no late winner, no payout).

- The free plan goes to sleep (the bot will go offline). To prevent that, use a paid plan, ping
  `https://<your-app>.onrender.com/health` every 5 minutes with UptimeRobot, or use a cheap VPS.
- The database is on Supabase, so redeploying doesn't lose any points.

## Testing tips

1. Add a test prize (price 1) with `/additem`, give yourself points with `/addpoints`, then click **Purchase** in `#marketplace` to test the full flow.
2. Write a few messages, then check `/points`.
3. Test the nightly job right away with `/rundaily force:true`.
