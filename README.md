# PiTV

A Raspberry Pi media appliance for shared reading, lyrics, video and background
music. The TV runs a **native Qt Quick application with libmpv playback**.
Phones use a small web companion for remote control and PIN-protected editing.

Administrators paste YouTube links. Videos stream from YouTube when played, like
on a TV box; background music is downloaded to the Pi so it plays without
internet. Browsing content does not depend on an internet connection; videos do.

## Architecture

- `native/`: C++/Qt 6 Quick television UI, local navigation, QR remote pairing,
  cached content snapshot, libmpv audio/video and playback recovery.
- `server/`: Fastify/TypeScript API, SQLite content, YouTube stream lookups and
  relay (`streams.ts`), background-music downloads, ranged local media serving
  and unbuffered live control events.
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

For real videos and music, install FFmpeg/ffprobe and `yt-dlp[default]`. yt-dlp
uses Node as its YouTube JavaScript challenge runtime. Set `YTDLP_PATH` when the
executable is outside PATH. Background-music downloads are listed in the editor's
media preparation view; failed ones can be retried there or on the TV.

## Build the native application on Linux

The baseline is Debian Bookworm / 64-bit Raspberry Pi OS with Qt 6.4 and
libmpv 0.35 or later. Install packages listed in
`ansible/roles/native/tasks/main.yml`, or provision the development VM below.

```sh
cmake -S native -B native/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --parallel 2
ctest --test-dir native/build --output-on-failure
PITV_API_URL=http://127.0.0.1:3000 ./native/build/pitv-native
```

Run the app in a graphical Linux session for video. libmpv draws the video with
OpenGL into the Qt Quick scene; the Pi runs the app with `QT_QPA_PLATFORM=xcb`
under labwc's Xwayland. Video is decoded in software: the Pi 4's hardware H.264
decoder (`bcm2835-codec`) stops answering when flushed for a seek, freezing the
picture and the sound, while software decoding of 1080p takes about 15% of the
Pi's CPU. Unit/UI smoke tests also run headlessly, without an HDMI display. The
source includes a sample library fixture.

The playback integration check generates a short picture-only clip and a
sound-only clip, plays them together through Qt/libmpv under Xvfb (as a YouTube
stream plays), and records a private PipeWire output to verify audio samples. It requires FFmpeg, Xvfb, PipeWire, WirePlumber, `pulseaudio-utils` and
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

To work with real content, copy a Pi's database, uploaded images and downloaded
music into the VM. The Pi is only read; the VM's previous database is kept in
`/var/lib/pitv/vm-before-pull-*.db`. Run from Git Bash with the VM running:

```sh
bash tools/pull-pi-content.sh
```

It defaults to `pitv@raspberrypi.local` over SSH (key auth; set `PITV_SSH_KEY`
for a key file other than `~/.ssh/id_ed25519_pitv`). Add `--no-media` to skip the
music files. The admin PIN is not copied: the VM keeps its own in
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
- `pitv-backend.service`: API, YouTube stream relay and music downloads.
- `pitv-update-ytdlp.timer`: installs each new yt-dlp release daily.
- nginx: phone companion, API proxy and uploaded images.
- PipeWire/WirePlumber: HDMI output, hotplug recovery and no idle suspension.

The native application controls playback gain using the persisted volume setting.
The hardware sink is kept at unity. Volume changes no longer run sudo or
spawn a shell. Ctrl+Alt+F2 opens the login console; Ctrl+Alt+F1 returns to the TV.

Change `ADMIN_PIN` in `/etc/kiosk/admin.env` and restart `pitv-backend`. An optional
`/etc/kiosk/media.env` holds media configuration overrides. The old YouTube Data
API key is no longer required. Keep device secrets outside Git.

## Video streaming

Videos play straight from YouTube, as on a TV box; nothing is downloaded. When a
video is chosen, the server looks up its streams with yt-dlp (a few seconds; a
video highlighted on the TV is looked up ahead, so it usually starts at once) and
picks H.264 up to 1080p at 30 frames per second, with AAC sound. Above 360p
YouTube sends picture and sound separately; the TV's player (libmpv) plays the
two together, reading about two minutes ahead into memory, so seeking nearby is
instant.

The player reads the streams through a relay in the server (`/api/stream/:id/…`,
loopback only). YouTube holds a long or open-ended request to about 5 Mbit/s
but serves requests of 10 MB or less at full speed (about 45 Mbit/s on the
library's connection), so the relay fetches in 8 MB pieces. Stream addresses
expire after about six hours and only work from the device that looked them up;
the relay looks an expired address up again mid-stream. A stream that stops
loading reconnects where it stopped, three times before the TV asks for help.

yt-dlp has to keep up with YouTube's changes, so `pitv-update-ytdlp.timer`
installs each new release daily and goes back if one does not start.
`yt_dlp_version` is only the oldest release the device accepts. Videos need the
internet; when YouTube or the connection is down, the TV says so and the rest of
the library still works.

## Channels and live streams

A video section can also hold YouTube channels. Paste a channel's link
(`youtube.com/@name`, from any of its tabs) and the TV shows the channel's page:
"● Live now" first while it is streaming, then its latest 30 videos, then its
playlists. The lists come from yt-dlp's quick listing of the channel's tabs (about a
second each) and are read again after an hour; whether the channel is live is read
again every 90 seconds while someone has the page open.

Paste a channel's live link (`youtube.com/@name/live`) for a tile that tunes straight
in to whatever the channel is streaming; when nothing is on, the TV says so and
Select checks again. Live streams come as YouTube's HLS playlist, read straight from
YouTube (their pieces are small, so they are not held back); the player picks the
best H.264 quality up to 1080p at 30 frames per second and shows a red LIVE badge in
place of the time bar. A broadcast that ends says so.

## Background music

Background tracks are downloaded so the music plays without internet. The worker
handles one job at a time, persists queue/retry state, validates completed files
with ffprobe and exposes only completed media. Copies of videos downloaded by
earlier versions are deleted when the server starts.

| Setting | Default | Purpose |
| --- | --- | --- |
| `MEDIA_CACHE_LIMIT_MB` | 4096 | Managed storage budget, including preparation space |
| `MEDIA_MAX_ASSET_MB` | 512 | Maximum completed file size |
| `MEDIA_QUEUE_LIMIT` | 200 | Pending job limit |
| `MEDIA_MIN_FREE_MB` | 256 | Free disk space reserve |
| `MEDIA_MAX_ATTEMPTS` | 3 | Automatic attempts before showing a retry action |
| `MEDIA_JOB_TIMEOUT_MS` | 1800000 | Time limit per preparation job |

Older music files may be removed to make room; the playing track is protected.
Playlist discovery (listing a playlist's videos) is capped at 500 entries, with
metadata refreshed after six hours.

## Verification on the Pi

Before putting a rewritten installation into service, verify:

- Boot with internet disconnected; browse cached content and play background music;
  a video says it cannot reach YouTube.
- Navigate long lists and lyrics; measure frame timing and remote input latency.
- Play a 1080p video, seek repeatedly in both directions and leave the player;
  the picture and the background music must carry on, and
  `journalctl -k -b | grep bcm2835-codec` must stay empty (software decoding).
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
