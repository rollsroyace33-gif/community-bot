# Vexo upgrade: Phase 1 audit and plan

Written 2026-11-14. No feature code was written in Phase 1. Nothing here is built yet.
Service prices and limits below were looked up on 2026-11-14 and can change; check each provider's page before paying.

---

## PART 1: AUDIT (what exists today)

### A. Project architecture
- Node.js 22, plain JavaScript. Libraries: `discord.js` 14, `@supabase/supabase-js`, `node-cron`, `dotenv`. Nothing else.
- `src/index.js` starts everything: loads config, logs in, loads the `guilds` rows, registers slash commands, starts the timers, and runs a tiny web server (`/health`) so Render sees the bot as alive.
- `src/events/` = what happens on a message, a button press, a member joining, the bot being added to / removed from a server.
- `src/commands/` = 24 slash commands (one file each, picked up automatically).
- `src/tasks/` = control channel orders + games (Rumble, Number Guess) + their scheduler.
- `src/jobs/` = nightly points job and trial/payment reminders.
- Single feature files: `giveaway.js`, `marketplace.js`, `scam.js`, `automod.js`, `xDrop.js`, `learn.js`, `knowledge.js`, `ai.js`, `replies.js`, `setup.js`, `plans.js`, `guilds.js`.
- Tests: 8 offline test files in `npm test` (fake Discord, fake database, fake AI) + 3 extra (`shop`, `boss-gate`, `rumble-order`) + `qa` (makes real AI calls).

### B. Multi-server architecture
- One row per server in the `guilds` table (settings JSON, boss, plan dates, AI call counter). Every data table has `guild_id`.
- `guilds.settings(server)` is the ONE place features ask "which channels / roles / boss does this server use?".
  - HΛVØCZ (home server): values come from `.env`. Nothing is auto-created there.
  - Other servers: values come from their `guilds` row, filled by automatic setup and `/setup`.
- Plans: `config.features` is the feature map (`free` / `premium`). `plans.hasFeature(server, feature)` is the check. HΛVØCZ always has everything. A feature that is NOT in the map is off everywhere except HΛVØCZ (this is exactly what the Personal Vexo flag needs).
- Automatic setup (`src/setup.js`): on join it creates a "Vexo" category with `vexo-control`, `marketplace`, `rumble`, `vexo-logs`, `x-posts`, `giveaways`. It reuses channels that exist, never duplicates, saves IDs per server, explains missing permissions, and can be re-run safely with `/setup`.

### C. Commands and features today
- Everyone: `/ask`, `/points`, `/leaderboard`, `/help`, `/ticket`.
- Admin: `/setup`, `/status`, `/knowledge`, `/automod`, `/rumble`, `/guess`, `/giveaway`, `/additem`, `/edititem`, `/removeitem`, `/repostitem`, `/listitems`, `/pending`, `/refund`, `/setupmarketplace`, `/addpoints`, `/removepoints`, `/rundaily`.
- Owner only, HΛVØCZ only: `/admin`.
- Not commands: chat with Vexo (mention / "vexo" / reply), control channel orders in plain language, points for activity, X post rewards, scam protection, auto mod, welcome messages, boss presence / cover / offline chat (HΛVØCZ only).

### D. HΛVØCZ knowledge system
- HΛVØCZ: `knowledge.md` (imported into the database once) + facts the boss teaches in the control channel (`vexo_knowledge` table). HΛVØCZ never learns from channels.
- Other servers: admin picks "knowledge source channels" in `/setup`; `learn.js` summarises them into `guilds.knowledge`.
- `ai.converse()` builds the prompt with that knowledge and Vexo's personality. `tests/prompt-snapshot.test.js` proves the HΛVØCZ prompts did not change. This test is the safety net for every later phase.
- Unanswered questions are stored (text only) in `vexo_unanswered`.

