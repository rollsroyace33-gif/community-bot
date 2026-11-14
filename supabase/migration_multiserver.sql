-- =====================================================================
-- VEXO MULTI-SERVER MIGRATION
--
-- HOW TO RUN: Supabase > SQL Editor > New query > paste this WHOLE file > Run.
-- BEFORE YOU RUN: change ONE line below (STEP 0) to your HΛVØCZ server ID.
--
-- Safe to run again and again. It never deletes or changes existing data:
--   * it only ADDS a guild_id column to each table (every existing row is
--     marked as HΛVØCZ automatically),
--   * creates the new "guilds" table,
--   * adds new versions of the database functions that know about servers.
-- The OLD function versions keep working, so the bot that is live right now
-- is not disturbed between running this file and uploading the new code.
-- If anything fails, Supabase undoes the whole run and nothing is changed.
--
-- (New install from zero: run supabase/schema.sql first, then this file.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 0: YOUR HΛVØCZ SERVER ID  <<<<<<  CHANGE THIS ONE LINE  >>>>>>
-- Discord > right-click the HΛVØCZ server icon > Copy Server ID
-- (needs Settings > Advanced > Developer Mode ON). Keep the quotes.
-- It is the same number as GUILD_ID in your .env.
-- ---------------------------------------------------------------------
create or replace function vexo_home_guild() returns text
language sql immutable as $$
  select 'PASTE_HAVOCZ_SERVER_ID_HERE'::text
$$;

-- stops right here (nothing changed) if the line above was not edited
do $$
begin
  if vexo_home_guild() !~ '^\d{17,20}$' then
    raise exception 'STEP 0 is not done: replace PASTE_HAVOCZ_SERVER_ID_HERE (near the top of this file) with your HΛVØCZ server ID (17-20 digits), then run again.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- STEP 1: the guilds table (one row per Discord server).
-- A row is never deleted, also not when the bot leaves a server
-- (that is how a server can only ever get one free trial).
-- ---------------------------------------------------------------------
create table if not exists guilds (
  guild_id text primary key,
  name text,
  knowledge text,                                   -- compact summary of what Vexo knows about this server
  settings jsonb not null default '{}'::jsonb,      -- channel IDs, role IDs, auto mod switches, knowledge source channels
  boss_user_id text,                                -- the admin Vexo treats as "boss" in this server
  ticket_instructions text not null default 'Please open a ticket to claim your prize.',
  status text not null default 'active',            -- active | left
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  paid_until timestamptz,
  ai_calls_today int not null default 0,
  created_at timestamptz not null default now()
);
-- extra helper columns (not in the list above so a re-run can add them to an older guilds table)
alter table guilds add column if not exists ai_calls_day date;          -- the day ai_calls_today belongs to
alter table guilds add column if not exists left_at timestamptz;        -- when the bot was removed (row is kept)
alter table guilds add column if not exists knowledge_updated_at timestamptz;
alter table guilds enable row level security;

-- HΛVØCZ itself (channels, roles and the boss keep coming from the .env values)
insert into guilds (guild_id, name, status)
values (vexo_home_guild(), 'HΛVØCZ', 'active')
on conflict (guild_id) do nothing;


-- ---------------------------------------------------------------------
-- STEP 2: guild_id on every table.
-- "default vexo_home_guild()" does the backfill: every row that exists
-- today gets the HΛVØCZ server ID. Nothing else in a row is touched.
-- ---------------------------------------------------------------------
-- this table is used by the X post drop reward but was missing from schema.sql
create table if not exists x_post_drops (
  status_id text primary key,
  user_id text not null,
  message_id text,
  created_at timestamptz not null default now()
);
alter table x_post_drops enable row level security;

alter table users           add column if not exists guild_id text not null default vexo_home_guild();
alter table daily_stats     add column if not exists guild_id text not null default vexo_home_guild();
alter table messages_log    add column if not exists guild_id text not null default vexo_home_guild();
alter table reaction_log    add column if not exists guild_id text not null default vexo_home_guild();
alter table point_log       add column if not exists guild_id text not null default vexo_home_guild();
alter table items           add column if not exists guild_id text not null default vexo_home_guild();
alter table purchases       add column if not exists guild_id text not null default vexo_home_guild();
alter table bot_settings    add column if not exists guild_id text not null default vexo_home_guild();
alter table daily_runs      add column if not exists guild_id text not null default vexo_home_guild();
alter table scheduled_tasks add column if not exists guild_id text not null default vexo_home_guild();
alter table vexo_knowledge  add column if not exists guild_id text not null default vexo_home_guild();
alter table vexo_unanswered add column if not exists guild_id text not null default vexo_home_guild();
alter table x_post_drops    add column if not exists guild_id text not null default vexo_home_guild();


-- ---------------------------------------------------------------------
-- STEP 3: "one row per member" becomes "one row per member PER SERVER".
-- Only the table's key definition changes; no row is changed.
-- (reaction_log and x_post_drops keep their keys: Discord message IDs and
--  X post IDs are already unique across all servers.)
-- ---------------------------------------------------------------------
create or replace function vexo_set_pk(p_table text, p_cols text[]) returns void
language plpgsql as $$
declare
  v_name text;
  v_cols text[];
  v_list text;
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
  where c.conrelid = ('public.' || quote_ident(p_table))::regclass
    and c.contype = 'p';

  if v_cols = p_cols then
    return; -- already done (this file was run before)
  end if;
  if v_name is not null then
    execute format('alter table public.%I drop constraint %I', p_table, v_name);
  end if;
  select string_agg(quote_ident(u.col), ', ' order by u.ord) into v_list
  from unnest(p_cols) with ordinality as u(col, ord);
  execute format('alter table public.%I add primary key (%s)', p_table, v_list);
end;
$$;

select vexo_set_pk('users',        array['guild_id', 'user_id']);
select vexo_set_pk('daily_stats',  array['guild_id', 'user_id', 'day']);
select vexo_set_pk('bot_settings', array['guild_id', 'key']);
select vexo_set_pk('daily_runs',   array['guild_id', 'day']);

drop function if exists vexo_set_pk(text, text[]);

-- faster "this server only" lookups
create index if not exists messages_log_guild_day_idx   on messages_log (guild_id, day, score);
create index if not exists point_log_guild_reason_idx   on point_log (guild_id, reason);
create index if not exists point_log_guild_user_idx     on point_log (guild_id, user_id);
create index if not exists items_guild_active_idx       on items (guild_id, active);
create index if not exists purchases_guild_status_idx   on purchases (guild_id, status);
create index if not exists scheduled_tasks_guild_idx    on scheduled_tasks (guild_id, status, run_at);
create index if not exists vexo_knowledge_guild_idx     on vexo_knowledge (guild_id, active);
create index if not exists vexo_unanswered_guild_idx    on vexo_unanswered (guild_id, resolved, times_asked desc);
create index if not exists x_post_drops_guild_user_idx  on x_post_drops (guild_id, user_id, created_at);


-- ---------------------------------------------------------------------
-- STEP 4: database functions, NEW versions (first argument = the server).
-- Same rules as before, only "in this server" is added everywhere.
-- ---------------------------------------------------------------------

-- Add / remove points (never below 0). Returns new balance.
create or replace function adjust_points(p_guild text, p_user text, p_amount int, p_reason text)
returns int language plpgsql as $$
declare
  v_new int;
begin
  insert into users(guild_id, user_id) values (p_guild, p_user) on conflict do nothing;
  update users set points = greatest(0, points + p_amount)
    where guild_id = p_guild and user_id = p_user returning points into v_new;
  insert into point_log(guild_id, user_id, amount, reason) values (p_guild, p_user, p_amount, p_reason);
  return v_new;
end;
$$;

-- Award points with per-category cap and total daily cap (atomic).
create or replace function award_points(
  p_guild text, p_user text, p_day date, p_category text, p_amount int, p_cat_cap int, p_total_cap int
) returns int language plpgsql as $$
declare
  v_s daily_stats%rowtype;
  v_cat int;
  v_allowed int;
begin
  insert into daily_stats(guild_id, user_id, day) values (p_guild, p_user, p_day) on conflict do nothing;
  select * into v_s from daily_stats
    where guild_id = p_guild and user_id = p_user and day = p_day for update;

  v_cat := case p_category
    when 'message' then v_s.msg_pts
    when 'reaction' then v_s.react_pts
    when 'quality' then v_s.quality_pts
    else 0 end;

  v_allowed := least(p_amount, p_cat_cap - v_cat, p_total_cap - (v_s.msg_pts + v_s.react_pts + v_s.quality_pts));
  if v_allowed <= 0 then
    return 0;
  end if;

  update daily_stats set
    msg_pts     = msg_pts     + case when p_category = 'message'  then v_allowed else 0 end,
    react_pts   = react_pts   + case when p_category = 'reaction' then v_allowed else 0 end,
    quality_pts = quality_pts + case when p_category = 'quality'  then v_allowed else 0 end
  where guild_id = p_guild and user_id = p_user and day = p_day;

  perform adjust_points(p_guild, p_user, v_allowed, p_category);
  return v_allowed;
end;
$$;

-- Count one valid message. Every N-th message gives 1 point.
create or replace function record_message(
  p_guild text, p_user text, p_day date, p_per_point int, p_cat_cap int, p_total_cap int
) returns int language plpgsql as $$
declare
  v_count int;
begin
  insert into daily_stats(guild_id, user_id, day) values (p_guild, p_user, p_day) on conflict do nothing;
  update daily_stats set msg_count = msg_count + 1
    where guild_id = p_guild and user_id = p_user and day = p_day returning msg_count into v_count;
  if v_count % p_per_point = 0 then
    return award_points(p_guild, p_user, p_day, 'message', 1, p_cat_cap, p_total_cap);
  end if;
  return 0;
end;
$$;

-- One reaction = 1 point, only once per (message, user).
create or replace function record_reaction(
  p_guild text, p_message text, p_user text, p_day date, p_cat_cap int, p_total_cap int
) returns int language plpgsql as $$
begin
  insert into reaction_log(guild_id, message_id, user_id) values (p_guild, p_message, p_user) on conflict do nothing;
  if not found then
    return 0;
  end if;
  return award_points(p_guild, p_user, p_day, 'reaction', 1, p_cat_cap, p_total_cap);
end;
$$;

-- Redeem an item: check stock + points, deduct, create purchase. Atomic.
-- An item from another server is "not found".
create or replace function redeem_item(p_guild text, p_user text, p_item int)
returns jsonb language plpgsql as $$
declare
  v_item items%rowtype;
  v_points int;
  v_pid int;
begin
  select * into v_item from items where id = p_item and guild_id = p_guild for update;
  if not found or not v_item.active then
    return jsonb_build_object('ok', false, 'message', 'Item not found.');
  end if;
  if v_item.stock <= 0 then
    return jsonb_build_object('ok', false, 'message', '❌ This item is out of stock.');
  end if;

  insert into users(guild_id, user_id) values (p_guild, p_user) on conflict do nothing;
  select points into v_points from users where guild_id = p_guild and user_id = p_user for update;
  if v_points < v_item.price then
    return jsonb_build_object('ok', false,
      'message', format('❌ Not enough points. You need %s points, but you have %s.', v_item.price, v_points));
  end if;

  update users set points = points - v_item.price where guild_id = p_guild and user_id = p_user;
  update items set stock = stock - 1 where id = p_item and guild_id = p_guild;
  insert into purchases(guild_id, user_id, item_id, item_name, item_type, price)
    values (p_guild, p_user, v_item.id, v_item.name, v_item.type, v_item.price)
    returning id into v_pid;
  insert into point_log(guild_id, user_id, amount, reason)
    values (p_guild, p_user, -v_item.price, 'purchase #' || v_pid);

  return jsonb_build_object(
    'ok', true,
    'purchase_id', v_pid,
    'item_id', v_item.id,
    'item_name', v_item.name,
    'item_type', v_item.type,
    'role_id', v_item.role_id,
    'price', v_item.price,
    'stock', v_item.stock - 1
  );
end;
$$;

-- Refund a PENDING purchase: points back, stock back.
-- A purchase from another server is "not found".
create or replace function refund_purchase(p_guild text, p_purchase int)
returns jsonb language plpgsql as $$
declare
  v_p purchases%rowtype;
begin
  select * into v_p from purchases where id = p_purchase and guild_id = p_guild for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Purchase not found.');
  end if;
  if v_p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'message', 'This purchase''s status is: ' || v_p.status || '. Only pending purchases can be refunded.');
  end if;

  update purchases set status = 'refunded' where id = p_purchase and guild_id = p_guild;
  perform adjust_points(p_guild, v_p.user_id, v_p.price, 'refund #' || p_purchase);
  update items set stock = stock + 1 where id = v_p.item_id and guild_id = p_guild;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_p.user_id,
    'item_id', v_p.item_id,
    'item_name', v_p.item_name,
    'price', v_p.price,
    'ticket_channel_id', v_p.ticket_channel_id
  );
