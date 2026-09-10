create table if not exists public.suggestions (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  category text not null,
  message text not null,
  deployment_sha text not null default 'unknown',
  constraint suggestions_category_check check (category in ('idea', 'content', 'bug', 'other')),
  constraint suggestions_message_length check (char_length(message) between 4 and 600),
  constraint suggestions_sha_length check (char_length(deployment_sha) between 1 and 64)
);

create index if not exists suggestions_time_category_idx
  on public.suggestions (occurred_at desc, category);

alter table public.suggestions enable row level security;
revoke all on table public.suggestions from anon, authenticated;
grant insert, select, update, delete on table public.suggestions to service_role;
grant usage, select on sequence public.suggestions_id_seq to service_role;

comment on table public.suggestions is
  'Optional anonymous product suggestions. Intentionally contains no room code, player/session identifier, IP address, or device fingerprint.';
