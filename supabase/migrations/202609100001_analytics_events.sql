create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  event_type text not null,
  properties jsonb not null default '{}'::jsonb,
  deployment_sha text not null default 'unknown',
  constraint analytics_events_type_length check (char_length(event_type) between 1 and 64),
  constraint analytics_events_sha_length check (char_length(deployment_sha) between 1 and 64)
);

create index if not exists analytics_events_type_time_idx
  on public.analytics_events (event_type, occurred_at desc);

create index if not exists analytics_events_prompt_group_idx
  on public.analytics_events ((properties->>'promptId'), ((properties->>'participantCount')::int))
  where event_type = 'challenge_completed' and properties ? 'promptId' and properties ? 'participantCount';

alter table public.analytics_events enable row level security;
revoke all on table public.analytics_events from anon, authenticated;
grant insert on table public.analytics_events to service_role;
grant usage, select on sequence public.analytics_events_id_seq to service_role;

comment on table public.analytics_events is
  'Privacy-safe server-authored gameplay telemetry. No player identifiers, room codes, prompt text, IPs, or vote mappings.';
