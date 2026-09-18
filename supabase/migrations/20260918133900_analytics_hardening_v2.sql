-- Analytics hardening v2.
-- Adds idempotent event delivery metadata, explicit environment/schema semantics,
-- Riyadh reporting days, authoritative player activation, and client-session views.

alter table public.analytics_events
  add column if not exists event_id uuid,
  add column if not exists schema_version smallint not null default 1,
  add column if not exists environment text not null default 'legacy';

alter table public.analytics_events
  drop constraint if exists analytics_events_event_id_key;
alter table public.analytics_events
  add constraint analytics_events_event_id_key unique (event_id);

alter table public.analytics_events
  drop constraint if exists analytics_events_schema_version_check;
alter table public.analytics_events
  add constraint analytics_events_schema_version_check
  check (schema_version between 1 and 32767);

alter table public.analytics_events
  drop constraint if exists analytics_events_environment_check;
alter table public.analytics_events
  add constraint analytics_events_environment_check
  check (environment in ('legacy', 'production', 'staging', 'development', 'test'));

alter table public.analytics_events
  drop constraint if exists analytics_events_v2_requires_event_id;
alter table public.analytics_events
  add constraint analytics_events_v2_requires_event_id
  check (schema_version < 2 or event_id is not null);

create index if not exists analytics_events_environment_time_idx
  on public.analytics_events (environment, occurred_at desc);

comment on table public.analytics_events is
  'Server-authored and allowlisted product telemetry. May contain a bounded pseudonymous browser analytics identity; does not contain player names, raw gameplay UIDs, room codes, raw IP addresses, prompt text, or voter-to-target mappings.';

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
  and (schema_version = 1 or environment = 'production')
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
  and (schema_version = 1 or environment = 'production')
group by 1, 2, 3, 4;

create or replace view public.analytics_player_activity_daily
with (security_invoker = on)
as
select distinct
  (occurred_at at time zone 'Asia/Riyadh')::date as activity_day,
  properties->>'analyticsPlayerId' as analytics_player_id
