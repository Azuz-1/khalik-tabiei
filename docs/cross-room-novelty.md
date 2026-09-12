# Cross-room prompt novelty

This feature is a UX repeat-avoidance layer, not an authentication or security identity.

- Each participant browser stores a versioned 3 KiB Bloom filter in local site storage.
- A prompt is recorded only after the server has made that prompt public to that participant.
- The internal `promptId` remains server-only. A stable opaque novelty token derived from the prompt identity is exposed only at the public reveal boundary.
- Browsers send the compressed filter when creating/joining a room and after a newly public prompt is recorded.
- The server validates version, exact encoded length and base64url shape, decodes the filter, and keeps it only in in-memory room state.
- Prompt selection unions filters for current challenge participants and prefers candidates that are not probably present in that union.
- `usedPromptIds` is the authoritative exact no-repeat mechanism for the room session and survives rematches and roster/mode changes.
- When one mode has consumed all 300 prompts, only that mode's exact history is reset; other modes keep their history.
- If every otherwise-valid candidate appears seen in the advisory Bloom history (including an all-ones malicious filter), the picker falls back to the normal exact room-session eligible pool. Novelty data can never block gameplay or alter scoring, voting, roles or timers.
- The browser filter is never reset merely because a mode is exhausted. A saturated mode only falls back for that selection.
- The Bloom filter is compression, not encryption or anonymization. With a known finite prompt universe, approximate membership can be tested by the server.
- Novelty history is not sent to analytics and is not keyed by IP. Stale room entries are ignored once a player leaves because selection only considers current participants, and all room copies disappear when the room is destroyed.
- Clearing site data, private browsing, or using a different browser/device starts a fresh local history.

A brand-new room starts with an empty exact `usedPromptIds` set, but participant browsers may still contribute their advisory cross-room Bloom history. For v1 the filter uses 24,576 bits and 18 hash positions. At 900 inserted prompts, the modeled false-positive probability is about 0.000203% (roughly 1 in 494,000). A false positive can make an unseen prompt temporarily look seen; it cannot make a successfully recorded prompt look unseen.
