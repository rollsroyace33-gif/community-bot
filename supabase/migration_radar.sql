-- =====================================================================
-- Vexo: radar features (SOL Radar and NFT Radar).
-- Run this ONCE in Supabase > SQL Editor, AFTER migration_giveaway.sql.
-- It is safe to run again. It only creates NEW tables; no existing table
-- or row is changed.
-- =====================================================================

-- One row per SOL Radar update that was posted (per server, per time slot).
-- The primary key is what stops the same update from being posted twice,
-- also across restarts and redeploys.
create table if not exists sol_radar_posts (
  guild_id text not null,
  slot text not null,                    -- "2026-11-14 10:00" on that server's SOL Radar clock
  channel_id text,
  message_id text,
  created_at timestamptz not null default now(),
  primary key (guild_id, slot)
);
alter table sol_radar_posts enable row level security;
create index if not exists sol_radar_posts_created_idx on sol_radar_posts (created_at);

-- ---------------------------------------------------------------------
-- NFT Radar (added in upgrade phase 3). Safe to run again.
-- ---------------------------------------------------------------------

-- One row per discovered project, shared by every server (it is researched
-- only once). "project_key" (the website domain, X handle or name) is
-- unique, so the same project is never stored or researched twice.
create table if not exists nft_radar_projects (
  id bigserial primary key,
  project_key text not null unique,
  name text not null,
  source text,                           -- 'admin' | 'web' | 'magiceden'
  status text not null default 'new',    -- 'new' | 'selected' | 'dropped'
  drop_reason text,
  data jsonb not null default '{}'::jsonb, -- research result: mint date, supply, price, links, summary, reasons, risks, score
  added_by text,                         -- Discord user id when an admin added it
  added_guild_id text,                   -- the server it was added from (admin-added projects go to that server only)
  created_at timestamptz not null default now(),
  researched_at timestamptz
);
alter table nft_radar_projects enable row level security;
create index if not exists nft_radar_projects_status_idx on nft_radar_projects (status, created_at);

-- One row per server per project: the approval request and what happened
-- to it. The primary key stops a project from being sent to the same
-- server twice. Only the first Approve / Reject counts.
create table if not exists nft_radar_reviews (
  guild_id text not null,
  project_id bigint not null references nft_radar_projects (id) on delete cascade,
  status text not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  log_channel_id text,
  log_message_id text,
  decided_by text,
  decided_at timestamptz,
  post_channel_id text,
  post_message_id text,
  created_at timestamptz not null default now(),
  primary key (guild_id, project_id)
);
alter table nft_radar_reviews enable row level security;
create index if not exists nft_radar_reviews_guild_idx on nft_radar_reviews (guild_id, created_at);

-- One row per scheduled discovery run, so a restart never repeats a run
-- (and never spends the free web-search allowance twice).
create table if not exists nft_radar_runs (
  slot text primary key,                 -- "2026-11-14 09:00" (UTC)
  found integer,
  created_at timestamptz not null default now()
);
alter table nft_radar_runs enable row level security;

NOTIFY pgrst, 'reload schema';
