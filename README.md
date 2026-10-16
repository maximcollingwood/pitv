# PiTV

A Raspberry Pi media appliance for shared reading, lyrics, video and background
music. The TV runs a **native Qt Quick application with GStreamer playback**.
Phones use a small web companion for remote control and PIN-protected editing.

Administrators paste YouTube links. The service discovers titles/playlists and
prepares media in the background; ready files play from the Pi. Browsing content
and playing cached media do not depend on an internet connection. New imports do.

## Architecture

- `native/`: C++/Qt 6 Quick television UI, local navigation, QR remote pairing,
  cached content snapshot, GStreamer audio/video and playback recovery.
- `server/`: Fastify/TypeScript API, SQLite content, persistent media queue,
  yt-dlp imports, ranged local media serving and unbuffered live control events.
- `app/`: React phone remote and editor. The browser no longer runs on the TV.
- `db/`: additive database schema and initial content. Normal startup never resets
  an existing library.
- `ansible/`: installs the full appliance, including native build dependencies,
  pinned importer, PipeWire, labwc, nginx and systemd services.

All five section types remain: articles, song lyrics, YouTube videos/playlists,
book catalog and book FAQs. Background tracks remain independent of sections.
Foreground video pauses background music; lyrics keep it playing. Arrow keys,
Enter, Escape/Backspace, the phone remote and the TV's own remote operate the TV.

### The TV (HDMI-CEC)

Like a TV box, the screen joins the TV's HDMI-CEC bus as a playback device named
PiTV (`/dev/cec0`, HDMI0; `PITV_CEC_DEVICE` overrides it):

- The TV remote's arrows, OK, Back and media keys reach PiTV while the TV shows
  it, and not while the TV's own menu is open. No IR receiver is needed.
- When the TV goes to standby the screen sleeps: it returns to the home screen and
  pauses background music. When the TV comes back on (it announces itself) the
  screen restarts the HDMI sound output once the TV's input is up, then resumes the
  music. Some TVs, the library's Vizio among them, otherwise stay silent after they
  come on.
- Any button pressed while the TV is off turns it on and switches it to PiTV (One
  Touch Play). The phone remote shows whether the TV is on and has a power button.
- Volume is not sent over CEC: the Vizio speaks CEC 1.4, where TVs may refuse
  volume commands from other devices, and it does. See the next section.

### TV volume (Vizio SmartCast)

The phone remote and the TV's own remote share one volume, the TV's. Vizio
SmartCast TVs have a local HTTPS API that sets and reports the volume; PiTV uses
it once paired (admin page, **System** tab, **TV** card: **Pair with the TV**, then
type the PIN the TV shows). The TV must be on the same Wi-Fi as the Pi.

- The phone remote's **Sound** sheet shows the TV's volume (0 to 100) with Mute,
  and the player's up and down step it, so the TV shows its own volume bar.
  Without a paired, reachable TV they control PiTV's own level as before.
- The server reads the TV every 5 seconds while the TV is on (never in
  standby), so changes made with the TV's remote reach the phones and the screen.
- The pairing is kept in `/var/lib/pitv/tv.json` (`TV_PAIRING_PATH`), readable
  only by the service. Before sending its key PiTV checks the TV's certificate
  (pinned at pairing); if the TV moves to a new address it is found again on the
  local network by its serial number.

Without a CEC adapter (the development VM) none of this applies. In the VM,
`sudo modprobe vivid n_devs=1 num_inputs=1 input_types=3 num_outputs=1 output_types=1`
emulates a TV on `/dev/cec0` and a source on `/dev/cec1` for testing with
`cec-ctl` (v4l-utils).

The integration API is documented in [docs/native-contract.md](docs/native-contract.md).

## Develop the phone and service

Requires Node.js 22.14 or newer (22 LTS recommended).

```sh
npm ci
npm run dev
```

The API listens on `127.0.0.1:3000` (set `HOST` to expose it elsewhere); on the Pi,
nginx is the only network entry point. Open `http://localhost:5173/remote` or `/admin`.
The default development PIN is `0000`. Remote navigation becomes available when
the native app sends its heartbeat. The web companion has no TV preview route.

