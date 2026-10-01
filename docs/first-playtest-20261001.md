# First real playtest — خلك طبيعي (45 minutes)

Prepared from an external UX review on 1 October 2026. Real observations only; scripted simulations are not customer research. This checklist authorizes no merge, deploy or configuration change.

## Setup

| Item | Requirement |
| --- | --- |
| Players | 5–6 Saudi/Gulf players, mostly first-timers, including one less experienced with games. The host plays; a separate observer if possible. |
| Devices | One phone per player; at least one iPhone with Safari and one Samsung with Chrome. |
| Before starting | Use the test build that matches the reviewed commit. **The host opens the link with `?trial=1` before creating the room**, and on every other test browser too. |
| Notes | Device, browser, network, time of failure and recovery, and the exact text that confused someone. Do not record roles or private content without consent. |

## Run sheet

| Minutes | Task | Host says |
| --- | --- | --- |
| 0–3 | Introduce | «اليوم نختبر اللعبة، مو نختبركم. استخدموها مثل ما تفهمونها، وإذا شي لخبطكم قولوه. ما راح أشرح إلا إذا علقتوا.» |
| 3–8 | Join by link/QR; one person by the manual room code; no rules explanation | «ادخلوا من جوالاتكم، واقرأوا اللي تحتاجونه من الموقع.» |
| 8–18 | A 3-challenge match with the available settings; watch roles, actions and voting | «يلا نبدأ. كل واحد يتبع اللي يظهر له على جواله.» |
| 18–28 | A new match; interruptions on both phone types | «الحين بنختبر الرجوع: قفّل الشاشة ٢٠ ثانية وافتحها. بعدها، بتحدّي ثاني، طفّ الواي فاي وارجع على بيانات الجوال.» |
| 28–34 | Host opens «إنهاء اللعبة», cancels once, then confirms; change a setting and start again | «وش تتوقعون يصير لو ضغطت إنهاء اللعبة؟» (then do it without explaining) |
| 34–38 | Optional rematch; then close the room and try the old link | «تبون تلعبون مرة ثانية؟» then «الحين بنقفل الغرفة ونجرب رابطها القديم.» |
| 38–45 | The six questions | Each player answers before group discussion. |

## Five moments to watch

1. **Joining:** do they know who creates and who joins? Do they think a TV is required?
2. **First role and action:** does the impostor understand they cannot see the prompt? Do players wait for the action signal and keep their screen private?
3. **First vote and the last five seconds:** do they pick without confirming? Do they tell «نسجّل صوتك» apart from an accepted vote?
4. **Returning from an interruption:** do the current role and phase come back? Does anyone need help, or cast an old vote?
5. **Ending, then playing again:** do they expect the room to stay? Do the room code and players remain? Do they distinguish ending a game from closing the room?

## Six questions after play

1. «بكلامك: وش كنت تسوي إذا أنت طبيعي، وإذا أنت المتخفي؟»
2. «متى اعتبرت إن صوتك انحسب؟ ورّنا العلامة اللي اعتمدت عليها.»
3. «أي كلمة أو زر وقّفك أو فهمته غلط؟»
4. «بعد قفل الجوال أو تغيير الشبكة، عرفت وين وصلت اللعبة؟»
5. «وش توقعت من إنهاء اللعبة؟ ووش الفرق عن إغلاق الغرفة؟»
6. «ودّك تلعب مباراة ثانية الآن؟ وش أكثر شي حمّسك أو طفّشك؟»

## Pass or fix first

| Check | Pass | Fix first |
| --- | --- | --- |
| iPhone/Safari and Samsung/Chrome | Lock/unlock and Wi‑Fi → mobile data on **each** device during a round | Only emulation, or only one device tested |
| Reconnect | Time to a usable current state is within the release recovery budget | Stale screen that looks connected, lost seat, repeated manual help |
| Time passing while away | The player understands the round moved on; no old timer or action replays | A round restarts or an old action counts |
| Privacy | Zero unintended reveals before the allowed reveal | Any leaked role or prompt |
| Getting started | Everyone joins and understands their first action from the UI and rules | The same confusion for two people |
| Voting | Players tell picking, sending and accepted apart; no unexplained lost vote | A pick that looks confirmed but was not recorded, or waiting without guidance |
| Ending | The room is kept | Unexpected room loss or devices disagreeing |
| Wanting to replay | Ask before offering a rematch and record the real choice (a fun signal, not launch proof) | Replaying only to please the host |
| **Ready to launch** | Usability and device checks pass **and all current release gates pass on the same build** | The 45-minute test does not replace CI or release tests |
