# Vexo upgrade: progress (single source of truth)

Last updated: 2026-11-17. The full instructions are in `docs/VEXO_UPGRADE_SPEC.md`. The audit and plan are in `docs/VEXO_UPGRADE_PLAN.md`.
On "resume": read the spec, read this file, run the syntax check and `npm test`, report, wait for OK.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 0 | Save spec + progress files | DONE |
| 1 | Codebase audit and plan (no code) | DONE (owner wrote "ok" on 2026-11-14) |
| 1b | Live test of giveaways + multi-server by the owner | POSTPONED by the owner (will upload and test later) |
| 2 | Automatic multi-server setup (new channels) | WAITING FOR MY TEST (built; owner moved on without a live test) |
| 3 | NFT Radar | WAITING FOR MY TEST (built 2026-11-14, offline tests pass) |
| 4 | SOL Radar | WAITING FOR MY TEST |
| 5 | Full Web3 AI assistant | NOT STARTED |
| 6 | Personal Vexo AI agent (activation + chat) | NOT STARTED |
| 7 | Personal wallet and portfolio | NOT STARTED |
| 8 | Personal alerts and reminders | NOT STARTED |
| 9 | Personal memory and preferences | NOT STARTED |
| 10 | HΛVØCZ knowledge in Personal Vexo | NOT STARTED |
| 11 | Personal autonomous participation | NOT STARTED |
| 12 | Vexo Logs and admin permissions review | NOT STARTED |
| 13 | Database and security review | NOT STARTED |
| 14 | Cost optimization review | NOT STARTED |
| 15 | Final testing and deployment | NOT STARTED |

## Phase 3 (NFT Radar) — IN PROGRESS. Owner wrote "ok" to the plan on 2026-11-14 and gave a Tavily key in chat (NOT saved in any file; the owner puts it in `.env` and Render as `TAVILY_API_KEY`).

## Phase 3 log

- 3.1 DONE: `backups/before-phase-3/` (83 files). Note: `supabase/.env` exists in the project; its copy was removed from this backup. 2026-11-14: on the owner's instruction the `supabase/.env` copies in before-phase-1, 2 and 4 were deleted too (the real `supabase/.env` untouched); no .env file is left in `backups/`.

## Standing rule (owner, 2026-11-14): backups never contain ANY .env file

