-- Privacy-conscious product analytics helpers.
-- Pseudonymous ids are session-scoped analytics identifiers, not gameplay UIDs.

create index if not exists analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at desc);

create index if not exists analytics_events_player_time_idx
  on public.analytics_events ((properties->>'analyticsPlayerId'), occurred_at desc)
  where properties ? 'analyticsPlayerId';

grant select on table public.analytics_events to service_role;

create or replace view public.analytics_last_24h as
select
  count(distinct properties->>'analyticsPlayerId') filter (
    where event_type = 'client_started'
      and properties ? 'analyticsPlayerId'
  )::bigint as unique_visitors,
  count(distinct properties->>'analyticsPlayerId') filter (
    where event_type = 'client_session_summary'
      and properties->>'summaryKind' = 'match_participation'
      and properties->>'playedMatch' = 'true'
      and properties ? 'analyticsPlayerId'
  )::bigint as unique_players,
  count(*) filter (where event_type = 'game_started')::bigint as games_started,
  count(*) filter (where event_type = 'game_completed')::bigint as games_completed,
  count(*) filter (where event_type = 'game_abandoned')::bigint as games_abandoned,
  count(*) filter (where event_type = 'room_created')::bigint as rooms_created,
  count(*) filter (where event_type = 'rematch_started')::bigint as rematches_started,
  count(*) filter (where event_type in ('game_error', 'client_error'))::bigint as error_events,
  round(
    100.0 * count(*) filter (where event_type = 'game_completed')
    / nullif(count(*) filter (where event_type = 'game_started'), 0),
    1
  ) as completion_rate_pct,
  round(
    100.0 * count(*) filter (where event_type = 'rematch_started')
    / nullif(count(*) filter (where event_type = 'game_completed'), 0),
    1
  ) as rematch_rate_pct
from public.analytics_events
where occurred_at >= now() - interval '24 hours';

create or replace view public.analytics_daily_overview as
select
  occurred_at::date as day,
  count(distinct properties->>'analyticsPlayerId') filter (
    where event_type = 'client_started'
      and properties ? 'analyticsPlayerId'
  )::bigint as unique_visitors,
  count(distinct properties->>'analyticsPlayerId') filter (
    where event_type = 'client_session_summary'
      and properties->>'summaryKind' = 'match_participation'
      and properties->>'playedMatch' = 'true'
      and properties ? 'analyticsPlayerId'
  )::bigint as unique_players,
  count(*) filter (where event_type = 'game_started')::bigint as games_started,
  count(*) filter (where event_type = 'game_completed')::bigint as games_completed,
  count(*) filter (where event_type = 'game_abandoned')::bigint as games_abandoned,
  count(*) filter (where event_type = 'rematch_started')::bigint as rematches_started,
  round(avg((properties->>'startingPlayerCount')::numeric) filter (
    where event_type = 'game_started' and properties ? 'startingPlayerCount'
  ), 2) as avg_starting_players,
  round(avg((properties->>'durationSeconds')::numeric) filter (
    where event_type = 'game_completed' and properties ? 'durationSeconds'
  ), 2) as avg_completed_game_seconds
from public.analytics_events
group by occurred_at::date;

create or replace view public.analytics_player_activity_daily as
select distinct
  occurred_at::date as activity_day,
  properties->>'analyticsPlayerId' as analytics_player_id
from public.analytics_events
where event_type = 'client_session_summary'
  and properties->>'summaryKind' = 'match_participation'
  and properties->>'playedMatch' = 'true'
  and properties ? 'analyticsPlayerId';

create or replace view public.analytics_retention_cohorts as
with player_days as (
  select activity_day, analytics_player_id
  from public.analytics_player_activity_daily
),
cohorts as (
  select analytics_player_id, min(activity_day) as cohort_day
  from player_days
  group by analytics_player_id
)
select
  c.cohort_day,
  count(*)::bigint as cohort_size,
  count(*) filter (
    where exists (
      select 1 from player_days p
      where p.analytics_player_id = c.analytics_player_id
        and p.activity_day = c.cohort_day + 1
    )
  )::bigint as returned_day_1,
  count(*) filter (
    where exists (
      select 1 from player_days p
      where p.analytics_player_id = c.analytics_player_id
        and p.activity_day = c.cohort_day + 7
    )
  )::bigint as returned_day_7,
  count(*) filter (
    where exists (
      select 1 from player_days p
      where p.analytics_player_id = c.analytics_player_id
        and p.activity_day = c.cohort_day + 30
    )
  )::bigint as returned_day_30,
  round(100.0 * count(*) filter (
    where exists (
      select 1 from player_days p
      where p.analytics_player_id = c.analytics_player_id
        and p.activity_day = c.cohort_day + 1
    )
  ) / nullif(count(*), 0), 1) as day_1_retention_pct,
  round(100.0 * count(*) filter (
    where exists (
      select 1 from player_days p
      where p.analytics_player_id = c.analytics_player_id
        and p.activity_day = c.cohort_day + 7
    )
  ) / nullif(count(*), 0), 1) as day_7_retention_pct,
  round(100.0 * count(*) filter (
    where exists (
      select 1 from player_days p
      where p.analytics_player_id = c.analytics_player_id
        and p.activity_day = c.cohort_day + 30
    )
  ) / nullif(count(*), 0), 1) as day_30_retention_pct
from cohorts c
group by c.cohort_day
order by c.cohort_day desc;

revoke all on public.analytics_last_24h from anon, authenticated;
revoke all on public.analytics_daily_overview from anon, authenticated;
revoke all on public.analytics_player_activity_daily from anon, authenticated;
revoke all on public.analytics_retention_cohorts from anon, authenticated;
grant select on public.analytics_last_24h to service_role;
grant select on public.analytics_daily_overview to service_role;
grant select on public.analytics_player_activity_daily to service_role;
grant select on public.analytics_retention_cohorts to service_role;

-- Raw analytics retention: keep at most 180 days. A statement-level trigger
-- prunes old rows whenever a new analytics batch is inserted, avoiding a hard
-- dependency on pg_cron while still enforcing rolling retention in active use.
create or replace function public.prune_old_analytics_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.analytics_events
  where occurred_at < now() - interval '180 days';
  return null;
end;
$$;

revoke all on function public.prune_old_analytics_events() from public, anon, authenticated;

drop trigger if exists analytics_events_prune_old on public.analytics_events;
create trigger analytics_events_prune_old
after insert on public.analytics_events
for each statement execute function public.prune_old_analytics_events();

comment on view public.analytics_last_24h is
  'Rolling 24-hour product overview. unique_players means distinct pseudonymous sessions that participated in an active match.';
comment on view public.analytics_retention_cohorts is
  'Day-1/day-7/day-30 retention by pseudonymous anonymous-session identity; browser cookie resets can lower measured retention.';
