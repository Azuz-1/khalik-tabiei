"""Rank segment-8 takes by distance to the owner's native reading (DIAGNOSTIC shortlist only;
the owner's ear makes the decision). Reads analyze.py results.jsonl.
Owner targets (owner_targets.json, line 8): pause before «وإذا» 220 ms; «المتخفي» rise +4.0 st;
juncture «المتخفي»→«انمسك» 280 ms; «انمسك» fall 2.9 st and not the most prominent word."""
import sys, json
T = dict(p_waitha=220, rise=4.0, juncture=280, fall=2.9)
rows = []
for l in open(sys.argv[1]):
    r = json.loads(l)
    if not r["take"].startswith("08"): continue
    d = (abs((r.get("pause_before_وإذا_ms") or 0) - T["p_waitha"]) / 100 + abs((r.get("pause_before_انمسك_ms") or 0) - T["juncture"]) / 100
         + abs((r.get("المتخفي_rise_st") or 0) - T["rise"]) / 2 + abs((r.get("انمسك_fall_st") or 0) - T["fall"]) / 2
         + (1.5 if r.get("rank_انمسك") == 1 else 0) + (5 if not r.get("انمسك_heard") else 0))
    rows.append((round(d, 2), r["take"], r.get("pause_before_وإذا_ms"), r.get("المتخفي_rise_st"), r.get("pause_before_انمسك_ms"),
                 r.get("انمسك_fall_st"), r.get("rank_انمسك"), r["asr"]))
print("dist | take | pause_وإذا | rise_المتخفي | juncture | fall_انمسك | rank_انمسك | asr")
for x in sorted(rows): print(" | ".join(map(str, x)))
