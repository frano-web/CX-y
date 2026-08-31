-- CX Trip Manager — aktualizacja modułu zadań dla istniejącej bazy
-- Uruchom ten plik TYLKO jeśli wcześniej uruchomiłeś starszy schema.sql.

alter table public.tasks add column if not exists team_id uuid references public.teams(id) on delete cascade;
alter table public.tasks add column if not exists note text;
alter table public.tasks add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.tasks add column if not exists priority text not null default 'normal';
update public.tasks t set team_id=r.team_id from public.races r where t.race_id=r.id and t.team_id is null;
alter table public.tasks alter column race_id drop not null;
alter table public.tasks alter column team_id set not null;

drop policy if exists "tasks select" on public.tasks;
drop policy if exists "tasks insert" on public.tasks;
drop policy if exists "tasks update" on public.tasks;
drop policy if exists "tasks delete" on public.tasks;

create policy "tasks select" on public.tasks for select to authenticated using (public.is_team_member(team_id));
create policy "tasks insert" on public.tasks for insert to authenticated with check (public.is_team_member(team_id) and (race_id is null or public.can_access_race(race_id)));
create policy "tasks update" on public.tasks for update to authenticated using (public.is_team_member(team_id)) with check (public.is_team_member(team_id) and (race_id is null or public.can_access_race(race_id)));
create policy "tasks delete" on public.tasks for delete to authenticated using (public.is_team_member(team_id));
