"""Generate the test lines with Kokoro v1.0 (kokoro-onnx from PyPI, model from GitHub releases).

Kokoro v1.0 has no German voice. The 'de' jobs below are an EXPERIMENT: German text is
phonemized by espeak-ng (lang='de') and spoken by an English voice. Unsupported; expect an accent
and possibly dropped phonemes.
"""
import json
import sys
import time
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

sys.path.insert(0, str(Path(__file__).parent))
from lines import load_lines  # noqa: E402

ROOT = Path("/tmp/voice-research")
OUT = ROOT / "samples" / "raw"
OUT.mkdir(parents=True, exist_ok=True)
M = ROOT / "models" / "kokoro-onnx"

t0 = time.perf_counter()
k = Kokoro(str(M / "kokoro-v1.0.onnx"), str(M / "voices-v1.0.bin"))
load_s = time.perf_counter() - t0
print("load_s", round(load_s, 2))

# (lang of text, voice, espeak lang, speed, label)
JOBS = [
    ("en", "bm_george", "en-gb", 0.95, "kokoro"),
    ("en", "am_michael", "en-us", 0.95, "kokoro"),
    ("en", "am_onyx", "en-us", 0.95, "kokoro"),
    ("en", "bm_lewis", "en-gb", 0.95, "kokoro"),
    ("de", "bm_george", "de", 0.95, "kokoro-EXPERIMENT-german-via-english-voice"),
    ("de", "am_onyx", "de", 0.95, "kokoro-EXPERIMENT-german-via-english-voice"),
]
lines = load_lines()
stats = []
for lang, voice, elang, speed, label in JOBS:
    for (l, key), text in lines.items():
        if l != lang:
            continue
        ph_all = None
        if lang == "de":
            import phonemizer
            # remove espeak's "(en)…(de)" language-switch flags, otherwise they would be spoken
            raw = phonemizer.phonemize(text, "de", preserve_punctuation=True, with_stress=True,
                                       language_switch="remove-flags").strip()
            kept = k.tokenizer.known(raw)
            dropped = sorted(set(raw) - set(kept))
            ph_all = dict(raw=raw, dropped=dropped)
        out = OUT / f"{label}_{lang}_{voice}_{key}.wav"
        t0 = time.perf_counter()
        if ph_all:
            audio, sr = k.create(ph_all["raw"], voice=voice, speed=speed, lang=elang, is_phonemes=True)
        else:
            audio, sr = k.create(text, voice=voice, speed=speed, lang=elang)
        gen_s = time.perf_counter() - t0
        sf.write(str(out), audio, sr, subtype="PCM_16")
        dur = len(audio) / sr
        stats.append(dict(engine="kokoro-onnx", lang=lang, voice=voice, key=key, file=out.name,
                          load_s=round(load_s, 2), gen_s=round(gen_s, 2), audio_s=round(dur, 2),
                          rtf=round(gen_s / dur, 3), sr=sr, chars=len(text), phonemes=ph_all))
        print(stats[-1])

(ROOT / "samples" / "stats_kokoro.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False))
