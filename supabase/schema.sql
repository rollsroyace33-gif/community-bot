-- =====================================================================
-- Paste this WHOLE file into Supabase > SQL Editor > New query > Run
-- Safe to run again (uses "if not exists" / "create or replace").
-- =====================================================================

create table if not exists users (
  user_id text primary key,
  points int not null default 0 check (points >= 0),
  created_at timestamptz not null default now()
);

create table if not exists daily_stats (
  user_id text not null,
  day date not null,
  msg_count int not null default 0,
  msg_pts int not null default 0,
  react_pts int not null default 0,
  quality_pts int not null default 0,
  bonus_pts int not null default 0,
  quality_score int not null default 0,
  primary key (user_id, day)
);

create table if not exists messages_log (
  id bigserial primary key,
  user_id text not null,
  day date not null,
  content text not null,
  score int,
  created_at timestamptz not null default now()
);
create index if not exists messages_log_day_idx on messages_log (day, score);

create table if not exists reaction_log (
  message_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists point_log (
  id bigserial primary key,
  user_id text not null,
  amount int not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists items (
  id serial primary key,
  name text not null,
  description text not null default '',
  price int not null check (price > 0),
  stock int not null check (stock >= 0),
  type text not null default 'other',
  role_id text,
  image_url text,
  channel_id text,
  message_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists purchases (
  id serial primary key,
  user_id text not null,
  item_id int not null references items(id),
  item_name text not null,
  item_type text not null,
  price int not null,
  status text not null default 'pending' check (status in ('pending','delivered','refunded')),
  ticket_channel_id text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

-- small key/value store (e.g. marketplace header message id)
create table if not exists bot_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

create table if not exists daily_runs (
  day date primary key,
  top_user_id text,
  ran_at timestamptz not null default now()
);

-- scheduled tasks from the control channel (number guess game, later: announcement, poll, giveaway...)
-- state holds private game data (secret number, winner, guess counts). Only the bot can read it (RLS below).
create table if not exists scheduled_tasks (
  id bigserial primary key,
  type text not null,
  run_at timestamptz not null,
  channel_id text not null,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','announced','running','done','cancelled')),
  created_by text not null,
  created_at timestamptz not null default now(),
  state jsonb not null default '{}'::jsonb
);
create index if not exists scheduled_tasks_status_idx on scheduled_tasks (status, run_at);

-- community facts taught by the boss in the control channel (the ONLY way Vexo learns)
create table if not exists vexo_knowledge (
  id bigserial primary key,
  fact text not null,
  source text,
  created_by text,
  created_at timestamptz not null default now(),
  active boolean not null default true
);

-- member questions Vexo could not answer. Question text ONLY: no user id, name or other personal data.
create table if not exists vexo_unanswered (
  id bigserial primary key,
  question text not null,
  times_asked int not null default 1,
  last_asked timestamptz not null default now(),
  resolved boolean not null default false
);
create index if not exists vexo_unanswered_open_idx on vexo_unanswered (resolved, times_asked desc);

-- Security: only the bot (service_role key) can touch these tables.
alter table users enable row level security;
alter table daily_stats enable row level security;
alter table messages_log enable row level security;
alter table reaction_log enable row level security;
alter table point_log enable row level security;
alter table items enable row level security;
alter table purchases enable row level security;
alter table daily_runs enable row level security;
alter table bot_settings enable row level security;
alter table scheduled_tasks enable row level security;
alter table vexo_knowledge enable row level security;
alter table vexo_unanswered enable row level security;

-- ---------------------------------------------------------------------
-- Add / remove points (never below 0). Returns new balance.
-- ---------------------------------------------------------------------
create or replace function adjust_points(p_user text, p_amount int, p_reason text)
returns int language plpgsql as $$
declare
  v_new int;
begin
  insert into users(user_id) values (p_user) on conflict do nothing;
  update users set points = greatest(0, points + p_amount)
    where user_id = p_user returning points into v_new;
  insert into point_log(user_id, amount, reason) values (p_user, p_amount, p_reason);
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------
-- Award points with per-category cap and total daily cap (atomic).
-- Categories: message | reaction | quality
-- ---------------------------------------------------------------------
create or replace function award_points(
  p_user text, p_day date, p_category text, p_amount int, p_cat_cap int, p_total_cap int
) returns int language plpgsql as $$
declare
  v_s daily_stats%rowtype;
  v_cat int;
  v_allowed int;
begin
  insert into daily_stats(user_id, day) values (p_user, p_day) on conflict do nothing;
  select * into v_s from daily_stats where user_id = p_user and day = p_day for update;

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
  where user_id = p_user and day = p_day;

  perform adjust_points(p_user, v_allowed, p_category);
  return v_allowed;
end;
$$;

-- ---------------------------------------------------------------------
-- Count one valid message. Every N-th message gives 1 point.
-- ---------------------------------------------------------------------
create or replace function record_message(
  p_user text, p_day date, p_per_point int, p_cat_cap int, p_total_cap int
) returns int language plpgsql as $$
declare
  v_count int;
begin
  insert into daily_stats(user_id, day) values (p_user, p_day) on conflict do nothing;
  update daily_stats set msg_count = msg_count + 1
    where user_id = p_user and day = p_day returning msg_count into v_count;
  if v_count % p_per_point = 0 then
    return award_points(p_user, p_day, 'message', 1, p_cat_cap, p_total_cap);
  end if;
  return 0;
end;
$$;

-- ---------------------------------------------------------------------
-- One reaction = 1 point, only once per (message, user).
-- ---------------------------------------------------------------------
create or replace function record_reaction(
  p_message text, p_user text, p_day date, p_cat_cap int, p_total_cap int
) returns int language plpgsql as $$
begin
  insert into reaction_log(message_id, user_id) values (p_message, p_user) on conflict do nothing;
  if not found then
    return 0;
  end if;
  return award_points(p_user, p_day, 'reaction', 1, p_cat_cap, p_total_cap);
end;
$$;

-- ---------------------------------------------------------------------
-- Redeem an item: check stock + points, deduct, create purchase. Atomic.
-- ---------------------------------------------------------------------
create or replace function redeem_item(p_user text, p_item int)
returns jsonb language plpgsql as $$
declare
  v_item items%rowtype;
  v_points int;
  v_pid int;
begin
  select * into v_item from items where id = p_item for update;
  if not found or not v_item.active then
    return jsonb_build_object('ok', false, 'message', 'Item not found.');
  end if;
  if v_item.stock <= 0 then
    return jsonb_build_object('ok', false, 'message', '❌ This item is out of stock.');
  end if;

  insert into users(user_id) values (p_user) on conflict do nothing;
  select points into v_points from users where user_id = p_user for update;
  if v_points < v_item.price then
    return jsonb_build_object('ok', false,
      'message', format('❌ Not enough points. You need %s points, but you have %s.', v_item.price, v_points));
  end if;

  update users set points = points - v_item.price where user_id = p_user;
  update items set stock = stock - 1 where id = p_item;
  insert into purchases(user_id, item_id, item_name, item_type, price)
    values (p_user, v_item.id, v_item.name, v_item.type, v_item.price)
    returning id into v_pid;
  insert into point_log(user_id, amount, reason)
    values (p_user, -v_item.price, 'purchase #' || v_pid);

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

-- ---------------------------------------------------------------------
-- Refund a PENDING purchase: points back, stock back.
-- ---------------------------------------------------------------------
create or replace function refund_purchase(p_purchase int)
returns jsonb language plpgsql as $$
declare
  v_p purchases%rowtype;
begin
  select * into v_p from purchases where id = p_purchase for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Purchase not found.');
  end if;
  if v_p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'message', 'This purchase''s status is: ' || v_p.status || '. Only pending purchases can be refunded.');
  end if;

  update purchases set status = 'refunded' where id = p_purchase;
  perform adjust_points(v_p.user_id, v_p.price, 'refund #' || p_purchase);
  update items set stock = stock + 1 where id = v_p.item_id;

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
