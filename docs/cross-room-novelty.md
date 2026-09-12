# Cross-room prompt novelty

This feature is a UX repeat-avoidance layer, not an authentication or security identity.

- Each participant browser stores a versioned **exact bitset (v2)** in local site storage: 1,536 bits / 192 raw bytes / 256 base64url characters.
- The 900 active prompts map to stable, reorder-independent history slots. The current bank has one unique slot per prompt, with reserved append-only room inside each mode block.
- A prompt is recorded only after the server has made that prompt public to that participant.
- The internal `promptId` remains server-only. Only an opaque history-slot token is exposed to participating players at the public reveal boundary; Host/Display/spectator views do not receive it.
- Browsers send the versioned exact bitset when creating/joining a room and after a newly public prompt is recorded.
- The server validates version, exact encoded length and base64url shape, decodes the bitset, and keeps the participant copies only in in-memory room state.
- Prompt selection unions histories for the current challenge participants. If any prompt in the selected mode is exact-unseen by all current participants, the picker is restricted to those unseen prompts.
- `usedPromptIds` remains current-match duplicate protection and is cleared when a new match starts or the match is aborted back to the lobby.
- A separate server-only room-session history survives rematches/abandon within that room and is used only as a secondary preference inside the current-player eligible pool. It must never force a repeat while an exact-unseen prompt exists for the current participants.
- When all 300 prompts of a mode are exhausted for the room-session preference, only that mode's session history is recycled. Other modes keep their history.
- Missing, stale, malformed, unavailable-storage, or all-ones browser history fails open: it cannot block gameplay or alter scoring, voting, roles, timers, authority, or phase flow.
- The exact bitset is compact representation, not encryption or anonymization. Because the prompt universe and slot mapping are known to the server, the server can test membership for known prompts.
- Novelty history is not sent to analytics and is not keyed by IP, account, name, or device fingerprint. Room copies disappear when the room is destroyed.
- Clearing site data, private browsing, or using a different browser/device starts a fresh local browser history.

A brand-new room starts with empty server-side room-session history, while participant browsers can still contribute exact history learned in earlier rooms. The guarantee therefore applies to history actually supplied by the current participants' browsers; it cannot recognize the same physical person after site data is cleared or when they use a different browser/device without introducing a durable identity mechanism.
