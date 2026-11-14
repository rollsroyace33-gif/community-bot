You are going to upgrade my Vexo Discord bot using the specification at the bottom of this message. The working rules come first and override anything in the spec that conflicts with them. I am not a programmer, so explain everything in simple English.

=== STEP 0: SAVE EVERYTHING TO FILES FIRST (before any audit or code) ===
1. Save this whole message, word for word, to docs/VEXO_UPGRADE_SPEC.md (working rules first, then the specification).
2. Create docs/VEXO_UPGRADE_PROGRESS.md. This is the single source of truth for progress. It must always contain:
   - a table of all phases with status: NOT STARTED / IN PROGRESS / WAITING FOR MY TEST / DONE
   - for the current phase: the exact sub-step you are on and the exact next action
   - files created and files modified so far
   - SQL files: which exist, the order to run them, and whether I confirmed running them
   - new .env variable names needed (names only, never values)
   - decisions we made and questions still waiting for my answer
   - known problems
3. Tell me both files exist, then start Phase 1.

=== SURVIVING LIMITS AND RESTARTS ===
My usage limit can run out at any moment, and I may close my laptop. Conversation memory will be lost. So:
- Work in small sub-steps. After EVERY sub-step, update docs/VEXO_UPGRADE_PROGRESS.md before doing anything else.
- Before starting a file, write in the progress file which file you are about to write. After finishing it, mark it finished. Never leave a file half-written; if a file is large, write it in complete, working pieces.
- Never rely on remembering earlier messages. Anything important (my answers, decisions, option names) goes into the progress file immediately.
- When I say "resume", read docs/VEXO_UPGRADE_SPEC.md and docs/VEXO_UPGRADE_PROGRESS.md first, check the files on disk for anything half-written or broken (syntax check + run tests), report where we are, and wait for my OK.

=== ONE PHASE AT A TIME, THEN STOP ===
- Do exactly one phase, then STOP and wait. Never start the next phase without my written OK for the phase just finished.
- Phase 1 is audit and plan only. Write no feature code in Phase 1.
- Before each phase, make a safety copy of src/ and supabase/ into backups/before-phase-N/ (never copy .env or node_modules) so we can roll back. Git does not work on my laptop.
- At the end of each phase, set its status to WAITING FOR MY TEST and give me a short report:
  1. What you built, in simple words
  2. Files created and modified
  3. SQL to run in Supabase: file name and order (or "none")
  4. New .env variables: names only, with where I get each value
  5. Exact terminal commands to run, in order (npm install, npm run deploy, npm start)
  6. A short test checklist for Discord: what to do and what I should see
  7. Anything that could affect existing features
- I will then run npm start and test. If I report a problem, fix only that problem. Mark the phase DONE only after I say it works.

=== DO NOT BREAK WHAT EXISTS ===
- Existing features must keep working exactly as now: multi-server, HΛVØCZ knowledge and Q&A, points, marketplace, Rumble, giveaways, Guess Game, scam protection and auto mod, X posts, /setup, /status, /admin, vexo-logs. Vexo's personality and design do not change.
- Additive changes only. If a change could affect an existing feature, stop and ask me first.
- Run the existing tests after every phase and tell me the result.
- SQL must be re-runnable and must not change or delete existing rows (create table if not exists, add column if not exists), ending with NOTIFY pgrst, 'reload schema';
- The project uses plain SQL files in supabase/ and Supabase, not an ORM. Follow the existing patterns.
- Never print, edit or delete my .env or any key. Put new variables in .env.example with a comment.

