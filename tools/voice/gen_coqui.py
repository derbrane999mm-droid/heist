"""Generate the test lines with Coqui TTS (coqui-tts fork on PyPI) using the older single-language
models that are hosted on GitHub releases (XTTS-v2 lives on Hugging Face -> not reachable here).

Needs an `espeak-ng` executable on PATH (built from source in build/espeak-install).
Run with TTS_HOME=/tmp/voice-research/models/coqui so the downloads stay inside the work dir.
"""
import json
import sys
import time
import wave
from pathlib import Path

import torch
from TTS.api import TTS

sys.path.insert(0, str(Path(__file__).parent))
from lines import load_lines  # noqa: E402

ROOT = Path("/tmp/voice-research")
OUT = ROOT / "samples" / "raw"
OUT.mkdir(parents=True, exist_ok=True)
torch.set_num_threads(2)

# (lang, model, speaker or None, label)
JOBS = [
    ("de", "tts_models/de/thorsten/vits", None, "thorsten-vits"),
    ("de", "tts_models/de/thorsten/tacotron2-DDC", None, "thorsten-tacotron2DDC"),
    ("en", "tts_models/en/vctk/vits", "p226", "vctk-vits-p226"),
    ("en", "tts_models/en/vctk/vits", "p273", "vctk-vits-p273"),
    ("en", "tts_models/en/vctk/vits", "p326", "vctk-vits-p326"),
]
lines = load_lines()
stats = []
cache = {}
for lang, model, speaker, label in JOBS:
    try:
        if model not in cache:
            t0 = time.perf_counter()
            cache[model] = TTS(model_name=model, progress_bar=False).to("cpu")
            load_s = time.perf_counter() - t0
        else:
            load_s = 0.0
        tts = cache[model]
    except Exception as e:  # noqa: BLE001
        print("LOAD FAILED", model, type(e).__name__, str(e)[:300])
        continue
    for (l, key), text in lines.items():
        if l != lang:
            continue
        out = OUT / f"coqui_{lang}_{label}_{key}.wav"
        t0 = time.perf_counter()
        try:
            kw = dict(speaker=speaker) if speaker else {}
            tts.tts_to_file(text=text, file_path=str(out), **kw)
        except Exception as e:  # noqa: BLE001
            print("GEN FAILED", model, key, type(e).__name__, str(e)[:300])
            continue
        gen_s = time.perf_counter() - t0
        with wave.open(str(out), "rb") as wf:
            dur = wf.getnframes() / wf.getframerate()
            sr = wf.getframerate()
        stats.append(dict(engine="coqui-tts", lang=lang, voice=label, key=key, file=out.name,
                          load_s=round(load_s, 2), gen_s=round(gen_s, 2), audio_s=round(dur, 2),
                          rtf=round(gen_s / dur, 3), sr=sr, chars=len(text)))
        print(stats[-1])
        load_s = 0.0

(ROOT / "samples" / "stats_coqui.json").write_text(json.dumps(stats, indent=1))
