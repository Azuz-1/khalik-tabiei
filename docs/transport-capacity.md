# Transport capacity defaults

The WebSocket admission layer defaults to 4,000 concurrent sockets process-wide and 64 concurrent sockets per validated source IP. The per-IP default is deliberately above one Host plus ten player phones and allows reconnect overlap on shared Wi-Fi/NAT.

Room creation also uses both a coarse source-IP window and a tighter signed-identity window. This is defense in depth rather than person identification; a signed anonymous UID represents one browser identity, not a human being.

Empty Lobby expiry is configurable and is based on product-meaningful activity rather than heartbeat, reconnect, broadcast, rejected actions, or settings spam. Expired empty Lobbies are synchronously reclaimed before active-room capacity is rejected.
