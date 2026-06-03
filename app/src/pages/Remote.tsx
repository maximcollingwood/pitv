import { useEffect, useRef, useState } from "react";
import { api, type BgState, type BgTrack, type RemoteAction } from "../lib/api";

function press(action: RemoteAction) {
    api.press(action);
    if (navigator.vibrate) navigator.vibrate(10); // brief haptic where supported
}

function BackgroundControl() {
    const [tracks, setTracks] = useState<BgTrack[]>([]);
    const [state, setState] = useState<BgState>({ trackId: null, playing: false });

    // Brief optimistic spinner after a user action — the phone doesn't know
    // when the TV's YT player has actually started, so we just give visual
    // feedback for ~1.5s. If the request fails, we drop the spinner early.
    const [pending, setPending] = useState(false);
    const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    function startPending() {
        setPending(true);
        if (pendingTimer.current) clearTimeout(pendingTimer.current);
        pendingTimer.current = setTimeout(() => setPending(false), 1500);
    }
    function clearPending() {
        setPending(false);
        if (pendingTimer.current) clearTimeout(pendingTimer.current);
    }
    useEffect(() => () => {
        if (pendingTimer.current) clearTimeout(pendingTimer.current);
    }, []);

    useEffect(() => {
        api.backgroundTracks().then(setTracks).catch(() => { });
    }, []);

    useEffect(() => {
        const src = new EventSource("/api/background/events");
        src.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data) as { tracks?: BgTrack[]; state?: BgState };
                if (msg.tracks) setTracks(msg.tracks);
                if (msg.state) setState(msg.state);
            } catch {
                /* ignore */
            }
        };
        return () => src.close();
    }, []);

    const onPick = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const v = e.target.value;
        const id = v === "" ? null : Number(v);
        startPending();
        api.setBackgroundState({ trackId: id, playing: id != null }).catch(clearPending);
    };

    const toggle = () => {
        if (state.trackId == null) return;
        startPending();
        api.setBackgroundState({ playing: !state.playing }).catch(clearPending);
    };

    return (
        <div className="bg-control">
            <select
                className="bg-control__select"
                value={state.trackId ?? ""}
                onChange={onPick}
                aria-label="Background audio track"
            >
                <option value="">— Background audio —</option>
                {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                        {t.title}
                    </option>
                ))}
            </select>
            <button
                className="btn btn--small"
                onClick={toggle}
                disabled={state.trackId == null || pending}
            >
                {pending ? <span className="spinner" aria-label="Loading" /> : (state.playing ? "Pause" : "Play")}
            </button>
        </div>
    );
}

export function Remote() {
    // Lock the page against scrolling/bounce so it behaves like a native remote.
    useEffect(() => {
        document.documentElement.classList.add("lock");
        document.body.classList.add("lock");
        return () => {
            document.documentElement.classList.remove("lock");
            document.body.classList.remove("lock");
        };
    }, []);

    // System-volume slider — controls the pi's default sink directly.
    const [vol, setVol] = useState<number | null>(null);
    const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        api
            .getVolume()
            .then((r) => setVol(r.level))
            .catch(() => setVol(0));
    }, []);

    function onSlide(e: React.ChangeEvent<HTMLInputElement>) {
        const v = Number(e.target.value) / 100;
        setVol(v); // optimistic
        if (sendTimer.current) clearTimeout(sendTimer.current);
        sendTimer.current = setTimeout(() => {
            api.setVolume(v).catch(() => { });
        }, 200);
    }

    const pct = vol == null ? 5 : Math.round(vol * 100);

    return (
        <div className="remote">
            <BackgroundControl />

            <div className="volume">
                <span className="volume__label">Vol</span>
                <input
                    className="volume__slider"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={pct}
                    onChange={onSlide}
                    aria-label="System volume"
                />
                <span className="volume__pct">{pct}%</span>
            </div>


            <div className="dpad">
                <button className="dpad__btn dpad__up" onClick={() => press("up")} aria-label="Up">▲</button>
                <button className="dpad__btn dpad__left" onClick={() => press("left")} aria-label="Left">◀</button>
                <button className="dpad__btn dpad__ok" onClick={() => press("select")}>OK</button>
                <button className="dpad__btn dpad__right" onClick={() => press("right")} aria-label="Right">▶</button>
                <button className="dpad__btn dpad__down" onClick={() => press("down")} aria-label="Down">▼</button>
            </div>

            <button className="btn remote__back" onClick={() => press("back")}>Back</button>

            <a className="remote__edit" href="/admin">Edit content</a>
        </div>
    );
}
