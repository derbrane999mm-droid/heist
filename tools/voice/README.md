# Spoken Broker lines (research result, 2026-11-14)

Status: route chosen, voice not yet picked by Mert (he has to listen: Claude cannot hear audio).

## Route
Pre-generated clips, one per subtitle key and language, made at build time and committed as static files (`public/voice/<lang>/<key>.mp3`), played by key next to the subtitle.

- Engine: **Supertonic 3 through `sherpa-onnx`** (PyPI `sherpa-onnx`, also npm `sherpa-onnx-node`). Model from the GitHub release `k2-fsa/sherpa-onnx`, tag `tts-models` (Hugging Face is not reachable from the build sandbox).
- Why: the same voice speaks English and German (voices M1–M5), runs on CPU in a few seconds per line, no account, no cost. Licences: engine Apache-2.0, Supertonic code MIT, model OpenRAIL-M.
- Radio effect: `radio.sh` (loudness normalise, band-pass 300–3400 Hz, compressor, light saturation, quiet noise bed, limiter), then MP3 32 kbit/s mono. MP3 because WebM/Opus has a history of problems in Safari.
- Each line must be generated with a fixed seed and checked with speech recognition (`check.py`); regenerate on a mismatch. One earlier run produced a garbled word.
- Size: about 22 kB per average line as MP3, roughly 13 MB for 600 lines; a player only downloads the lines that play, in one language.

## Fallback
Kokoro (`kokoro-onnx`, voice `bm_george`) for English plus Piper `thorsten-high` for German: two different speakers. Do not ship the Piper voice `alan` (dataset is "all rights reserved"); `ryan` is non-commercial share-alike.

## Not an option
The browser's built-in speech synthesis: no radio filter possible, a different voice per player and browser, weak German voices outside Edge.

## Files here
`gen_supertonic.py`, `gen_piper.py`, `gen_kokoro.py`, `gen_coqui.py` (generation), `lines.py` (test lines), `radio.sh` (effect + encoding), `check.py` (duration, levels, speech-recognition check), `make_listen_page.py`. Paths inside point at the original research folder and need adjusting when the real pipeline is built.
