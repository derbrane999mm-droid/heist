"""Generate the test lines with Piper (piper-tts from PyPI, voices from GitHub releases)."""
import json
import sys
import time
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

sys.path.insert(0, str(Path(__file__).parent))
from lines import load_lines  # noqa: E402

ROOT = Path("/tmp/voice-research")
OUT = ROOT / "samples" / "raw"
OUT.mkdir(parents=True, exist_ok=True)

# (lang, voice name, variant label, synthesis config kwargs)
DRY = dict(length_scale=1.1, noise_scale=0.45, noise_w_scale=0.6)
JOBS = [
    ("en", "en_US-ryan-high", "default", {}),
    ("en", "en_US-ryan-high", "dry", DRY),
    ("en", "en_GB-alan-medium", "default", {}),
    ("en", "en_GB-alan-medium", "dry", DRY),
    ("en", "en_US-joe-medium", "default", {}),
    ("en", "en_GB-northern_english_male-medium", "default", {}),
    ("de", "de_DE-thorsten-high", "default", {}),
    ("de", "de_DE-thorsten-high", "dry", DRY),
    ("de", "de_DE-thorsten_emotional-medium", "neutral", dict(speaker_id=4)),
    ("de", "de_DE-thorsten_emotional-medium", "sleepy", dict(speaker_id=5)),
    ("de", "de_DE-karlsson-low", "default", {}),
]

lines = load_lines()
stats = []
loaded = {}
for lang, voice_name, variant, cfg in JOBS:
    mdir = ROOT / "models" / f"vits-piper-{voice_name}"
    if voice_name not in loaded:
        t0 = time.perf_counter()
        loaded[voice_name] = PiperVoice.load(mdir / f"{voice_name}.onnx", mdir / f"{voice_name}.onnx.json")
        load_s = time.perf_counter() - t0
    else:
        load_s = 0.0
    voice = loaded[voice_name]
    for (l, key), text in lines.items():
        if l != lang:
            continue
        out = OUT / f"piper_{lang}_{voice_name.split('-', 1)[1]}_{variant}_{key}.wav"
        t0 = time.perf_counter()
        with wave.open(str(out), "wb") as wf:
            voice.synthesize_wav(text, wf, syn_config=SynthesisConfig(**cfg))
        gen_s = time.perf_counter() - t0
        with wave.open(str(out), "rb") as wf:
            dur = wf.getnframes() / wf.getframerate()
            sr = wf.getframerate()
        stats.append(dict(engine="piper", lang=lang, voice=voice_name, variant=variant, key=key,
                          file=out.name, load_s=round(load_s, 2), gen_s=round(gen_s, 2),
                          audio_s=round(dur, 2), rtf=round(gen_s / dur, 3), sr=sr, chars=len(text)))
        print(stats[-1])
        load_s = 0.0

(ROOT / "samples" / "stats_piper.json").write_text(json.dumps(stats, indent=1))
