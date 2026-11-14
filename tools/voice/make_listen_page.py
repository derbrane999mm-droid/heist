"""Build samples/listen.html: a plain local page with audio players for every sample, so a human
can compare the engines quickly (open the file from the samples folder, or serve the folder)."""
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lines import load_lines  # noqa: E402

S = Path("/tmp/voice-research/samples")
LINES = load_lines()
checks = {}
if (S / "checks.json").exists():
    checks = {r["name"]: r for r in json.loads((S / "checks.json").read_text())}

GROUPS = [
    ("supertonic3", "Supertonic 3 via sherpa-onnx (same voices M1-M5 in both languages)"),
    ("piper", "Piper (different speaker per language)"),
    ("kokoro_", "Kokoro v1.0 (English only)"),
    ("kokoro-EXPERIMENT", "Kokoro EXPERIMENT: German text through an English voice (unsupported)"),
    ("coqui", "Coqui TTS (older single-language models)"),
    ("espeak-ng", "espeak-ng (formant synth, robotic baseline)"),
]
rows = {g: [] for g, _ in GROUPS}
for wav in sorted((S / "raw").glob("*.wav")):
    for g, _ in GROUPS:
        if wav.stem.startswith(g):
            rows[g].append(wav.stem)
            break

out = ["<!doctype html><meta charset='utf-8'><title>NULL VAULT - Broker voice samples</title>",
       "<style>body{font:14px system-ui;margin:24px;max-width:1100px}table{border-collapse:collapse;width:100%}"
       "td,th{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:middle}"
       "audio{height:32px;width:260px}h2{margin-top:32px}.t{color:#555}</style>",
       "<h1>NULL VAULT - Broker voice samples</h1>",
       "<p>Radio = band-pass 300-3400 Hz, compression, light saturation, noise bed, MP3 32 kbit/s mono. "
       "Raw = engine output (WAV). WER = word error rate of a Whisper-small transcription against the script "
       "(0 = every word recognised; a machine check, not a quality rating).</p>"]
for lang in ("en", "de"):
    for key in ("intro1", "kit"):
        out.append(f"<p class='t'><b>{lang} / sub.{key}:</b> {html.escape(LINES[(lang, key)])}</p>")
for g, title in GROUPS:
    if not rows[g]:
        continue
    out.append(f"<h2>{html.escape(title)}</h2><table><tr><th>sample</th><th>radio (mp3)</th><th>raw (wav)</th>"
               "<th>WER raw / radio</th></tr>")
    for name in sorted(rows[g], key=lambda n: (re.search(r"_(en|de)_", n).group(1) != "en", n)):
        c = checks.get(name)
        w = f"{c['wer_raw']:.2f} / {c['wer_radio']:.2f}" if c else "n/a"
        out.append(f"<tr><td>{html.escape(name)}</td>"
                   f"<td><audio controls preload='none' src='radio/{name}.radio.mp3'></audio></td>"
                   f"<td><audio controls preload='none' src='raw/{name}.wav'></audio></td><td>{w}</td></tr>")
    out.append("</table>")
(S / "listen.html").write_text("\n".join(out), encoding="utf-8")
print("wrote", S / "listen.html", sum(len(v) for v in rows.values()), "samples")
