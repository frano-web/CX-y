-- CX Trip V15 — status startowego dla całego wyścigu
-- Uruchom raz w Supabase → SQL Editor → Run.

alter table public.races
  add column if not exists entry_fee_paid boolean not null default false;