`npm run dev` initializes missing tables and seed content without deleting edits.
Set `DB_PATH` to choose a separate SQLite database. Never use a production database
for tests; automated tests create isolated temporary databases.

```sh
npm run typecheck
npm test
npm run build
```

For actual media imports, install FFmpeg/ffprobe and `yt-dlp[default]`. The importer
uses Node as its YouTube JavaScript challenge runtime. Set `YTDLP_PATH` when the
executable is outside PATH. Metadata and content failures are visible in the
editor's media preparation view; failed jobs can be retried there or on the TV.

## Build the native application on Linux

The baseline is Debian Bookworm / 64-bit Raspberry Pi OS with Qt 6.4 and
GStreamer 1.22 or later. Install packages listed in
`ansible/roles/native/tasks/main.yml`, or provision the development VM below.

```sh
cmake -S native -B native/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --parallel 2
ctest --test-dir native/build --output-on-failure
PITV_API_URL=http://127.0.0.1:3000 ./native/build/pitv-native
```

Run the app in a graphical Linux session for video. It uses OpenGL and the
GStreamer `qml6glsink` plugin, which on Bookworm (GStreamer 1.22, Qt 6.4) only
supports X11: run it with `QT_QPA_PLATFORM=xcb` (under Xwayland on a Wayland
desktop). Hardware decode depends on the installed driver, codec plugins and OS,
not just a launch flag; the Pi 4 uses `v4l2h264dec`. Unit/UI smoke tests also run
headlessly, without an HDMI display. The source includes a sample library fixture.

The playback integration check generates a short test clip, renders it through
Qt/GStreamer under Xvfb, and records a private PipeWire output to verify audio
samples. It requires FFmpeg, Xvfb, PipeWire, WirePlumber, `pulseaudio-utils` and
`dbus-run-session`, in addition to the native dependencies:

```sh
bash native/tests/verify-playback.sh native/build/pitv-native native-playback.png
```

This test uses software graphics and an isolated audio output. It does not measure
Pi frame timing or validate a physical HDMI connection.

On Windows, the Vagrant/VirtualBox VM provides the Linux build and a full local
appliance:

```sh
vagrant up
```

The VirtualBox window is the TV: the native app runs full screen (1600x900) on a
plain X server. Use the arrow keys, Enter and Escape in the window, or the phone
companion at `http://localhost:8080/remote` (editor at `/admin`). Graphics and
video decoding are software in the VM, so it validates layout, navigation and
behavior, not Pi performance, hardware decode or HDMI audio.

### UI changes without a Pi

In the VM the TV app loads its QML from the shared repo (`native/qml`), so QML
edits only need an app restart. C++ changes need a rebuild:

```sh
npm run vm:tv:reload
npm run vm:tv:rebuild
```

The Pi itself always uses the QML compiled into its build. `vagrant provision`
re-applies everything (server, companion and native app).

For the phone companion, `npm run vm:app` serves it with live reload at
`http://localhost:5173/remote`, talking to the VM's API through
`http://localhost:8080`, so the remote drives the VM's TV.

To work with real content, copy a Pi's database, uploaded images and prepared
media into the VM. The Pi is only read; the VM's previous database is kept in
`/var/lib/pitv/vm-before-pull-*.db`. Run from Git Bash with the VM running:

```sh
bash tools/pull-pi-content.sh
```

It defaults to `pitv@raspberrypi.local` over SSH (key auth; set `PITV_SSH_KEY`
for a key file other than `~/.ssh/id_ed25519_pitv`). Add `--no-media` to skip the
video cache. The admin PIN is not copied: the VM keeps its own in
`/etc/kiosk/admin.env`.

## Install or update a Pi

1. Flash 64-bit Raspberry Pi OS Lite, create an administrator account and enable SSH.
2. Set `kiosk_repo_url` and `kiosk_repo_branch` in `ansible/group_vars/all.yml` to
   the repository/ref containing this rewrite.
3. Run the repository's `bootstrap.sh` with the same repository and branch, then reboot.

For an existing installation, deploy only after the native build and tests pass.
The admin page's **System** tab updates from `kiosk_repo_branch` (Update now), shows
the running version, the screen and device health (temperature, power supply,
storage, network), and restarts the screen app, restarts or shuts down the Pi.
Its Picture card shows a colour check on the TV and switches the HDMI colour range
(Automatic, Full or Limited) for TVs that show colours washed out or clipped. The
choice is kept in `/etc/kiosk/hdmi-range` and applied as the screen session starts.
From a shell:

