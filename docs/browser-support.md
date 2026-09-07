# Browser support and release checks

Chrome, Safari, and Samsung Internet are required release targets. Use current
stable browser and operating-system versions; old versions are not certified by
the automated suite. Record the exact app revision, browser version, OS, and
device when checking a release.

## Automated coverage

The existing `browser` CI job runs the entire Playwright suite on:

- Chromium, with the runtime matched to the pinned Playwright runner.
- Google Chrome stable, using the actual `chrome` channel.
- WebKit, with the runtime matched to the pinned Playwright runner.

Each project covers Host and Player flows, Arabic RTL, small and large touch
viewports, ten-player rosters, dialogs and focus, network loss and authenticated
seat recovery, a full match with production timers, voting/scoring privacy,
optional feedback, and local fonts. No project is allowed to fail silently.

WebKit is an early warning for Safari engine compatibility, not a run of Apple's
Safari app. Chromium/mobile emulation is not Samsung Internet. A Samsung user
agent string would not change that. Automation also does not reproduce phone
locking, OS suspension, the on-screen keyboard, or Wi-Fi/cellular handover.

## Required real-device release check

These checks remain unverified until someone records actual device results:

| Target | Representative device |
| --- | --- |
| Chrome on Android | Samsung Galaxy S24 Ultra or a comparable Android phone |
| Samsung Internet on Android | Samsung Galaxy S24 Ultra |
| Safari on iOS | iPhone 14 Plus, plus a smaller iPhone when available |
| Safari on macOS | Mac acting as Host |

Play one mixed-browser room: Chrome Host, Safari Player, Samsung Internet Player,
and Chrome Player. Repeat room creation with Safari and Samsung Internet as Host.

1. Create/join with Arabic names using the real keyboard and room link. Verify
   the keyboard and browser bars do not hide Join, vote confirmation, or Exit.
2. Complete a match through role/prompt, ready, countdown, action, reveal,
   discussion, voting, results, ranking, feedback, and rematch. Check RTL,
   scrolling, touch targets, and portrait/landscape layout.
3. On each Player browser, switch to WhatsApp or another app and lock the phone
   for 10 seconds, 45 seconds, and several minutes. Return during both discussion
   and voting. The same seat must recover to the current authoritative phase;
   old votes/actions must not replay and private data must stay private.
4. Switch Wi-Fi to cellular, test airplane mode, and restore connectivity. Check
   visible connection feedback, blocked stale game controls, reachable Exit,
   and recovery without a duplicate seat. Verify the Host sees disconnection.
5. Confirm Host audio unlocks after a user gesture, mute works, and lack of audio
   never prevents play. Check room-code copying over the production HTTPS URL.
6. Check a second tab, reload, leave confirmation, kick, and room closure. Repeat
   keyboard-only dialog navigation on desktop Safari and Chrome.

Treat a frozen connected-looking screen, wrong recovered identity, unusable
primary control, or private-information leak as a release blocker. Passing CI
alone does not close this real-device check.

References: [Playwright browsers](https://playwright.dev/docs/browsers) and
[mobile emulation](https://playwright.dev/docs/emulation).