### E. Rumble, Giveaway, Guess Game
- **Rumble** (`tasks/rumbleRoyale.js`, very large): players press a Join button. Players are kept in memory (`game.players`, keyed by Discord user id) and saved inside the task's `state` in `scheduled_tasks`. One entry per user id already.
- **Number Guess** (`tasks/numberGuess.js`): members type numbers in the channel. Guess counts are kept in memory per user id. There is no "join" step: playing = typing guesses.
- **Giveaway** (`giveaway.js`): entries in the `giveaway_entries` table; the database key (giveaway, user) makes double entries impossible.
- Rumble and Guess run through the task scheduler; giveaways have their own timer. All survive restarts.

### F. Vexo Logs and admin permissions
- Each customer server has a private `vexo-logs` channel. HΛVØCZ has no separate logs channel today: logs go to `REDEEM_LOGS_CHANNEL_ID`, and scam alerts fall back to the control channel.
- Who is an admin: the boss (by Discord user ID only), staff roles, members with Manage Server, and in HΛVØCZ also `ADMIN_ROLE_ID`.
- There is already an "approval with buttons" pattern: scam alerts in the logs channel with Kick / Ban / Ignore, where only admins can press. NFT Radar approvals and Personal Vexo approvals will copy this pattern (no new permission system).

### G. Database (Supabase, plain SQL files)
- `schema.sql`: `users`, `daily_stats`, `messages_log`, `reaction_log`, `point_log`, `items`, `purchases`, `bot_settings`, `daily_runs`, `scheduled_tasks`, `vexo_knowledge`, `vexo_unanswered` + points/shop functions.
- `migration_multiserver.sql`: `guilds`, `x_post_drops`, `guild_id` on everything, per-server functions, `count_ai_call`.
- `migration_scam_xdrop.sql`: `scam_actions`.
- `migration_giveaway.sql`: `giveaways`, `giveaway_entries`.
- All tables have row level security on: only the bot can read them.

### H. Schedulers / background jobs (4 today)
1. Task scheduler: checks `scheduled_tasks` every 15 seconds (games).
2. Daily job: `node-cron`, default 23:55 Asia/Dhaka (quality points, top chatter).
3. Expiry reminders: hourly (trial / payment notices).
4. Giveaway timer: every 10 seconds.
- All of them keep their state in the database, so a restart never duplicates work. New schedulers will follow the same rule.

### I. External API integrations today
- Discord, Supabase, and ONE AI provider (OpenAI by default, Anthropic optional) called with plain `fetch`.
- There is NO market data, NO Solana / wallet, NO NFT marketplace and NO web search integration yet. All of that is new.

### J. AI model and tool calling
- Default model `gpt-4o-mini`. Every AI call goes through `ai.chat()`, which enforces the plan and the per-server daily AI limit (`DEFAULT_DAILY_AI_LIMIT`; HΛVØCZ unlimited).
- `ai.chat()` returns text or JSON. There is NO tool / function calling today.
- There is no per-user AI limit today (only a per-hour Q&A rate limit). Personal Vexo needs a new per-user daily limit.

### K. Event participation and rewards
- Points prizes are paid by `tasks/prize.js` (Rumble, Guess) and `giveaway.js`, both check `point_log` first so nobody is paid twice.
- Non-points prizes are claimed with the server's ticket instructions.
- Participation identity is already the Discord user id everywhere, which is what "human + agent = one participant" needs.

### L. Existing files that later phases must touch (small, additive edits only)
| File | Why | Phase |
|---|---|---|
| `src/config.js` | new .env names, feature map entries | 2, 3, 4, 5, 6 |
| `src/guilds.js` | new channel keys in settings | 2 |
| `src/setup.js`, `src/commands/setup.js` | new channels in auto setup and /setup | 2 |
| `src/commands/status.js`, `help.js` | show the new features | 2 onward |
| `src/plans.js` | command / button feature locks, feature names | 2 onward |
| `src/index.js` | start / stop new timers; DM support | 3, 4, 6, 8 |
| `src/events/interactionCreate.js` | route new buttons (approve / reject, request assistant) | 3, 6 |
| `src/events/messageCreate.js` | DM branch for Personal Vexo; activity tracking | 6, 11 |
| `src/replies.js` | Web3 question router in front of normal chat | 5 |
| `src/ai.js` | one new export for tool-style calls (existing functions untouched) | 5 |
| `src/giveaway.js` | one small function to add an entry for an owner | 11 |
| `src/tasks/rumbleRoyale.js` | one small function to add a player for an owner | 11 |
| `.env.example`, `package.json`, `README.md` | new variables, new test scripts, docs | all |

