# Analytics and product-learning data

The game records privacy-safe, server-authored telemetry so real play can improve game balance, prompt quality, reliability, and match pacing.

## Privacy boundary

Never store or send in analytics:

- player display names;
- session/player UIDs;
- room codes;
- IP addresses;
- user-agent/device fingerprints;
- prompt text (use `promptId` only);
- voter → target mappings;
- raw WebSocket payloads;
- raw exception text/stacks;
- free text.

The allowlist in `server/src/analytics.ts` is the source of truth. Adding a property requires an explicit allowlist change and review.

## Durable storage

The optional durable sink uses Supabase Data REST from the server only. No Supabase secret is exposed to the client.

1. Create a Supabase project.
2. Run `supabase/migrations/202609100001_analytics_events.sql` in the SQL editor.
3. Add these Render environment variables:
   - `SUPABASE_URL=https://<project-ref>.supabase.co`
   - `SUPABASE_SECRET_KEY=sb_secret_...`
4. Keep `ANALYTICS` unset or set it to `on`. Set `ANALYTICS=off` to disable collection entirely.

Legacy `SUPABASE_SERVICE_ROLE_KEY` is accepted as a transition fallback, but new deployments should use `SUPABASE_SECRET_KEY`.

If Supabase is unavailable or misconfigured, gameplay remains available. Telemetry is best-effort and never participates in game-state decisions or readiness checks.

## What we can answer

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
  round(100.0 * avg((properties->>'caught')::boolean::int), 1) as caught_pct
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
  round(100.0 * avg((properties->>'caught')::boolean::int), 1) as caught_pct
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

### Errors

```sql
select properties->>'code' as code, properties->>'action' as action, count(*)
from analytics_events
where event_type = 'game_error'
group by 1, 2
order by 3 desc;
```

## Retention

Start with 90 days of raw telemetry. The data intentionally has no cross-day player identity, so long-lived user profiling is neither possible nor needed for product decisions.