=== RULES THAT OVERRIDE THE SPEC ===
1. Multi-server and plans: every new feature is per guild (guild_id) and goes through the existing feature map and hasFeature(). Propose which new features are free and which are premium in the Phase 1 plan and wait for my decision.
2. HΛVØCZ does not get auto-created channels today (it uses .env channels). Do not create channels in HΛVØCZ automatically. In the plan, tell me how the new channels will be set there.
3. The spec says channels are created in ANY server but also says Personal Vexo is for HΛVØCZ members. Resolve it like this unless I say otherwise: NFT Radar and SOL Radar are available to every server; Personal Vexo is enabled per guild by a flag that is ON only for HΛVØCZ at first, and the get-vexo-assistant channel is created only where that flag is on.
4. Personal agent participation (Phase 11) must be done by the Vexo bot itself recording an entry for the owner inside Vexo's own event system. Never use a member's account, user token, or any self-bot behavior. That breaks Discord's rules.
5. Wallets are read-only public addresses only. Never ask for or store seed phrases or private keys, and warn the user if they paste one.
6. Cost control: add a per-user daily AI limit for Personal Vexo as well as the per-guild limit, cache market and NFT data, and never run AI calls in a loop.
7. If an API key is missing or an API fails, that feature turns itself off with a clear log message. The bot must still start and all other features must work. Never publish invented market or NFT data.
8. NFT Radar never publishes without admin approval. Radar and market posts always keep the "not financial advice" line.
9. Personal data (memory, wallets, reminders) is isolated per user, usable only by that user, and deletable by that user with a command.
10. In the Phase 1 report, list every external service this upgrade needs (for example Helius, a market data API, an NFT marketplace API, a web research source), whether it has a free tier, and what happens on Render's free plan with the schedulers.
11. My code currently has unfinished or untested work (multi-server testing, giveaways, the unmentioned-question fix). In the Phase 1 audit, tell me what is unfinished and recommend whether to finish it before starting Phase 2.

==================================================================
=== THE SPECIFICATION ===
==================================================================

# VEXO — COMPLETE AI ECOSYSTEM UPGRADE

You are working on my existing Vexo Discord AI bot.

I want to upgrade Vexo into a powerful Multi-Server AI and Web3 ecosystem by adding:

1. NFT Radar
2. SOL Radar
3. Full Web3 AI Assistant
4. Personal Vexo AI Agent
5. Personal Wallet and Portfolio Intelligence
6. Personal Memory and Automation
7. Autonomous HAVOCZ Community Participation
8. Automatic Multi-Server Setup

## MOST IMPORTANT RULE

DO NOT BREAK, REMOVE, REPLACE, OR REWRITE EXISTING VEXO FEATURES.

My current Vexo is already working and includes:

- Multi-server architecture
- HAVOCZ knowledge and Q&A
- Points and activity systems
- Marketplace
- Rumble hosting
- Giveaway management
- Guess Game
- Existing permissions
- Vexo Logs
- Existing database
- Existing AI architecture
- Existing integrations and commands

All existing features must continue working exactly as before.

This upgrade must be ADDITIVE.

Before making changes, inspect the complete existing codebase and understand how everything works.

Do not assume the architecture.

# PHASE 1 — CODEBASE AUDIT

Before coding, inspect and report:

A. Current project architecture
B. Multi-server architecture
C. Existing commands and features
D. Existing HAVOCZ knowledge system
E. Rumble, Giveaway and Guess Game architecture
F. Vexo Logs and admin permission system
G. Database structure and models
H. Existing scheduler/background jobs
I. Existing API integrations
J. Current AI model and tool-calling architecture
K. Existing event participation and reward systems
L. Exact files that need modification
M. New files/modules required
N. Potential conflicts and security risks

After the audit, propose a safe implementation plan.

Do not start rewriting existing systems.

Implement incrementally and test after each phase.

# PHASE 2 — AUTOMATIC MULTI-SERVER SETUP

Vexo must remain a true multi-server Discord bot.

When Vexo is added to ANY Discord server, it should automatically initialize the Vexo system for that server.

Automatically create these channels:

1. #📡・nft-radar
2. #📈・sol-radar
3. #🤖・get-vexo-assistant

Use suitable categories if appropriate.

Requirements:

- Create channels only if they do not already exist.
- Never create duplicate channels.
- Save each channel ID against its own guild/server ID.
- Store configuration independently for every server.
- Configure suitable channel permissions.
- Do not expose private user information.
- Handle bot restarts without duplicating setup.
- If channels already exist, reuse them.
- If Vexo lacks Manage Channels permission, notify the server admin and explain the missing permission.
- If setup partially fails, retry safely without duplicating successfully created channels.