### M. New files (all new code lives here)
- `src/web3/cache.js` (shared cache), `src/web3/market.js` (SOL price, OHLC, RSI), `src/web3/solana.js` (wallet reads), `src/web3/nft.js` (collections, floors, launches), `src/web3/research.js` (web search), `src/web3/router.js` (which tool answers which question), `src/web3/safety.js` (wallet address check, seed phrase / private key detection).
- `src/solRadar.js`, `src/nftRadar.js`, `src/approvals.js` (shared Approve / Reject buttons).
- `src/personal/agents.js`, `chat.js`, `memory.js`, `wallets.js`, `reminders.js`, `alerts.js`, `participation.js`, `updates.js`.
- Commands: `src/commands/solradar.js`, `nftradar.js`, `myvexo.js`.
- SQL: one re-runnable file per phase that needs it (`migration_radar.sql`, `migration_personal.sql`, ...).
- Tests: one offline test file per phase, added to `npm test`.

### N. Conflicts and security risks found
1. **Direct messages do not work today.** The bot does not ask Discord for DM messages, `messageCreate` ignores DMs, and the button handler refuses anything outside a server. Personal Vexo chat in DMs needs the "Direct Messages" intent (not a privileged one, no Discord approval needed) and a new, separate DM branch. Existing server behaviour is not touched, but this is a change to two core files, so it is listed as a question below.
2. **Web3 assistant changes normal chat.** Phase 5 puts a router in front of Vexo's normal answers. Risk: a HΛVØCZ question is answered by the Web3 path by mistake. Safe approach: the router only takes clear live-data questions (price, floor, wallet address, "research this project"); everything else goes to the existing path unchanged, and the prompt snapshot test must still pass.
3. **No reliable free "upcoming Solana mints" feed exists.** Magic Eden's public API lists its own launchpad collections only. NFT Radar quality will depend on this plus web research. The admin approval step is the safety net; expect some weak candidates in the approval queue.
4. **"Artwork quality" needs an image-capable AI call** (more expensive). Plan: leave it out of version 1 and judge from text signals; add it later if you want.
5. **Guess Game by an agent is a fairness problem.** In Rumble and giveaways an agent only "joins". In the Guess Game, playing means guessing numbers; a bot guessing for a member is an automated advantage over humans. See question 6.
6. **Auto-joining every event favours agent owners** over ordinary members. This is your call as the owner; the "only when inactive" rule limits it.
7. **Render free plan sleeps** after 15 minutes without web traffic. A sleeping bot posts no SOL Radar updates and sends no reminders. See Part 3.
8. **Private keys pasted by users.** The bot cannot delete a user's own DM message. It will refuse to store it, warn the user, and tell them to delete the message and move their funds.
9. **Wallet alerts cost API credits** (polling). Plan: check every 10 minutes, limit tracked wallets per user (3), stop when the daily budget is used.
10. **Channel names with emoji** (`📡・nft-radar`): fine on Discord, but "reuse if it exists" must match on the saved ID first and the exact name second, like today.
11. **Existing customer servers** will get the new channels the next time their admin runs `/setup` (auto setup only runs on join). Nothing is created silently on restart.
12. **Spec phases 12, 13, 14** (logs, database/security, cost) are not separate features. They are built into each phase as it is made, and each keeps a short review phase at the end.

---

## PART 2: UNFINISHED WORK (rule 11)

| Item | State | What is missing |
|---|---|---|
| Giveaways | Code finished. 26 offline tests pass. | You have not confirmed: running `migration_giveaway.sql`, uploading the files, and the real Discord test checklist. |
| Multi-server | Code finished. Offline tests pass. | A real test in your customer test server (join, setup, trial, free plan, data separation) is not confirmed. |
| "Unmentioned-question fix" | **I cannot find any code for this.** Today Vexo answers a member only when it is mentioned, replied to, called "vexo", or in the #ask channel (`src/replies.js`). | I need you to describe what the fix should do. |

