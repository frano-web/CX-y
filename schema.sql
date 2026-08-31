-- CX Trip Manager — schema Supabase/Postgres
-- Uruchom CAŁY plik raz w Supabase → SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now(),
  unique(team_id,user_id)
);

create table if not exists public.races (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  race_date date not null,
  end_date date,
  start_time time,
  city text,
  race_address text,
  venue_url text,
  registration_url text,
  category text,
  status text not null default 'planowany' check (status in ('planowany','potwierdzony','zakonczony','odwolany')),
  hotel_status text not null default 'brak' check (hotel_status in ('brak','szukamy','zarezerwowany','oplacony')),
  hotel_name text,
  hotel_address text,
  hotel_url text,
  hotel_rooms text,
  hotel_price numeric(10,2),
  hotel_notes text,
  race_notes text,
  transport_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.race_participants (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'nieustalone' check (status in ('jedzie','moze','nie_jedzie','nieustalone')),
  note text,
  unique(race_id,user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  race_id uuid references public.races(id) on delete cascade,
  title text not null,
  note text,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  due_date date,
  priority text not null default 'normal' check (priority in ('high','normal','low')),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- Zgodność z wcześniejszą wersją bazy: zadania mogą być teraz ogólne dla ekipy,
-- a nie tylko przypisane do konkretnego wyścigu.
alter table public.tasks add column if not exists team_id uuid references public.teams(id) on delete cascade;
alter table public.tasks add column if not exists note text;
alter table public.tasks add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.tasks add column if not exists priority text not null default 'normal';
update public.tasks t set team_id=r.team_id from public.races r where t.race_id=r.id and t.team_id is null;
alter table public.tasks alter column race_id drop not null;
alter table public.tasks alter column team_id set not null;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  payer_id uuid not null references auth.users(id) on delete restrict,
  description text not null,
  category text not null default 'inne',
  amount numeric(10,2) not null check (amount >= 0),
  paid_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  share_amount numeric(10,2) not null check (share_amount >= 0),
  unique(expense_id,user_id)
);

create table if not exists public.race_vehicles (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  driver_id uuid references auth.users(id) on delete set null,
  name text not null,
  seats integer not null default 5 check (seats > 0 and seats <= 9),
  departure_time timestamptz,
  departure_place text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.packing_items (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  qty integer not null default 1 check (qty > 0),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists races_touch_updated_at on public.races;
create trigger races_touch_updated_at before update on public.races for each row execute function public.touch_updated_at();

-- Helpery RLS. SECURITY DEFINER zapobiega rekurencji polityk.
create or replace function public.is_team_member(_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.team_members m where m.team_id = _team_id and m.user_id = auth.uid());
$$;

create or replace function public.can_access_race(_race_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.races r where r.id = _race_id and public.is_team_member(r.team_id));
$$;

-- RPC: utworzenie ekipy i automatyczne dodanie twórcy jako admina.
create or replace function public.create_team(team_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
  code text;
  dname text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  code := upper(substr(md5(random()::text || clock_timestamp()::text),1,6));
  dname := coalesce(nullif(auth.jwt()->'user_metadata'->>'display_name',''), split_part(coalesce(auth.jwt()->>'email','Użytkownik'),'@',1));
  insert into public.teams(name, invite_code, created_by) values (trim(team_name), code, auth.uid()) returning id into tid;
  insert into public.team_members(team_id,user_id,display_name,role) values(tid,auth.uid(),dname,'admin');
  return tid;
end; $$;

-- RPC: dołączenie kodem. Jeden użytkownik może być w kilku ekipach, ale UI używa pierwszej.
create or replace function public.join_team(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
  dname text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id into tid from public.teams where invite_code = upper(trim(code));
  if tid is null then raise exception 'Nieprawidłowy kod ekipy'; end if;
  dname := coalesce(nullif(auth.jwt()->'user_metadata'->>'display_name',''), split_part(coalesce(auth.jwt()->>'email','Użytkownik'),'@',1));
  insert into public.team_members(team_id,user_id,display_name,role) values(tid,auth.uid(),dname,'member') on conflict(team_id,user_id) do nothing;
  return tid;
end; $$;

revoke all on function public.create_team(text) from public;
revoke all on function public.join_team(text) from public;
grant execute on function public.create_team(text) to authenticated;
grant execute on function public.join_team(text) to authenticated;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.races enable row level security;
alter table public.race_participants enable row level security;
alter table public.tasks enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.race_vehicles enable row level security;
alter table public.packing_items enable row level security;

-- Uprawnienia Data API
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.teams, public.team_members, public.races, public.race_participants,
  public.tasks, public.expenses, public.expense_shares, public.race_vehicles, public.packing_items to authenticated;

-- Teams
create policy "members select teams" on public.teams for select to authenticated using (public.is_team_member(id));
create policy "members update teams" on public.teams for update to authenticated using (public.is_team_member(id)) with check (public.is_team_member(id));

-- Members
create policy "members see team members" on public.team_members for select to authenticated using (public.is_team_member(team_id));
create policy "member updates self" on public.team_members for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and public.is_team_member(team_id));

-- Races
create policy "members select races" on public.races for select to authenticated using (public.is_team_member(team_id));
create policy "members insert races" on public.races for insert to authenticated with check (public.is_team_member(team_id));
create policy "members update races" on public.races for update to authenticated using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));
create policy "members delete races" on public.races for delete to authenticated using (public.is_team_member(team_id));

-- Child tables by race
create policy "race participants select" on public.race_participants for select to authenticated using (public.can_access_race(race_id));
create policy "race participants insert" on public.race_participants for insert to authenticated with check (public.can_access_race(race_id));
create policy "race participants update" on public.race_participants for update to authenticated using (public.can_access_race(race_id)) with check (public.can_access_race(race_id));
create policy "race participants delete" on public.race_participants for delete to authenticated using (public.can_access_race(race_id));

create policy "tasks select" on public.tasks for select to authenticated using (public.is_team_member(team_id));
create policy "tasks insert" on public.tasks for insert to authenticated with check (public.is_team_member(team_id) and (race_id is null or public.can_access_race(race_id)));
create policy "tasks update" on public.tasks for update to authenticated using (public.is_team_member(team_id)) with check (public.is_team_member(team_id) and (race_id is null or public.can_access_race(race_id)));
create policy "tasks delete" on public.tasks for delete to authenticated using (public.is_team_member(team_id));

create policy "expenses select" on public.expenses for select to authenticated using (public.can_access_race(race_id));
create policy "expenses insert" on public.expenses for insert to authenticated with check (public.can_access_race(race_id));
create policy "expenses update" on public.expenses for update to authenticated using (public.can_access_race(race_id)) with check (public.can_access_race(race_id));
create policy "expenses delete" on public.expenses for delete to authenticated using (public.can_access_race(race_id));

create policy "expense shares select" on public.expense_shares for select to authenticated using (exists(select 1 from public.expenses e where e.id=expense_id and public.can_access_race(e.race_id)));
create policy "expense shares insert" on public.expense_shares for insert to authenticated with check (exists(select 1 from public.expenses e where e.id=expense_id and public.can_access_race(e.race_id)));
create policy "expense shares update" on public.expense_shares for update to authenticated using (exists(select 1 from public.expenses e where e.id=expense_id and public.can_access_race(e.race_id))) with check (exists(select 1 from public.expenses e where e.id=expense_id and public.can_access_race(e.race_id)));
create policy "expense shares delete" on public.expense_shares for delete to authenticated using (exists(select 1 from public.expenses e where e.id=expense_id and public.can_access_race(e.race_id)));

create policy "vehicles select" on public.race_vehicles for select to authenticated using (public.can_access_race(race_id));
create policy "vehicles insert" on public.race_vehicles for insert to authenticated with check (public.can_access_race(race_id));
create policy "vehicles update" on public.race_vehicles for update to authenticated using (public.can_access_race(race_id)) with check (public.can_access_race(race_id));
create policy "vehicles delete" on public.race_vehicles for delete to authenticated using (public.can_access_race(race_id));

create policy "packing select" on public.packing_items for select to authenticated using (public.can_access_race(race_id));
create policy "packing insert" on public.packing_items for insert to authenticated with check (public.can_access_race(race_id));
create policy "packing update" on public.packing_items for update to authenticated using (public.can_access_race(race_id)) with check (public.can_access_race(race_id));
create policy "packing delete" on public.packing_items for delete to authenticated using (public.can_access_race(race_id));

-- Realtime: dla małej 5-osobowej ekipy Postgres Changes jest prosty i wystarczający.
do $$ begin
  alter publication supabase_realtime add table public.races;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.race_participants; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tasks; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.expenses; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.expense_shares; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.race_vehicles; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.packing_items; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.team_members; exception when duplicate_object then null; end $$;
