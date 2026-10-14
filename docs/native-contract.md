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
- `{ "type": "remote", "action": "up|down|left|right|select|back|home" }`
- `{ "type": "background", "tracks": [], "state": {"trackId":null,"playing":false} }`
- `{ "type": "volume", "level": 0.05 }`
- `{ "type": "media", "asset": { ... } }`

The initial connection sends a library invalidation. Remote actions are ephemeral;
do not replay old navigation after a disconnected screen reconnects. Refresh the
snapshot after reconnect. Keepalive frames arrive every 15 seconds.

`POST /api/device/status` from loopback is the native heartbeat, every 5 seconds:
`{page,title,playing,position,duration,error}`. `GET /api/device/status` adds
`connected` and `updatedAt` for the phone. The backend accepts writes only from
loopback; nginx must prevent external clients from using its loopback proxy to
write status. Public `/api/system/volume` stores/publishes the desired level;
the native player applies it (no sudo subprocess per volume change).

## Prepared media

`POST /api/media/prepare` with `{ "url": "YouTube URL", "kind": "audio|video" }`
returns an asset. `GET /api/media/:key` polls the same asset. Assets have:

```json
{"key":"stable-key","sourceUrl":"https://www.youtube.com/watch?v=...","kind":"video","status":"queued","title":"","playbackUrl":null,"progress":0,"error":null}
```

Statuses: `queued`, `downloading`, `ready`, `error`. `progress` is 0–100.
`playbackUrl` is a same-origin relative URL served with HTTP range support, only
present after the complete file has been validated. The native client resolves
relative URLs against PITV_API_URL, polls while preparing, and shows actionable
errors with a retry action. No partial download is exposed as ready.

Saving a video/background link queues preparation automatically. Media titles may
be omitted: the worker fills them from YouTube metadata. Playlist URLs are detected
automatically. `GET /api/playlist?list=...` returns cached `{videos:[{id,title}],
source:"cache|extractor|api|rss",status:"queued|downloading|ready|error",error:null}`;
it queues discovery and returns promptly. Discovery prepares videos in order with
a bounded queue/cache; selecting any entry may enqueue it on demand.

`GET /api/admin/media` lists `{assets:[...],playlists:[...],cacheBytes,cacheLimitBytes}`.
Playlist records contain `{id,title,sourceUrl,status,error,videoCount}`, including
discovery failures that have not produced any assets. Listing never requeues work;
`GET /api/playlist?list=ID&retry=1` explicitly retries playlist discovery.
`POST /api/admin/media/:key/retry` requeues a failed asset. The admin endpoints
require the normal bearer token. Media messages and snapshot invalidations update clients.

## Persistence and recovery

Schema changes are additive. Normal development startup and device deployment
must never reset existing content. Media jobs survive restarts and retry with
backoff; partials stay private and storage is bounded. Local interface/content and
ready media need no WAN connection. YouTube imports require internet and may fail
for unavailable or restricted content. yt-dlp is an independently updateable tool.
