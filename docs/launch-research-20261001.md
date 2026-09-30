# Launch research and benchmarks — 1 October 2026

Shared by both games (خلك طبيعي and لعبتنا اليوم). Each figure names its source. Figures
marked **estimate** were not measured. Secondary sources (blogs, aggregators) are marked
as such and should be read as indicative only.

## 1. Who plays, on what network and phone

| Fact | Figure | Source | What it means for us |
| --- | --- | --- | --- |
| Saudi mobile internet | Median download 216 Mbps, latency 24 ms (CST Saudi Internet Report, July 2026) | [Saudi Expatriates summary of the CST report](https://www.saudi-expatriates.com/2026/07/saudi-arabia-internet-speed-216-mbps-cst-report.html) (secondary) | Bandwidth is not the constraint; server distance and cold starts are. |
| Riyadh → Frankfurt round trip | ≈ 92 ms | [WonderNetwork pings](https://wondernetwork.com/pings/Riyadh/Frankfurt) | Game 2 (Frankfurt) is well placed. |
| Riyadh → US west coast (game 1 is in Oregon) | ≈ 240 ms or more (**estimate** from the Riyadh → Seattle series) | [WonderNetwork pings](https://wondernetwork.com/pings/Riyadh/Seattle) | Every action on game 1 pays ~2.5× the Frankfurt round trip. Moving the service to Frankfurt is the cheapest latency win (owner decision; region change means creating a new Render service). |
| iOS vs Android share, Saudi Arabia | Volatile panel: June 2026 Android ~69% / iOS ~31%; August iOS ~52% | [StatCounter mobile OS, Saudi Arabia](https://gs.statcounter.com/os-market-share/mobile/saudi-arabia) | Treat both as primary. Real-device testing needs at least one current iPhone (Safari) and one Samsung (Chrome). |
| WhatsApp reach | Most used app; 90–94% of internet users (CST 2025, reported) | [CairoScene](https://cairoscene.com/News/WhatsApp-Leads-Social-Media-Use-in-Saudi-Arabia) (secondary) | Invites travel through WhatsApp. Both games now ship Arabic link previews. |
| Gamers | ≈ 23.5 million players in the Kingdom (reported market figure) | [IMARC Saudi gaming market](https://www.imarcgroup.com/saudi-arabia-gaming-market) (secondary) | Large audience; party/couple games are an under-served niche in Arabic. |

## 2. Hosting limits that affect players

| Limit | Source | Impact |
| --- | --- | --- |
| Render free web services spin down after 15 minutes without inbound traffic; the next request waits about a minute. | [Render free tier docs](https://render.com/docs/free) | First player of the evening waits ~1 min, and a room's server restarts lose in-memory rooms. Paid instance (~$7/month Starter) removes spin-down. **Owner decision**, not changed by us. |
| Supabase free projects pause after 7 days of inactivity. | [Supabase docs: free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) | Game 2 depends on Supabase for identity and rooms; a paused project breaks the game until resumed. Game 1 only loses analytics. |
| Render sets `RENDER_EXTERNAL_URL` for web services and static sites. | [Render environment variables](https://render.com/docs/environment-variables) | Used by game 2's build to make the link-preview image URL absolute. |

## 3. Performance budgets

| Budget | Threshold | Source | Where we stand (lab, throttled mobile profile) |
| --- | --- | --- | --- |
| Largest Contentful Paint | ≤ 2.5 s at p75 | [web.dev Core Web Vitals](https://web.dev/articles/vitals) | Game 2: 2.05 s median after the overnight bundle fix (was 2.38 s in the same session). Game 1: see its release doc. |
| Interaction to Next Paint | ≤ 200 ms | [web.dev INP](https://web.dev/articles/inp) | Needs real-device field data; not measurable honestly in the lab. |
| Cumulative Layout Shift | ≤ 0.1 | [web.dev CLS](https://web.dev/articles/cls) | No overflow/shift defects found in rendered reviews. |
| Response-time limits | 0.1 s feels instant, 1 s keeps flow, 10 s loses attention | [Nielsen Norman Group](https://www.nngroup.com/articles/response-times-3-important-limits/) | Game 2 action ACK p95 ≈ 20 ms on localhost up to 1,600 concurrent pairs; add network RTT on top. |

## 4. Testing with people

| Guidance | Source | Recommendation |
| --- | --- | --- |
| ~5 users find most usability problems in one round; iterate rather than test once with many. | [NN/g: why you only need 5 users](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/) | Run 2–3 small rounds, fixing between them. |
| Game playtests: plan around 5–6 players per round, more for balancing. | [Games User Research](https://gamesuserresearch.com/how-many-players-do-i-need-for-a-playtest/) | Game 1: two groups of 5–6 strangers-to-the-game. Game 2: 3–5 couples. |

## 5. Retention benchmarks (what "good" looks like after launch)

| Metric | Typical mobile games | Source |
| --- | --- | --- |
| Day 1 | ~25–40% (casual at the upper end) | [AppAgent](https://appagent.com/blog/mobile-game-retention-benchmarks/), [GameGrowthAdvisor](https://gamegrowthadvisor.com/blog/2026-03-17-mobile-game-retention-strategies-2026/) (secondary) |
| Day 7 | ~12–18% | same |
| Day 30 | ~5–8% | same |

For a party game the better unit is the **group**: "did this room play a second match?" and
"did this room come back within 7 days?". Both games already emit the events needed
(rematch / new match in the same room); owner trials are now excluded via `?trial=1` in game 1
and the `test` environment in game 2.

## 6. Design evidence

| Finding | Source | Applied |
| --- | --- | --- |
| Spyfall-style hidden-role games: reviewers praise the timer for pace and pressure; complaints concentrate on the spy's guessing burden and on groups that stall. | [Meeple Like Us: Spyfall](https://www.meeplelikeus.co.uk/spyfall-2014/), [The Board Game Family](https://www.theboardgamefamily.com/2019/12/spyfall-party-game-review/) | Game 1 keeps its timed phases; the new last-5-seconds voting reminder targets the missed-ballot problem seen in owner trials (16%). |
| Couple apps: a study of 405 couples using the Agapé app for a month reported 93% found it enjoyable and 80% saw relationship improvement; more use correlated with greater gains. | [Behavioral Sciences 16(7):1182](https://www.mdpi.com/2076-328X/16/7/1182) | Supports short, daily, joint prompts — the shape of game 2's sessions. |
| Paired app mixed-methods evaluation: 64.3% of users past one month said their relationship felt stronger. | [JMIR / PMC12001865](https://pmc.ncbi.nlm.nih.gov/articles/PMC12001865/) | Same; also a reminder that these are self-reports from engaged users. |

## 7. Legal

| Requirement | Source | Status |
| --- | --- | --- |
| Saudi PDPL in force since September 2023 (enforced by SDAIA): a privacy notice is required when collecting personal data, including pseudonymous identifiers linked to a device. | [SDAIA PDPL knowledge centre](https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/GPDPL/) | Both games show privacy text; the owner should have it reviewed once by someone qualified in Saudi law before a public launch. Not legal advice. |