- When making `backups/before-phase-N/`, copy `src/` and `supabase/` WITHOUT any file named `.env` or `.env.*` (e.g. `supabase/.env`), then check `backups/` has no .env file.
- `.gitignore` covers `backups/` and every `.env` / `.env.*` file in every folder (except `.env.example`).
- 3.2 DONE: `supabase/migration_radar.sql` + tables `nft_radar_projects`, `nft_radar_reviews`, `nft_radar_runs` (create if not exists; SOL Radar table untouched).
- 3.3 DONE: `src/web3/research.js` (Tavily, cache 6h, daily stop 30 searches) + `config.nftRadar` in `src/config.js`. Live check with the owner's key (key passed only to that one test run, never saved): works; 3 searches used. Discovery results are noisy (few real upcoming Solana mints) -> admin `/nftradar add` stays the main source.
- 3.4 + 3.5 DONE: `src/nftRadar.js` (complete file: Magic Eden + web discovery, research + code fact check, approval embed with Approve / Reject `nftr:approve:<id>` / `nftr:reject:<id>`, public post, timer every 5 min, `/nftradar scan` once per 6h for all servers, admin add max 5 per server per day). Not yet wired into the bot.
- 3.6 DONE: `src/commands/nftradar.js`.
- 3.7 DONE: `src/config.js` (`nftRadar: 'premium'`), `src/plans.js` (command, `nftr:` buttons, name), `src/events/interactionCreate.js` (button route), `src/index.js` (start / stop timer), `src/commands/status.js`, `src/commands/help.js`, `.env.example` (`TAVILY_API_KEY`, `NFT_RADAR_TIMES`).
- 3.8 DONE: `tests/nftradar.test.js` (19 tests) + `package.json` (`npm test`, `npm run test:nftradar`); `tests/multiserver.test.js` feature list line (+ `nftRadar: false`).
- 3.9 DONE (2026-11-14): syntax check clean; `npm test` all pass (prompt-snapshot, multiserver 26, scam 31, giveaway 26, setup-channels 15, solradar 25, nftradar 19, boss / rumble); `shop` 15, `boss-gate` 31, `rumble-order` 24 pass. Slash command definition builds (longest description 77 chars).
- 3.10 DONE: `README.md` section, report given. Phase 3 = WAITING FOR MY TEST. STOPPED.
- 3.11 (owner report 2026-11-14): "/nft shows no command in the customer test server; /status shows NFT Radar ON". Finding: `/nftradar` exists and is registered GLOBALLY by the bot at every start (`src/deploy-commands.js`, 25 global + 1 home-only `/admin`). Most likely `src/commands/nftradar.js` was not uploaded (the new `/status` line was). Owner asked for: run, preview, status (last run, projects, pending, Tavily credits this month), pending; admin only; all servers; /help. DONE: `src/commands/nftradar.js` now `status | pending | preview | run | add | on | off` (`scan` renamed to `run`; the bot owner may `run` any time, others once per 6h shared), `src/nftRadar.js` (+ pendingList, stats, previewProject, EXAMPLE, owner option on scanNow), `src/web3/research.js` (+ `usage()` from Tavily `GET /usage`, free; searches-since-start counter), `src/commands/help.js` line, `tests/nftradar.test.js` (22 pass). `npm test` all pass. Nothing else changed.
- 3.12 (owner report 2026-11-14): startup said "slash commands NOT registered": the home-guild registration failed with Missing Access (the owner's test bot is not in GUILD_ID), and because both steps were one function the whole registration counted as failed. FIXED: `src/deploy-commands.js` now does two independent steps (global, then home-only `/admin`); bot not in the home server / Missing Access / Unknown Guild = one line "home guild not reachable, skipped /admin commands"; one log line per step with counts (`logResult`). `src/index.js` passes the client and prints those lines. New `tests/deploy-commands.test.js` (7 pass, added to `npm test` + `npm run test:deploy`). /help already had both radar lines (checked). Global list = 25 commands incl. nftradar, solradar, giveaway, setup, status, help, automod; home-only = admin.

### Phase 3 result (for the owner's test)

- Files created: `src/nftRadar.js`, `src/web3/research.js`, `src/commands/nftradar.js`, `tests/nftradar.test.js`
- Files modified: `supabase/migration_radar.sql`, `src/config.js`, `src/plans.js`, `src/events/interactionCreate.js`, `src/index.js`, `src/commands/status.js`, `src/commands/help.js`, `.env.example`, `package.json`, `README.md`, `tests/multiserver.test.js`
- SQL to run: `supabase/migration_radar.sql` again (adds 3 NFT tables; safe to re-run, SOL Radar table untouched).
- New .env: `TAVILY_API_KEY` (required; owner has a key and adds it to `.env` + Render), `NFT_RADAR_TIMES` (optional, default 09:00,21:00 UTC).
- Commands: `npm run deploy` is needed (new `/nftradar` command), then restart.
- Not tested for real: Discord buttons in a real server, the real AI research answer quality. Tavily itself was checked live (works).
- Exact next action for Claude: WAIT. Fix only what the owner reports. When the owner says NFT Radar works, mark phase 3 DONE. Next planned phase: 5 (Full Web3 AI assistant), only after the owner's written OK.

## Fix (2026-11-17): unprompted Q&A + "about Vexo" — BUILT, WAITING FOR MY TEST (build "unprompted-qa-fix-v1")

- Owner: Vexo used to answer project questions in normal chat without a mention; now only when mentioned (HΛVØCZ and customer servers). Also: answer questions about Vexo itself (features, updates, roadmap, trial / premium, setup), mention or not. This answers Q2 ("unmentioned-question fix").
- Root cause (investigation): there was never a "looks like a question" check in normal chat. Every version (all backups) answers an un-addressed member ONLY in the Q&A channel: `src/replies.js:238` `if (isAsk || addr.any)`, `isAsk` = message in `settings.channels.ask`. HΛVØCZ got unprompted answers only because ASK_CHANNEL_ID was its chat channel (#open-floor, see the comment in replies.js bossMessage). Since the home /setup work (`src/guilds.js:92`, `{ ...homeEnvChannels(), ...homeChosen(row) }`) a /setup "Ask channel" choice overrides ASK_CHANNEL_ID, so choosing another channel there (or ASK_CHANNEL_ID missing on Render) silently ends unprompted answers in the chat channel. Customer servers: `otherSettings().channels.ask` is '' unless chosen in /setup and auto setup never creates one -> mention only, always. Not the cause: plans.hasFeature (home always true), Message Content intent, ratelimit keys (per guild:user, fine), knowledge lookup (per guild, home falls back to knowledge.md). Not checked: the live DB / Render env (not allowed).
- Fix: NEW `src/unprompted.js` (cheap checks: Knowledge Q&A plan, allowed chat channel, not talking to someone else, question shape + project / Vexo topic, 15 s per-channel cooldown) -> one AI call with silentIfCasual (casual = silence) and new `silentIfUnknown` (not in knowledge = silence, still recorded for the boss). NEW `src/aboutVexo.js` (global ABOUT VEXO block from config.features + PLANNED list from this file's phases 5-15; `isAboutVexo`). `src/ai.js`: options `aboutVexo`, `silentIfUnknown` (off = prompt unchanged; snapshot 12/12 identical). `src/replies.js`: step b2 (unprompted) before offline chat; aboutVexo flag on every conversation; ⏳ on creator-question limit only in #ask. `src/build.js` BUILD "unprompted-qa-fix-v1".
- Never answers unprompted in: control, logs (and any channel named *log*), shop, purchase logs, receipts, rumble, giveaways, SOL / NFT Radar, assistant, X posts, welcome, rules, tickets, EXCLUDED_CHANNEL_IDS; only CHAT_CHANNEL_IDS when set (HΛVØCZ). Bots never. Boss gate unchanged. Free-plan servers: silent, zero AI calls.
- Tests: NEW `tests/unprompted-qa.test.js` (21 pass) added to `npm test` + `npm run test:unprompted`; `tests/home-setup.test.js` build marker. `npm test` all pass; shop, boss-gate, rumble-order, rumble-guild pass; syntax clean.
- deploy-pack/ = this fix only (old rumble-guild-fix-v1 pack moved to backups/deploy-pack-rumble-guild-fix-v1). SQL: none. .env: none.

## Extra request 4 (2026-11-15): one /setup for every server — BUILT, WAITING FOR MY TEST (not deployed; build "setup-unified-v1")

- Owner: HΛVØCZ still shows the old refusal. Proof: that text exists only in backups/before-home-setup/src/commands/setup.js:62 (old `if (guilds.isHome(interaction)) return interaction.reply(...)`); the current code has no such branch -> the live bot runs an old upload.
- New rule: the SAME /setup options in every server; only allowed differences: .env fallback in HΛVØCZ and the "Create missing channels" button there (no automatic creation). BUILD = "setup-unified-v1" (startup, first line of /setup, /status footer). deploy-pack/ with files new/changed since backups/before-home-setup-2/.
- Plan: U.1 one channel list for all servers (+ welcome and ask for customer servers: otherSettings + per-server welcome in events/guildMemberAdd.js); U.2 boss + ticket text also in HΛVØCZ (/setup first, then BOSS_USER_ID / old wording; bossCover + setup.js use settings boss); U.3 build marker; U.4 /status welcome + ask lines everywhere; U.5 tests; U.6 deploy-pack.
- U.1 DONE: src/guilds.js (customer servers: welcome + ask from /setup; HΛVØCZ: assistant in HOME_CHANNEL_KEYS); src/events/guildMemberAdd.js rewritten (welcomes per server, own bulk counter per server, no welcome channel = no welcome).
- U.2 DONE: src/commands/setup.js rewritten: ONE channel list + role + sources + boss + ticket for every server; HΛVØCZ only adds .env fallback ("choose none") and the Create button; build line first. src/guilds.js: HΛVØCZ boss = guilds.boss_user_id (/setup) else BOSS_USER_ID; ticket text = chosen text else the usual HΛVØCZ ticket button. src/bossCover.js + src/setup.js read the boss from settings.
- U.3 DONE: src/build.js BUILD = "setup-unified-v1" (startup "Logged in as ... build:", first line of every /setup reply, /status footer). src/commands/status.js: Welcome, Ask and Get Vexo Assistant lines in every server.
- U.4 DONE: tests/home-setup.test.js (18 pass: same menu in HΛVØCZ and a customer server, build line first, HΛVØCZ boss / ticket from /setup with fallback, welcome + ask in a customer server). Syntax 102 files OK; `npm test` all pass; shop 15, boss-gate 31, rumble-order 24. Search for the old refusal text (excl. backups, node_modules, .env): 0 matches (only in backups/before-home-setup/src/commands/setup.js:62 and :82).
- U.5 DONE: .gitignore + `deploy-pack/`. deploy-pack/ = 28 files new/changed since backups/before-home-setup-2 (src 20, tests 4, .env.example, .gitignore, README.md, docs/VEXO_UPGRADE_PROGRESS.md). package.json / package-lock.json unchanged. Nothing to delete on GitHub. WARNING: round-1 files (before that backup, never deployed) are NOT in the pack: src/ai.js, learn.js, automod.js, offlineChat.js, commands/knowledge.js, commands/nftradar.js, commands/solradar.js, tasks/scheduler.js, package.json.
- Other HΛVØCZ differences kept on purpose (none blocks a /setup channel): no automatic channels (setup.js), .env fallback (guilds.js), plan "home" = every feature, no AI limit (plans.js), scam protection off by default (scam.js), knowledge.md + separate source sheet (ai.js, learn.js), /knowledge refresh / clear off, /admin only there, personality lines. Fixed: welcomes were home-only (events/guildMemberAdd.js) -> per server.
- RESULT: BUILT, WAITING FOR MY TEST. Not deployed. SQL: none. Render: LOGS_CHANNEL_ID (from request 3).

## Extra request 3 (2026-11-15): finish + prove + build marker — BUILT, WAITING FOR MY TEST (not deployed)

- Owner: only marketplace content may use REDEEM_LOGS_CHANNEL_ID; add BUILD = "home-setup-v2" (startup log + bottom of /status); prove with searches; upload list vs backups/before-home-setup-2; no deploy.
- Findings: round 2 code was complete (R.1-R.5). Still wrong: (a) HΛVØCZ feature logs used REDEEM_LOGS_CHANNEL_ID as .env fallback -> replace by a NEW variable LOGS_CHANNEL_ID (decision Q5); (b) /setup panel showed the raw .env logs id (could show the shop) -> use getFeatureChannel; (c) README line + nftRadar.js comment still said "else REDEEM_LOGS / control".
- Steps: B.1 LOGS_CHANNEL_ID (config.js, guilds.js, .env.example, setup panel, status label) · B.2 build marker (src/build.js, index.js, commands/status.js) · B.3 texts (README, nftRadar.js comment) · B.4 tests · B.5 upload list.
- B.1 DONE: `LOGS_CHANNEL_ID` in src/config.js (config.channels.logs), src/guilds.js (home logs .env fallback = LOGS_CHANNEL_ID; REDEEM_LOGS no longer used for feature logs), .env.example, src/commands/setup.js (panel uses getFeatureChannel for every line + logs hint), src/commands/status.js label, src/nftRadar.js comment.
- B.2 DONE: new src/build.js (BUILD = "home-setup-v2"); src/index.js prints "Logged in as <tag> build: home-setup-v2"; src/commands/status.js footer "build: home-setup-v2".
- B.3 DONE: README (logs rule, button, build marker), nftRadar.js comment.
- B.4 DONE: tests giveaway / solradar / nftradar get LOGS_CHANNEL_ID in their fake env; home-setup: separate purchase-log channel, tests for "never REDEEM_LOGS / control / shop", "purchase records are the only REDEEM_LOGS user", build marker in /status (16 pass). marketplace.js: sendLog exposed on `_test` only. Syntax check 102 files OK; `npm test` all pass; shop 15, boss-gate 31, rumble-order 24.
- Proof searches (excl. backups, node_modules, .env): the old refusal text = 0 matches (one history line in this file reworded). REDEEM_LOGS_CHANNEL_ID in code only in config.js (purchase records) + comments / hints; `redeemLogs` is sent to only by marketplace.js (purchase log + ticket transcript). logsChannelId = getFeatureChannel(x, 'logs') everywhere.
- B.5 DONE: upload list. vs backups/before-home-setup-2: NEW src/build.js, src/notices.js; CHANGED src/ bossCover, config, giveaway, guilds, index, marketplace, nftRadar, scam, setup, solRadar, xDrop; src/commands/ guess, setup, status; src/events/guildMemberAdd; src/jobs/daily; src/tasks/control, rumbleRoyale; tests/ giveaway, home-setup, nftradar, solradar; root .env.example, README.md; docs/VEXO_UPGRADE_PROGRESS.md. package.json / package-lock.json NOT changed since that backup. Nothing to delete on GitHub. WARNING: round 1 (before that backup) was never deployed either: also needed src/ai.js, learn.js, automod.js, offlineChat.js, commands/knowledge.js, commands/nftradar.js, commands/solradar.js, tasks/scheduler.js and package.json -> advice: upload the whole src/ and tests/ folders.
- RESULT: BUILT, WAITING FOR MY TEST. Not deployed. SQL: none. New Render variable: LOGS_CHANNEL_ID (HΛVØCZ private logs channel, NOT the shop). Live: until LOGS_CHANNEL_ID is set or a logs channel is chosen in /setup, HΛVØCZ feature logs are not sent (purchase records unchanged).

## Extra request 2 (2026-11-14): home channels, round 2 — BUILT (R.1-R.5 done), WAITING FOR MY TEST

- Owner still sees the old "home server, no setup" refusal + "SOL_RADAR_CHANNEL_ID is empty" + a "SOL Radar settings" log in the shop: these texts exist only in the OLD code (backups/before-home-setup); the new files were not deployed. Root cause of the shop log: old code sent HΛVØCZ feature logs to `logs || REDEEM_LOGS_CHANNEL_ID`, and home `logs` was always empty, so REDEEM_LOGS_CHANNEL_ID (which must point at the shop channel) got them.
- New rules from the owner: one `getFeatureChannel(guildId, feature)`; a feature with no channel never falls back to another channel (logs: no control fallback any more), skips, /status "not set", boss told once in vexo-logs; Create button makes only sol-radar, nft-radar, giveaways and replies with links; tests: no-channel posts nowhere, nothing but shop content reaches the shop, home /setup saves + reads, button no duplicate.
- R.1 DONE: backup `backups/before-home-setup-2/` (no .env).
- R.2 DONE: `src/guilds.js` `getFeatureChannel(x, feature)` (/setup, else .env for HΛVØCZ, else ''; never the shop for non-shop features); `logsChannelId` = logs only (no control fallback); HΛVØCZ logs .env fallback = REDEEM_LOGS_CHANNEL_ID unless it is the shop. Features switched to it: rumbleRoyale.js, xDrop.js, jobs/daily.js, commands/guess.js, tasks/control.js, giveaway.js, solRadar.js, nftRadar.js, events/guildMemberAdd.js, bossCover.js (ticket / control). scam.js: logs only (control fallback removed).
- R.3 DONE: new `src/notices.js` (missing channel told once in logs, remembered in settings.channelNotices); called from solRadar.js tick and nftRadar.js tick.
- R.4 DONE: `src/setup.js` HOME_CREATE_KEYS = solRadar, nftRadar, giveaway (+ ids for links, existing channels never changed); `src/commands/setup.js` reply with links + texts; `src/commands/status.js` every line via getFeatureChannel ("not set" = feature posts nothing), logs "from .env (REDEEM_LOGS_CHANNEL_ID)".
- R.5 DONE: /setup refuses the shop channel for every non-shop feature; giveaway start refuses the shop channel. tests/home-setup.test.js updated + new tests (15 pass); tests/solradar.test.js: one test updated (no channel -> one note in logs, not zero messages). `npm test` all pass; shop 15, boss-gate 31, rumble-order 24. No direct env channel reads outside config.js / guilds.js.
- RESULT: BUILT, WAITING FOR MY TEST. Not deployed. SQL: none. New Render variables: none. Files since `backups/before-home-setup/`: 25 src files (incl. new src/notices.js) + tests/home-setup.test.js (new) + tests/solradar.test.js + package.json + README.md.

## Extra request (2026-11-14): /setup in the home server (HΛVØCZ) — BUILT, WAITING FOR MY TEST (owner wrote "ok" = all 3 recommendations: separate home source sheet; logs order logs > REDEEM_LOGS > control, never marketplace; purchase logs stay on REDEEM_LOGS)

- H.1 DONE: backup `backups/before-home-setup/` (src, supabase, tests; no .env).
- H.2 DONE: `src/guilds.js` (HOME_CHANNEL_KEYS, homeEnvChannels, homeChosen, homeChannelSources, pingRoleId + knowledgeSources from /setup, `logsChannelId()` helper).
- H.3 DONE: log routing through `guilds.logsChannelId()` in solRadar.js, nftRadar.js, giveaway.js, automod.js, scam.js, commands/solradar.js, commands/nftradar.js; "X_CHANNEL_ID is empty" texts now also say "/setup" (solRadar, nftRadar, giveaway, guess).
- H.4 DONE: bossCover.js (control), offlineChat.js (excluded channels, + logs), events/guildMemberAdd.js (welcome), index.js (marketplace sync check), tasks/scheduler.js (warnings) now read `guilds.settings(home)`.
- H.5 DONE: `src/setup.js` (HOME_CREATE_KEYS, `missingHome()`, `createMissingHome()` button-only, reuse by name, saves as /setup choice; onChannelDelete also clears a deleted home /setup choice -> falls back to .env).
- H.6 DONE: `src/commands/setup.js` (home panel with (/setup)/(.env) per channel, welcome + ask, "choose none" = back to .env, Create missing channels button, boss / ticket text hidden in home, logs != marketplace check, boss or Manage Server).
- H.7 DONE: `src/learn.js` (home absorbs into `settings.sourceKnowledge`, never guilds.knowledge; home allowed in readHistory / onMessage), `src/ai.js` (home knowledge = main + separate sheet when present), `src/commands/knowledge.js` (view shows home sources; refresh / clear still off in home).
- H.8 DONE: `src/commands/status.js` (home: "from /setup" / "from .env" per channel, welcome + ask lines, logs via logsChannelId, field split at 1,024 chars).
- H.9 DONE: all existing tests passed WITHOUT changes; new `tests/home-setup.test.js` (13 pass), added to `npm test` + `npm run test:home`. `npm test` all pass; shop 15, boss-gate 31, rumble-order 24. README section added.
- RESULT: WAITING FOR MY TEST in HΛVØCZ. SQL: none. New .env: none. Note: Discord shows /setup only to members with Manage Server (command default); a boss without Manage Server needs it allowed in Server Settings > Integrations.

- Owner wants: /setup works in HΛVØCZ (channel pickers for control, logs, marketplace, rumble, number guess, x-posts, giveaways, nft-radar, sol-radar, welcome, ask, knowledge sources; game ping role), saved in the home guilds row; a "Create missing channels" button (only on press, never automatic, no duplicates); priority = /setup value first, then .env; /status shows the source of each channel; everything else about HΛVØCZ unchanged; feature logs to the logs channel, never the shop; /setup for boss or Manage Server.
- Findings: home channels come from `guilds.homeSettings()` (= .env). Home "logs" is empty, so feature logs fall back to REDEEM_LOGS_CHANNEL_ID (the purchase log). No code sends feature logs to the marketplace channel: if they appeared in the shop, REDEEM_LOGS_CHANNEL_ID probably points to the shop channel. A few files read .env channels directly (bossCover, offlineChat, guildMemberAdd welcome, index marketplace sync, scheduler warnings). HΛVØCZ knowledge = its guilds.knowledge (knowledge.md, 4,992 chars); learn.js would merge/cap that sheet (6,000) if home used source channels -> plan keeps source learning in a SEPARATE sheet (settings JSON) so the curated sheet is never rewritten.
- Plan: no SQL (settings JSON in the existing home guilds row). Files: guilds.js, commands/setup.js, setup.js (home create button), commands/status.js, learn.js + ai.js (separate home source sheet), bossCover.js, offlineChat.js, events/guildMemberAdd.js, index.js, tasks/scheduler.js (warnings), one-line log-channel helper in solRadar.js, nftRadar.js, giveaway.js, automod.js, scam.js, commands/solradar.js, commands/nftradar.js; wording of "X_CHANNEL_ID is empty" messages; new tests/home-setup.test.js; README.

## Phase 3 plan (NFT Radar) — accepted by the owner ("ok", 2026-11-14)

- Owner wrote "start building nft radar". Owner's own earlier rule: if nothing is saved, give the plan first (incl. the mint source and whether it is free) and wait for OK before coding. So: plan given, waiting.
- Resume check that day: syntax clean, `npm test` all pass. NFT Radar had nothing saved (only the Phase 2 channel).
- Live finding 2026-11-14: Magic Eden's public launchpad list (`api-mainnet.magiceden.dev/v2/launchpad/collections`, no key) answers, newest first, but its newest launch is 2026-02-20. It is NOT a working upcoming-mint feed right now. `MAGICEDEN_API_KEY` is not needed (works without a key) and is dropped from the plan.
- Tavily (official docs, checked 2026-11-14): free plan 1,000 credits a month, no card.
- Sources for candidates (all free): (A) admin adds a project: `/nftradar add <link or name>` (most reliable); (B) Tavily web search, twice a day, AI picks out project names + links; (C) Magic Eden launchpad list once a day (free, currently empty, costs nothing). No scraping of mint-calendar websites.
- Budget: discovery 2 runs/day x 3 searches + research about 3 searches per candidate, at most 5 new candidates a day => well under 1,000 a month. Research is done ONCE per project for all servers; approvals are per server.
- Flow: discover -> research (Tavily) -> one AI call per candidate (facts only from the sources; missing = "Not announced"; links checked with the scam link checker; past mints, no official link or low score are dropped) -> approval request with Approve / Reject in each premium server's vexo-logs (Manage Server or boss, at most 3 a day per server) -> on Approve: spec post format in that server's NFT Radar channel; on Reject: nothing posted. A project is never sent twice to the same server.
- Tables (added to `supabase/migration_radar.sql`): `nft_radar_projects` (one row per project, unique key), `nft_radar_reviews` (guild_id + project_id primary key, status, who decided, message ids).
- New .env: `TAVILY_API_KEY` (required; without it NFT Radar switches off with a log line, everything else works), `NFT_RADAR_TIMES` (optional).
- Planned sub-steps: 3.1 backup `backups/before-phase-3/` · 3.2 SQL · 3.3 `src/web3/research.js` (Tavily) · 3.4 `src/nftRadar.js` (discovery + research + AI) · 3.5 approval buttons + public post (in `src/nftRadar.js`) · 3.6 `src/commands/nftradar.js` · 3.7 small edits: `src/config.js`, `src/plans.js` (`nftRadar: 'premium'`), `src/index.js`, `src/commands/status.js`, `src/commands/help.js`, `.env.example` · 3.8 `tests/nftradar.test.js` + `package.json` · 3.9 run all tests · 3.10 README + report, WAITING FOR MY TEST, STOP.
- Exact next action for Claude: WAIT for the owner's OK on this plan. On OK: start at 3.1.

## STOPPED on 2026-11-14 by the owner's instruction. Do NOT start any phase until the owner says so.

- Result of the market data work: DONE. Live check on 2026-11-14 with no key: CoinGecko answered (price, high, low, change, volume, RSI from 169 hourly points), and with CoinGecko blocked on purpose the Binance backup answered with matching numbers. Syntax check clean; `npm test` all pass (solradar 24, setup-channels 15, giveaway 26, scam 31, multiserver 26, prompt-snapshot and the boss / rumble tests).
- Files changed for it: `src/web3/market.js`, `src/solRadar.js`, `.env.example`, `README.md`, `tests/solradar.test.js`. Before it (the channel fix): `src/setup.js`, `src/index.js`, `tests/setup-channels.test.js`.
- `COINGECKO_API_KEY` is now OPTIONAL. No new SQL. No new .env names.
- Not verified by Claude: a real scheduled post in real Discord and a real AI-written outlook (the owner tests with `/solradar preview` and `/solradar now`).
- 2026-11-14, owner asked again: use the easiest market-data API, test once, change nothing else, then STOP. Answer: already in place, no code changed. Chosen setup = CoinGecko without a key (nothing to obtain), Binance public data as automatic backup, optional `COINGECKO_API_KEY`. Tested once more: the real scheduler code with real CoinGecko data and a pretend channel posted exactly 1 update for a due time and did not repeat it a minute later.
- 2026-11-14, newest owner instruction: SOL Radar must use Binance's free public market data (`https://data-api.binance.vision/api/v3/ticker/price?symbol=SOLUSDT`, no key) as its source; change nothing else; no new env variables; then deploy to Render. Change being made (IN PROGRESS): in `src/web3/market.js` Binance becomes the FIRST source (price from `/ticker/price`, 24h high / low / change from `/ticker/24hr`, hourly history from `/klines`), CoinGecko becomes the backup and still supplies the market-wide volume line when it answers. `src/solRadar.js`: only the volume / footer source wording. `tests/solradar.test.js` updated. Claude cannot deploy to Render (no access; the owner uploads to GitHub).
  - RESULT: DONE and tested on 2026-11-14. Live check: the real scheduler code fetched from `data-api.binance.vision` (and CoinGecko for volume), posted exactly 1 update to a pretend channel, no repeat. Syntax clean; `npm test` all pass (solradar 25, setup-channels 15, giveaway 26, scam 31, multiserver 26, prompt-snapshot, boss / rumble); `shop` 15, `boss-gate` 31, `rumble-order` 24. No new env variable. Files: `src/web3/market.js`, `src/solRadar.js`, `tests/solradar.test.js`, `README.md`, `.env.example`.
  - NOT done: deployment to Render and a real post in Discord (owner's step). STOPPED again.
- Exact next action for Claude: WAIT. On "resume": follow the resume rule, report, and ask which phase the owner wants (next planned: NFT Radar, spec phase 3).

## Owner's instruction on 2026-11-14 — market data connection (details)

- Owner (summary of their message): SOL Radar now shows up in multiple servers. ONLY make the existing SOL Radar fully operational by connecting it to a reliable market-data API (CoinGecko or Binance, whichever fits). Do not add features or change anything else. Then STOP; the remaining work continues later.
- Cause found earlier: `COINGECKO_API_KEY` is empty, and the code switched SOL Radar off without a key.
- Decision (this REPLACES working rule 7 for SOL Radar only, because the owner asked for it to run now): SOL Radar no longer needs a key. `src/web3/market.js` uses CoinGecko (with the key when one is set, without a key otherwise) and falls back to Binance's public market data (SOL/USDT, no key) when CoinGecko does not answer. If BOTH fail, nothing is posted (still never invented numbers).
- Files being changed for this: `src/web3/market.js`, `src/solRadar.js` (source name in the footer, start without a key), `.env.example` (comment), `README.md`, `tests/solradar.test.js`. Nothing else.
- Also finished just before this: the one-time startup channel upgrade (see the next section) — its tests pass (setup-channels 15).

## Problem reported by the owner on 2026-11-14 (phase 4 test) — FIXED (startup channel upgrade), offline tests pass

- Owner's report: "SOL Radar shows in /help but does not work in my test server (multi-server mode)."
- What a read-only check of the owner's own setup showed (no key values were printed):
  1. `COINGECKO_API_KEY` is EMPTY in the local settings → SOL Radar switches itself off in EVERY server (by design, rule 7).
  2. The test server ("Teeest", trial, premium) has NO SOL Radar / NFT Radar channel saved. Reason: Phase 2 only created the new channels when a server is first joined or when its admin runs `/setup`; a server that already had Vexo got nothing on restart.
  3. Fine: `sol_radar_posts` table exists (SQL was run), the plan allows it, `giveaways` table exists and has rows.
- Fix (only this problem): `src/setup.js` gets a one-time "setup upgrade" at startup for servers that already have Vexo (never HΛVØCZ): it creates only the missing channels, once per setup version, and tells the admin in the control channel. Called from `src/index.js`. Tests added to `tests/setup-channels.test.js`.
- The key itself can only be added by the owner.

## Phase 4 (SOL Radar) — built, WAITING FOR MY TEST

- 2026-11-14: the owner wrote "use it start next phase" (after "i use uptime robot"). Claude's reading: written OK to start the next phase. Phase 2 was NOT live-tested by the owner; it stays "built, offline tests pass, live test later".
- Next phase by decision Q7 = SOL Radar (spec phase 4), built before NFT Radar (spec phase 3).
- Design (so a restart does not need the chat):
  - `src/web3/cache.js` small time-based cache · `src/web3/market.js` CoinGecko (Demo key, header `x-cg-demo-api-key`): `/coins/markets` for price / 24h change / high / low / volume, `/coins/solana/market_chart?days=7` for hourly points; RSI(14, hourly), support / resistance from recent highs and lows, volume trend, momentum, all calculated in code. Cache 5 min / 15 min, shared by all servers.
  - `src/solRadar.js`: one timer (every minute). Per server: `settings.solRadar = { enabled, times[], timezone }` (default times from `SOL_RADAR_TIMES`, timezone UTC). Posts only the newest due slot, only within 120 minutes of it (no bursts after sleep). Duplicate protection: table `sol_radar_posts` (primary key guild_id + slot), claimed before sending.
  - AI: at most ONE short call per 15 minutes for all servers together (two scenario sentences). Every $ number the AI writes must be one of the real levels, otherwise pre-written sentences are used. AI down = pre-written sentences. Market API down or key missing = no post at all.
  - Feature map: `solRadar: 'premium'`. Command `/solradar status | on | off | times | now | preview` (Manage Server or boss).
  - News line ("relevant market/news factors") is left out for now: it needs the web research module that comes with NFT Radar.
- Sub-steps: 4.1 backup `backups/before-phase-4/` · 4.2 `supabase/migration_radar.sql` · 4.3 `src/web3/cache.js` · 4.4 `src/web3/market.js` · 4.5 `src/solRadar.js` · 4.6 `src/commands/solradar.js` · 4.7 small edits: `src/config.js`, `src/plans.js`, `src/index.js`, `src/commands/status.js`, `src/commands/help.js`, `.env.example`, `tests/multiserver.test.js` (feature list line) · 4.8 `tests/solradar.test.js` + `package.json` · 4.9 run all tests · 4.10 README + report, WAITING FOR MY TEST, STOP.

## Phase 4 log

- 4.1 DONE: `backups/before-phase-4/` (79 files, no .env)
- 4.2 DONE: `supabase/migration_radar.sql` (table `sol_radar_posts`)
- 4.3 DONE: `src/web3/cache.js`
- 4.4 DONE: `src/web3/market.js` (needs `config.solRadar.apiKey`, added in 4.7)
- 4.5 DONE: `src/solRadar.js` (complete file) · `src/config.js` already has `solRadar` settings + `solRadar: 'premium'` in the feature map
- 4.6 DONE: `src/commands/solradar.js`
- 4.7 DONE: `src/plans.js`, `src/index.js`, `src/commands/status.js`, `src/commands/help.js`, `.env.example`, `tests/multiserver.test.js` (feature list line only)
- 4.8 DONE: `tests/solradar.test.js` (23 tests) + `package.json` (`npm test`, `npm run test:solradar`)
- 4.9 DONE (2026-11-14): syntax check clean; `npm test` all pass (incl. prompt-snapshot, multiserver 26, scam 31, giveaway 26, setup-channels 11, solradar 23); `shop` 15, `boss-gate` 31, `rumble-order` 24 pass. One live check without a key confirmed CoinGecko's answer has the fields and hourly points the code expects.
- 4.10 DONE: `README.md` section, report given. STOPPED.

### Phase 4 result (for the owner's test)

- Files created: `supabase/migration_radar.sql`, `src/web3/cache.js`, `src/web3/market.js`, `src/solRadar.js`, `src/commands/solradar.js`, `tests/solradar.test.js`
- Files modified: `src/config.js`, `src/plans.js`, `src/index.js`, `src/commands/status.js`, `src/commands/help.js`, `.env.example`, `package.json`, `README.md`, `tests/multiserver.test.js`
- SQL to run: `supabase/migration_radar.sql` (after `migration_giveaway.sql`). Until it is run, SOL Radar posts nothing (it logs why).
- New .env names: `COINGECKO_API_KEY` (required for the feature), `SOL_RADAR_TIMES`, `SOL_RADAR_TIMEZONE` (optional). HΛVØCZ also needs `SOL_RADAR_CHANNEL_ID` from Phase 2.
- Not tested for real: posting in real Discord, the real CoinGecko key, a real AI outlook.
- Left out on purpose: the news line (comes with the web research module in the NFT Radar phase).
- Exact next action for Claude: WAIT. Fix only what the owner reports. When the owner gives the OK: make `backups/before-phase-3/` and start NFT Radar (spec phase 3). It adds tables to `migration_radar.sql` and needs `TAVILY_API_KEY` (and optional `MAGICEDEN_API_KEY`).

## Earlier phase: 2 (automatic multi-server setup) — built, offline tests pass, NOT live-tested by the owner yet

- 2026-11-14: the owner wrote (their words): "i ll upload later on render you make it if any env variale need make it i,ll add real value to env file". Claude's reading: do NOT wait for the live test (step 1b is postponed, the owner uploads and tests later); start building; put every new variable in `.env.example` and the owner fills in the real values.
- Sub-steps: 2.1 backup `backups/before-phase-2/` · 2.2 `src/config.js` (3 channel variables) · 2.3 `src/guilds.js` (channel keys + personalVexo flag) · 2.4 `src/setup.js` (new channels) · 2.5 `src/commands/setup.js`, `status.js`, `help.js`, `admin.js` · 2.6 `.env.example` · 2.7 `tests/setup-channels.test.js` + `package.json` · 2.8 run all tests · 2.9 report, set WAITING FOR MY TEST, STOP.
- Now on: 2.1. Each finished sub-step is ticked in "Phase 2 log" below.

## Phase 2 log

- 2.1 DONE: `backups/before-phase-2/` (79 files, no .env)
- 2.2 DONE: `src/config.js` (channels.nftRadar / solRadar / assistant from the 3 new variables)
- 2.3 DONE: `src/guilds.js` (3 channel keys for other servers; `personalVexo` flag: true in HΛVØCZ, per-server setting elsewhere)
- 2.4 DONE: `src/setup.js` (KEYS nftRadar, solRadar, assistant; `wantedKeys`; reuse by name anywhere; each new channel saved right after it is made)
- 2.5 DONE: `src/commands/setup.js`, `status.js`, `help.js`, `admin.js` (`/admin personalvexo guild_id on`)
- 2.6 DONE: `.env.example`
- 2.7 DONE: `tests/setup-channels.test.js` (11 tests) + `package.json` (`npm test` and `npm run test:setup`)
- 2.8 DONE (2026-11-14): syntax check clean; `npm test` all pass (incl. prompt-snapshot, multiserver 26, scam 31, giveaway 26, setup-channels 11); `shop` 15, `boss-gate` 31, `rumble-order` 24 pass
- 2.9 DONE: `README.md` section added, report given to the owner. STOPPED.

### Phase 2 result (for the owner's test)

- Files created: `tests/setup-channels.test.js`
- Files modified: `src/config.js`, `src/guilds.js`, `src/setup.js`, `src/commands/setup.js`, `src/commands/status.js`, `src/commands/help.js`, `src/commands/admin.js`, `.env.example`, `package.json`, `README.md`
- SQL: none
- New .env names: `NFT_RADAR_CHANNEL_ID`, `SOL_RADAR_CHANNEL_ID`, `VEXO_ASSISTANT_CHANNEL_ID` (all three HΛVØCZ only, optional for now)
- Not built on purpose: no radar posts, no Personal Vexo yet (later phases). The feature map was not changed in Phase 2.
- Exact next action for Claude: WAIT. Fix only what the owner reports. When the owner says Phase 2 works: mark it DONE, make `backups/before-phase-3/`, and start SOL Radar (spec phase 4, built before NFT Radar by decision Q7).

## Earlier step 1b (owner's live test of giveaways + multi-server) — POSTPONED by the owner

- Phase 1 is DONE. The owner answered the Phase 1 report with one word, "ok", and no separate answers. I (Claude) read that as: every recommended option is accepted (see "Decisions made"). The owner can still change any of them.
- Because recommendation 1 was "finish and live-test giveaways and multi-server before Phase 2", Phase 2 has NOT started. No code was written after Phase 1.
- What the owner does now: (1) run `supabase/migration_giveaway.sql` in Supabase, (2) upload the giveaway files to GitHub, (3) run the giveaway checklist and the multi-server checklist in the customer test server, (4) report "works" or the problems.
- Exact next action for Claude: WAIT. If the owner reports a problem, fix only that problem. When the owner says both work: mark 1b DONE, make `backups/before-phase-2/`, start Phase 2 (and nothing more).
- Still needed from the owner: an answer to question 2 (before Phase 5) and question 9 (before SOL Radar goes live).

## Test state (2026-11-14)

- Syntax check: all files in `src`, `tests`, `scripts` pass.
- `npm test`: all pass (boss, bossnoquestion, boss-offline, rumble, prompt-snapshot, multiserver 26, scam 31, giveaway 26).
- Extra offline tests: `shop` 15 pass, `boss-gate` 31 pass, `rumble-order` 24 pass. `test:qa` not run (real AI calls).

## Files created so far

- `docs/VEXO_UPGRADE_SPEC.md` (finished)
- `docs/VEXO_UPGRADE_PROGRESS.md` (this file)
- `docs/VEXO_UPGRADE_PLAN.md` (finished)
- `backups/before-phase-1/` (copy of `src/` and `supabase/`)

## Files modified so far

- none (Phase 1 wrote no feature code)

## SQL files

Existing, in the order to run them:

1. `supabase/schema.sql` (new installs only)
2. `supabase/migration_multiserver.sql`
3. `supabase/migration_scam_xdrop.sql`
4. `supabase/migration_giveaway.sql` — owner has NOT yet confirmed running this one
5. `supabase/migration_radar.sql` (phase 4: table `sol_radar_posts`; phase 3 added `nft_radar_projects`, `nft_radar_reviews`, `nft_radar_runs`). The SOL table exists in the owner's database (checked 2026-11-14). The owner must RUN IT AGAIN for the NFT tables — not yet confirmed.

Still planned: `migration_personal.sql` (phases 6 to 11).

## New .env variable names (names only)

Already in `.env.example` (the owner adds the real values in `.env` and in Render > Environment):

- Giveaways: `GIVEAWAY_CHANNEL_ID`
- Phase 2: `NFT_RADAR_CHANNEL_ID`, `SOL_RADAR_CHANNEL_ID`, `VEXO_ASSISTANT_CHANNEL_ID` (HΛVØCZ channels, made by hand)
- Phase 4: `COINGECKO_API_KEY` (OPTIONAL since 2026-11-14: SOL Radar runs without it), `SOL_RADAR_TIMES`, `SOL_RADAR_TIMEZONE`

- Phase 3: `TAVILY_API_KEY` (required for NFT Radar), `NFT_RADAR_TIMES` (optional). `MAGICEDEN_API_KEY` dropped (not needed).

Planned, not added yet:

- Phase 5: `HELIUS_API_KEY`
- Phase 6: `PERSONAL_DAILY_AI_LIMIT`
- (added 2026-11-15) `LOGS_CHANNEL_ID`: HΛVØCZ private logs channel for feature logs (never the shop); /setup can choose it instead.

## Decisions made

- (working rules) NFT Radar and SOL Radar: every server. Personal Vexo: per-guild flag, ON only for HΛVØCZ at first; the get-vexo-assistant channel is created only where the flag is on.
- (working rules) No channels are auto-created in HΛVØCZ; its new channels come from .env variables.
- (working rules) Agent participation = the bot records an entry for the owner in Vexo's own event system. Never a user account or token.
- (earlier, giveaways) Winner announcements always ping @everyone in every server; the ping role is only for the giveaway start.

Accepted on 2026-11-14 by the owner's "ok" to the Phase 1 report (Claude's reading: all recommended options; not answered one by one):

- Q1: finish and live-test giveaways + multi-server BEFORE Phase 2.
- Q3: `solRadar`, `nftRadar`, `web3Assistant` = premium. `personalVexo` = not in the feature map (HΛVØCZ only at first).
- Q4: Personal Vexo chat happens in DMs with the bot (adds the non-privileged Direct Messages intent).
- Q5: HΛVØCZ approval requests go to a new channel the owner creates, set with a new `LOGS_CHANNEL_ID` variable.
- Q6: the Guess Game is left out of agent participation (Rumble and giveaways only).
- Q7: build order: SOL Radar (spec phase 4) BEFORE NFT Radar (spec phase 3).
- Q8: web research service = Tavily.
- Q10: no image ("artwork quality") analysis in NFT Radar version 1.

## Questions waiting for the owner's answer

- Q2: ANSWERED 2026-11-17 and built (see "Fix (2026-11-17): unprompted Q&A").
- (Q9 is answered, see below.)

Answered on 2026-11-14 in the owner's words: "i use uptime robot" → Q9: Render stays on the free plan, kept awake by UptimeRobot pinging `/health` every 5 minutes. Consequences to remember: this uses almost all 750 free hours a month (only ONE free service in the Render workspace); if a ping gap lets the bot sleep, schedulers pause, so SOL Radar must catch up with at most the newest missed slot and reminders must be sent late, once.

## Known problems

- Giveaways and multi-server are finished in code and pass offline tests, but are not yet confirmed in real Discord.
- The "unmentioned-question fix": built 2026-11-17 (unprompted-qa-fix-v1), waiting for the owner's live test.
- Direct messages to the bot do not work today (needed for Personal Vexo, see question 4).
- No reliable free feed of upcoming Solana mints exists; NFT Radar candidates will be uneven and rely on admin approval.
- Render's free plan sleeps after 15 minutes without web traffic, which stops all schedulers.
