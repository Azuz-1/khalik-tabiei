"""Critical-line audition plan (segments 1,5,7,8,10,12), 3 takes each.

Wording is constant within a segment across all engines. Each take changes ONE
variable versus take 1 (the engine's recommended/default settings, one phrase):
  kind="adj"    -> engine-native prosody adjustment (engine decides what that means; see gen_*.py)
  kind="split"  -> phrase boundaries: phrases generated separately, joined with exact silences (gaps_ms)
  kind="spell"  -> hidden pronunciation (class-A test); caption unchanged
Phrases are split only on performance beats (never word-by-word, except the countdown
beats, which ARE the performance beats of segment 5).
"""
BASE = {
    1: "تَخَيَّل كلهم يرفعون يِدْهُم… وأنت الوحيد اللي ما تَدري وش السالفة!",
    5: "ثلاثة… اثنين… واحد… اِرْفَع يَدَك!",
    7: "بعدها يِنكَشِف المطلوب… وكل واحد يبدأ يِشِكْ بالثاني.",
    8: "تبدون بالتصويت على الشخص اللي شاكِّين فيه… وإذا أغلبْكُم اختار المُتَخَفّي، إنْمَسَكْ.",  # owner-corrected vowels; «.» not «!»: explanatory, not exclaimed (round 3)
    10: "إذا عرفت المُتَخَفّي تَكْسَب نقاط… وإذا قِدَر يِفْلِت، هو اللي يَكْسَب.",
    12: "الحين السؤال… تِقْدَر؟ خَلِّك طبيعي!",
}
T = {}
def take(seg, n, kind, desc, phrases, gaps=()):
    T[(seg, n)] = dict(seg=seg, take=n, kind=kind, desc=desc, phrases=phrases, gaps_ms=list(gaps))

for s in BASE: take(s, 1, "default", "engine default settings, one phrase", [BASE[s]])

take(1, 2, "adj", "engine-native prosody adjustment (playful surprise)", [BASE[1]])
take(1, 3, "split", "beat split at … : setup | punchline, 220 ms", ["تَخَيَّل كلهم يرفعون يِدْهُم…", "وأنت الوحيد اللي ما تَدري وش السالفة!"], [220])

take(5, 2, "split", "countdown as individual beats (380/380 ms) + 450 ms beat before payoff",
     ["ثلاثة…", "اثنين…", "واحد…", "اِرْفَع يَدَك!"], [380, 380, 450])
take(5, 3, "split", "count as one phrase + 450 ms beat + payoff phrase", ["ثلاثة… اثنين… واحد…", "اِرْفَع يَدَك!"], [450])

take(7, 2, "adj", "engine-native prosody adjustment (playfully suspicious)", [BASE[7]])
take(7, 3, "split", "reveal | suspicion, 280 ms", ["بعدها يِنكَشِف المطلوب…", "وكل واحد يبدأ يِشِكْ بالثاني."], [280])

take(8, 2, "split", "payoff isolated: sentence | 320 ms | اِنْمَسَك!",
     ["تبدون بالتصويت على الشخص اللي شاكِّين فيه… وإذا أغلبْكُم اختار المُتَخَفّي،", "إنْمَسَكْ!"], [320])
take(8, 3, "adj", "engine-native prosody adjustment, انمسك kept in sentence", [BASE[8]])

take(10, 2, "split", "contrast split at … : outcome 1 | outcome 2, 300 ms",
     ["إذا عرفت المُتَخَفّي تَكْسَب نقاط…", "وإذا قِدَر يِفْلِت، هو اللي يَكْسَب."], [300])
take(10, 3, "spell", "hidden Najdi /g/: قِدَر → گِدَر (caption unchanged)", [BASE[10].replace("قِدَر", "گِدَر")])

take(12, 2, "split", "3 beats: الحين السؤال… | 300 ms | تِقْدَر؟ | 380 ms | خَلِّك طبيعي!",
     ["الحين السؤال…", "تِقْدَر؟", "خَلِّك طبيعي!"], [300, 380])
take(12, 3, "adj", "take 2 phrasing + engine-native prosody adjustment per beat",
     ["الحين السؤال…", "تِقْدَر؟", "خَلِّك طبيعي!"], [300, 380])
