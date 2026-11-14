-- =====================================================================
-- Vexo: X posts channel per server + scam protection
-- Run this ONCE in Supabase > SQL Editor, AFTER migration_multiserver.sql.
-- It is safe to run again: every step checks if it was already done.
-- No existing row is changed or deleted.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. X post drops: "one credit per X post, ever" becomes
--    "one credit per X post PER SERVER". Only the table's key changes.
--    HΛVØCZ rows stay exactly as they are.
-- ---------------------------------------------------------------------
do $$
declare
  v_name text;
  v_cols text[];
begin
  select c.conname,
         array(
           select a.attname::text
           from unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
           order by k.ord
         )
    into v_name, v_cols
  from pg_constraint c
  where c.conrelid = 'public.x_post_drops'::regclass
    and c.contype = 'p';

  if v_cols = array['guild_id', 'status_id'] then
    return; -- already done
  end if;
  if v_name is not null then
    execute format('alter table public.x_post_drops drop constraint %I', v_name);
  end if;
  alter table public.x_post_drops add primary key (guild_id, status_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Scam protection: remembers every kick / ban Vexo made, so a member
--    who comes back after a kick and repeats the scam is banned.
-- ---------------------------------------------------------------------
create table if not exists scam_actions (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  action text not null,           -- 'kick' or 'ban'
  reason text,
  created_at timestamptz not null default now()
);
alter table scam_actions enable row level security;
create index if not exists scam_actions_guild_user_idx on scam_actions (guild_id, user_id, created_at);

NOTIFY pgrst, 'reload schema';
