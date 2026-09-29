import json, re, os, sys, urllib.request, urllib.error
R = "/home/user/khalik-tabiei/promo/voice_auditions/segments/R_picks"
VOICES = {"YwG5nJLWQ33Z3AKec3RN": "M", "gTKrhCj22wWEoax2wtwr": "F2", "tPQlZxlHLbatonwL593Q": "F1"}
GAME = {  # playful tags per line; same words as the video script
 "01": lambda t: "[excited] " + t.replace("… وأنت", "… [whispers] وأنت"),
 "03": lambda t: "[playful] " + t,
 "05": lambda t: "[playful] " + t.replace("واحد…", "[excited] واحد…"),
 "06": lambda t: "[mischievously] " + t,
 "08": lambda t: "[playful] " + t,
 "12": lambda t: "[curious] " + t.replace("تِگْدَر", "[mischievously] تِگْدَر"),
}
SET = {"calm": {"stability": 0.6, "similarity_boost": 0.8, "style": 0.0, "speed": 1.0},
       "game": {"stability": 0.35, "similarity_boost": 0.8, "style": 0.3, "speed": 1.05}}
def text(n):
    p = json.load(open(f"{R}/{n}.json"))["phrases"][0]
    return re.match(r"\([^)]*\)(.*)", p).group(1).strip()
def tts(vid, t, settings, path):
    body = {"text": t, "model_id": "eleven_v4", "voice_settings": settings}
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=mp3_44100_128",
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r: open(path, "wb").write(r.read())
if __name__ == "__main__":
    log = []
    for vid, vn in VOICES.items():
        for n in ["01", "03", "05", "06", "08", "12"]:
            base = text(n)
            for mode in ["calm", "game"]:
                t = ("[warm] " + base) if mode == "calm" else GAME[n](base)
                path = f"own/{vn}_{n}_{mode}.mp3"
                if os.path.exists(path): continue
                try: tts(vid, t, SET[mode], path); st = "ok"
                except urllib.error.HTTPError as e: st = f"HTTP {e.code} {e.read()[:200]!r}"
                print(vn, n, mode, st, flush=True)
                log.append(dict(voice=vn, voice_id=vid, line=n, mode=mode, text=t, settings=SET[mode], status=st))
                if st != "ok" and "voice_settings" in st: sys.exit(1)
    json.dump(log, open("own/log.json", "w"), ensure_ascii=False, indent=1)
