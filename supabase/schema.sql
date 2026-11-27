-- =====================================================================
-- EVENT PASS - Supabase schema
-- Run this once in the Supabase Dashboard -> SQL Editor -> New query.
-- Creates 2 tables: events and registrations.
-- =====================================================================

-- Needed for gen_random_uuid() (already enabled on Supabase, safe to repeat).
create extension if not exists pgcrypto;

-- Used to build friendly pass IDs: EP-0001, EP-0002, ...
create sequence if not exists public.registration_id_seq;

-- ---------------------------------------------------------------------
-- 1) events - one row with the details shown on the public page
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  tagline      text not null default '',
  description  text not null default '',
  event_date   date not null,
  start_time   time not null,
  venue        text not null,
  organizer    text not null default '',
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) registrations - one row per participant / QR pass
-- ---------------------------------------------------------------------
create table if not exists public.registrations (
  id            text primary key
                default 'EP-' || lpad(nextval('public.registration_id_seq')::text, 4, '0'),
  token         text not null unique,          -- secret: only this goes inside the QR
  name          text not null check (char_length(name) between 2 and 80),
  usn           text not null default '',
  branch        text not null,
  phone         text not null unique check (phone ~ '^[0-9]{10}$'),
  email         text not null unique check (position('@' in email) > 1),
  status        text not null default 'pending'
                check (status in ('pending', 'verified', 'revoked')),
  registered_at timestamptz not null default now(),
  verified_at   timestamptz
);

create index if not exists registrations_status_idx
  on public.registrations (status);
create index if not exists registrations_registered_at_idx
  on public.registrations (registered_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
--   anon         = public browser  (read event, submit registration)
--   service_role = backend only    (bypasses RLS, full access)
-- ---------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.registrations enable row level security;

drop policy if exists "Public can read events" on public.events;
create policy "Public can read events"
  on public.events for select to anon, authenticated
  using (true);

drop policy if exists "Public can register" on public.registrations;
create policy "Public can register"
  on public.registrations for insert to anon, authenticated
  with check (true);

-- Deliberately NO select policy on registrations: QR tokens must not be
-- readable with the public anon key. The backend uses the service_role key.

grant select on public.events to anon, authenticated;
grant insert on public.registrations to anon, authenticated;

-- ---------------------------------------------------------------------
-- Seed data (safe to re-run)
-- ---------------------------------------------------------------------
insert into public.events (name, tagline, description, event_date, start_time, venue, organizer)
select
  'TechNova 2026',
  'Innovate. Build. Celebrate.',
  'The annual inter-department tech fest: hackathon, robotics arena, paper presentations and a live cultural night. Register now and get your digital entry pass.',
  date '2026-12-18',
  time '09:30',
  'Main Auditorium, College Campus',
  'Student Council'
where not exists (select 1 from public.events);

-- ---------------------------------------------------------------------
-- To undo everything (dev only):
-- drop table if exists public.registrations;
-- drop table if exists public.events;
-- drop sequence if exists public.registration_id_seq;
-- ---------------------------------------------------------------------
