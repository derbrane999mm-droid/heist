"""Objective checks on every sample (no human ear involved):
- duration, peak, RMS, share of near-silent frames, longest internal pause   (raw wav)
- share of spectral energy above 4 kHz in the radio version                  (band-limit check)
- ASR round trip with Whisper-small (sherpa-onnx): word error rate vs the script line,
  for the raw wav and for the final radio .webm                               (intelligibility proxy)
- encoded file sizes
Writes samples/checks.json and prints a table.
"""
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import numpy as np
import sherpa_onnx

sys.path.insert(0, str(Path(__file__).parent))
from lines import load_lines  # noqa: E402

ROOT = Path("/tmp/voice-research")
S = ROOT / "samples"
W = ROOT / "models" / "whisper-small"
LINES = load_lines()


def decode(path, sr=16000):
    raw = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(sr),
         "-f", "f32le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def make_rec(lang):
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=str(W / "small-encoder.int8.onnx"), decoder=str(W / "small-decoder.int8.onnx"),
        tokens=str(W / "small-tokens.txt"), language=lang, task="transcribe", num_threads=2)


RECS = {"en": make_rec("en"), "de": make_rec("de")}


def asr(samples, lang):
    st = RECS[lang].create_stream()
    st.accept_waveform(16000, samples)
    RECS[lang].decode_stream(st)
    return st.result.text.strip()


def norm(t):
    t = unicodedata.normalize("NFKC", t).lower().replace("ß", "ss")
    t = re.sub(r"[^\w\s]", " ", t)
    return t.split()


def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=int)
    d[:, 0] = np.arange(len(r) + 1)
    d[0, :] = np.arange(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (r[i - 1] != h[j - 1]))
    return round(float(d[-1, -1]) / max(1, len(r)), 3)


def audio_stats(x, sr):
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    rms = float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0
    fl = int(0.02 * sr)
    n = len(x) // fl
    fr = np.sqrt(np.mean(x[: n * fl].reshape(n, fl) ** 2, axis=1))
    quiet = fr < (10 ** (-45 / 20))
    longest, cur = 0, 0
    inner = quiet[np.argmax(~quiet): len(quiet) - np.argmax(~quiet[::-1])] if (~quiet).any() else quiet
    for q in inner:
        cur = cur + 1 if q else 0
        longest = max(longest, cur)
    return dict(dur_s=round(len(x) / sr, 2), peak_dbfs=round(20 * np.log10(peak + 1e-9), 1),
                rms_dbfs=round(20 * np.log10(rms + 1e-9), 1), quiet_share=round(float(quiet.mean()), 2),
                longest_inner_pause_s=round(longest * 0.02, 2))


def band_db(x, sr, lo, hi):
    """Energy in [lo, hi) Hz relative to total energy, in dB."""
    spec = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(len(x), 1 / sr)
    share = spec[(f >= lo) & (f < hi)].sum() / (spec.sum() + 1e-12)
    return round(float(10 * np.log10(share + 1e-12)), 1)


# Resumable: results are saved after every file; files already in checks.json are skipped
# unless their wav is newer than the stored result. Files matching argv[1] (regex) go first.
OUTJ = S / "checks.json"
rows = json.loads(OUTJ.read_text()) if OUTJ.exists() and "--fresh" not in sys.argv else []
rows = [r for r in rows if "radio_db_above4500" in r and (S / "raw" / (r["name"] + ".wav")).exists()
        and r.get("wav_mtime") == (S / "raw" / (r["name"] + ".wav")).stat().st_mtime
        and r.get("webm_mtime") == (S / "radio" / (r["name"] + ".radio.webm")).stat().st_mtime]
done = {r["name"] for r in rows}
prio = re.compile(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
wavs = sorted((S / "raw").glob("*.wav"), key=lambda w: (0 if prio and prio.search(w.stem) else 1, w.stem))
for wav in wavs:
    name = wav.stem
    if name in done:
        continue
    m = re.search(r"_(en|de)_.*_(intro1|kit)$", name)
    lang, key = m.group(1), m.group(2)
    ref = LINES[(lang, key)]
    x = decode(wav)
    st = audio_stats(x, 16000)
    hyp_raw = asr(x, lang)
    webm = S / "radio" / f"{name}.radio.webm"
    mp3 = S / "radio" / f"{name}.radio.mp3"
    clean = S / "clean" / f"{name}.clean.webm"
    xr = decode(webm)
    hyp_radio = asr(xr, lang)
    row = dict(name=name, lang=lang, key=key, chars=len(ref), **st,
               wer_raw=wer(ref, hyp_raw), wer_radio=wer(ref, hyp_radio),
               asr_raw=hyp_raw, asr_radio=hyp_radio,
               radio_dur_s=round(len(xr) / 16000, 2),
               radio_db_below200=band_db(xr, 16000, 0, 200), radio_db_above4500=band_db(xr, 16000, 4500, 8001),
               raw_db_below200=band_db(x, 16000, 0, 200), raw_db_above4500=band_db(x, 16000, 4500, 8001),
               webm_bytes=webm.stat().st_size, mp3_bytes=mp3.stat().st_size,
               clean_webm_bytes=clean.stat().st_size, wav_bytes=wav.stat().st_size,
               wav_mtime=wav.stat().st_mtime, webm_mtime=webm.stat().st_mtime)
    rows.append(row)
    OUTJ.write_text(json.dumps(sorted(rows, key=lambda r: r["name"]), indent=1, ensure_ascii=False))
    print(f"{name:75s} {st['dur_s']:6.2f}s pk{st['peak_dbfs']:6.1f} rms{st['rms_dbfs']:6.1f} "
          f"pause{st['longest_inner_pause_s']:5.2f} WERraw {row['wer_raw']:.2f} WERradio {row['wer_radio']:.2f} "
          f"webm {row['webm_bytes']:6d} mp3 {row['mp3_bytes']:6d}", flush=True)

OUTJ.write_text(json.dumps(sorted(rows, key=lambda r: r["name"]), indent=1, ensure_ascii=False))
print("checked", len(rows), "files")
