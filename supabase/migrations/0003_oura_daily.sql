-- Stage 13 — server mirror of the cached Oura health data.
--
-- Oura Daily Readiness + Daily Stress are EXTERNALLY-sourced health metrics, not
-- user-authored `records`, so they get their own table rather than riding the
-- sync envelope. The isolation/security pattern is identical to `records`
-- (0001): per-user rows, Row-Level Security on auth.uid(), encryption in transit
-- + at rest, and table privileges only for the `authenticated` role.
--
-- NOTE (auth seam): the client persists this cache locally today; writing it to
-- this table is wired only once real Oura auth + an ingest path land (see
-- specs/stage-13-oura-integration.md). The schema ships now so the pattern is set.

-- One normalised summary per user per calendar day (matches core OuraDaySummary).
create table oura_daily (
  user_id              uuid    not null references auth.users (id) on delete cascade,
  day                  text    not null,            -- "YYYY-MM-DD" (active-zone day)
  readiness_score      integer,                      -- 1-100, null when absent
  temperature_deviation double precision,
  readiness_instant    bigint,                       -- epoch ms, null when absent
  stress_high_seconds  integer,
  recovery_high_seconds integer,
  stress_day_summary   text check (
    stress_day_summary is null
    or stress_day_summary in ('restored', 'normal', 'stressful')
  ),
  updated_at           bigint  not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- Row-Level Security (same shape as records: the owner is the verified JWT).
-- ---------------------------------------------------------------------------
alter table oura_daily enable row level security;

create policy oura_daily_select on oura_daily
  for select using (user_id = auth.uid());

create policy oura_daily_modify on oura_daily
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The signed-in role reads/writes its own rows; anon gets nothing.
grant select, insert, update, delete on oura_daily to authenticated;
