create extension if not exists pgcrypto;

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  action text,
  description text,
  user_email text,
  created_at timestamptz default now()
);

create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);

alter table public.activity_logs enable row level security;

drop policy if exists "Admin can read activity logs" on public.activity_logs;
create policy "Admin can read activity logs"
on public.activity_logs
for select
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and lower(profiles.role) = 'admin'
  )
);

drop policy if exists "Admin can insert activity logs" on public.activity_logs;
create policy "Admin can insert activity logs"
on public.activity_logs
for insert
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and lower(profiles.role) = 'admin'
  )
);
