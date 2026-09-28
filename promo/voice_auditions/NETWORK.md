# Voice auditions — network check (2026-09-28)

Voice generation was **not performed**: both required TTS sources are still blocked
by this cloud environment's egress policy (proxy answers `403` to `CONNECT`,
reported as `connect_rejected` / policy denial).

| Check | Result |
|---|---|
| `curl https://huggingface.co/api/models/ResembleAI/chatterbox` | **Blocked** — `CONNECT tunnel failed, response 403` |
| `curl -L https://huggingface.co/ResembleAI/chatterbox/resolve/main/conds.pt` | **Blocked** — 403 on `huggingface.co` (redirect never reached) |
| `cdn-lfs.hf.co`, `cas-bridge.xethub.hf.co` (HF CDN) | **Blocked** — no connection |
| `hf-mirror.com` | **Blocked** — no connection |
| `pip install edge-tts` (pypi.org / files.pythonhosted.org) | OK — edge-tts 7.2.8 installed |
| `edge-tts --list-voices` (`speech.platform.bing.com`) | **Blocked** — 403 `connect_rejected`; no `ar-SA` voices listed |
| `download.pytorch.org` | **Blocked** — 403 |
| `pypi.org/simple/torch/` | OK (200) — torch itself is installable from PyPI |

Conclusion: Hugging Face (all model weights, incl. Chatterbox / XTTS / OpenAudio)
and the Microsoft Edge speech endpoint are both unreachable, so none of the
candidate engines can run here.

To unblock: in the environment settings (cloud environment menu → Edit → Network
access), choose a broader access level or add these allowed domains:
`huggingface.co`, `cdn-lfs.hf.co`, `cas-bridge.xethub.hf.co`,
`speech.platform.bing.com` (optionally `download.pytorch.org`).
See https://code.claude.com/docs/en/claude-code-on-the-web