Each server must have independent configuration.

IMPORTANT:
HAVOCZ-specific functionality must not accidentally activate in unrelated servers.

Build this as a reusable onboarding/setup module.

# PHASE 3 — NFT RADAR

Create an automated Solana NFT intelligence system.

The NFT Radar channel should discover and research upcoming Solana NFT mints.

Vexo should:

1. Discover upcoming Solana NFT projects.
2. Research project websites and social links.
3. Analyze available project information.
4. Evaluate project quality and relevant signals.
5. Identify potentially interesting projects.
6. Prepare concise Radar posts.

Analyze signals such as:

- Artwork quality
- Collection identity
- Project originality
- Community activity
- Team transparency
- Roadmap
- Ecosystem connections
- Mint supply
- Mint price
- Mint date
- Market interest
- Available on-chain information

Do not publish every discovered mint.

Filter out low-quality, suspicious, irrelevant, or poorly documented projects.

## ADMIN APPROVAL REQUIRED

NFT Radar must NEVER automatically publish a discovered project.

Workflow:

AI Research → Internal Analysis → Vexo Logs → Boss/Admin Approval → NFT Radar Publication.

Use the existing Vexo Logs and permission system.

Authorized Boss/Admin users should receive an approval request with:

- Project name
- Mint date
- Supply
- Mint price
- Official links
- AI research summary
- Why Vexo selected it
- Available risk indicators
- APPROVE / REJECT controls

Only authorized users can approve or reject.

If approved, publish the post in the correct server's NFT Radar channel.

If rejected, do not publish.

Prevent duplicate project posts.

Public post format:

📡 NFT RADAR

Project: XYZ
Mint: Date
Supply: 1,111
Mint Price: 0.2 SOL

Why it caught Vexo's attention:
• Interesting artwork
• Active community
• Clear project direction
• Relevant ecosystem signals

Official: Link

⚠️ Research independently before minting. No project success or profit is guaranteed.

Keep public posts concise.

# PHASE 4 — SOL RADAR

Create a dedicated SOL Radar system.

Channel:
#📈・sol-radar

## DAILY UPDATE FREQUENCY

Vexo must publish 4–5 separate SOL market update messages every day.

This is a strict requirement.

Use a scheduler with configurable update times and timezone.

Default timezone: UTC.

Make the schedule configurable per server.

Do not publish all updates at once.

Each update should contain relevant current information.

## INFORMATION TO INCLUDE

- Current SOL price in USD
- 24-hour price change
- 24-hour high and low
- Trading volume
- RSI
- Market momentum
- Support levels
- Resistance levels
- Relevant market/news factors
- Possible bullish scenario
- Possible bearish scenario

Use available market data APIs.

Do not invent unavailable values.

If RSI or another indicator cannot be calculated reliably, omit it or clearly mark it unavailable.

## SIMPLE LANGUAGE

The purpose is to make market information understandable to ordinary Discord members.

Avoid complicated trading terminology without explanation.

Example:

📈 SOL RADAR

SOL Price: $XXX

Today's Movement:
High: $XXX
Low: $XXX
24h Change: +X%

Market Signals:
RSI: XX
Volume: Increasing
Momentum: Positive

Near-Term Outlook:

If buying momentum continues, SOL could test the $XXX area.

If selling pressure increases, SOL may move toward $XXX.

⚠️ Market analysis, not guaranteed predictions or financial advice.

Each update should be concise and useful.

Avoid repeating identical messages.

Use caching to minimize API costs.

If data sources fail, do not publish fabricated market information.

# PHASE 5 — FULL WEB3 AI ASSISTANT

Upgrade normal Vexo chat into a capable Solana/Web3 AI assistant.

Members should be able to ask questions about:

- Solana
- SOL price
- Solana ecosystem
- Solana NFTs
- NFT floor prices
- NFT collection volume
- NFT sales
- Rising and falling collections
- Upcoming NFT mints
- Solana projects
- Web3 projects
- Tokens
- Public wallets
- On-chain activity
- Project research
- Web3 news
- Market conditions

Examples:

"What is happening with Solana today?"

"Which NFT collections are gaining momentum?"

"Research this Solana NFT project."

"Show me the current floor price of this collection."

"Analyze this public wallet."

"What's happening in the Solana ecosystem?"

## INTELLIGENT TOOL ROUTING

Use external APIs for live information.

OpenAI should handle reasoning, interpretation, and explanations.

It must not pretend to be a blockchain database.

Potential integrations:

- Solana RPC
- Helius
- NFT marketplace APIs
- Market data APIs
- Reliable Web research sources

Reuse existing integrations whenever possible.

Use intelligent function/tool calling.

Examples:

SOL price question → Market API

Wallet question → Solana/Helius API

NFT floor question → NFT marketplace API

Project research → Web research + AI analysis

General question → AI only

Default answer length should be around 4–5 lines.

Give longer answers only when requested or genuinely necessary.

# PHASE 6 — PERSONAL VEXO AI AGENT

Create a separate Personal Vexo Agent for individual HAVOCZ community members.

This is an ADDITIONAL layer, not a replacement for normal Vexo.

## ACTIVATION SYSTEM

Create a dedicated channel:

#🤖・get-vexo-assistant

A member can request Personal Vexo.

Workflow:

1. Member requests Personal Vexo.
2. Request appears in Vexo Logs.
3. Existing Boss/Admin permission system controls approval.
4. Authorized admin approves.
5. Personal Agent is activated and linked to the member's Discord user ID.
6. Vexo sends the member a DM explaining the available features.

Make activation simple.

Do not require complicated manual configuration.

## PERSONAL AGENT ARCHITECTURE

Every Personal Agent must have isolated:

- User ID
- Memory
- Preferences
- Wallet information
- Tracked wallets
- Reminders
- Alerts
- Personal instructions
- Agent configuration
- Participation permissions

Never mix data between users.

The agent should understand its owner and their previous instructions.

Users should be able to update preferences and request deletion/forgetting of individual information according to the system's data-retention design.

## GENERAL AI CAPABILITIES

Personal Vexo should support normal AI conversations about:

- General knowledge
- Research
- Translation
- Writing
- Planning
- Learning
- Work assistance
- Coding questions
- Web3 questions
- Solana questions

Use efficient AI models and avoid unnecessary expensive operations.

Heavy image/video generation is NOT required in the initial version.

# PHASE 7 — PERSONAL WALLET AND PORTFOLIO

Users can provide their public wallet address.

Example:

"This is my wallet: ABC...XYZ"

Personal Vexo should remember the public address.

IMPORTANT SECURITY RULES:

- Never request a seed phrase.
- Never request a private key.
- Never request a secret key.
- No wallet signing.
- No transactions.
- Read-only access only.

## WALLET FEATURES

Personal Vexo should display:

- SOL balance
- Token holdings
- NFT count
- NFT collections
- Individual NFTs
- Estimated portfolio value when available
- Recent transactions
- NFT purchases
- NFT sales
- Wallet activity
- Portfolio changes

Example questions:

"Show my wallet."

"How much SOL do I have?"

"How many NFTs do I own?"

"Which collections do I hold?"

"What did I buy recently?"

"How has my portfolio changed?"

"What is my most valuable NFT?"

Allow users to track additional public wallets if they want.

# PHASE 8 — PERSONAL ALERTS AND REMINDERS

Personal Vexo should support:

- SOL price alerts
- NFT sale alerts
- Collection floor alerts
- Wallet activity alerts
- Token movement alerts
- Project launch alerts
- Personal reminders
- Recurring tasks

Examples:

"Remind me tomorrow at 5 PM."

"Every Sunday give me my wallet summary."

"Tell me if SOL goes below $100."

"Notify me when this wallet buys an NFT."

"Every week summarize my NFT portfolio changes."

Use the existing scheduler if available.

Store timezone per user.

