"""Generate the test lines with Supertonic 3 (31 languages incl. de/en) through sherpa-onnx.

Engine: sherpa-onnx (PyPI, Apache-2.0). Model: int8 ONNX export from the sherpa-onnx GitHub
release 'tts-models' (sherpa-onnx-supertonic-3-tts-int8-2026-05-11).
voice.bin is built from the sorted style files -> sid 0-4 = F1-F5, sid 5-9 = M1-M5.
"""
import json
import sys
import time
from pathlib import Path

import sherpa_onnx
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from lines import load_lines  # noqa: E402

ROOT = Path("/tmp/voice-research")
OUT = ROOT / "samples" / "raw"
OUT.mkdir(parents=True, exist_ok=True)
M = ROOT / "models" / "supertonic-3"

t0 = time.perf_counter()
cfg = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        supertonic=sherpa_onnx.OfflineTtsSupertonicModelConfig(
            duration_predictor=str(M / "duration_predictor.int8.onnx"),
            text_encoder=str(M / "text_encoder.int8.onnx"),
            vector_estimator=str(M / "vector_estimator.int8.onnx"),
            vocoder=str(M / "vocoder.int8.onnx"),
            tts_json=str(M / "tts.json"),
            unicode_indexer=str(M / "unicode_indexer.bin"),
            voice_style=str(M / "voice.bin"),
        ),
        debug=False,
        num_threads=2,
        provider="cpu",
    )
)
assert cfg.validate()
tts = sherpa_onnx.OfflineTts(cfg)
load_s = time.perf_counter() - t0
print("load_s", round(load_s, 2), "speakers", tts.num_speakers, "sr", tts.sample_rate)

SIDS = {"M1": 5, "M2": 6, "M3": 7, "M4": 8, "M5": 9}
STEPS = int(sys.argv[1]) if len(sys.argv) > 1 else 10
SPEED = 1.0
lines = load_lines()
stats = []
for name, sid in SIDS.items():
    for (lang, key), text in lines.items():
        gc = sherpa_onnx.GenerationConfig()
        gc.sid = sid
        gc.num_steps = STEPS
        gc.speed = SPEED
        gc.extra["lang"] = lang
        out = OUT / f"supertonic3_{lang}_{name}_{key}.wav"
        t0 = time.perf_counter()
        audio = tts.generate(text, gc)
        gen_s = time.perf_counter() - t0
        if len(audio.samples) == 0:
            print("EMPTY", out.name)
            continue
        sf.write(str(out), audio.samples, samplerate=audio.sample_rate, subtype="PCM_16")
        dur = len(audio.samples) / audio.sample_rate
        stats.append(dict(engine="supertonic3(sherpa-onnx,int8)", lang=lang, voice=name, key=key,
                          file=out.name, load_s=round(load_s, 2), gen_s=round(gen_s, 2),
                          audio_s=round(dur, 2), rtf=round(gen_s / dur, 3), sr=audio.sample_rate,
                          chars=len(text), steps=STEPS, speed=SPEED))
        print(stats[-1])

(ROOT / "samples" / "stats_supertonic.json").write_text(json.dumps(stats, indent=1))
