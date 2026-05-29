import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type MediaItem, type MediaType } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";
import { setCurrentEnter } from "../lib/remoteFocus";
import { parseYouTube, loadYouTubeApi } from "../lib/youtube";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Player() {
  useRemoteBack();
  const { type, id } = useParams();
  const [item, setItem] = useState<MediaItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  // There are no focusable tiles here, so make sure a stale tile action can't
  // fire when OK is pressed.
  useEffect(() => {
    setCurrentEnter(null);
  }, []);

  useEffect(() => {
    if (!type || !id) return;
    api
      .media(type as MediaType)
      .then((all) => {
        const found = all.find((i) => String(i.id) === id);
        if (found) setItem(found);
        else setError("Not found.");
      })
      .catch(() => setError("Could not load."));
  }, [type, id]);

  // Build the YouTube IFrame player and autostart playback.
  useEffect(() => {
    if (!item || !mountRef.current) return;
    const parsed = parseYouTube(item.youtube_url);
    if (parsed.kind === "unknown") {
      setError("This item has no valid video link.");
      return;
    }

    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current) return;
      const YT = (window as any).YT;
      const playerVars: any = {
        autoplay: 1,
        rel: 0,
        playsinline: 1,
        modestbranding: 1,
      };
      const config: any = {
        width: "100%",
        height: "100%",
        playerVars,
        events: { onReady: (e: any) => e.target.playVideo() },
      };
      if (parsed.kind === "playlist") {
        playerVars.listType = "playlist";
        playerVars.list = parsed.id;
      } else {
        config.videoId = parsed.id;
      }
      playerRef.current = new YT.Player(mountRef.current, config);
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
  }, [item]);

  // OK (select) on the remote toggles play/pause.
  useEffect(() => {
    const onRemote = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      const p = playerRef.current;
      if (!p || action !== "select") return;
      if (p.getPlayerState?.() === 1) p.pauseVideo?.(); // 1 === playing
      else p.playVideo?.();
    };
    window.addEventListener("pitv:remote", onRemote);
    return () => window.removeEventListener("pitv:remote", onRemote);
  }, []);

  if (error) return <div className="page"><p className="error">{error}</p></div>;

  return (
    <div className="player">
      <div className="player__frame" ref={mountRef} />
      <p className="player__hint">OK to play / pause · Back to return</p>
    </div>
  );
}