end;
$$;

-- Daily AI call counter per server (atomic). Returns the new count for p_day,
-- or -1 when the server already used p_limit calls today (the call is then
-- not allowed and not counted). p_limit <= 0 means "no limit, just count".
create or replace function count_ai_call(p_guild text, p_day date, p_limit int)
returns int language plpgsql as $$
declare
  v_count int;
begin
  update guilds set
    ai_calls_today = case when ai_calls_day = p_day then ai_calls_today + 1 else 1 end,
    ai_calls_day = p_day
  where guild_id = p_guild
    and (p_limit <= 0 or ai_calls_day is distinct from p_day or ai_calls_today < p_limit)
  returning ai_calls_today into v_count;
  if not found then
    return -1;
  end if;
  return v_count;
end;
$$;


-- ---------------------------------------------------------------------
-- STEP 5: the OLD function versions (without a server) stay, and simply
-- mean "HΛVØCZ". This keeps the currently running bot working until the
-- new code is uploaded. The new code never calls these.
-- ---------------------------------------------------------------------
create or replace function adjust_points(p_user text, p_amount int, p_reason text)
returns int language plpgsql as $$
begin
  return adjust_points(vexo_home_guild(), p_user, p_amount, p_reason);
end;
$$;

create or replace function award_points(
  p_user text, p_day date, p_category text, p_amount int, p_cat_cap int, p_total_cap int
) returns int language plpgsql as $$
begin
  return award_points(vexo_home_guild(), p_user, p_day, p_category, p_amount, p_cat_cap, p_total_cap);
end;
$$;

create or replace function record_message(
  p_user text, p_day date, p_per_point int, p_cat_cap int, p_total_cap int
) returns int language plpgsql as $$
begin
  return record_message(vexo_home_guild(), p_user, p_day, p_per_point, p_cat_cap, p_total_cap);
end;
$$;

create or replace function record_reaction(
  p_message text, p_user text, p_day date, p_cat_cap int, p_total_cap int
) returns int language plpgsql as $$
begin
  return record_reaction(vexo_home_guild(), p_message, p_user, p_day, p_cat_cap, p_total_cap);
end;
$$;

create or replace function redeem_item(p_user text, p_item int)
returns jsonb language plpgsql as $$
begin
  return redeem_item(vexo_home_guild(), p_user, p_item);
end;
$$;

create or replace function refund_purchase(p_purchase int)
returns jsonb language plpgsql as $$
begin
  return refund_purchase(vexo_home_guild(), p_purchase);
end;
$$;


-- tell Supabase's API about the new columns and functions
NOTIFY pgrst, 'reload schema';