Test state on 2026-11-14: syntax check clean; `npm test` all pass; `shop`, `boss-gate`, `rumble-order` pass. `test:qa` not run (it makes real AI calls).

**Recommendation: finish and live-test giveaways and multi-server BEFORE Phase 2.** Phase 2 edits `setup.js` and Phase 11 edits `giveaway.js` and Rumble; building on untested code makes any later bug hard to place. The unmentioned-question fix touches `replies.js`, the same file as Phase 5, so decide it before Phase 5 at the latest.

---

## PART 3: EXTERNAL SERVICES (rule 10)

| Service | Used for | Free tier (looked up 2026-11-14) | .env name |
|---|---|---|---|
| CoinGecko API (Demo key) | SOL price, 24h change / high / low, volume, hourly candles for RSI | Free: about 10,000 calls per month. Enough with caching (planned use: under 3,000). | `COINGECKO_API_KEY` |
| Helius | Wallet SOL balance, tokens, NFTs, recent transactions | Free: 1,000,000 credits per month, 2 requests per second on the NFT/enhanced API. | `HELIUS_API_KEY` |
| Magic Eden Solana API | NFT floor price, volume, collection stats, launchpad list | Public API free, about 120 requests per minute. A key is optional (request form). They ask for attribution. | `MAGICEDEN_API_KEY` (optional) |
| Tavily (web search API) | Project research for NFT Radar and "research this project", market news line | Free: 1,000 searches per month, no card. | `TAVILY_API_KEY` |
| OpenAI (already used) | Reasoning and writing only | Paid per use, as today. | (existing) |

- If a key is missing or a service fails, that one feature switches itself off with a clear log line; the bot still starts and everything else works. No invented numbers are ever posted.
- **Render free plan and schedulers:** the free web service sleeps after 15 minutes without incoming web requests, and has 750 free hours per month. While asleep: no SOL Radar posts, no reminders, no alerts, no giveaway endings. Options:
  1. Keep it awake with a free uptime pinger (for example UptimeRobot hitting `/health` every 5 minutes). This uses almost all 750 free hours, so only ONE free service can run in the workspace.
  2. Render paid Starter instance (about $7 per month): always on. **Recommended** once SOL Radar and reminders are live.
- After any downtime, schedulers post at most the newest missed SOL Radar slot (never a burst), and send late reminders once with "this was due at ...".

---

## PART 4: PROPOSED PLAN

### Free or premium (waiting for your decision)
| New feature | Proposal | Why |
|---|---|---|
| `solRadar` | premium | uses a short AI summary 4 to 5 times a day; a strong selling point |
| `nftRadar` | premium | uses web research + AI for every candidate |
| `web3Assistant` | premium (same level as `aiChat`) | every answer is an AI call plus API calls |
| `personalVexo` | NOT in the feature map = HΛVØCZ only at first | rule 3; can be added to the map later to sell it |

### How the new channels are set in HΛVØCZ (rule 2)
Nothing is created automatically. You create the three channels by hand and put their IDs in Render > Environment:
`NFT_RADAR_CHANNEL_ID`, `SOL_RADAR_CHANNEL_ID`, `VEXO_ASSISTANT_CHANNEL_ID`. An empty value = that feature is off in HΛVØCZ.
Other servers: auto setup creates `📡・nft-radar` and `📈・sol-radar` in the Vexo category (members read-only). `🤖・get-vexo-assistant` is created only where Personal Vexo is on.