from public.analytics_events
where properties ? 'analyticsPlayerId'
  and (
    (
      schema_version >= 2
      and environment = 'production'
      and event_type = 'match_participant'
    )
    or
    (
      schema_version = 1
      and event_type = 'client_session_summary'
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
    count(distinct (first_seen_at at time zone 'Asia/Riyadh')::date)::bigint as active_play_days
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
with room_members as (
  select
    room_session_id,
    analytics_player_id,
    min(first_seen_at) as first_seen_at
  from public.analytics_room_participants
  group by room_session_id, analytics_player_id
),
rooms as (
  select
    room_session_id,
    count(*)::int as participant_count,
    min(first_seen_at) as first_seen_at
  from room_members
  group by room_session_id
),
pairs as (
  select
    a.room_session_id as room_a,
    b.room_session_id as room_b,
    count(*)::int as shared_players
  from room_members a
  join room_members b
    on a.analytics_player_id = b.analytics_player_id
   and a.room_session_id <> b.room_session_id
  join rooms ra on ra.room_session_id = a.room_session_id
  join rooms rb on rb.room_session_id = b.room_session_id
  where ra.first_seen_at < rb.first_seen_at
     or (
       ra.first_seen_at = rb.first_seen_at
       and a.room_session_id < b.room_session_id
     )
  group by 1, 2
)
select
  p.room_a,
  p.room_b,
  p.shared_players,
  a.participant_count as room_a_players,
  b.participant_count as room_b_players,
  round(
    100.0 * p.shared_players
    / nullif(least(a.participant_count, b.participant_count), 0),
    1
  ) as overlap_pct_of_smaller_room,
  round(
    100.0 * p.shared_players
    / nullif(a.participant_count + b.participant_count - p.shared_players, 0),
    1
  ) as jaccard_pct,
  a.first_seen_at as room_a_first_seen_at,
  b.first_seen_at as room_b_first_seen_at
from pairs p
join rooms a on a.room_session_id = p.room_a
join rooms b on b.room_session_id = p.room_b;

create or replace view public.analytics_last_24h
with (security_invoker = on)
as
select
  count(distinct properties->>'analyticsPlayerId') filter (
    where event_type = 'client_started'
      and properties ? 'analyticsPlayerId'
      and (schema_version = 1 or environment = 'production')
  )::bigint as unique_visitors,
  count(distinct properties->>'analyticsPlayerId') filter (
    where properties ? 'analyticsPlayerId'
      and (
        (
          schema_version >= 2
          and environment = 'production'
          and event_type = 'match_participant'
        )
        or
        (
          schema_version = 1
          and (
            event_type = 'match_participant'
            or (
              event_type = 'client_session_summary'
              and properties->>'summaryKind' = 'match_participation'
              and properties->>'playedMatch' = 'true'
            )
          )
        )
      )
  )::bigint as unique_players,
  count(*) filter (
    where event_type = 'game_started'
      and (schema_version = 1 or environment = 'production')
  )::bigint as games_started,
  count(*) filter (
    where event_type = 'game_completed'
      and (schema_version = 1 or environment = 'production')
  )::bigint as games_completed,
  count(*) filter (
    where event_type = 'game_abandoned'
      and (schema_version = 1 or environment = 'production')
  )::bigint as games_abandoned,
  count(*) filter (
    where event_type = 'room_created'
      and (schema_version = 1 or environment = 'production')
  )::bigint as rooms_created,
  count(*) filter (
    where event_type = 'rematch_started'
      and (schema_version = 1 or environment = 'production')
  )::bigint as rematches_started,
  count(*) filter (
    where event_type in ('game_error', 'client_error')
      and (schema_version = 1 or environment = 'production')
  )::bigint as error_events,
  round(
    100.0 * count(*) filter (
      where event_type = 'game_completed'
        and (schema_version = 1 or environment = 'production')
    )
    / nullif(count(*) filter (
      where event_type = 'game_started'
        and (schema_version = 1 or environment = 'production')
    ), 0),
    1
  ) as completion_rate_pct,
  round(
    100.0 * count(*) filter (
      where event_type = 'rematch_started'
        and (schema_version = 1 or environment = 'production')
    )
    / nullif(count(*) filter (
      where event_type = 'game_completed'
        and (schema_version = 1 or environment = 'production')
    ), 0),
    1
  ) as rematch_rate_pct
from public.analytics_events
where occurred_at >= now() - interval '24 hours';

create or replace view public.analytics_daily_overview
with (security_invoker = on)
as
select
  (occurred_at at time zone 'Asia/Riyadh')::date as day,
  count(distinct properties->>'analyticsPlayerId') filter (
    where event_type = 'client_started'
      and properties ? 'analyticsPlayerId'
      and (schema_version = 1 or environment = 'production')
  )::bigint as unique_visitors,
  count(distinct properties->>'analyticsPlayerId') filter (
    where properties ? 'analyticsPlayerId'
      and (
        (
          schema_version >= 2
          and environment = 'production'
          and event_type = 'match_participant'
        )
        or
        (
          schema_version = 1
          and (
            event_type = 'match_participant'
            or (
              event_type = 'client_session_summary'
              and properties->>'summaryKind' = 'match_participation'
              and properties->>'playedMatch' = 'true'
            )
          )
        )
      )
  )::bigint as unique_players,
  count(*) filter (
    where event_type = 'game_started'
      and (schema_version = 1 or environment = 'production')
  )::bigint as games_started,
  count(*) filter (
    where event_type = 'game_completed'
      and (schema_version = 1 or environment = 'production')
  )::bigint as games_completed,
  count(*) filter (
    where event_type = 'game_abandoned'
      and (schema_version = 1 or environment = 'production')
  )::bigint as games_abandoned,
  count(*) filter (
    where event_type = 'rematch_started'
      and (schema_version = 1 or environment = 'production')
  )::bigint as rematches_started,
  round(avg((properties->>'startingPlayerCount')::numeric) filter (
    where event_type = 'game_started'
      and properties ? 'startingPlayerCount'
      and (schema_version = 1 or environment = 'production')
  ), 2) as avg_starting_players,
  round(avg((properties->>'durationSeconds')::numeric) filter (
    where event_type = 'game_completed'
      and properties ? 'durationSeconds'
      and (schema_version = 1 or environment = 'production')
  ), 2) as avg_completed_game_seconds
from public.analytics_events
where schema_version = 1 or environment = 'production'
group by 1;

drop view if exists public.analytics_retention_cohorts;
create view public.analytics_retention_cohorts
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
  round(
    100.0 * count(*) filter (
      where exists (
        select 1 from player_days p
        where p.analytics_player_id = c.analytics_player_id
          and p.activity_day = c.cohort_day + 1
      )
    ) / nullif(count(*), 0),
    1
  ) as day_1_retention_pct,
  round(
    100.0 * count(*) filter (
      where exists (
        select 1 from player_days p
        where p.analytics_player_id = c.analytics_player_id
          and p.activity_day = c.cohort_day + 7
      )
    ) / nullif(count(*), 0),
    1
  ) as day_7_retention_pct
from cohorts c
group by c.cohort_day
order by c.cohort_day desc;

create or replace view public.analytics_client_sessions
with (security_invoker = on)
as
select
  properties->>'clientSessionId' as client_session_id,
  max(properties->>'analyticsPlayerId') filter (
    where properties ? 'analyticsPlayerId'
  ) as analytics_player_id,
  min(occurred_at) filter (
    where event_type = 'client_started'
  ) as started_at,
  min(occurred_at) filter (
    where event_type = 'client_session_summary'
      and properties->>'summaryKind' = 'match_session_marker'
      and properties->>'playedMatch' = 'true'
  ) as first_match_seen_at,
  max(occurred_at) as last_event_at,
  sum(
    coalesce(nullif(properties->>'foregroundSeconds', '')::numeric, 0)
  ) filter (
    where event_type = 'client_session_summary'
  ) as foreground_seconds
from public.analytics_events
where environment = 'production'
  and schema_version >= 2
  and properties ? 'clientSessionId'
group by properties->>'clientSessionId';

revoke all on public.analytics_room_participants from anon, authenticated;
revoke all on public.analytics_match_participants from anon, authenticated;
revoke all on public.analytics_player_activity_daily from anon, authenticated;
revoke all on public.analytics_player_journeys from anon, authenticated;
revoke all on public.analytics_room_overlap from anon, authenticated;
revoke all on public.analytics_last_24h from anon, authenticated;
revoke all on public.analytics_daily_overview from anon, authenticated;
revoke all on public.analytics_retention_cohorts from anon, authenticated;
revoke all on public.analytics_client_sessions from anon, authenticated;

grant select on public.analytics_room_participants to service_role;
grant select on public.analytics_match_participants to service_role;
grant select on public.analytics_player_activity_daily to service_role;
grant select on public.analytics_player_journeys to service_role;
grant select on public.analytics_room_overlap to service_role;
grant select on public.analytics_last_24h to service_role;
grant select on public.analytics_daily_overview to service_role;
grant select on public.analytics_retention_cohorts to service_role;
grant select on public.analytics_client_sessions to service_role;

comment on view public.analytics_room_overlap is
  'Directional pairwise room membership overlap with overlap coefficient and Jaccard similarity; no permanent party identifier.';
comment on view public.analytics_client_sessions is
  'Best-effort browser page-session telemetry for timing and diagnostics; not an authentication credential or authoritative player identity.';
comment on view public.analytics_retention_cohorts is
  'Browser-level D1/D7 activated-player retention using Asia/Riyadh product calendar days. D30 is intentionally omitted because the current identity horizon does not support a clean D30 measure.';