Prevent duplicate reminders and unnecessary notifications.

# PHASE 9 — PERSONAL MEMORY AND PREFERENCES

Personal Vexo should remember useful user-specific context.

Examples:

- User preferences
- Interests
- Projects
- Tracked wallets
- Personal instructions
- Important ongoing goals
- Communication preferences

Example:

"Remember that I prefer short answers."

"Track this wallet."

"What do you remember about me?"

"Forget my previous wallet."

Use isolated per-user storage.

Do not share private memory with other members.

# PHASE 10 — HAVOCZ KNOWLEDGE IN PERSONAL VEXO

Existing Vexo already contains HAVOCZ knowledge.

DO NOT rebuild the entire HAVOCZ knowledge system.

Reuse the existing knowledge system.

Personal Vexo should answer:

- What is HAVOCZ?
- HAVOCZ roadmap
- HAVOCZ updates
- HAVOCZ utilities
- Vexo features
- Staking information
- Ecosystem information
- Community announcements

Personal Vexo should also provide important HAVOCZ updates.

Examples of important updates:

- Major roadmap changes
- Important project announcements
- Ecosystem launches
- Major Vexo updates
- Staking or utility changes
- Important collaborations
- Security announcements
- Major mint updates
- Significant community announcements

Do not notify users about every ordinary Discord message.

Only important and verified updates should trigger notifications.

Optional setting:

"Notify me whenever there is an important HAVOCZ update."

# PHASE 11 — PERSONAL AUTONOMOUS COMMUNITY PARTICIPATION

Personal Vexo may participate in HAVOCZ community events on behalf of its owner, but only after explicit user permission.

Supported events:

- Rumble
- Giveaway
- Guess Game

Example user instructions:

"If I am inactive, participate in Rumbles and Giveaways for me."

"Only join giveaways."

"Join Rumbles but don't chat."

"Don't participate in Guess Games."

"Turn autonomous mode off."

"Only participate when I am inactive."

## HUMAN PRIORITY

If the real user is active:

Personal Agent must not participate.

If the real user is inactive:

Personal Agent may participate according to the owner's permissions.

Do not send unnecessary messages.

Do not spam.

Do not mass-react.

Respect Discord rate limits.

Stop participating when the event ends.

Use the existing event and reward systems.

The human owner must receive the correct rewards and ownership credit.

## CRITICAL: NO DUPLICATE PARTICIPATION

Human Discord account + Personal Vexo Agent must count as ONE member identity.

Example:

If the human user already joined a Giveaway, their Personal Agent cannot join again.

If the Personal Agent already joined, the human account cannot join again.

Apply this rule to Rumble, Giveaway, Guess Game, and all other events where duplicate participation would create an unfair advantage.

Use owner_user_id as the unique participant identity.

Participation record should include:

- event_id
- owner_user_id
- participation_source
- discord_user_id
- personal_agent_id, if applicable
- timestamp

Before accepting participation, check whether the owner has already participated.

This must work regardless of whether the participation comes from the real user or their agent.

# PHASE 12 — VEXO LOGS AND ADMIN PERMISSIONS

Reuse the existing Vexo Logs system.

Integrate:

- NFT Radar approval requests
- Personal Vexo activation requests
- Approval/rejection actions
- Relevant system errors
- Setup errors
- Important automation logs

Use the existing Boss/Admin permissions.

Do not introduce conflicting permission systems.

Only authorized users should approve protected actions.

Each server must have independent permissions.

# PHASE 13 — DATABASE AND SECURITY

Extend the existing database safely.

Do not replace the current database architecture.

Use existing models where possible.

Add new tables/models only where required.

Suggested entities:

- GuildVexoConfig
- RadarConfig
- RadarResearch
- RadarApproval
- PersonalAgent
- PersonalMemory
- PersonalPreferences
- UserWallet
- TrackedWallet
- PersonalAlert
- PersonalReminder
- RecurringTask
- AgentParticipation
- AgentActivityLog

Adapt names and structure to the existing database.

Important:

