-- Bedjo Cleaner production cleanup for final branch-based testing.
--
-- Before running:
-- 1. Make sure the six Auth users already exist.
-- 2. Adjust the target email/username values below to match your real login accounts.
-- 3. Run this in Supabase SQL Editor.
--
-- This script keeps one admin profile and five operator profiles, one per branch.
-- It also removes old orders without branch_id so operator branch filtering is clean.

begin;

create temp table production_target_profiles (
  role text not null,
  branch_key text,
  email text not null,
  username text not null,
  full_name text not null
) on commit drop;

insert into production_target_profiles (role, branch_key, email, username, full_name)
values
  ('admin', null, 'admin@bedjocleaner.com', 'admin', 'Admin Bedjo Cleaner'),
  ('operator', 'BEC', 'operator.bec@bedjocleaner.com', 'operator_bec', 'Operator BEC'),
  ('operator', 'BTC', 'operator.btc@bedjocleaner.com', 'operator_btc', 'Operator BTC'),
  ('operator', 'TSM', 'operator.tsm@bedjocleaner.com', 'operator_tsm', 'Operator TSM'),
  ('operator', 'Ciwalk', 'operator.ciwalk@bedjocleaner.com', 'operator_ciwalk', 'Operator Ciwalk'),
  ('operator', 'PVJ', 'operator.pvj@bedjocleaner.com', 'operator_pvj', 'Operator PVJ');

create temp table production_branches as
select distinct on (target.branch_key)
  target.branch_key,
  branches.id as branch_id,
  branches.name as branch_name
from (values
  ('BEC'),
  ('BTC'),
  ('TSM'),
  ('Ciwalk'),
  ('PVJ')
) as target(branch_key)
join public.branches branches
  on lower(branches.name) = lower(target.branch_key)
  or lower(branches.name) = lower('Bedjo ' || target.branch_key)
  or lower(branches.name) like lower('%' || target.branch_key || '%')
order by target.branch_key, branches.name;

do $$
begin
  if (select count(*) from production_branches) <> 5 then
    raise exception 'Expected 5 branches (BEC, BTC, TSM, Ciwalk, PVJ), found %. Check public.branches names.', (select count(*) from production_branches);
  end if;
end $$;

-- Align the six target profiles with production roles/branches.
update public.profiles profiles
set
  username = target.username,
  full_name = target.full_name,
  role = target.role,
  branch_id = case
    when target.role = 'operator' then branches.branch_id
    else profiles.branch_id
  end,
  status = 'active'
from production_target_profiles target
left join production_branches branches
  on branches.branch_key = target.branch_key
where lower(profiles.email) = lower(target.email);

-- Guard: fail loudly if any Auth user/profile target is missing.
do $$
declare
  missing_count integer;
begin
  select count(*)
  into missing_count
  from production_target_profiles target
  left join public.profiles profiles
    on lower(profiles.email) = lower(target.email)
  where profiles.id is null;

  if missing_count > 0 then
    raise exception 'One or more target profiles are missing. Create the Auth users first, then rerun cleanup.';
  end if;
end $$;

-- Keep only the one admin and five operator profiles listed above.
-- Detach old profile references from orders first to avoid FK failures.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'operator_id'
  ) then
    execute '
      update public.orders
      set operator_id = null
      where operator_id in (
        select profiles.id
        from public.profiles profiles
        where not exists (
          select 1
          from production_target_profiles target
          where lower(target.email) = lower(profiles.email)
        )
      )';
  end if;
end $$;

delete from public.profiles profiles
where not exists (
  select 1
  from production_target_profiles target
  where lower(target.email) = lower(profiles.email)
);

-- Remove old dummy/orphan orders outside the production branch set.
-- Child tables are cleaned defensively for schemas without ON DELETE CASCADE.
do $$
begin
  if to_regclass('public.order_photos') is not null then
    execute '
      delete from public.order_photos
      where order_id in (
        select id from public.orders
        where branch_id is null
           or branch_id not in (select branch_id from production_branches)
      )';
  end if;

  if to_regclass('public.payment_proofs') is not null then
    execute '
      delete from public.payment_proofs
      where order_id in (
        select id from public.orders
        where branch_id is null
           or branch_id not in (select branch_id from production_branches)
      )';
  end if;

  if to_regclass('public.notifications') is not null then
    execute '
      delete from public.notifications
      where order_id in (
        select id from public.orders
        where branch_id is null
           or branch_id not in (select branch_id from production_branches)
      )';
  end if;
end $$;

delete from public.payments
where order_id in (
  select id from public.orders
  where branch_id is null
     or branch_id not in (select branch_id from production_branches)
);

delete from public.order_items
where order_id in (
  select id from public.orders
  where branch_id is null
     or branch_id not in (select branch_id from production_branches)
);

delete from public.orders
where branch_id is null
   or branch_id not in (select branch_id from production_branches);

-- Verification result.
select
  profiles.email,
  profiles.username,
  profiles.full_name,
  profiles.role,
  branches.name as branch,
  profiles.status
from public.profiles profiles
left join public.branches branches on branches.id = profiles.branch_id
order by profiles.role, branches.name nulls first, profiles.email;

select
  branches.name as branch,
  count(orders.id) as orders_count
from public.branches branches
left join public.orders orders on orders.branch_id = branches.id
where branches.id in (select branch_id from production_branches)
group by branches.name
order by branches.name;

commit;
