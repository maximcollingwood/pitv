import { Outlet } from "react-router-dom";
import { RemoteListener } from "./RemoteListener";
import { RemoteBadge } from "./RemoteBadge";
import { BackgroundAudio } from "./BackgroundAudio";

// Shared shell for all TV (remote-driven) pages: the SSE remote listener, the
// background-audio player + bar (persists across navigation), and the
// always-present "scan to control" QR badge.
export function TvLayout() {
  return (
    <>
      <RemoteListener />
      <BackgroundAudio />
      <Outlet />
      <RemoteBadge />
    </>
  );
}
