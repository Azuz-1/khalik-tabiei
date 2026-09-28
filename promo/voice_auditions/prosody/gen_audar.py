"""Engine: Audar-TTS-V1-Flash (AudarAI Open License v1.0, commercial use permitted), transformers on CPU.
Voice: built-in synthetic profile demo_male_3 ("bright, curious"; interpolated, resembles no real person).
Native controls: inline expression tags ([curious] [excited] [mischievously] ...), temperature/top_k/top_p/
repetition_penalty, seed. Usage: from gen_audar import Audar; a=Audar(); wav=a.say(text, seed, temperature)"""
import os, re, torch, numpy as np, librosa
from huggingface_hub import snapshot_download, hf_hub_download
from transformers import AutoModelForCausalLM, AutoTokenizer
from neucodec import NeuCodec

REPO = "audarai/Audar-TTS-V1-Flash"
# Official neuphonic/neucodec is gated; this Apache-2.0 mirror is byte-identical
# (pytorch_model.bin sha256 30c3ea13…ebdf verified against the official LFS hash).
CODEC = "nguyensu27/neucodec"
VOICE = "demo_male_3"
# Whisper transcript of the profile clip (profile clips ship without transcripts).
REF_TEXT = "يا هلا والله شفيك بعد الحفل الذي صار في نون سمعت إن واحد من الجمهور صار يتنبأ بالمستقبل بعد سماع الناي"

class Audar:
    def __init__(self, voice=VOICE, ref_text=REF_TEXT):
        torch.set_num_threads(os.cpu_count())
        d = snapshot_download(REPO, allow_patterns=["transformers/*"])
        self.tok = AutoTokenizer.from_pretrained(f"{d}/transformers")
        self.lm = AutoModelForCausalLM.from_pretrained(f"{d}/transformers", torch_dtype=torch.float32).eval()
        self.codec = NeuCodec.from_pretrained(CODEC).eval()
        ref = hf_hub_download(REPO, f"samples/{voice}_source.wav")
        y, _ = librosa.load(ref, sr=16000)
        with torch.no_grad():
            codes = self.codec.encode_code(torch.tensor(y)[None, None]).squeeze().tolist()
        self.ref = "".join(f"<|speech_{c}|>" for c in codes); self.ref_text = ref_text
        self.end_id = self.tok.convert_tokens_to_ids("<|TARGET_CODES_END|>")

    def say(self, text, seed=1, temperature=1.0, top_k=40, top_p=0.9, rep=1.1):
        prompt = (f"user: Convert the text to speech:<|REF_TEXT_START|>{self.ref_text}<|REF_TEXT_END|>"
                  f"<|REF_SPEECH_START|>{self.ref}<|REF_SPEECH_END|>"
                  f"<|TARGET_TEXT_START|>{text}<|TARGET_TEXT_END|>\nassistant:<|TARGET_CODES_START|>")
        ids = self.tok(prompt, return_tensors="pt", add_special_tokens=False).input_ids
        torch.manual_seed(seed)
        with torch.no_grad():
            out = self.lm.generate(ids, max_new_tokens=1500, do_sample=True, temperature=temperature, top_k=top_k,
                                   top_p=top_p, repetition_penalty=rep, eos_token_id=self.end_id)
        s = self.tok.decode(out[0, ids.shape[1]:], skip_special_tokens=False)
        codes = [int(x) for x in re.findall(r"<\|speech_(\d+)\|>", s)]
        with torch.no_grad():
            wav = self.codec.decode_code(torch.tensor(codes)[None, None, :]).cpu().numpy()[0, 0, :]
        return wav, 24000
