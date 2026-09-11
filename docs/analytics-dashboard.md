# Analytics dashboard

The product analytics pipeline distinguishes between **visitors** and **players** without storing player names, room codes, gameplay UIDs, raw IP addresses, prompt text, or individual vote mappings.

## Identity semantics

- `analyticsPlayerId` is generated server-side from the existing anonymous HttpOnly session identity using a domain-separated SHA-256 hash.
- It is stable only while that anonymous browser session remains stable (the session cookie currently has a 30-day maximum age).
- Clearing cookies, changing browsers/devices, or session expiry creates a new analytics identity. Therefore unique-player and retention metrics are intentionally pseudonymous approximations of people, not account-level identity.
- Raw IP addresses are not written to `analytics_events`. The runtime may still process an IP transiently for networking, capacity and abuse-rate limiting.

## Metric definitions

- **Unique visitors:** distinct `analyticsPlayerId` values on `client_started` events.
- **Unique players:** distinct `analyticsPlayerId` values on `client_session_summary` events where `summaryKind = match_participation` and `playedMatch = true`.
- **Games started/completed/abandoned:** counts of their respective authoritative server events.
- **Completion rate:** completed games / started games in the selected window.
- **Rematch rate:** rematches started / completed games in the selected window.
- **Retention:** a player is retained on day N when the same pseudonymous session participates in a match N calendar days after its first observed match participation.

## Ready-to-use Supabase queries

Rolling 24 hours:

```sql
select * from public.analytics_last_24h;
```

Daily dashboard:

```sql
select *
from public.analytics_daily_overview
order by day desc
limit 90;
```

Retention cohorts:

```sql
select *
from public.analytics_retention_cohorts
order by cohort_day desc
limit 90;
```

Prompt balance:

```sql
select
  properties->>'promptId' as prompt_id,
  count(*) as challenges,
  round(100.0 * avg(case when (properties->>'caught')::boolean then 1 else 0 end), 1) as catch_rate_pct,
  round(avg((properties->>'discussionSeconds')::numeric), 1) as avg_discussion_seconds,
  round(avg((properties->>'votingSeconds')::numeric), 1) as avg_voting_seconds
from public.analytics_events
where event_type = 'challenge_completed'
  and occurred_at >= now() - interval '30 days'
  and properties ? 'promptId'
group by properties->>'promptId'
having count(*) >= 10
order by challenges desc;
```

Player-count balance:

```sql
select
  (properties->>'startingPlayerCount')::int as players,
  count(*) as games,
  round(avg((properties->>'durationSeconds')::numeric), 1) filter (where event_type = 'game_completed') as avg_completed_seconds
from public.analytics_events
where event_type in ('game_started', 'game_completed')
  and occurred_at >= now() - interval '30 days'
  and properties ? 'startingPlayerCount'
group by 1
order by 1;
```

## Retention and legal operations

Raw analytics are pruned after 180 days by a statement-level database trigger when new analytics arrive. The public privacy notice describes the categories, purpose, pseudonymous identity and retention period.

Pseudonymized identifiers can still be personal data under applicable law. Access to analytics views and raw events remains denied to `anon` and `authenticated`; only the server/service role should query them. Product/legal owners should document the lawful basis for analytics and re-review the notice before materially expanding collection or changing purposes.
