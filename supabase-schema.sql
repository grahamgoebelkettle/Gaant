-- Run this in Supabase Dashboard → SQL Editor.
-- Copy from the line below (create table...) through the end. Do not paste the filename.

-- Boards: one row per project/board, owned by a user
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled project',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Board data: one row per board. Persisted fields:
--   tasks: array of { task, phase, party, start, end, startDate, endDate, star, overview, subTasks, blockers, links, dependsOn } (accordion/expandable content included)
--   settings: { title, description, phases, paletteIndex, responsibleParties, ... } (palette index, phase colors, saved party list)
--   view: current view mode
--   custom_palettes: user-created color palettes for the project
create table if not exists public.board_data (
  board_id uuid primary key references public.boards(id) on delete cascade,
  tasks jsonb not null default '[]',
  settings jsonb not null default '{}',
  view text not null default 'default',
  custom_palettes jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- RLS: users can only see and modify their own boards
alter table public.boards enable row level security;
alter table public.board_data enable row level security;

create policy "Users can do everything on own boards"
  on public.boards for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Users can do everything on own board_data"
  on public.board_data for all
  using (
    board_id in (select id from public.boards where owner_id = auth.uid())
  )
  with check (
    board_id in (select id from public.boards where owner_id = auth.uid())
  );

-- Optional: keep updated_at in sync
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger boards_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();

create trigger board_data_updated_at
  before update on public.board_data
  for each row execute function public.set_updated_at();
