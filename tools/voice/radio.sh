#!/usr/bin/env bash
# Turn every raw TTS wav into a "radio" version and encode it for the web.
#   samples/raw/<name>.wav  ->  samples/radio/<name>.radio.webm  (Opus 16 kbit/s mono, 16 kHz)
#                               samples/radio/<name>.radio.mp3   (MP3 32 kbit/s mono, 16 kHz)
#                               samples/clean/<name>.clean.webm  (Opus 24 kbit/s mono, no effect;
#                                                                 for the "filter at runtime" option)
# Chain: loudness normalise -> band-pass 300-3400 Hz (4th order each side) -> compressor ->
#        light tanh saturation -> low-pass again (removes clip harmonics) ->
#        quiet band-limited pink-noise bed -> limiter -> 16 kHz.
set -euo pipefail
ROOT=/tmp/voice-research/samples
mkdir -p "$ROOT/radio" "$ROOT/clean"

RADIO_FC='[0:a]aresample=48000,aformat=channel_layouts=mono,loudnorm=I=-18:TP=-2:LRA=7,
highpass=f=300:p=2,highpass=f=300:p=2,lowpass=f=3400:p=2,lowpass=f=3400:p=2,
acompressor=threshold=-22dB:ratio=4:attack=5:release=90:makeup=4dB,
volume=5dB,asoftclip=type=tanh,lowpass=f=3400:p=2,lowpass=f=3400:p=2,adelay=120:all=1,apad=pad_dur=0.18[v];
anoisesrc=color=pink:amplitude=0.035:sample_rate=48000:seed=7,highpass=f=300:p=2,highpass=f=300:p=2,lowpass=f=3400:p=2,lowpass=f=3400:p=2[n];
[v][n]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=disabled,aresample=16000[out]'

for f in "$ROOT"/raw/*.wav; do
  n=$(basename "$f" .wav)
  ffmpeg -hide_banner -loglevel error -y -i "$f" -filter_complex "$RADIO_FC" -map '[out]' \
    -ac 1 -c:a libopus -b:a 16k -vbr on -application voip "$ROOT/radio/$n.radio.webm"
  ffmpeg -hide_banner -loglevel error -y -i "$f" -filter_complex "$RADIO_FC" -map '[out]' \
    -ac 1 -ar 16000 -c:a libmp3lame -b:a 32k "$ROOT/radio/$n.radio.mp3"
  ffmpeg -hide_banner -loglevel error -y -i "$f" \
    -af 'aresample=48000,aformat=channel_layouts=mono,loudnorm=I=-18:TP=-2:LRA=7' \
    -ac 1 -c:a libopus -b:a 24k -vbr on -application voip "$ROOT/clean/$n.clean.webm"
done
echo "done: $(ls "$ROOT/radio" | wc -l) radio files, $(ls "$ROOT/clean" | wc -l) clean files"
