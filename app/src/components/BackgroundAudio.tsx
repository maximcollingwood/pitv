import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { api, type BgState, type BgTrack } from "../lib/api";
import { setCurrentEnter } from "../lib/remoteFocus";
import { parseYouTube, loadYouTubeApi } from "../lib/youtube";
import { isImmersiveRoute } from "../lib/immersive";

/* eslint-disable @typescript-eslint/no-explicit-any */

function BgTile({
  focusKey,
  onEnter,
  className,
  children,
}: {
  focusKey: string;
  onEnter?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onEnter });
  // Match the standard Tile pattern: while focused, register the action so the
  // phone remote's OK (which goes through fireEnter, not norigin's key listener)
  // fires THIS tile's handler instead of the previously-focused page tile's.
  useEffect(() => {
    if (focused) setCurrentEnter(onEnter ?? null);
  }, [focused, onEnter]);
  return (
    <div
      ref={ref}
      className={`bg-bar__btn${focused ? " bg-bar__btn--focused" : ""} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

export function BackgroundAudio() {
  const navigate = useNavigate();
  const location = useLocation();
  // Hide the bar on any immersive screen (player + lyrics). Only the *video*
  // player should also pause playback — on lyrics we keep the music going so
  // people can sing along.
  const hideBar = isImmersiveRoute(location.pathname);
  const pauseAudio = location.pathname.startsWith("/play");

  const [tracks, setTracks] = useState<BgTrack[]>([]);
  const [state, setState] = useState<BgState>({ trackId: null, playing: false });

  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const currentVideoRef = useRef<string>("");

  // Reserve top padding only when the bar is visible.
  useEffect(() => {
    document.body.classList.toggle("tv-with-bg-bar", !hideBar);
    return () => document.body.classList.remove("tv-with-bg-bar");
  }, [hideBar]);

  // Fetch tracks once.
  useEffect(() => {
    api.backgroundTracks().then(setTracks).catch(() => {});
  }, []);

  // Subscribe to live updates — the backend pushes BOTH the tracks list and
  // the state so newly-added tracks propagate without a restart.
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

  // Create the hidden YT player once.
  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current) return;
      const YT = (window as any).YT;
      playerRef.current = new YT.Player(mountRef.current, {
        width: "200",
        height: "200",
        playerVars: { autoplay: 0, rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: (e: any) => e.target.setVolume(100),
          onStateChange: (e: any) => {
            // Loop: when a video ENDs (state 0), replay it.
            if (e.data === 0) playerRef.current?.playVideo?.();
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, []);

  // React to state / route — load new video, play, or pause as needed.
  useEffect(() => {
    const p = playerRef.current;
    if (!p || typeof p.loadVideoById !== "function") return;
    const track = tracks.find((t) => t.id === state.trackId);
    const videoId = track ? parseYouTube(track.youtube_url).id : "";
    const wantPlay = state.playing && !pauseAudio && Boolean(videoId);

    if (wantPlay) {
      if (videoId !== currentVideoRef.current) {
        currentVideoRef.current = videoId;
        p.loadVideoById(videoId);
      } else if (p.getPlayerState && p.getPlayerState() !== 1) {
        p.playVideo?.();
      }
    } else {
      try {
        p.pauseVideo?.();
      } catch {
        /* ignore */
      }
    }
  }, [state, tracks, pauseAudio]);

  function togglePlay() {
    if (state.trackId == null) {
      // No selection yet — open the picker so the user can choose first.
      navigate("/background-picker");
      return;
    }
    api.setBackgroundState({ playing: !state.playing }).catch(() => {});
  }

  const track = tracks.find((t) => t.id === state.trackId);
  const trackLabel = track ? track.title : "Select a track";
  const stateLabel = state.playing ? "Playing" : "Paused";

  return (
    <>
      {!hideBar && (
        <div className="bg-bar">
          <span className="bg-bar__label">Background</span>
          <BgTile
            focusKey="bg-pick"
            className="bg-bar__pick"
            onEnter={() => navigate("/background-picker")}
          >
            {trackLabel}
          </BgTile>
          <BgTile focusKey="bg-play" onEnter={togglePlay}>
            {stateLabel}
          </BgTile>
        </div>
      )}
      {/* Off-screen YT iframe — audio plays through the system sink. */}
      <div className="bg-audio__player">
        <div ref={mountRef} />
      </div>
    </>
  );
}