- Enforce unique constraints.
- Prevent duplicate scheduled jobs.
- Prevent cross-user data leakage.
- Prevent cross-server data leakage.
- Secure API keys and secrets.
- Validate all wallet addresses.
- Handle rate limits.
- Handle API failures.
- Add appropriate audit logs.

# PHASE 14 — COST OPTIMIZATION

Avoid unnecessary AI/API calls.

Use direct APIs whenever possible.

Routing:

SOL price → Market API

SOL indicators → Market data calculation

Wallet balance → Solana/Helius

Wallet NFTs → NFT data provider

NFT floor → Marketplace API

NFT Radar → Scheduled research + AI analysis

SOL Radar → Market API + short AI summary

Simple questions → AI only

Personal reminders → Scheduler

HAVOCZ questions → Existing knowledge system

Use caching and configurable update intervals.

Do not run continuous AI calls when scheduled or event-based checks are sufficient.

Keep API costs under control.

# PHASE 15 — TESTING AND DEPLOYMENT

After implementation, test:

1. Existing Vexo commands still work.
2. Existing HAVOCZ features still work.
3. Multi-server support remains intact.
4. Adding Vexo to a new server triggers automatic setup.
5. Existing channels are reused.
6. Duplicate channels are not created.
7. SOL Radar publishes 4–5 updates daily.
8. SOL data is accurate and cached.
9. NFT Radar research works.
10. NFT Radar requires admin approval.
11. Unauthorized users cannot approve.
12. Personal Vexo activation works.
13. Each user's memory is isolated.
14. Wallet data is read-only.
15. Reminders work correctly.
16. Personal Agent respects user permissions.
17. Human and agent cannot join the same event twice.
18. Other servers do not accidentally inherit HAVOCZ-specific behavior.
19. Existing database records remain intact.
20. Bot restarts do not duplicate scheduled jobs.

Do not claim features are complete until they have been tested.

At the end, provide:

- What was implemented
- Files created
- Files modified
- Database migrations
- API keys/configuration required
- Discord permissions required
- Scheduler configuration
- Deployment instructions
- Remaining limitations
- Test results

# FINAL ARCHITECTURE

VEXO
│
├── EXISTING MULTI-SERVER VEXO
│   ├── Existing AI
│   ├── HAVOCZ Knowledge
│   ├── Points
│   ├── Marketplace
│   ├── Rumble
│   ├── Giveaway
│   └── Guess Game
│
├── NFT RADAR
│   ├── Upcoming Solana NFT Discovery
│   ├── AI Project Research
│   ├── Vexo Logs Approval
│   └── Approved Public Posts
│
├── SOL RADAR
│   ├── 4–5 Daily Updates
│   ├── SOL Price
│   ├── Market Indicators
│   ├── Support/Resistance
│   └── Market Scenarios
│
├── FULL WEB3 AI ASSISTANT
│   ├── Solana Research
│   ├── NFT Analysis
│   ├── Token Information
│   ├── Wallet Research
│   └── Web3 News
│
└── PERSONAL VEXO
    ├── Personal AI Chat
    ├── My Wallet
    ├── Portfolio Intelligence
    ├── Personal Memory
    ├── Personal Preferences
    ├── Reminders
    ├── Alerts
    ├── HAVOCZ Knowledge
    ├── Important HAVOCZ Updates
    └── Optional Autonomous Participation
        ├── Rumble
        ├── Giveaway
        ├── Guess Game
        └── Human + Agent = ONE Participant

# FINAL INSTRUCTION

First audit the existing codebase.

Do not rewrite the entire bot.

Do not remove existing features.

Do not break the multi-server architecture.

Build all new functionality as independent, modular, additive systems.

Preserve backward compatibility.

If a feature already exists, reuse it rather than creating a duplicate implementation.

If an implementation decision could risk existing functionality, explain the risk and propose a safe approach before proceeding.

My priority is a stable, scalable, premium-quality Vexo ecosystem, not just adding lots of features.

Now begin with STEP 0, then Phase 1 (audit and plan only), then stop and wait for my OK.
