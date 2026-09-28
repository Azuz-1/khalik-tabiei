"""Pass/fail screen for recipe takes (NOT a ranking; everything that passes goes to the owner).
Fail if (a) Whisper misses a key word, or (b) there is no pause (>=120 ms) at a point where the
owner paused (reference/owner_targets.json).
Usage: python screen.py results.jsonl"""
import sys, json, re
KEY = {1: ["تخيل", "يرفعون", "الوحيد", "السالف"], 2: ["طبيعي", "جماعي", "منكم", "المطلوب"], 3: ["تدخلون", "جوالات", "تحميل", "تسجيل"],
       4: ["يشوف", "بجواله", "المتخفي", "يطلع"], 6: ["المتخفي", "يقلد", "يفضح", "نفسه"], 9: ["ترفع", "تاشر", "رقم", "جوله"],
       11: ["وبالنهاي", "اكثر", "نقاط", "الفايز"], 12: ["الحين", "السؤال", "خلك", "طبيعي"], 5: ["ثلاث", "اثنين", "واحد", "ارفع", "يدك"],
       7: ["ينكشف", "المطلوب", "يشك", "بالثاني"], 10: ["نقاط", "يفلت", "يكسب"], 8: ["المتخفي", "انمسك", "اغلب"]}
# owner pause points: (word before, word after)
# "*" = whatever word is adjacent (spelling variants such as «تِگْدَر» / «تِگْدَر تخدعهم»)
PAUSE = {1: [("يدهم", "وانت")], 2: [("طبيعي", "لعبه")], 3: [], 4: [("بجواله", "الا")], 6: [("يقلدكم", "ويحاول")],
         9: [("بصابعك", "وكل")], 11: [("وبالنهايه", "اكثر")], 12: [("السؤال", "*"), ("*", "خلك")], 5: [("اثنين", "واحد"), ("واحد", "ارفع")],
         7: [], 10: [("نقاط", "واذا")], 8: [("فيه", "واذا"), ("المتخفي", "انمسك")]}
def norm(t): return re.sub("[إأآ]", "ا", re.sub(r"[ً-ْـ]", "", t)).replace("ة", "ه")
for l in open(sys.argv[1]):
    r = json.loads(l); seg = int(r["take"][:2]); asr = norm(r["asr"]).replace(" ", "")
    miss = [k for k in KEY.get(seg, []) if norm(k)[:4] not in asr]
    W = r["words"]; bad = []
    for a, b in PAUSE.get(seg, []):
        if b == "*":
            ia = next((i for i, w in enumerate(W) if norm(a) in w[0]), None); ib = ia + 1 if ia is not None and ia + 1 < len(W) else None
        elif a == "*":
            ib = next((i for i, w in enumerate(W) if norm(b) in w[0]), None); ia = ib - 1 if ib else None
        else:
            ia = next((i for i, w in enumerate(W) if norm(a) in w[0]), None)
            ib = next((i for i, w in enumerate(W) if norm(b) in w[0] and (ia is None or i > ia)), None)
        if ia is None or ib is None: bad.append(f"{a}|{b}:unaligned"); continue
        lo, hi = W[ia][1], W[ib][2]
        ms = max([pm for p0, pm in r["pauses"] if lo <= p0 <= hi] or [0])
        if ms < 120: bad.append(f"{a}|{b}:{ms}ms")
    print(("PASS" if not miss and not bad else "FAIL"), r["take"], r["dur"], "| missing:", miss, "| pauses:", bad or "ok", "|", r["asr"])
