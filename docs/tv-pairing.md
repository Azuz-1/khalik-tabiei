# TV pairing

`/tv` is the primary living-room setup for the existing read-only Display surface.
It is a transport/authentication UX layer only; it does not create a participant,
join a room, or change the Display projection.

## User flow

1. Open `https://<production-origin>/tv` on the television browser.
2. The TV creates an in-memory pairing session and shows a six-digit code for five minutes.
3. The current room owner opens **📺 العب على التلفزيون**, enters that code, and claims it.
4. The server binds the pairing to the exact current room incarnation: room code,
   room `createdAt`, current `hostUid`, and current Display revocation epoch.
5. The TV polls pairing status with its separate high-entropy bearer secret. The
   six-digit code by itself cannot read pairing status or obtain a Display token.
6. After revalidating the bound room, the server generates the normal existing
   Display HMAC capability and returns it only to that TV request.
7. The TV stores the capability in the current browser history entry and replaces
   the visible URL with `/display/<ROOM>`. The existing Display client then owns
   reconnect, read-only WebSocket authentication, aliases, and public projection.

The pairing secret and Display token are never put in the normal TV URL, query
string, analytics, or application logs. The existing direct Display link/QR is
retained under **خيارات أخرى** for laptops, tablets, spare phones, and HDMI devices.

## Security and lifecycle

- Human codes are exactly six random digits and unique among active pairings.
- Pairings expire after five minutes and are single-binding. Exact same-room claim
  retries are idempotent; another room cannot rebind the session.
- The registry is process-local and capped at 5,000 active entries. Expiry cleanup
  is opportunistic, so there is no pairing timer/test handle to leak.
- Only a signed anonymous session that is the authoritative current room owner may
  claim a code. Claims use a tight per-owner rate limit plus a roomier per-IP limit
  for shared-NAT parties.
- TV creation and high-entropy status polling have independent bounded limits.
- Ownership transfer, room-code reuse/new `createdAt`, explicit Display revocation,
  or any Display epoch change makes an older pairing binding unusable.
- A room with another active Display rejects a new pairing claim with
  `DISPLAY_IN_USE`; it does not silently kick the existing screen.
- Pairing status revalidates the room before releasing the existing Display token;
  old pairings are never silently upgraded to a newer owner or revocation epoch.
- Pairing state follows the same single-process lifecycle as authoritative rooms.
  A process restart can remove a pending pairing, in which case the TV creates a
  new code. No Redis/database or horizontal-replica coordination is introduced.

For the best living-room experience, production can map a short custom domain to
the existing service and use its `/tv` path. The application itself always uses
the current origin and does not hard-code a fictional production hostname.
