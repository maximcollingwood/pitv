# Native kiosk integration contract

The TV is a Qt 6 Quick application. The Node service owns the content database,
media preparation, and LAN control API. All existing content/admin APIs remain.
The phone remains a web client. The native process defaults to
`PITV_API_URL=http://127.0.0.1:3000` and never renders a web page or YouTube iframe.

## Snapshot and events

`GET /api/library` returns:

```json
{
  "config": {"title":"PiTV","subtitle":"","dark":true,"hero":"","sections":[]},
  "items": {"1":[]},
  "background": {"tracks":[],"state":{"trackId":null,"playing":false}},
  "info": {"hostname":"pitv","remoteUrl":"http://pitv.local/remote","adminUrl":"http://pitv.local/admin"},
  "volume": 0.05
}
```

`GET /api/device/events` is a persistent, unbuffered SSE connection. All messages
use ordinary `data:` frames containing one of:

- `{ "type": "library" }`: fetch a new snapshot asynchronously.
- `{ "type": "remote", "action": "up|down|left|right|select|back|home|power" }`:
  `power` turns the TV off, or on and over to PiTV, over HDMI-CEC.
- `{ "type": "background", "tracks": [], "state": {"trackId":null,"playing":false} }`
- `{ "type": "volume", "level": 0.05 }`
- `{ "type": "tvVolume", "available": true, "level": 27, "muted": false }`: the TV's own
  volume (a paired Vizio SmartCast TV), published when it changes. The library
  snapshot carries the same object as `tv`. While `available`, the player's up and
  down send `POST /api/tv/volume` with `{ "step": 2 }` or `{ "step": -2 }`.
- `{ "type": "media", "asset": { ... } }`

The initial connection sends a library invalidation. Remote actions are ephemeral;
do not replay old navigation after a disconnected screen reconnects. Refresh the
snapshot after reconnect. Keepalive frames arrive every 15 seconds.

`POST /api/device/status` from loopback is the native heartbeat, every 5 seconds:
`{page,title,playing,position,duration,error,tv}`, where `tv` is the TV's power as
followed over HDMI-CEC (`"on"`, `"standby"`, or null without CEC). `GET /api/device/status` adds
`connected` and `updatedAt` for the phone. The backend accepts writes only from
loopback; nginx must prevent external clients from using its loopback proxy to
write status. Public `/api/system/volume` stores/publishes the desired level;
the native player applies it (no sudo subprocess per volume change).

## Video streams

Videos stream from YouTube; nothing is downloaded. These endpoints accept only
loopback clients (and nginx refuses `/api/stream` from the network).

`GET /api/stream?url=YouTube URL[&fresh=1]` looks a video up (a few seconds the
first time, cached until its addresses near expiry; `fresh=1` looks it up again
after playback failed) and returns:

```json
{"id":"dQw4w9WgXcQ","title":"…","duration":1755,"live":false,"video":"/api/stream/dQw4w9WgXcQ/video","audio":"/api/stream/dQw4w9WgXcQ/audio","userAgent":null,"headers":{}}
```

`video` is the picture (or picture and sound together), `audio` the separate sound
or null. Relative URLs are the relay: `GET|HEAD /api/stream/:id/video|audio` serves
the stream with HTTP range support, fetching from YouTube in 8 MB pieces (YouTube
throttles longer requests) and looking an expired address up again mid-stream. A
live video's `video` is YouTube's own HLS address, opened with `userAgent` and
`headers`. Failures are `{error}` with 400 (not a YouTube video), 502 (YouTube
refused or is unreachable; the message is YouTube's, made readable) or 404.

`POST /api/stream/warm {url}` looks a video up in the background (202), so it starts
at once when chosen; the TV sends it for the highlighted video. The native player
plays `video` and `audio` together, resolves relative URLs against PITV_API_URL,
reopens a failed stream with `fresh=1` where it stopped (three times before showing
the error with a retry action), and treats a stream that buffers for 25 seconds as
failed. Saving a video link looks it up in the background to fill a missing title.

## Background music

`POST /api/media/prepare` with `{ "url": "YouTube URL", "kind": "audio" }` returns
an asset (`kind: "video"` is refused: videos stream). `GET /api/media/:key` polls
the same asset. Assets have:

```json
{"key":"stable-key","sourceUrl":"https://www.youtube.com/watch?v=...","kind":"audio","status":"queued","title":"","playbackUrl":null,"progress":0,"error":null}
```

Statuses: `queued`, `downloading`, `ready`, `error`. `progress` is 0–100.
`playbackUrl` is a same-origin relative URL served with HTTP range support, only
present after the complete file has been validated. The native client resolves
relative URLs against PITV_API_URL, polls while preparing, and shows actionable
errors with a retry action. No partial download is exposed as ready.

Saving a background link queues its download automatically. Titles may be
omitted: the worker fills them from YouTube metadata. Playlist URLs are detected
automatically. `GET /api/playlist?list=...` returns cached `{videos:[{id,title}],
source:"cache|extractor|api|rss",status:"queued|downloading|ready|error",error:null}`;
it queues discovery and returns promptly.

`GET /api/admin/media` lists `{assets:[...],playlists:[...],cacheBytes,cacheLimitBytes}`.
Playlist records contain `{id,title,sourceUrl,status,error,videoCount}`, including
discovery failures. Listing never requeues work;
`GET /api/playlist?list=ID&retry=1` explicitly retries playlist discovery.
`POST /api/admin/media/:key/retry` requeues a failed asset. The admin endpoints
require the normal bearer token. Media messages and snapshot invalidations update clients.

## Persistence and recovery

Schema changes are additive. Normal development startup and device deployment
must never reset existing content. Media jobs survive restarts and retry with
backoff; partials stay private and storage is bounded. Local interface/content and
ready media need no WAN connection. YouTube imports require internet and may fail
for unavailable or restricted content. yt-dlp is an independently updateable tool.
