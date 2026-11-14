-- =====================================================================
-- Vexo: giveaways
-- Run this ONCE in Supabase > SQL Editor, AFTER migration_multiserver.sql
-- and migration_scam_xdrop.sql.
-- It is safe to run again. It only creates two NEW tables; no existing
-- table or row is changed.
-- =====================================================================

-- one row per giveaway (every server has its own, separated by guild_id)
create table if not exists giveaways (
  id bigint generated always as identity primary key,
  guild_id text not null,
  channel_id text not null,
  message_id text,                      -- the giveaway box (embed + Join button)
  prize text not null,
  winners_count integer not null default 1,
  points_prize integer,                 -- set = these points are added to every winner automatically
  required_role_id text,                -- only members with this role can join / win
  ping_role_id text,                    -- pinged when the giveaway starts (winners are announced with @everyone)
  host_id text not null,
  image_name text,                      -- file name of the re-uploaded picture on the giveaway message
  ends_at timestamptz not null,
  status text not null default 'active',  -- active | ended | cancelled
  settled boolean not null default false, -- true once winners are picked, paid and announced
  winner_ids jsonb not null default '[]'::jsonb,       -- current winners
  past_winner_ids jsonb not null default '[]'::jsonb,  -- everyone who ever won it (a reroll never picks them again)
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
alter table giveaways enable row level security;
create index if not exists giveaways_status_idx on giveaways (status, ends_at);
create index if not exists giveaways_guild_idx on giveaways (guild_id, status);

-- one row per member per giveaway. The primary key is what stops double entries.
create table if not exists giveaway_entries (
  giveaway_id bigint not null references giveaways (id) on delete cascade,
  guild_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (giveaway_id, user_id)
);
alter table giveaway_entries enable row level security;

NOTIFY pgrst, 'reload schema';
