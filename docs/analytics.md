# Analytics and product-learning data

The game records privacy-safe telemetry so real play can improve game balance, prompt quality, reliability, UX, device compatibility, and match pacing.

## Privacy boundary

Never store or send in structured analytics:

- player display names;
- session/player UIDs;
- room codes;
- IP addresses;
- raw user-agent strings or persistent device fingerprints;
- exact URLs/paths that could contain a room code;
- prompt text (use `promptId` only);
- voter → target mappings;
- raw WebSocket payloads;
- raw exception text/stacks;
- free text.

The allowlist in `server/src/analytics.ts` is the source of truth. Adding a property requires an explicit allowlist change and review.

Client telemetry deliberately converts potentially identifying browser signals into **coarse low-cardinality buckets before sending**. Examples: browser family instead of the raw user agent, viewport buckets instead of exact screen dimensions, device-memory/hardware-concurrency buckets instead of precise values, and route buckets (`home` / `join` / `other`) instead of URLs. The signed anonymous session is used only transiently to rate-limit telemetry ingestion; it is not written into analytics rows.

The Home suggestion box is the one intentional free-text surface. Its message is stored in a **separate** `suggestions` table that has no player/session identifier, room code, IP, or device fields. IP and signed session UID are used only transiently in process memory for abuse-rate limiting and are never written with the suggestion. Structured analytics receives only the suggestion category and a coarse length bucket, never the message text.

## Durable storage

The optional durable sink uses Supabase Data REST from the server only. No Supabase secret is exposed to the client.

1. Create a Supabase project.
2. Run these migrations in order in the SQL editor:
   - `supabase/migrations/202609100001_analytics_events.sql`
   - `supabase/migrations/202609100002_suggestions.sql`
3. Add these Render environment variables:
   - `SUPABASE_URL=https://<project-ref>.supabase.co`
   - `SUPABASE_SECRET_KEY=sb_secret_...`
4. Keep `ANALYTICS` unset or set it to `on`. Set `ANALYTICS=off` to disable structured telemetry entirely.

Legacy `SUPABASE_SERVICE_ROLE_KEY` is accepted as a transition fallback, but new deployments should use `SUPABASE_SECRET_KEY`.

If Supabase is unavailable or misconfigured, gameplay remains available. Structured telemetry is best-effort and never participates in game-state decisions or readiness checks. The suggestion endpoint fails visibly instead of pretending a free-text suggestion was saved.

## What is collected

Server-authored gameplay telemetry covers room creation, game start/completion, every resolved Challenge, prompt ID, mode, participant count, Challenge/stint position, caught/not-caught result, selected Challenge total, match duration, rematch intent/start, disconnect/reconnect, room closure, and typed game errors.

Anonymous client telemetry adds device/browser compatibility and UX health without storing an identity: device class; coarse viewport; browser/OS family; browser vs standalone display mode; Arabic/English/other language bucket; touch support; coarse network type and Save-Data; reduced-motion preference; coarse CPU/memory/pixel-ratio buckets; orientation; support for audio/vibration/share/Intl.Segmenter/VisualViewport/Network Information APIs; navigation type; TTFB/FCP/load/DOMContentLoaded timings; resource count and transferred KB; LCP/CLS/coarse interaction delay; foreground/background duration; online/offline transitions; resize/orientation changes; and only the **kind** of client error (`runtime`, `resource`, `promise`) without message, stack, filename or URL.

## Product queries

### Funnel

```sql
select
  count(*) filter (where event_type = 'room_created') as rooms_created,
  count(*) filter (where event_type = 'game_started') as games_started,
  count(*) filter (where event_type = 'game_completed') as games_completed
from analytics_events
where occurred_at >= now() - interval '30 days';
```

### Challenge-count popularity

```sql
select
  properties->>'targetChallenges' as challenges,
  count(*) as games
from analytics_events
where event_type = 'game_started'
  and occurred_at >= now() - interval '30 days'
group by 1
order by 1::int;
```

### Player-count mix

```sql
select
  properties->>'startingPlayerCount' as players,
  count(*) as games
from analytics_events
where event_type = 'game_started'
group by 1
order by 1::int;
```

### Prompt catch rate by group size

This is the primary content-quality query. A high catch rate can mean a prompt makes the impostor too easy to identify; a very low catch rate can mean the prompt is too ambiguous.

```sql
select
  properties->>'promptId' as prompt_id,
  (properties->>'participantCount')::int as players,
  count(*) as samples,
  round(100.0 * avg(((properties->>'caught')::boolean)::int), 1) as caught_pct
from analytics_events
where event_type = 'challenge_completed'
group by 1, 2
having count(*) >= 5
order by caught_pct desc, samples desc;
```