```sh
sudo update-kiosk
sudo reboot
```

The backend stays unprivileged: the System tab writes one word into
`/var/lib/pitv/system/request`, and the root `pitv-system.path` unit acts only on
`update`, `restart-screen`, `reset-audio`, `range-automatic`, `range-full`,
`range-limited`, `reboot` and `poweroff`. Each update's output is in
`/var/log/pitv-update.log`. The development VM sets `kiosk_self_update: false`
(it is provisioned from the shared folder instead).

The playbook creates `/var/lib/pitv/pre-native-rewrite.db` once before migrating an
existing database. SQLite's backup includes committed WAL data. Content, settings,
uploads and the existing admin PIN are preserved. No schema-version reset runs.
The native launcher replaces Chromium; its old profile is left available for recovery.

- `kiosk.service`: labwc session and native application restart loop (the app is
  an X11 client on labwc's Xwayland).
- `pitv-backend.service`: API and managed importer worker.
- nginx: phone companion, API proxy and uploaded images.
- PipeWire/WirePlumber: HDMI output, hotplug recovery and no idle suspension.

The native application controls playback gain using the persisted volume setting.
The hardware sink is kept at unity. Volume changes no longer run sudo or
spawn a shell. Ctrl+Alt+F2 opens the login console; Ctrl+Alt+F1 returns to the TV.

Change `ADMIN_PIN` in `/etc/kiosk/admin.env` and restart `pitv-backend`. An optional
`/etc/kiosk/media.env` holds media configuration overrides. The old YouTube Data
API key is no longer required. Keep device secrets outside Git.

## Media preparation and storage

The worker handles one job at a time, persists queue/retry state, validates completed
files with ffprobe and exposes only completed media. Video selection requests
H.264 at up to 1080p to suit the Pi 4. Audio tracks are prepared separately.

| Setting | Default | Purpose |
| --- | --- | --- |
| `MEDIA_CACHE_LIMIT_MB` | 4096 | Managed storage budget, including preparation space |
| `MEDIA_MAX_ASSET_MB` | 512 | Maximum completed file size |
| `MEDIA_QUEUE_LIMIT` | 200 | Pending job limit |
| `MEDIA_PLAYLIST_PREFETCH` | 10 | Videos automatically prepared per playlist |
| `MEDIA_MIN_FREE_MB` | 256 | Free disk space reserve |
| `MEDIA_MAX_ATTEMPTS` | 3 | Automatic attempts before showing a retry action |
| `MEDIA_JOB_TIMEOUT_MS` | 1800000 | Time limit per preparation job |

Older cached media may be removed to make room; active/recent playback is protected.
Selecting uncached media prepares it on demand. Playlist discovery is capped at
500 entries, with metadata refreshed after six hours. Live/restricted/unavailable
videos and files beyond the limits may fail preparation. Preparing a new item can
take time; the UI reports its state rather than blocking navigation.

Use media that can be stored locally. YouTube extraction remains an external
integration that needs occasional updates. `yt_dlp_version` pins the importer
independently; change that version and re-provision to update it. Existing ready
media continues to work when new imports fail.

## Verification on the Pi

Before putting a rewritten installation into service, verify:

- Boot with internet disconnected; browse cached content and play prepared media.
- Navigate long lists and lyrics; measure frame timing and remote input latency.
- Play representative 1080p H.264 clips and confirm the actual decoder in GStreamer logs.
- Turn the TV off/on and switch HDMI inputs during playback; confirm sound recovers
  (`journalctl -b | grep -E "CEC|HDMI audio"` shows the screen following the TV).
- Interrupt an import, restart the backend, and confirm the queue recovers.
- Edit content from a phone and confirm the native screen updates without restarting.

Useful diagnostics:

```sh
systemctl status kiosk pitv-backend nginx
journalctl -u kiosk -u pitv-backend -b
curl -s http://localhost/api/device/status
vcgencmd get_throttled
```

GitHub Actions builds/tests the service, companion and native app. Physical Pi
performance and audio recovery require the hardware checks above.
