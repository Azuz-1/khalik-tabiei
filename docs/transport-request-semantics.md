# Request acknowledgement semantics

Protocol-v2 action requests carry a client-generated bounded request ID. The server validates and authorizes the action first, then sends `ACK`; expected failures return `ERROR` with the same ID.

The server retains only a bounded recent cache per signed anonymous identity. A cached success is reusable only when both the action payload and the authoritative post-action context match the caller's current room/match/round/phase context. Conflicting or stale-context reuse returns `BAD_REQUEST`.

A client can also clear a pending indicator when an authoritative `STATE` proves the requested change already happened. This is only UI settlement; it does not make client state authoritative.

The client never retries state-changing requests automatically after reconnect. In particular it never replays votes, kicks, leave, close, or rematch actions.
