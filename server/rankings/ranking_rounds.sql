-- Run once in the Supabase SQL editor. The game server writes with the secret
-- key (bypasses RLS); RLS with no policies keeps the table closed to browsers.
create table if not exists public.ranking_rounds (
  id text primary key,
  map_id text not null,
  ended_at timestamptz not null,
  players jsonb not null
);
create index if not exists ranking_rounds_ended_at on public.ranking_rounds (ended_at, id);
alter table public.ranking_rounds enable row level security;
revoke all on public.ranking_rounds from anon, authenticated;