### Phases
| # | Phase | What gets built | SQL | New .env names |
|---|---|---|---|---|
| 2 | Auto setup | the 2 radar channels in auto setup and `/setup`, shown in `/status` and `/help`; the 3 HΛVØCZ channel variables; the assistant channel only where the flag is on | none (settings JSON already exists) | `NFT_RADAR_CHANNEL_ID`, `SOL_RADAR_CHANNEL_ID`, `VEXO_ASSISTANT_CHANNEL_ID` |
| 3 | NFT Radar | discovery (Magic Eden launchpad + web research), AI summary, approval request with Approve / Reject in vexo-logs, public post only after approval, no duplicates, `/nftradar` (on/off, check now) | `migration_radar.sql` | `TAVILY_API_KEY`, `MAGICEDEN_API_KEY` |
| 4 | SOL Radar | market module with cache, RSI and support / resistance calculated in code, 5 posts a day at set times (per server times and timezone, default UTC), `/solradar` | same file as phase 3 or a small one | `COINGECKO_API_KEY`, `SOL_RADAR_TIMES` |
| 5 | Web3 assistant | question router + tools (price, floor, wallet, research) in front of normal chat; answers 4 to 5 lines | none | `HELIUS_API_KEY` |
| 6 | Personal Vexo | request button in the assistant channel, approval in vexo-logs, welcome DM, private chat with a per-user daily AI limit | `migration_personal.sql` | `PERSONAL_DAILY_AI_LIMIT` |
| 7 | Wallet and portfolio | save public address (validated), balance, tokens, NFTs, recent activity, extra tracked wallets; seed phrase / key warning | part of personal SQL | none |
| 8 | Alerts and reminders | reminders, recurring tasks, SOL price alerts, wallet activity alerts; per-user timezone | part of personal SQL | none |
| 9 | Memory and preferences | remember / show / forget, `/myvexo forget` and `/myvexo delete-everything` | part of personal SQL | none |
| 10 | HΛVØCZ knowledge in Personal Vexo | reuse the existing knowledge; optional "important update" notices that the boss sends on purpose | small | none |
| 11 | Agent participation | per-event permissions, "only when inactive", the BOT records the owner's entry in Rumble and giveaways; one identity per owner | small | none |
| 12 | Logs review | check every approval, error and automation is logged per server | none | none |
| 13 | Database and security review | keys, uniqueness, cross-user and cross-server leak tests | none | none |
| 14 | Cost review | measure real API and AI use, tune caches and limits | none | none |
| 15 | Final test and deploy | the 20-point checklist from the spec | none | none |

Notes on choices inside the plan:
- **Tool routing (phase 5):** the code decides which API to call from one small AI classification, then one AI call writes the answer from the real data. Maximum 2 AI calls per question, never a loop.
- **SOL Radar numbers:** price, change, high, low and volume come straight from the API. RSI (14 hours) and support / resistance are calculated by code from hourly candles and marked "approximate". If candles are missing, that line is left out. The AI only writes the two scenario sentences from those numbers.
- **Important HΛVØCZ updates (phase 10):** "verified" = the boss marks it. Plan: a control channel order like `important update: ...` (or a button) sends it to subscribed members. Vexo never decides alone that a normal message is important.
- **Phase 11:** uses the member's own Discord user id as the single identity, so the existing "one entry per user" protections already block duplicates in both directions. A new `agent_participation` table records who joined how (human or agent) for the audit log.

---

## PART 5: QUESTIONS WAITING FOR YOUR ANSWER

1. **Finish first?** Do you agree to finish and live-test giveaways and multi-server before Phase 2? (Recommended: yes.)
2. **Unmentioned-question fix:** what should it do exactly? (I found no code for it.)
3. **Free or premium:** do you accept the table in Part 4 (SOL Radar, NFT Radar, Web3 assistant = premium; Personal Vexo = HΛVØCZ only)?
4. **Where does Personal Vexo chat happen?** (a) In DMs with the bot (recommended; needs one extra non-privileged Discord intent) or (b) in a private thread inside the server.
5. **HΛVØCZ approvals:** HΛVØCZ has no vexo-logs channel today. Should approval requests go to (a) a new channel you create, with a new `LOGS_CHANNEL_ID` variable (recommended), (b) your redeem logs channel, or (c) the control channel?
6. **Guess Game and agents:** (a) leave the Guess Game out of agent participation (recommended, it is unfair to humans), or (b) allow one random guess per game for the owner?
7. **Phase order:** may I build SOL Radar (phase 4) before NFT Radar (phase 3)? Its data is reliable and it is quicker to test. (Recommended: yes.)
8. **Web research service:** is Tavily fine (free 1,000 searches a month), or do you already have another one?
9. **Render:** will you move to an always-on plan or use an uptime pinger before SOL Radar goes live?
10. **Artwork quality:** OK to leave image analysis out of NFT Radar version 1?
