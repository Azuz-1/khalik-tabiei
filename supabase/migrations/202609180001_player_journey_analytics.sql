-- Authoritative pseudonymous player-journey analytics.
-- Links a 30-day anonymous browser identity to room and match lifecycle IDs
-- without storing display names, room codes, raw IP addresses, or gameplay UIDs.

create index if not exists analytics_events_room_player_time_idx
  on public.analytics_events (
    (properties->>'roomSessionId'),
    (properties->>'analyticsPlayerId'),
    occurred_at desc
  )
  where properties ? 'roomSessionId'
    and properties ? 'analyticsPlayerId';

create index if not exists analytics_events_match_player_time_idx
  on public.analytics_events (
    (properties->>'matchId'),
    (properties->>'analyticsPlayerId'),
    occurred_at desc
  )
  where properties ? 'matchId'
    and properties ? 'analyticsPlayerId';

create or replace view public.analytics_room_participants
with (security_invoker = on)
as
select
  properties->>'roomSessionId' as room_session_id,
  properties->>'analyticsPlayerId' as analytics_player_id,
  bool_or(coalesce((properties->>'isOwner')::boolean, false)) as was_owner,
  min(occurred_at) as first_seen_at,
  max(occurred_at) as last_seen_at
from public.analytics_events
where event_type = 'room_participant_joined'
  and properties ? 'roomSessionId'
  and properties ? 'analyticsPlayerId'
group by 1, 2;

create or replace view public.analytics_match_participants
with (security_invoker = on)
as
select
  properties->>'roomSessionId' as room_session_id,
  properties->>'matchId' as match_id,
  (properties->>'matchOrdinal')::int as match_ordinal,
  properties->>'analyticsPlayerId' as analytics_player_id,
  bool_or(coalesce((properties->>'isOwner')::boolean, false)) as was_owner,
  max((properties->>'startingPlayerCount')::int) as starting_player_count,
  max((properties->>'targetChallenges')::int) as target_challenges,
  min(occurred_at) as first_seen_at
from public.analytics_events
where event_type = 'match_participant'
  and properties ? 'roomSessionId'
  and properties ? 'matchId'
  and properties ? 'analyticsPlayerId'
group by 1, 2, 3, 4;

create or replace view public.analytics_player_activity_daily
with (security_invoker = on)
as
select distinct
  occurred_at::date as activity_day,
  properties->>'analyticsPlayerId' as analytics_player_id
from public.analytics_events
where properties ? 'analyticsPlayerId'
  and (
    event_type = 'match_participant'
    or (
      event_type = 'client_session_summary'
      and properties->>'summaryKind' = 'match_participation'
      and properties->>'playedMatch' = 'true'
    )
  );

create or replace view public.analytics_player_journeys
with (security_invoker = on)
as
with match_activity as (
  select
    analytics_player_id,
    min(first_seen_at) as first_played_at,
    max(first_seen_at) as last_played_at,
    count(distinct room_session_id)::bigint as rooms_played,
    count(distinct match_id)::bigint as matches_played,
    count(distinct first_seen_at::date)::bigint as active_play_days
  from public.analytics_match_participants
  group by analytics_player_id
),
room_activity as (
  select
    analytics_player_id,
    min(first_seen_at) as first_room_seen_at,
    max(last_seen_at) as last_room_seen_at,
    count(distinct room_session_id)::bigint as rooms_joined
  from public.analytics_room_participants
  group by analytics_player_id
)
select
  coalesce(m.analytics_player_id, r.analytics_player_id) as analytics_player_id,
  r.first_room_seen_at,
  r.last_room_seen_at,
  m.first_played_at,
  m.last_played_at,
  coalesce(r.rooms_joined, 0)::bigint as rooms_joined,
  coalesce(m.rooms_played, 0)::bigint as rooms_played,
  coalesce(m.matches_played, 0)::bigint as matches_played,
  coalesce(m.active_play_days, 0)::bigint as active_play_days
