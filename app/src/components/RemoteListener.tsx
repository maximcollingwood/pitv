import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { navigateByDirection } from "@noriginmedia/norigin-spatial-navigation";
import { fireEnter } from "../lib/remoteFocus";
import type { RemoteAction } from "../lib/api";

const DIRECTIONS = ["up", "down", "left", "right"] as const;

// Subscribes the TV to the backend's SSE relay and turns phone presses into
// on-screen navigation. Renders nothing.
export function RemoteListener() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const source = new EventSource("/api/remote/events"); // auto-reconnects

    source.onmessage = (e) => {
      let action: RemoteAction;
      try {
        action = JSON.parse(e.data).action;
      } catch {
        return;
      }

      // Default behaviors: move focus, activate the focused tile, or go back.
      if ((DIRECTIONS as readonly string[]).includes(action)) {
        navigateByDirection(action, {});
      } else if (action === "select") {
        fireEnter();
      } else if (action === "back") {
        if (location.pathname !== "/") navigate(-1);
      }

      // Broadcast so content pages can add behavior (reader scroll, player
      // play/pause) without coupling to the listener.
      window.dispatchEvent(new CustomEvent("pitv:remote", { detail: action }));
    };

    return () => source.close();
  }, [navigate, location.pathname]);

  return null;
}
