import { Outlet } from "react-router-dom";
import { RemoteListener } from "./RemoteListener";
import { RemoteBadge } from "./RemoteBadge";

// Shared shell for all TV (remote-driven) pages: the SSE remote listener and
// the always-present "scan to control" QR badge.
export function TvLayout() {
  return (
    <>
      <RemoteListener />
      <Outlet />
      <RemoteBadge />
    </>
  );
}