from match_activity m
full join room_activity r using (analytics_player_id);

create or replace view public.analytics_room_overlap
with (security_invoker = on)
as
with room_sizes as (
  select room_session_id, count(*)::int as participant_count
  from public.analytics_room_participants
  group by room_session_id
),
overlap as (
  select
    a.room_session_id as room_a,
    b.room_session_id as room_b,
    count(*)::int as shared_players
  from public.analytics_room_participants a
  join public.analytics_room_participants b
    on a.analytics_player_id = b.analytics_player_id
   and a.room_session_id < b.room_session_id
  group by 1, 2
)
select
  o.room_a,
  o.room_b,
  o.shared_players,
  a.participant_count as room_a_players,
  b.participant_count as room_b_players,
  round(
    100.0 * o.shared_players / nullif(least(a.participant_count, b.participant_count), 0),
    1
  ) as overlap_pct_of_smaller_room
from overlap o
join room_sizes a on a.room_session_id = o.room_a
join room_sizes b on b.room_session_id = o.room_b;

create or replace view public.analytics_last_24h
with (security_invoker = on)
as
select
  count(distinct properties->>'analyticsPlayerId') filter (
    where event_type = 'client_started'
      and properties ? 'analyticsPlayerId'
  )::bigint as unique_visitors,
  count(distinct properties->>'analyticsPlayerId') filter (
    where properties ? 'analyticsPlayerId'
      and (
        event_type = 'match_participant'
        or (
          event_type = 'client_session_summary'
          and properties->>'summaryKind' = 'match_participation'
          and properties->>'playedMatch' = 'true'
        )
      )
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

create or replace view public.analytics_daily_overview
with (security_invoker = on)
as
select
  occurred_at::date as day,
  count(distinct properties->>'analyticsPlayerId') filter (
    where event_type = 'client_started'
      and properties ? 'analyticsPlayerId'
  )::bigint as unique_visitors,
  count(distinct properties->>'analyticsPlayerId') filter (
    where properties ? 'analyticsPlayerId'
      and (
        event_type = 'match_participant'
        or (
          event_type = 'client_session_summary'
          and properties->>'summaryKind' = 'match_participation'
          and properties->>'playedMatch' = 'true'
        )
      )
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

create or replace view public.analytics_retention_cohorts
with (security_invoker = on)
as
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

revoke all on public.analytics_room_participants from anon, authenticated;
revoke all on public.analytics_match_participants from anon, authenticated;
revoke all on public.analytics_player_activity_daily from anon, authenticated;
revoke all on public.analytics_player_journeys from anon, authenticated;
revoke all on public.analytics_room_overlap from anon, authenticated;
revoke all on public.analytics_last_24h from anon, authenticated;
revoke all on public.analytics_daily_overview from anon, authenticated;
revoke all on public.analytics_retention_cohorts from anon, authenticated;

grant select on public.analytics_room_participants to service_role;
grant select on public.analytics_match_participants to service_role;
grant select on public.analytics_player_activity_daily to service_role;
grant select on public.analytics_player_journeys to service_role;
grant select on public.analytics_room_overlap to service_role;
grant select on public.analytics_last_24h to service_role;
grant select on public.analytics_daily_overview to service_role;
grant select on public.analytics_retention_cohorts to service_role;

comment on view public.analytics_room_participants is
  'Pseudonymous room-membership edges. No display names, room codes, raw IPs, or gameplay UIDs.';
comment on view public.analytics_match_participants is
  'Authoritative server-authored pseudonymous match participation; one row per browser identity per match.';
comment on view public.analytics_room_overlap is
  'Pairwise room membership overlap for identifying returning groups without names or IP addresses.';
comment on view public.analytics_player_journeys is
  'Per-pseudonymous-browser room and match journey metrics within the anonymous session cookie lifetime.';
