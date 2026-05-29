import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useRemoteBack } from "../lib/useRemoteBack";
import { setCurrentEnter } from "../lib/remoteFocus";
import { loadYouTubeApi } from "../lib/youtube";

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Player() {
  useRemoteBack();
  const { videoId } = useParams();
  const [flash, setFlash] = useState<string | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // No focusable tiles here, so OK must not fire a stale tile action.
  useEffect(() => {
    setCurrentEnter(null);
  }, []);

  // Build the IFrame player and autostart.
  useEffect(() => {
    if (!videoId || !mountRef.current) return;
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current) return;
      const YT = (window as any).YT;
      playerRef.current = new YT.Player(mountRef.current, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
        events: { onReady: (e: any) => e.target.playVideo() },
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
  }, [videoId]);

  // Remote controls: OK play/pause, left/right seek, up/down volume.
  useEffect(() => {
    const show = (msg: string) => {
      setFlash(msg);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 900);
    };
    const onRemote = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      const p = playerRef.current;
      if (!p) return;
      switch (action) {
        case "select":
          if (p.getPlayerState?.() === 1) {
            p.pauseVideo?.();
            show("Paused");
          } else {
            p.playVideo?.();
            show("Playing");
          }
          break;
        case "left":
          p.seekTo?.(Math.max(0, (p.getCurrentTime?.() ?? 0) - 10), true);
          show("« 10s");
          break;
        case "right":
          p.seekTo?.((p.getCurrentTime?.() ?? 0) + 10, true);
          show("10s »");
          break;
        case "up": {
          const v = clamp((p.getVolume?.() ?? 0) + 10);
          p.unMute?.();
          p.setVolume?.(v);
          show(`Volume ${v}%`);
          break;
        }
        case "down": {
          const v = clamp((p.getVolume?.() ?? 0) - 10);
          p.setVolume?.(v);
          show(`Volume ${v}%`);
          break;
        }
      }
    };
    window.addEventListener("pitv:remote", onRemote);
    return () => {
      window.removeEventListener("pitv:remote", onRemote);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  return (
    <div className="player">
      <div className="player__stage">
        <div className="player__frame" ref={mountRef} />
      </div>
      <p className="player__hint">
        OK to play/pause · Left/Right to seek · Up/Down for volume · Back to return
      </p>
      {flash && <div className="player__flash">{flash}</div>}
    </div>
  );
}