### Mode balance

```sql
select
  properties->>'mode' as mode,
  (properties->>'participantCount')::int as players,
  count(*) as challenges,
  round(100.0 * avg(((properties->>'caught')::boolean)::int), 1) as caught_pct
from analytics_events
where event_type = 'challenge_completed'
group by 1, 2
order by 2, 1;
```

### Match duration

```sql
select
  (properties->>'targetChallenges')::int as challenges,
  round(avg((properties->>'durationSeconds')::numeric), 0) as avg_seconds,
  percentile_cont(0.5) within group (order by (properties->>'durationSeconds')::numeric) as median_seconds
from analytics_events
where event_type = 'game_completed'
group by 1
order by 1;
```

### Rematch rate

```sql
select
  count(*) filter (where event_type = 'rematch_started')::numeric
    / nullif(count(*) filter (where event_type = 'game_completed'), 0) as rematch_rate
from analytics_events
where occurred_at >= now() - interval '30 days';
```

### Connection reliability

```sql
select event_type, properties->>'phase' as phase, count(*)
from analytics_events
where event_type in ('player_disconnected', 'player_reconnected')
group by 1, 2
order by 3 desc;
```

### Device/browser mix

```sql
select
  properties->>'deviceClass' as device,
  properties->>'osFamily' as os,
  properties->>'browserFamily' as browser,
  count(*) as starts
from analytics_events
where event_type = 'client_started'
group by 1, 2, 3
order by 4 desc;
```

### Small-screen/device coverage

```sql
select
  properties->>'viewportBucket' as viewport,
  properties->>'deviceClass' as device,
  count(*) as starts
from analytics_events
where event_type = 'client_started'
group by 1, 2
order by 3 desc;
```

### Load performance by device

```sql
select
  s.properties->>'deviceClass' as device,
  p.properties->>'navigationType' as navigation,
  count(*) as samples,
  round(avg((p.properties->>'loadMs')::numeric), 0) as avg_load_ms,
  round(avg((p.properties->>'fcpMs')::numeric), 0) as avg_fcp_ms
from analytics_events p
join lateral (
  select properties
  from analytics_events s
  where s.event_type = 'client_started'
    and s.occurred_at between p.occurred_at - interval '15 seconds' and p.occurred_at + interval '15 seconds'
  order by abs(extract(epoch from (s.occurred_at - p.occurred_at)))
  limit 1
) s on true
where p.event_type = 'client_performance'
group by 1, 2
order by 3 desc;
```

Because client telemetry intentionally has no persistent/session identifier, device/performance correlation is approximate by close timestamp. Use aggregate distributions, not per-user journeys.

### Web-vital distribution

```sql
select
  properties->>'metric' as metric,
  properties->>'rating' as rating,
  count(*) as samples,
  round(avg((properties->>'value')::numeric), 2) as avg_value
from analytics_events
where event_type = 'client_vital'
group by 1, 2
order by 1, 2;
```

### Backgrounding / connectivity pressure

```sql
select
  round(avg((properties->>'foregroundSeconds')::numeric), 0) as avg_foreground_seconds,
  sum((properties->>'backgroundTransitions')::int) as background_transitions,
  sum((properties->>'offlineTransitions')::int) as offline_transitions,
  sum((properties->>'orientationChanges')::int) as orientation_changes
from analytics_events
where event_type = 'client_session_summary';
```

### Client error kinds

```sql
select
  properties->>'kind' as kind,
  properties->>'routeBucket' as surface,
  count(*) as occurrences
from analytics_events
where event_type = 'client_error'
group by 1, 2
order by 3 desc;
```

### Server/game errors

```sql
select properties->>'code' as code, properties->>'action' as action, count(*)
from analytics_events
where event_type = 'game_error'
group by 1, 2
order by 3 desc;
```

### Suggestions inbox

```sql
select id, occurred_at, category, message, deployment_sha
from suggestions
order by occurred_at desc
limit 100;
```

### Suggestion categories over time

```sql
select date_trunc('week', occurred_at) as week, category, count(*)
from suggestions
group by 1, 2
order by 1 desc, 3 desc;
```

## Retention

Start with 90 days of raw structured telemetry. The data intentionally has no cross-day player identity, so long-lived user profiling is neither possible nor needed for product decisions. Suggestions can use the same 90-day default initially, with useful product ideas moved into the normal product backlog before expiry.
