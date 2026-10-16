#!/usr/bin/env bash
# Exercise the real Qt OpenGL + libmpv + PipeWire path with generated media: a
# picture-only and a sound-only file, played together as a YouTube stream is.
# Usage: bash native/tests/verify-playback.sh build/pitv-native [screenshot.png]
set -euo pipefail

for command in dbus-run-session pipewire pipewire-pulse wireplumber pactl parec ffmpeg python3 xvfb-run; do
  command -v "$command" >/dev/null || { printf 'Missing playback-test dependency: %s\n' "$command" >&2; exit 2; }
done
if [[ "${1:-}" != --session ]]; then
  exec dbus-run-session -- bash "$0" --session "$@"
fi
shift
binary=$(realpath "${1:?Supply the path to pitv-native}")
screenshot=$(realpath -m "${2:-native-playback.png}")
fixture_source=$(cd "$(dirname "$0")" && pwd)/library.json
test_dir=$(mktemp -d /tmp/pitv-playback.XXXXXX)
pipewire_pid= pulse_pid= policy_pid= capture_pid=
cleanup() {
  result=$?
  trap - EXIT
  for pid in "$capture_pid" "$policy_pid" "$pulse_pid" "$pipewire_pid"; do
    [[ -z "$pid" ]] || kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  if [[ "$result" -ne 0 ]]; then
    for logfile in "$test_dir"/*.log; do
      printf '\n%s\n' "$logfile" >&2
      tail -30 "$logfile" >&2
    done
  fi
  rm -rf -- "$test_dir"
  exit "$result"
}
trap cleanup EXIT

# A private runtime and bus keep this test away from the user's audio devices.
export XDG_RUNTIME_DIR="$test_dir/runtime"
export PIPEWIRE_RUNTIME_DIR="$XDG_RUNTIME_DIR"
export PULSE_RUNTIME_PATH="$XDG_RUNTIME_DIR/pulse"
export PULSE_SERVER="unix:$PULSE_RUNTIME_PATH/native"
mkdir -m 700 "$XDG_RUNTIME_DIR"
pipewire >"$test_dir/pipewire.log" 2>&1 & pipewire_pid=$!
pipewire-pulse >"$test_dir/pulse.log" 2>&1 & pulse_pid=$!
wireplumber >"$test_dir/policy.log" 2>&1 & policy_pid=$!
for attempt in $(seq 1 50); do
  if pactl info >/dev/null 2>&1; then break; fi
  sleep .1
done
pactl load-module module-null-sink sink_name=pitv_test >/dev/null
export PITV_AUDIO_DEVICE=pitv_test

ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x360:rate=30 -t 6 -c:v libx264 \
  -preset ultrafast -threads 1 -pix_fmt yuv420p -an -movflags +faststart "$test_dir/picture.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i sine=frequency=440:sample_rate=48000 -t 6 -c:a aac \
  "$test_dir/sound.m4a"
python3 - "$fixture_source" "$test_dir" <<'PY'
import json, pathlib, sys
fixture = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
root = pathlib.Path(sys.argv[2])
source = fixture['items']['3'][0]['youtube_url']
# Where the server would say the video streams from.
fixture.setdefault('_streams', {})[source] = {'video': (root / 'picture.mp4').as_uri(), 'audio': (root / 'sound.m4a').as_uri()}
(root / 'library.json').write_text(json.dumps(fixture), encoding='utf-8')
PY
mkdir -p "$(dirname "$screenshot")"
# Capture the private sink's monitor to prove the audio stream carries samples,
# rather than merely accepting a PLAYING transition from the media clock.
# A short record latency makes the monitor deliver samples promptly; the default
# buffering can still hold the whole playback when the player exits.
parec --device=pitv_test.monitor --format=float32le --rate=48000 --channels=1 --latency-msec=50 \
  >"$test_dir/audio.f32" 2>"$test_dir/capture.log" & capture_pid=$!
env -u QT_QUICK_BACKEND LIBGL_ALWAYS_SOFTWARE=1 QT_QPA_PLATFORM=xcb \
  xvfb-run -a -s '-screen 0 1600x900x24' "$binary" --verify-playback \
  --fixture "$test_dir/library.json" --route 2,0,0 --screenshot "$screenshot"
sleep 1 # let the capture drain what the sink already rendered
kill "$capture_pid" 2>/dev/null || true
wait "$capture_pid" 2>/dev/null || true
capture_pid=
python3 - "$test_dir/audio.f32" <<'PY'
import array, math, pathlib, sys
data = pathlib.Path(sys.argv[1]).read_bytes()
samples = array.array('f')
samples.frombytes(data[:len(data) // 4 * 4])
if sys.byteorder != 'little':
    samples.byteswap()
peak = max((abs(sample) for sample in samples if math.isfinite(sample)), default=0)
if peak < 0.0001:
    raise SystemExit('Audio verification failed: the private output received no audible samples.')
print(f'Audio output verified: {len(samples)} samples, peak {peak:.5f}')
PY
printf 'Rendered video and delivered audio successfully: %s\n' "$screenshot"
